import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentApiKeys, agents, authUsers, companies, companyMemberships, heartbeatRuns, instanceUserRoles } from "@paperclipai/db";
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
        const cloudTenantActor = await resolveCloudTenantActor(db, req);
        if (cloudTenantActor) {
          req.actor = {
            ...cloudTenantActor,
            runId: runIdHeader ?? undefined,
          };
          next();
          return;
        }

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

async function resolveCloudTenantActor(db: Db, req: Request): Promise<Express.Request["actor"] | null> {
  const expectedToken = process.env.PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN?.trim();
  if (!expectedToken) return null;

  const token = req.header("x-paperclip-cloud-tenant-token")?.trim();
  if (!token || !constantTimeStringEqual(token, expectedToken)) return null;

  const userId = requiredCloudHeader(req, "x-paperclip-cloud-user-id");
  const userEmail = requiredCloudHeader(req, "x-paperclip-cloud-user-email").toLowerCase();
  const stackId = requiredCloudHeader(req, "x-paperclip-cloud-stack-id");
  const stackRole = stackMembershipRole(req.header("x-paperclip-cloud-stack-role"));
  const userName = req.header("x-paperclip-cloud-user-name")?.trim() || userEmail;
  const paperclipCompanyId = req.header("x-paperclip-cloud-paperclip-company-id")?.trim();
  const companyId = cloudTenantCompanyId(stackId);
  const companyName = paperclipCompanyId || `${stackId} Paperclip`;
  const now = new Date();

  await db
    .insert(authUsers)
    .values({
      id: userId,
      name: userName,
      email: userEmail,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: authUsers.id,
      set: {
        name: userName,
        email: userEmail,
        emailVerified: true,
        updatedAt: now,
      },
    });

  await db
    .insert(instanceUserRoles)
    .values({
      userId,
      role: "instance_admin",
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [instanceUserRoles.userId, instanceUserRoles.role],
    });

  await db
    .insert(companies)
    .values({
      id: companyId,
      name: companyName,
      description: `Provisioned by Paperclip Cloud for stack ${stackId}.`,
      status: "active",
      issuePrefix: issuePrefixForCloudStack(stackId),
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: companies.id,
    });

  const membershipRole = stackRole === "owner" || stackRole === "admin" ? "owner" : stackRole;
  const membership = await db
    .insert(companyMemberships)
    .values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        companyMemberships.companyId,
        companyMemberships.principalType,
        companyMemberships.principalId,
      ],
      set: {
        status: "active",
        membershipRole,
        updatedAt: now,
      },
    })
    .returning()
    .then((rows) => rows[0] ?? {
      companyId,
      membershipRole,
      status: "active",
    });

  return {
    type: "board",
    userId,
    userName,
    userEmail,
    companyIds: [companyId],
    memberships: [{
      companyId,
      membershipRole: membership.membershipRole,
      status: membership.status,
    }],
    isInstanceAdmin: true,
    source: "cloud_tenant",
  };
}

function requiredCloudHeader(req: Request, name: string): string {
  const value = req.header(name)?.trim();
  if (!value) {
    throw new Error(`Missing trusted Cloud tenant header ${name}`);
  }
  return value;
}

function stackMembershipRole(value: string | undefined): "owner" | "admin" | "member" | "support" {
  if (value === "owner" || value === "admin" || value === "member" || value === "support") {
    return value;
  }
  throw new Error("Invalid trusted Cloud tenant stack role");
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cloudTenantCompanyId(stackId: string): string {
  const bytes = createHash("sha256").update(`paperclip-cloud-tenant-company:${stackId}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function issuePrefixForCloudStack(stackId: string): string {
  const hash = createHash("sha256").update(stackId).digest("hex").slice(0, 4).toUpperCase();
  return `PC${hash}`;
}

export function requireBoard(req: Express.Request) {
  return req.actor.type === "board";
}
