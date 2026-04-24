import { createHash } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentApiKeys, agents, authUsers, companyMemberships, heartbeatRuns, instanceUserRoles } from "@paperclipai/db";
import { verifyLocalAgentJwt } from "../agent-auth-jwt.js";
import type { DeploymentMode } from "@paperclipai/shared";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import { logger } from "./logger.js";
import { boardAuthService } from "../services/board-auth.js";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const TAILSCALE_AUTOLOGIN_ENABLED = process.env.PAPERCLIP_TAILSCALE_AUTOLOGIN_ENABLED === "true";
const TAILSCALE_AUTOLOGIN_USER_EMAIL = process.env.PAPERCLIP_TAILSCALE_AUTOLOGIN_USER_EMAIL?.trim().toLowerCase() || null;
const TAILSCALE_AUTOLOGIN_PROXY_TOKEN = process.env.PAPERCLIP_TAILSCALE_AUTOLOGIN_PROXY_TOKEN?.trim() || null;
const ACTIVE_RUN_AUTH_STATUSES = new Set(["queued", "running", "scheduled_retry"]);

interface ActorMiddlewareOptions {
  deploymentMode: DeploymentMode;
  resolveSession?: (req: Request) => Promise<BetterAuthSessionResult | null>;
}

async function resolveBoardActorForUser(
  db: Db,
  input: {
    userId: string;
    userName?: string | null;
    userEmail?: string | null;
    runId?: string;
    source: "session";
  },
) {
  const [roleRow, memberships] = await Promise.all([
    db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, input.userId), eq(instanceUserRoles.role, "instance_admin")))
      .then((rows) => rows[0] ?? null),
    db
      .select({
        companyId: companyMemberships.companyId,
        membershipRole: companyMemberships.membershipRole,
        status: companyMemberships.status,
      })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, input.userId),
          eq(companyMemberships.status, "active"),
        ),
      ),
  ]);

  return {
    type: "board" as const,
    userId: input.userId,
    userName: input.userName ?? null,
    userEmail: input.userEmail ?? null,
    companyIds: memberships.map((row) => row.companyId),
    memberships,
    isInstanceAdmin: Boolean(roleRow),
    runId: input.runId ?? undefined,
    source: input.source,
  };
}

async function resolveTailscaleAutologinActor(
  db: Db,
  req: Request,
  runIdHeader?: string,
) {
  if (!TAILSCALE_AUTOLOGIN_ENABLED || !TAILSCALE_AUTOLOGIN_USER_EMAIL || !TAILSCALE_AUTOLOGIN_PROXY_TOKEN) {
    return null;
  }

  const requestToken = req.header("x-paperclip-tailscale-autologin")?.trim();
  if (!requestToken || requestToken !== TAILSCALE_AUTOLOGIN_PROXY_TOKEN) {
    return null;
  }

  const user = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      name: authUsers.name,
    })
    .from(authUsers)
    .where(eq(authUsers.email, TAILSCALE_AUTOLOGIN_USER_EMAIL))
    .then((rows) => rows[0] ?? null);

  if (!user) {
    logger.warn(
      { autoLoginEmail: TAILSCALE_AUTOLOGIN_USER_EMAIL, method: req.method, url: req.originalUrl },
      "Tailscale autologin user was not found",
    );
    return null;
  }

  return resolveBoardActorForUser(db, {
    userId: user.id,
    userName: user.name ?? null,
    userEmail: user.email ?? null,
    runId: runIdHeader,
    source: "session",
  });
}

function isPrivateRuntimeAddress(value?: string | null) {
  if (!value) return false;
  const address = value.replace(/^::ffff:/, "");
  if (address === "::1" || address === "127.0.0.1" || address === "localhost") return true;
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;
  const match172 = address.match(/^172\.(\d+)\./);
  if (match172) {
    const octet = Number(match172[1]);
    return octet >= 16 && octet <= 31;
  }
  return false;
}

function isPrivateRuntimeRequest(req: Request) {
  return isPrivateRuntimeAddress(req.ip) || isPrivateRuntimeAddress(req.socket.remoteAddress);
}

async function resolvePrivateRunActor(db: Db, req: Request, runIdHeader?: string | null) {
  const runId = runIdHeader?.trim();
  if (!runId || !isPrivateRuntimeRequest(req)) return null;

  const run = await db
    .select({
      id: heartbeatRuns.id,
      status: heartbeatRuns.status,
      agentId: heartbeatRuns.agentId,
      companyId: heartbeatRuns.companyId,
      agentStatus: agents.status,
    })
    .from(heartbeatRuns)
    .innerJoin(agents, eq(heartbeatRuns.agentId, agents.id))
    .where(eq(heartbeatRuns.id, runId))
    .then((rows) => rows[0] ?? null);

  if (!run || !ACTIVE_RUN_AUTH_STATUSES.has(run.status)) return null;
  if (run.agentStatus === "terminated" || run.agentStatus === "pending_approval") return null;

  return {
    type: "agent" as const,
    agentId: run.agentId,
    companyId: run.companyId,
    keyId: undefined,
    runId: run.id,
    source: "agent_key" as const,
  };
}

