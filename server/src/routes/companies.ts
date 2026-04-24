import { Router, type Request } from "express";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { pluginCompanySettings, plugins } from "@paperclipai/db";
import {
  DEFAULT_FEEDBACK_DATA_SHARING_TERMS_VERSION,
  companyPortabilityExportSchema,
  companyPortabilityImportSchema,
  companyPortabilityPreviewSchema,
  createCompanySchema,
  feedbackTargetTypeSchema,
  feedbackTraceStatusSchema,
  feedbackVoteValueSchema,
  updateCompanyBrandingSchema,
  updateCompanySchema,
} from "@paperclipai/shared";
import { badRequest, forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  agentService,
  budgetService,
  companyPortabilityService,
  companyService,
  feedbackService,
  logActivity,
} from "../services/index.js";
import type { StorageService } from "../storage/types.js";
import { assertBoard, assertCompanyAccess, assertInstanceAdmin, getActorInfo } from "./authz.js";

export function companyRoutes(db: Db, storage?: StorageService) {
  const router = Router();
  const svc = companyService(db);
  const agents = agentService(db);
  const portability = companyPortabilityService(db, storage);
  const access = accessService(db);
  const budgets = budgetService(db);
  const feedback = feedbackService(db);

  function parseBooleanQuery(value: unknown) {
    return value === true || value === "true" || value === "1";
  }

  function parseDateQuery(value: unknown, field: string) {
    if (typeof value !== "string" || value.trim().length === 0) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw badRequest(`Invalid ${field} query value`);
    }
    return parsed;
  }

  function assertImportTargetAccess(
    req: Request,
    target: { mode: "new_company" } | { mode: "existing_company"; companyId: string },
  ) {
    if (target.mode === "new_company") {
      assertInstanceAdmin(req);
      return;
    }
    assertCompanyAccess(req, target.companyId);
  }

  async function assertCanUpdateBranding(req: Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") return;
    if (!req.actor.agentId) throw forbidden("Agent authentication required");

    const actorAgent = await agents.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.companyId !== companyId) {
      throw forbidden("Agent key cannot access another company");
    }
    if (actorAgent.role !== "ceo") {
      throw forbidden("Only CEO agents can update company branding");
    }
  }

  async function assertCanManagePortability(req: Request, companyId: string, capability: "imports" | "exports") {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") return;
    if (!req.actor.agentId) throw forbidden("Agent authentication required");

    const actorAgent = await agents.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.companyId !== companyId) {
      throw forbidden("Agent key cannot access another company");
    }
    if (actorAgent.role !== "ceo") {
      throw forbidden(`Only CEO agents can manage company ${capability}`);
    }
  }

  router.get("/", async (req, res) => {
    assertBoard(req);
    const result = await svc.list();
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      res.json(result);
      return;
    }
    const allowed = new Set(req.actor.companyIds ?? []);
    res.json(result.filter((company) => allowed.has(company.id)));
  });

  router.get("/stats", async (req, res) => {
    assertBoard(req);
    const allowed = req.actor.source === "local_implicit" || req.actor.isInstanceAdmin
      ? null
      : new Set(req.actor.companyIds ?? []);
    const stats = await svc.stats();
    if (!allowed) {
      res.json(stats);
      return;
    }
    const filtered = Object.fromEntries(Object.entries(stats).filter(([companyId]) => allowed.has(companyId)));
    res.json(filtered);
  });

  // Common malformed path when companyId is empty in "/api/companies/{companyId}/issues".
  router.get("/issues", (_req, res) => {
    res.status(400).json({
      error: "Missing companyId in path. Use /api/companies/{companyId}/issues.",
    });
  });

  router.get("/:companyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    // Allow agents (CEO) to read their own company; board always allowed
    if (req.actor.type !== "agent") {
      assertBoard(req);
    }
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json(company);
  });

  router.get("/:companyId/plugins", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select({
        id: plugins.id,
        pluginKey: plugins.pluginKey,
        packageName: plugins.packageName,
        version: plugins.version,
        status: plugins.status,
        manifestJson: plugins.manifestJson,
        companyEnabled: pluginCompanySettings.enabled,
        companySettings: pluginCompanySettings.settingsJson,
        companyLastError: pluginCompanySettings.lastError,
        lastError: plugins.lastError,
        updatedAt: plugins.updatedAt,
      })
      .from(plugins)
      .leftJoin(
        pluginCompanySettings,
        and(eq(pluginCompanySettings.pluginId, plugins.id), eq(pluginCompanySettings.companyId, companyId)),
      );
    res.json(
      rows.map((row) => ({
        id: row.id,
        pluginKey: row.pluginKey,
        packageName: row.packageName,
        version: row.version,
        status: row.status,
        enabledForCompany: row.companyEnabled ?? row.status === "ready",
        displayName: typeof row.manifestJson?.displayName === "string" ? row.manifestJson.displayName : row.pluginKey,
        categories: row.manifestJson?.categories ?? [],
        capabilities: row.manifestJson?.capabilities ?? {},
        settings: row.companySettings ?? {},
        lastError: row.companyLastError ?? row.lastError ?? null,
        updatedAt: row.updatedAt,
      })),
    );
  });

  router.get("/:companyId/plugin-registry", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({
      endpoint: `/api/companies/${companyId}/plugins`,
      note: "Use the company plugins endpoint for installed plugin inventory and company enablement state.",
    });
  });

  router.get("/:companyId/connectors", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({
      status: "discovery_only",
      note: "This compatibility endpoint prevents agent dead ends. Use the listed first-party endpoints and company secrets instead of guessing connector routes.",
      connectors: [
        {
          key: "plugins",
          status: "available",
          endpoint: `/api/companies/${companyId}/plugins`,
          purpose: "Installed plugin inventory and company enablement state.",
        },
        {
          key: "zapier",
          status: "requires_company_runtime_mapping",
          endpoint: `/api/companies/${companyId}/zapier`,
          purpose: "Gmail, Calendar, and other Zapier ZDK-backed app coverage once company credentials are mapped.",
        },
        {
          key: "agent_mail",
          status: "external_mailbox_runtime",
          endpoint: `/api/companies/${companyId}/agent-mail/messages`,
          purpose: "AgentMail mailbox discovery shim; use company secrets/runtime bridge for live mailbox access.",
        },
        {
          key: "webhook_intake",
          status: "configured",
          purpose: "Event-driven Paperclip wakeups for customer/email, operations/domain incidents, and product/GitHub/deployment events.",
          secretInventory: {
            runtimePath: "/data/paperclip/webhook-ingress-20260424T090721Z/endpoints.json",
            hostBackupPath: "/srv/backups/paperclip/webhook-ingress-20260424T090721Z/endpoints.json",
          },
        },
      ],
    });
  });

  router.get("/:companyId/integrations", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({
      status: "partial_runtime_connected",
      note: "Paperclip should prefer webhook-triggered work over timer polling. This endpoint is an agent-safe integration map and intentionally does not expose secrets.",
      integrations: [
        {
          key: "paperclip_webhook_intake",
          status: "configured",
          channels: ["customer/email", "operations/domain_incident", "product/github_deployment"],
          verification: "Check routine_runs where source='webhook' and linked_issue_id is present.",
        },
        {
          key: "cloudflare",
          status: "external_provider",
          recommendedEvents: ["Email Routing or agentic-inbox inbound mail", "Worker/Pages deploy events", "DNS/domain incidents", "deliverability alerts"],
        },
        {
          key: "github",
          status: "external_provider",
          recommendedEvents: ["push", "pull_request", "workflow_run", "deployment_status", "issues"],
        },
        {
          key: "zapier",
          status: "requires_company_runtime_mapping",
          endpoint: `/api/companies/${companyId}/zapier`,
          recommendedEvents: ["new Gmail message", "new Calendar event", "updated Calendar event"],
        },
      ],
    });
  });

  router.get("/:companyId/zapier", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({
      connected: false,
      provider: "zapier",
      status: "not_configured_in_company_api",
      note: "Use company skills/secrets or the Zapier ZDK runtime bridge when configured; this endpoint exists so agents can discover the current state without a 404.",
      requiredForFullCoverage: ["Gmail connection", "Google Calendar connection", "company-scoped runtime credential mapping"],
    });
  });

  router.get("/:companyId/agent-mail/messages", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json([]);
  });

  router.get("/:companyId/adapters", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json([
      {
        type: "hermes_local",
        provider: "custom:minimax-token-plan",
        model: "MiniMax-M2.7",
        status: "preferred",
        note: "Paperclip production agents should use Hermes via the local T3 runtime gateway.",
      },
    ]);
  });

  router.get("/:companyId/operational-context", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({
      company,
      apiBase: process.env.PAPERCLIP_API_URL ?? null,
      apiHints: {
        issues: `/api/companies/${companyId}/issues`,
        agents: `/api/companies/${companyId}/agents`,
        goals: `/api/companies/${companyId}/goals`,
        skills: `/api/companies/${companyId}/skills`,
        plugins: `/api/companies/${companyId}/plugins`,
        connectors: `/api/companies/${companyId}/connectors`,
        integrations: `/api/companies/${companyId}/integrations`,
        zapier: `/api/companies/${companyId}/zapier`,
        adapters: `/api/companies/${companyId}/adapters`,
      },
      operatingRule: "Continue company work through available Paperclip APIs; document exact missing credentials instead of stopping on unavailable external services.",
    });
  });

  router.get("/:companyId/feedback-traces", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);

    const targetTypeRaw = typeof req.query.targetType === "string" ? req.query.targetType : undefined;
    const voteRaw = typeof req.query.vote === "string" ? req.query.vote : undefined;
    const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
    const issueId = typeof req.query.issueId === "string" && req.query.issueId.trim().length > 0 ? req.query.issueId : undefined;
    const projectId = typeof req.query.projectId === "string" && req.query.projectId.trim().length > 0
      ? req.query.projectId
      : undefined;

    const traces = await feedback.listFeedbackTraces({
      companyId,
      issueId,
      projectId,
      targetType: targetTypeRaw ? feedbackTargetTypeSchema.parse(targetTypeRaw) : undefined,
      vote: voteRaw ? feedbackVoteValueSchema.parse(voteRaw) : undefined,
      status: statusRaw ? feedbackTraceStatusSchema.parse(statusRaw) : undefined,
      from: parseDateQuery(req.query.from, "from"),
      to: parseDateQuery(req.query.to, "to"),
      sharedOnly: parseBooleanQuery(req.query.sharedOnly),
      includePayload: parseBooleanQuery(req.query.includePayload),
    });
    res.json(traces);
  });

  router.post("/:companyId/export", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManagePortability(req, companyId, "exports");
    const result = await portability.exportBundle(companyId, req.body);
    res.json(result);
  });

  router.post("/import/preview", validate(companyPortabilityPreviewSchema), async (req, res) => {
    assertBoard(req);
    assertImportTargetAccess(req, req.body.target);
    const preview = await portability.previewImport(req.body);
    res.json(preview);
  });

  router.post("/import", validate(companyPortabilityImportSchema), async (req, res) => {
    assertBoard(req);
    assertImportTargetAccess(req, req.body.target);
    const actor = getActorInfo(req);
    const result = await portability.importBundle(req.body, req.actor.type === "board" ? req.actor.userId : null);
    await logActivity(db, {
      companyId: result.company.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "company.imported",
      entityType: "company",
      entityId: result.company.id,
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        include: req.body.include ?? null,
        agentCount: result.agents.length,
        warningCount: result.warnings.length,
        companyAction: result.company.action,
      },
    });
    res.json(result);
  });

  router.post("/:companyId/exports/preview", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManagePortability(req, companyId, "exports");
    const preview = await portability.previewExport(companyId, req.body);
    res.json(preview);
  });

  router.post("/:companyId/exports", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManagePortability(req, companyId, "exports");
    const result = await portability.exportBundle(companyId, req.body);
    res.json(result);
  });

  router.post("/:companyId/imports/preview", validate(companyPortabilityPreviewSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManagePortability(req, companyId, "imports");
    if (req.body.target.mode === "existing_company" && req.body.target.companyId !== companyId) {
      throw forbidden("Safe import route can only target the route company");
    }
    if (req.body.collisionStrategy === "replace") {
      throw forbidden("Safe import route does not allow replace collision strategy");
    }
    const preview = await portability.previewImport(req.body, {
      mode: "agent_safe",
      sourceCompanyId: companyId,
    });
    res.json(preview);
  });

  router.post("/:companyId/imports/apply", validate(companyPortabilityImportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManagePortability(req, companyId, "imports");
    if (req.body.target.mode === "existing_company" && req.body.target.companyId !== companyId) {
      throw forbidden("Safe import route can only target the route company");
    }
    if (req.body.collisionStrategy === "replace") {
      throw forbidden("Safe import route does not allow replace collision strategy");
    }
    const actor = getActorInfo(req);
    const result = await portability.importBundle(req.body, req.actor.type === "board" ? req.actor.userId : null, {
      mode: "agent_safe",
      sourceCompanyId: companyId,
    });
    await logActivity(db, {
      companyId: result.company.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      entityType: "company",
      entityId: result.company.id,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.imported",
      details: {
        include: req.body.include ?? null,
        agentCount: result.agents.length,
        warningCount: result.warnings.length,
        companyAction: result.company.action,
        importMode: "agent_safe",
      },
    });
    res.json(result);
  });

  router.post("/", validate(createCompanySchema), async (req, res) => {
    assertBoard(req);
    if (!(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)) {
      throw forbidden("Instance admin required");
    }
    const company = await svc.create(req.body);
    await access.ensureMembership(company.id, "user", req.actor.userId ?? "local-board", "owner", "active");
    await logActivity(db, {
      companyId: company.id,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.created",
      entityType: "company",
      entityId: company.id,
      details: { name: company.name },
    });
    if (company.budgetMonthlyCents > 0) {
      await budgets.upsertPolicy(
        company.id,
        {
          scopeType: "company",
          scopeId: company.id,
          amount: company.budgetMonthlyCents,
          windowKind: "calendar_month_utc",
        },
        req.actor.userId ?? "board",
      );
    }
    res.status(201).json(company);
  });

  router.patch("/:companyId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const actor = getActorInfo(req);
    const existingCompany = await svc.getById(companyId);
    if (!existingCompany) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    let body: Record<string, unknown>;

    if (req.actor.type === "agent") {
      // Only CEO agents may update company branding fields
      const agentSvc = agentService(db);
      const actorAgent = req.actor.agentId ? await agentSvc.getById(req.actor.agentId) : null;
      if (!actorAgent || actorAgent.role !== "ceo") {
        throw forbidden("Only CEO agents or board users may update company settings");
      }
      if (actorAgent.companyId !== companyId) {
        throw forbidden("Agent key cannot access another company");
      }
      body = updateCompanyBrandingSchema.parse(req.body);
    } else {
      assertBoard(req);
      body = updateCompanySchema.parse(req.body);

      if (body.feedbackDataSharingEnabled === true && !existingCompany.feedbackDataSharingEnabled) {
        body = {
          ...body,
          feedbackDataSharingConsentAt: new Date(),
          feedbackDataSharingConsentByUserId: req.actor.userId ?? "local-board",
          feedbackDataSharingTermsVersion:
            typeof body.feedbackDataSharingTermsVersion === "string" && body.feedbackDataSharingTermsVersion.length > 0
              ? body.feedbackDataSharingTermsVersion
              : DEFAULT_FEEDBACK_DATA_SHARING_TERMS_VERSION,
        };
      }
    }

    const company = await svc.update(companyId, body);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.updated",
      entityType: "company",
      entityId: companyId,
      details: body,
    });
    res.json(company);
  });

  router.patch("/:companyId/branding", validate(updateCompanyBrandingSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanUpdateBranding(req, companyId);
    const company = await svc.update(companyId, req.body);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.branding_updated",
      entityType: "company",
      entityId: companyId,
      details: req.body,
    });
    res.json(company);
  });

  router.post("/:companyId/archive", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.archive(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.archived",
      entityType: "company",
      entityId: companyId,
    });
    res.json(company);
  });

  router.delete("/:companyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.remove(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
