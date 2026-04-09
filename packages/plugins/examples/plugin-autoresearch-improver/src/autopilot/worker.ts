import { randomUUID } from "node:crypto";
import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginEntityRecord,
  type PluginHealthDiagnostics
} from "@paperclipai/plugin-sdk";
import {
  ACTION_KEYS,
  DATA_KEYS,
  ENTITY_TYPES,
  PLUGIN_ID,
  type AutopilotProject,
  type ProductProgramRevision,
  type AutomationTier
} from "./constants.js";

function nowIso(): string {
  return new Date().toISOString();
}

function isValidCompanyId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidProjectId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidAutopilotId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isAutomationTier(value: unknown): value is AutomationTier {
  return value === "supervised" || value === "semiauto" || value === "fullauto";
}

function parseAutomationTier(value: unknown, fallback: AutomationTier = "supervised"): AutomationTier {
  return isAutomationTier(value) ? value : fallback;
}

function parsePositiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function asAutopilotProject(record: PluginEntityRecord): AutopilotProject {
  return record.data as unknown as AutopilotProject;
}

function asProductProgramRevision(record: PluginEntityRecord): ProductProgramRevision {
  return record.data as unknown as ProductProgramRevision;
}

async function findAutopilotProject(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.autopilotProject,
    scopeKind: "project",
    scopeId: projectId,
    limit: 10,
    offset: 0
  });
  return entities.find((e) => {
    const data = e.data as unknown as AutopilotProject;
    return data.companyId === companyId && data.projectId === projectId;
  }) ?? null;
}

async function upsertAutopilotProject(
  ctx: PluginContext,
  autopilot: AutopilotProject
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.autopilotProject,
    scopeKind: "project",
    scopeId: autopilot.projectId,
    externalId: autopilot.autopilotId,
    title: `Autopilot for project ${autopilot.projectId}`,
    status: autopilot.enabled ? "active" : "inactive",
    data: autopilot as unknown as Record<string, unknown>
  });
}

async function listAutopilotProjectEntities(
  ctx: PluginContext,
  projectId?: string
): Promise<PluginEntityRecord[]> {
  return await ctx.entities.list({
    entityType: ENTITY_TYPES.autopilotProject,
    scopeKind: projectId ? "project" : undefined,
    scopeId: projectId,
    limit: 200,
    offset: 0
  });
}

async function findProductProgramRevision(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  revisionId: string
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.productProgramRevision,
    scopeKind: "project",
    scopeId: projectId,
    limit: 100,
    offset: 0
  });
  return entities.find((e) => {
    const data = e.data as unknown as ProductProgramRevision;
    return data.companyId === companyId && data.revisionId === revisionId;
  }) ?? null;
}

async function listProductProgramRevisionEntities(
  ctx: PluginContext,
  companyId: string,
  projectId?: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.productProgramRevision,
    scopeKind: projectId ? "project" : undefined,
    scopeId: projectId,
    limit: 500,
    offset: 0
  });
  // Filter by companyId for cross-company isolation
  return entities.filter((e) => {
    const data = e.data as unknown as ProductProgramRevision;
    return data.companyId === companyId;
  });
}

async function upsertProductProgramRevision(
  ctx: PluginContext,
  revision: ProductProgramRevision
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.productProgramRevision,
    scopeKind: "project",
    scopeId: revision.projectId,
    externalId: revision.revisionId,
    title: `Program revision v${revision.version}`,
    status: "active",
    data: revision as unknown as Record<string, unknown>
  });
}