export function actorMiddleware(db: Db, opts: ActorMiddlewareOptions): RequestHandler {
  const boardAuth = boardAuthService(db);
  return async (req, _res, next) => {
    req.actor =
      opts.deploymentMode === "local_trusted"
        ? {
            type: "board",
            userId: "local-board",
            userName: "Local Board",
            userEmail: null,
            isInstanceAdmin: true,
            source: "local_implicit",
          }
        : { type: "none", source: "none" };

    const runIdHeader = req.header("x-paperclip-run-id");

    const authHeader = req.header("authorization");
    if (!authHeader?.toLowerCase().startsWith("bearer ")) {
      if (opts.deploymentMode === "authenticated" && opts.resolveSession) {
        let session: BetterAuthSessionResult | null = null;
        try {
          session = await opts.resolveSession(req);
        } catch (err) {
          logger.warn(
            { err, method: req.method, url: req.originalUrl },
            "Failed to resolve auth session from request headers",
          );
        }
        if (session?.user?.id) {
          req.actor = await resolveBoardActorForUser(db, {
            userId: session.user.id,
            userName: session.user.name ?? null,
            userEmail: session.user.email ?? null,
            runId: runIdHeader ?? undefined,
            source: "session",
          });
          next();
          return;
        }

        const autoLoginActor = await resolveTailscaleAutologinActor(db, req, runIdHeader ?? undefined);
        if (autoLoginActor) {
          req.actor = autoLoginActor;
          next();
          return;
        }
      }
      const privateRunActor = await resolvePrivateRunActor(db, req, runIdHeader);
      if (privateRunActor) {
        req.actor = privateRunActor;
        next();
        return;
      }
      if (runIdHeader) req.actor.runId = runIdHeader;
      next();
      return;
    }

    const token = authHeader.slice("bearer ".length).trim();
    if (!token) {
      next();
      return;
    }

    const boardKey = await boardAuth.findBoardApiKeyByToken(token);
    if (boardKey) {
      const access = await boardAuth.resolveBoardAccess(boardKey.userId);
      if (access.user) {
        await boardAuth.touchBoardApiKey(boardKey.id);
        req.actor = {
          type: "board",
          userId: boardKey.userId,
          userName: access.user?.name ?? null,
          userEmail: access.user?.email ?? null,
          companyIds: access.companyIds,
          memberships: access.memberships,
          isInstanceAdmin: access.isInstanceAdmin,
          keyId: boardKey.id,
          runId: runIdHeader || undefined,
          source: "board_key",
        };
        next();
        return;
      }
    }

    const tokenHash = hashToken(token);
    const key = await db
      .select()
      .from(agentApiKeys)
      .where(and(eq(agentApiKeys.keyHash, tokenHash), isNull(agentApiKeys.revokedAt)))
      .then((rows) => rows[0] ?? null);

    if (!key) {
      const claims = verifyLocalAgentJwt(token);
      if (!claims) {
        next();
        return;
      }

      const agentRecord = await db
        .select()
        .from(agents)
        .where(eq(agents.id, claims.sub))
        .then((rows) => rows[0] ?? null);

      if (!agentRecord || agentRecord.companyId !== claims.company_id) {
        next();
        return;
      }

      if (agentRecord.status === "terminated" || agentRecord.status === "pending_approval") {
        next();
        return;
      }

      req.actor = {
        type: "agent",
        agentId: claims.sub,
        companyId: claims.company_id,
        keyId: undefined,
        runId: runIdHeader || claims.run_id || undefined,
        source: "agent_jwt",
      };
      next();
      return;
    }

    await db
      .update(agentApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(agentApiKeys.id, key.id));

    const agentRecord = await db
      .select()
      .from(agents)
      .where(eq(agents.id, key.agentId))
      .then((rows) => rows[0] ?? null);

    if (!agentRecord || agentRecord.status === "terminated" || agentRecord.status === "pending_approval") {
      next();
      return;
    }

    req.actor = {
      type: "agent",
      agentId: key.agentId,
      companyId: key.companyId,
      keyId: key.id,
      runId: runIdHeader || undefined,
      source: "agent_key",
    };

    next();
  };
}

export function requireBoard(req: Express.Request) {
  return req.actor.type === "board";
}
