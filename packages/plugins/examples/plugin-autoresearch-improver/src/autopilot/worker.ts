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
  type AutomationTier,
  type ResearchCycle,
  type ResearchFinding,
  type Idea,
  type SwipeEvent,
  type PreferenceProfile,
  type IdeaStatus,
  type SwipeDecision,
  type ResearchStatus
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

function asResearchCycle(record: PluginEntityRecord): ResearchCycle {
  return record.data as unknown as ResearchCycle;
}

function asResearchFinding(record: PluginEntityRecord): ResearchFinding {
  return record.data as unknown as ResearchFinding;
}

function asIdea(record: PluginEntityRecord): Idea {
  return record.data as unknown as Idea;
}

function asSwipeEvent(record: PluginEntityRecord): SwipeEvent {
  return record.data as unknown as SwipeEvent;
}

function asPreferenceProfile(record: PluginEntityRecord): PreferenceProfile {
  return record.data as unknown as PreferenceProfile;
}

function isValidSwipeDecision(value: unknown): value is SwipeDecision {
  return value === "pass" || value === "maybe" || value === "yes" || value === "now";
}

function isValidIdeaStatus(value: unknown): value is IdeaStatus {
  return ["active", "maybe", "approved", "rejected", "in_progress", "completed"].includes(String(value));
}

// Normalize idea text for duplicate detection: lowercase, trim, collapse whitespace
function normalizeIdeaText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// Compute a simple similarity score between two idea texts (0-1)
function computeIdeaSimilarity(textA: string, textB: string): number {
  const normA = normalizeIdeaText(textA);
  const normB = normalizeIdeaText(textB);
  if (normA === normB) return 1;
  // Check if one contains the other
  if (normA.includes(normB) || normB.includes(normA)) return 0.9;
  // Levenshtein-like comparison (simple word overlap)
  const wordsA = new Set(normA.split(" "));
  const wordsB = new Set(normB.split(" "));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

// Research cycle helpers
async function findResearchCycle(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  cycleId: string
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.researchCycle,
    scopeKind: "project",
    scopeId: projectId,
    limit: 100,
    offset: 0
  });
  return entities.find((e) => {
    const data = e.data as unknown as ResearchCycle;
    return data.companyId === companyId && data.cycleId === cycleId;
  }) ?? null;
}

async function listResearchCycleEntities(
  ctx: PluginContext,
  companyId: string,
  projectId?: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.researchCycle,
    scopeKind: projectId ? "project" : undefined,
    scopeId: projectId,
    limit: 500,
    offset: 0
  });
  return entities.filter((e) => {
    const data = e.data as unknown as ResearchCycle;
    return data.companyId === companyId;
  });
}

async function upsertResearchCycle(
  ctx: PluginContext,
  cycle: ResearchCycle
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.researchCycle,
    scopeKind: "project",
    scopeId: cycle.projectId,
    externalId: cycle.cycleId,
    title: `Research cycle ${cycle.cycleId.slice(0, 8)}`,
    status: cycle.status === "completed" ? "active" : "inactive",
    data: cycle as unknown as Record<string, unknown>
  });
}

// Research finding helpers
async function upsertResearchFinding(
  ctx: PluginContext,
  finding: ResearchFinding
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.researchFinding,
    scopeKind: "project",
    scopeId: finding.projectId,
    externalId: finding.findingId,
    title: finding.title.slice(0, 80),
    status: "active",
    data: finding as unknown as Record<string, unknown>
  });
}

async function listResearchFindingEntities(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  cycleId?: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.researchFinding,
    scopeKind: "project",
    scopeId: projectId,
    limit: 500,
    offset: 0
  });
  return entities.filter((e) => {
    const data = e.data as unknown as ResearchFinding;
    return data.companyId === companyId && (!cycleId || data.cycleId === cycleId);
  });
}

// Idea helpers
async function upsertIdea(ctx: PluginContext, idea: Idea): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.idea,
    scopeKind: "project",
    scopeId: idea.projectId,
    externalId: idea.ideaId,
    title: idea.title.slice(0, 80),
    status: idea.status === "active" ? "active" : idea.status === "rejected" ? "inactive" : "active",
    data: idea as unknown as Record<string, unknown>
  });
}

async function listIdeaEntities(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.idea,
    scopeKind: "project",
    scopeId: projectId,
    limit: 500,
    offset: 0
  });
  return entities.filter((e) => {
    const data = e.data as unknown as Idea;
    return data.companyId === companyId;
  });
}

async function findIdeaById(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  ideaId: string
): Promise<Idea | null> {
  const entities = await listIdeaEntities(ctx, companyId, projectId);
  const match = entities.find((e) => asIdea(e).ideaId === ideaId);
  return match ? asIdea(match) : null;
}