async function getLatestProductProgramRevision(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<ProductProgramRevision | null> {
  const entities = await listProductProgramRevisionEntities(ctx, companyId, projectId);
  if (entities.length === 0) return null;
  return entities
    .map(asProductProgramRevision)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

let currentContext: PluginContext | null = null;

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx: PluginContext) {
    currentContext = ctx;

    // Register data handlers
    ctx.data.register(DATA_KEYS.projects, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      if (!companyId) return [];
      return await ctx.projects.list({ companyId, limit: 200, offset: 0 });
    });

    ctx.data.register(DATA_KEYS.autopilotProject, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      if (!companyId || !projectId) return null;
      const entity = await findAutopilotProject(ctx, companyId, projectId);
      return entity ? asAutopilotProject(entity) : null;
    });

    ctx.data.register(DATA_KEYS.autopilotProjects, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      if (!companyId) return [];
      const entities = await listAutopilotProjectEntities(ctx);
      return entities
        .map(asAutopilotProject)
        .filter((e) => e.companyId === companyId);
    });

    ctx.data.register(DATA_KEYS.productProgramRevision, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const revisionId = typeof params.revisionId === "string" ? params.revisionId : "";
      if (!companyId || !projectId || !revisionId) return null;
      // Cross-company access check
      const entity = await findProductProgramRevision(ctx, companyId, projectId, revisionId);
      if (!entity) return null;
      const revision = asProductProgramRevision(entity);
      // Enforce company isolation
      if (revision.companyId !== companyId) return null;
      return revision;
    });

    ctx.data.register(DATA_KEYS.productProgramRevisions, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      if (!companyId) return [];
      // If projectId is provided, verify company ownership
      if (projectId) {
        const entities = await listProductProgramRevisionEntities(ctx, companyId, projectId);
        return entities
          .map(asProductProgramRevision)
          .filter((e) => e.companyId === companyId)
          .sort((a, b) => b.version - a.version);
      }
      return [];
    });

    // Register action handlers
    ctx.actions.register(ACTION_KEYS.saveAutopilotProject, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const existing = await findAutopilotProject(ctx, companyId, projectId);
      const existingData = existing ? asAutopilotProject(existing) : null;

      const autopilotId = existingData?.autopilotId ?? (typeof params.autopilotId === "string" && params.autopilotId ? params.autopilotId : randomUUID());
      const automationTier = parseAutomationTier(params.automationTier, existingData?.automationTier ?? "supervised");
      const budgetMinutes = parseNonNegativeInteger(params.budgetMinutes, existingData?.budgetMinutes ?? 60);

      const autopilot: AutopilotProject = {
        autopilotId,
        companyId,
        projectId,
        enabled: params.enabled === true || (existingData?.enabled ?? false),
        automationTier,
        budgetMinutes,
        repoUrl: typeof params.repoUrl === "string" ? params.repoUrl : existingData?.repoUrl,
        workspaceId: typeof params.workspaceId === "string" ? params.workspaceId : existingData?.workspaceId,
        agentId: typeof params.agentId === "string" ? params.agentId : existingData?.agentId,
        paused: params.paused === true || (existingData?.paused ?? false),
        pauseReason: typeof params.pauseReason === "string" ? params.pauseReason : existingData?.pauseReason,
        createdAt: existingData?.createdAt ?? nowIso(),
        updatedAt: nowIso()
      };

      await upsertAutopilotProject(ctx, autopilot);
      return autopilot;
    });

    ctx.actions.register(ACTION_KEYS.enableAutopilot, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const automationTier = parseAutomationTier(params.automationTier, "supervised");
      const budgetMinutes = parseNonNegativeInteger(params.budgetMinutes, 60);

      const autopilot: AutopilotProject = {
        autopilotId: randomUUID(),
        companyId,
        projectId,
        enabled: true,
        automationTier,
        budgetMinutes,
        repoUrl: typeof params.repoUrl === "string" ? params.repoUrl : undefined,
        workspaceId: typeof params.workspaceId === "string" ? params.workspaceId : undefined,
        agentId: typeof params.agentId === "string" ? params.agentId : undefined,
        paused: false,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      await upsertAutopilotProject(ctx, autopilot);
      return autopilot;
    });

    ctx.actions.register(ACTION_KEYS.disableAutopilot, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const existing = await findAutopilotProject(ctx, companyId, projectId);
      if (!existing) {
        return { ok: true, message: "No autopilot project found" };
      }

      const autopilot = asAutopilotProject(existing);
      autopilot.enabled = false;
      autopilot.updatedAt = nowIso();

      await upsertAutopilotProject(ctx, autopilot);
      return { ok: true };
    });

    ctx.actions.register(ACTION_KEYS.saveProductProgramRevision, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const content = typeof params.content === "string" ? params.content : "";
      if (!content.trim()) {
        throw new Error("Program content cannot be empty");
      }

      const revisionId = typeof params.revisionId === "string" && params.revisionId
        ? params.revisionId
        : null;

      let revision: ProductProgramRevision;

      if (revisionId) {
        // Update existing revision - look it up and preserve version/createdAt
        const existing = await findProductProgramRevision(ctx, companyId, projectId, revisionId);
        if (!existing) {
          throw new Error("Revision not found: " + revisionId);
        }
        const existingData = asProductProgramRevision(existing);
        // Enforce company isolation
        if (existingData.companyId !== companyId) {
          throw new Error("Revision not found");
        }
        revision = {
          ...existingData,
          content,
          updatedAt: nowIso()
          // Preserve version and createdAt when updating in place
        };
      } else {
        // No revisionId provided - create a new revision
        const latest = await getLatestProductProgramRevision(ctx, companyId, projectId);
        revision = {
          revisionId: randomUUID(),
          companyId,
          projectId,
          content,
          version: latest ? latest.version + 1 : 1,
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
      }

      await upsertProductProgramRevision(ctx, revision);
      return revision;
    });

    ctx.actions.register(ACTION_KEYS.createProductProgramRevision, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const content = typeof params.content === "string" ? params.content : "";
      if (!content.trim()) {
        throw new Error("Program content cannot be empty");
      }

      const latest = await getLatestProductProgramRevision(ctx, companyId, projectId);
      const revision: ProductProgramRevision = {
        revisionId: randomUUID(),
        companyId,
        projectId,
        content,
        version: latest ? latest.version + 1 : 1,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      await upsertProductProgramRevision(ctx, revision);
      return revision;
    });

    ctx.logger.info("Autopilot plugin ready", { pluginId: PLUGIN_ID });
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    return {
      status: "ok",
      message: "Autopilot plugin is ready"
    };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