// Check for duplicate ideas in active and maybe pool
async function findDuplicateIdea(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  title: string,
  description: string,
  excludeIdeaId?: string
): Promise<{ idea: Idea; similarity: number } | null> {
  const entities = await listIdeaEntities(ctx, companyId, projectId);
  const candidate = `${normalizeIdeaText(title)} ${normalizeIdeaText(description)}`.trim();
  let bestMatch: { idea: Idea; similarity: number } | null = null;

  for (const entity of entities) {
    const idea = asIdea(entity);
    // Skip excluded idea, already approved/completed/rejected
    if (excludeIdeaId && idea.ideaId === excludeIdeaId) continue;
    if (!["active", "maybe"].includes(idea.status)) continue;

    const existing = `${normalizeIdeaText(idea.title)} ${normalizeIdeaText(idea.description)}`.trim();
    const similarity = computeIdeaSimilarity(candidate, existing);
    if (similarity >= 0.75) {
      // Strong similarity threshold
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { idea, similarity };
      }
    }
  }

  return bestMatch;
}

// Swipe event helpers
async function upsertSwipeEvent(ctx: PluginContext, swipe: SwipeEvent): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.swipeEvent,
    scopeKind: "project",
    scopeId: swipe.projectId,
    externalId: swipe.swipeId,
    title: `Swipe ${swipe.decision} on ${swipe.ideaId.slice(0, 8)}`,
    status: "active",
    data: swipe as unknown as Record<string, unknown>
  });
}

async function listSwipeEventEntities(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.swipeEvent,
    scopeKind: "project",
    scopeId: projectId,
    limit: 500,
    offset: 0
  });
  return entities.filter((e) => {
    const data = e.data as unknown as SwipeEvent;
    return data.companyId === companyId;
  });
}

// Preference profile helpers
async function findPreferenceProfile(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<PreferenceProfile | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.preferenceProfile,
    scopeKind: "project",
    scopeId: projectId,
    limit: 10,
    offset: 0
  });
  const matches = entities.filter((e) => {
    const data = e.data as unknown as PreferenceProfile;
    return data.companyId === companyId && data.projectId === projectId;
  });
  return matches.length > 0 ? asPreferenceProfile(matches[0]) : null;
}

async function upsertPreferenceProfile(
  ctx: PluginContext,
  profile: PreferenceProfile
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.preferenceProfile,
    scopeKind: "project",
    scopeId: profile.projectId,
    externalId: profile.profileId,
    title: `Preference profile for ${profile.projectId}`,
    status: "active",
    data: profile as unknown as Record<string, unknown>
  });
}

// --- Order ideas by score (desc) and status priority ---
const STATUS_PRIORITY: Record<IdeaStatus, number> = {
  active: 0,
  maybe: 1,
  approved: 2,
  in_progress: 3,
  completed: 4,
  rejected: 5
};

function sortIdeas(ideas: Idea[]): Idea[] {
  return [...ideas].sort((a, b) => {
    // First by status priority
    const statusDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (statusDiff !== 0) return statusDiff;
    // Then by score (descending)
    return b.score - a.score;
  });
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

    // Research cycle data handlers
    ctx.data.register(DATA_KEYS.researchCycle, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const cycleId = typeof params.cycleId === "string" ? params.cycleId : "";
      if (!companyId || !projectId || !cycleId) return null;
      const entity = await findResearchCycle(ctx, companyId, projectId, cycleId);
      if (!entity) return null;
      const cycle = asResearchCycle(entity);
      if (cycle.companyId !== companyId) return null;
      return cycle;
    });

    ctx.data.register(DATA_KEYS.researchCycles, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      if (!companyId) return [];
      const entities = await listResearchCycleEntities(ctx, companyId, projectId);
      return entities.map(asResearchCycle).sort((a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
    });

    ctx.data.register(DATA_KEYS.researchFindings, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const cycleId = typeof params.cycleId === "string" ? params.cycleId : undefined;
      if (!companyId || !projectId) return [];
      const entities = await listResearchFindingEntities(ctx, companyId, projectId, cycleId);
      return entities.map(asResearchFinding);
    });

    // Idea data handlers
    ctx.data.register(DATA_KEYS.idea, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const ideaId = typeof params.ideaId === "string" ? params.ideaId : "";
      if (!companyId || !projectId || !ideaId) return null;
      const idea = await findIdeaById(ctx, companyId, projectId, ideaId);
      return idea;
    });

    ctx.data.register(DATA_KEYS.ideas, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      if (!companyId || !projectId) return [];
      const entities = await listIdeaEntities(ctx, companyId, projectId);
      const ideas = entities.map(asIdea).filter((i) => i.status === "active" || i.status === "approved" || i.status === "rejected");
      return sortIdeas(ideas);
    });

    ctx.data.register(DATA_KEYS.maybePoolIdeas, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      if (!companyId || !projectId) return [];
      const entities = await listIdeaEntities(ctx, companyId, projectId);
      return entities.map(asIdea).filter((i) => i.status === "maybe");
    });

    // Swipe event data handlers
    ctx.data.register(DATA_KEYS.swipeEvents, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      if (!companyId || !projectId) return [];
      const entities = await listSwipeEventEntities(ctx, companyId, projectId);
      return entities.map(asSwipeEvent).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });

    // Preference profile data handler
    ctx.data.register(DATA_KEYS.preferenceProfile, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      if (!companyId || !projectId) return null;
      return await findPreferenceProfile(ctx, companyId, projectId);
    });

    // Register action handlers
    ctx.actions.register(ACTION_KEYS.startResearchCycle, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const query = typeof params.query === "string" ? params.query : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const cycle: ResearchCycle = {
        cycleId: randomUUID(),
        companyId,
        projectId,
        status: "running",
        query,
        findingsCount: 0,
        startedAt: nowIso()
      };

      await upsertResearchCycle(ctx, cycle);
      return cycle;
    });

    ctx.actions.register(ACTION_KEYS.completeResearchCycle, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const cycleId = typeof params.cycleId === "string" ? params.cycleId : "";
      if (!companyId || !projectId || !cycleId) {
        throw new Error("companyId, projectId, and cycleId are required");
      }

      const entity = await findResearchCycle(ctx, companyId, projectId, cycleId);
      if (!entity) {
        throw new Error("Research cycle not found");
      }

      const cycle = asResearchCycle(entity);
      if (cycle.companyId !== companyId) {
        throw new Error("Research cycle not found");
      }

      cycle.status = params.status === "failed" ? "failed" : "completed";
      cycle.reportContent = typeof params.reportContent === "string" ? params.reportContent : cycle.reportContent;
      cycle.findingsCount = typeof params.findingsCount === "number" ? params.findingsCount : cycle.findingsCount;
      cycle.completedAt = nowIso();
      if (typeof params.error === "string") cycle.error = params.error;

      await upsertResearchCycle(ctx, cycle);
      return cycle;
    });

    ctx.actions.register(ACTION_KEYS.addResearchFinding, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const cycleId = typeof params.cycleId === "string" ? params.cycleId : "";
      if (!companyId || !projectId || !cycleId) {
        throw new Error("companyId, projectId, and cycleId are required");
      }

      const finding: ResearchFinding = {
        findingId: randomUUID(),
        companyId,
        projectId,
        cycleId,
        title: typeof params.title === "string" ? params.title : "Untitled Finding",
        description: typeof params.description === "string" ? params.description : "",
        sourceUrl: typeof params.sourceUrl === "string" ? params.sourceUrl : undefined,
        sourceLabel: typeof params.sourceLabel === "string" ? params.sourceLabel : undefined,
        evidenceText: typeof params.evidenceText === "string" ? params.evidenceText : undefined,
        confidence: typeof params.confidence === "number" ? Math.max(0, Math.min(1, params.confidence)) : 0.5,
        createdAt: nowIso()
      };

      await upsertResearchFinding(ctx, finding);
      return finding;
    });

    ctx.actions.register(ACTION_KEYS.generateIdeas, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const cycleId = typeof params.cycleId === "string" ? params.cycleId : undefined;
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const ideasRaw = Array.isArray(params.ideas) ? params.ideas : [];
      const created: Idea[] = [];

      for (const raw of ideasRaw) {
        const title = typeof raw.title === "string" ? raw.title : "Untitled Idea";
        const description = typeof raw.description === "string" ? raw.description : "";
        const rationale = typeof raw.rationale === "string" ? raw.rationale : "";
        const sourceReferences = Array.isArray(raw.sourceReferences) ? raw.sourceReferences : [];
        const score = typeof raw.score === "number" ? Math.max(0, Math.min(100, raw.score)) : 50;

        // Check for duplicates
        const duplicate = await findDuplicateIdea(ctx, companyId, projectId, title, description);
        if (duplicate && duplicate.similarity >= 0.9) {
          // Near-exact duplicate - suppress with annotation
          const idea: Idea = {
            ideaId: randomUUID(),
            companyId,
            projectId,
            cycleId,
            title: title + " [Possible Duplicate]",
            description,
            rationale,
            sourceReferences,
            score: Math.floor(score * 0.9),
            status: "active",
            duplicateOfIdeaId: duplicate.idea.ideaId,
            duplicateAnnotated: true,
            createdAt: nowIso(),
            updatedAt: nowIso()
          };
          await upsertIdea(ctx, idea);
          created.push(idea);
        } else if (duplicate && duplicate.similarity >= 0.75) {
          // Lower similarity - just annotate as possible duplicate
          const idea: Idea = {
            ideaId: randomUUID(),
            companyId,
            projectId,
            cycleId,
            title: title + " [Review Duplicate]",
            description,
            rationale,
            sourceReferences,
            score,
            status: "active",
            duplicateOfIdeaId: duplicate.idea.ideaId,
            duplicateAnnotated: true,
            createdAt: nowIso(),
            updatedAt: nowIso()
          };
          await upsertIdea(ctx, idea);
          created.push(idea);
        } else {
          // New idea, no duplicate
          const idea: Idea = {
            ideaId: randomUUID(),
            companyId,
            projectId,
            cycleId,
            title,
            description,
            rationale,
            sourceReferences,
            score,
            status: "active",
            duplicateAnnotated: false,
            createdAt: nowIso(),
            updatedAt: nowIso()
          };
          await upsertIdea(ctx, idea);
          created.push(idea);
        }
      }

      // Apply preference profile ordering if available
      const profile = await findPreferenceProfile(ctx, companyId, projectId);
      if (profile) {
        // Sort by score desc, status priority, respecting preference weights
        created.sort((a, b) => {
          // Weight by preference - higher yes/now count means we prefer similar scores
          const aWeight = a.score * (profile.yesCount + profile.nowCount + 1);
          const bWeight = b.score * (profile.yesCount + profile.nowCount + 1);
          return bWeight - aWeight;
        });
      }

      return created;
    });

    ctx.actions.register(ACTION_KEYS.recordSwipe, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const ideaId = typeof params.ideaId === "string" ? params.ideaId : "";
      const decision = isValidSwipeDecision(params.decision) ? params.decision : "pass";
      if (!companyId || !projectId || !ideaId) {
        throw new Error("companyId, projectId, and ideaId are required");
      }

      // Record the swipe event
      const swipe: SwipeEvent = {
        swipeId: randomUUID(),
        companyId,
        projectId,
        ideaId,
        decision,
        createdAt: nowIso()
      };
      await upsertSwipeEvent(ctx, swipe);

      // Update the idea status based on decision
      const idea = await findIdeaById(ctx, companyId, projectId, ideaId);
      if (!idea) {
        throw new Error("Idea not found");
      }

      let newStatus: IdeaStatus = idea.status;
      if (decision === "pass") {
        newStatus = "rejected";
      } else if (decision === "maybe") {
        newStatus = "maybe";
      } else if (decision === "yes" || decision === "now") {
        newStatus = "approved";
      }

      idea.status = newStatus;
      idea.updatedAt = nowIso();
      await upsertIdea(ctx, idea);

      // Update the preference profile
      const existingProfile = await findPreferenceProfile(ctx, companyId, projectId);
      const profileId = existingProfile?.profileId ?? randomUUID();
      const profile: PreferenceProfile = {
        profileId,
        companyId,
        projectId,
        passCount: existingProfile?.passCount ?? 0,
        maybeCount: existingProfile?.maybeCount ?? 0,
        yesCount: existingProfile?.yesCount ?? 0,
        nowCount: existingProfile?.nowCount ?? 0,
        lastUpdated: nowIso()
      };

      if (decision === "pass") profile.passCount++;
      else if (decision === "maybe") profile.maybeCount++;
      else if (decision === "yes") profile.yesCount++;
      else if (decision === "now") profile.nowCount++;

      await upsertPreferenceProfile(ctx, profile);

      return { swipe, idea, profile };
    });

    ctx.actions.register(ACTION_KEYS.updatePreferenceProfile, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const existing = await findPreferenceProfile(ctx, companyId, projectId);
      const profileId = existing?.profileId ?? randomUUID();

      const profile: PreferenceProfile = {
        profileId,
        companyId,
        projectId,
        passCount: typeof params.passCount === "number" ? params.passCount : (existing?.passCount ?? 0),
        maybeCount: typeof params.maybeCount === "number" ? params.maybeCount : (existing?.maybeCount ?? 0),
        yesCount: typeof params.yesCount === "number" ? params.yesCount : (existing?.yesCount ?? 0),
        nowCount: typeof params.nowCount === "number" ? params.nowCount : (existing?.nowCount ?? 0),
        lastUpdated: nowIso()
      };

      await upsertPreferenceProfile(ctx, profile);
      return profile;
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
