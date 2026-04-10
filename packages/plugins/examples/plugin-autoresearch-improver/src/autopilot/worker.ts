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
  type ResearchStatus,
  type PlanningArtifact,
  type DeliveryRun,
  type WorkspaceLease,
  type CompanyBudget,
  type RunStatus,
  type ExecutionMode,
  type ApprovalMode,
  type ConvoyTask,
  type ConvoyTaskStatus,
  type Checkpoint,
  type ProductLock,
  type OperatorIntervention,
  type InterventionType,
  type LockType
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

function asPlanningArtifact(record: PluginEntityRecord): PlanningArtifact {
  return record.data as unknown as PlanningArtifact;
}

function asDeliveryRun(record: PluginEntityRecord): DeliveryRun {
  return record.data as unknown as DeliveryRun;
}

function asWorkspaceLease(record: PluginEntityRecord): WorkspaceLease {
  return record.data as unknown as WorkspaceLease;
}

function asCompanyBudget(record: PluginEntityRecord): CompanyBudget {
  return record.data as unknown as CompanyBudget;
}

function asConvoyTask(record: PluginEntityRecord): ConvoyTask {
  return record.data as unknown as ConvoyTask;
}

function asCheckpoint(record: PluginEntityRecord): Checkpoint {
  return record.data as unknown as Checkpoint;
}

function asProductLock(record: PluginEntityRecord): ProductLock {
  return record.data as unknown as ProductLock;
}

function asOperatorIntervention(record: PluginEntityRecord): OperatorIntervention {
  return record.data as unknown as OperatorIntervention;
}

function isValidSwipeDecision(value: unknown): value is SwipeDecision {
  return value === "pass" || value === "maybe" || value === "yes" || value === "now";
}

function isValidIdeaStatus(value: unknown): value is IdeaStatus {
  return ["active", "maybe", "approved", "rejected", "in_progress", "completed"].includes(String(value));
}

function isValidConvoyTaskStatus(value: unknown): value is ConvoyTaskStatus {
  return ["pending", "blocked", "running", "passed", "failed", "skipped"].includes(String(value));
}

function isValidInterventionType(value: unknown): value is InterventionType {
  return ["note", "checkpoint_request", "nudge", "linked_issue_inspection"].includes(String(value));
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

// Planning artifact helpers
async function findPlanningArtifact(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  artifactId: string
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.planningArtifact,
    scopeKind: "project",
    scopeId: projectId,
    limit: 100,
    offset: 0
  });
  return entities.find((e) => {
    const data = e.data as unknown as PlanningArtifact;
    return data.companyId === companyId && data.artifactId === artifactId;
  }) ?? null;
}

async function listPlanningArtifactEntities(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  ideaId?: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.planningArtifact,
    scopeKind: "project",
    scopeId: projectId,
    limit: 500,
    offset: 0
  });
  return entities.filter((e) => {
    const data = e.data as unknown as PlanningArtifact;
    if (data.companyId !== companyId) return false;
    if (ideaId && data.ideaId !== ideaId) return false;
    return true;
  });
}

async function upsertPlanningArtifact(
  ctx: PluginContext,
  artifact: PlanningArtifact
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.planningArtifact,
    scopeKind: "project",
    scopeId: artifact.projectId,
    externalId: artifact.artifactId,
    title: artifact.title.slice(0, 80),
    status: "active",
    data: artifact as unknown as Record<string, unknown>
  });
}

// Delivery run helpers
async function findDeliveryRun(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  runId: string
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.deliveryRun,
    scopeKind: "project",
    scopeId: projectId,
    limit: 200,
    offset: 0
  });
  return entities.find((e) => {
    const data = e.data as unknown as DeliveryRun;
    return data.companyId === companyId && data.runId === runId;
  }) ?? null;
}

async function listDeliveryRunEntities(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.deliveryRun,
    scopeKind: "project",
    scopeId: projectId,
    limit: 500,
    offset: 0
  });
  return entities.filter((e) => {
    const data = e.data as unknown as DeliveryRun;
    return data.companyId === companyId;
  });
}

async function upsertDeliveryRun(
  ctx: PluginContext,
  run: DeliveryRun
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.deliveryRun,
    scopeKind: "project",
    scopeId: run.projectId,
    externalId: run.runId,
    title: `Run ${run.runId.slice(0, 8)}`,
    status: run.status === "completed" || run.status === "failed" || run.status === "cancelled" ? "inactive" : "active",
    data: run as unknown as Record<string, unknown>
  });
}

// Workspace lease helpers
async function upsertWorkspaceLease(
  ctx: PluginContext,
  lease: WorkspaceLease
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.workspaceLease,
    scopeKind: "project",
    scopeId: lease.projectId,
    externalId: lease.leaseId,
    title: `Lease for run ${lease.runId.slice(0, 8)}`,
    status: lease.isActive ? "active" : "inactive",
    data: lease as unknown as Record<string, unknown>
  });
}

async function findActiveWorkspaceLease(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  runId: string
): Promise<WorkspaceLease | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.workspaceLease,
    scopeKind: "project",
    scopeId: projectId,
    limit: 100,
    offset: 0
  });
  const matches = entities.filter((e) => {
    const data = e.data as unknown as WorkspaceLease;
    return data.companyId === companyId && data.runId === runId && data.isActive;
  });
  return matches.length > 0 ? asWorkspaceLease(matches[0]) : null;
}

// Company budget helpers
async function findCompanyBudget(
  ctx: PluginContext,
  companyId: string
): Promise<CompanyBudget | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.companyBudget,
    scopeKind: "company",
    scopeId: companyId,
    limit: 10,
    offset: 0
  });
  const matches = entities.filter((e) => {
    const data = e.data as unknown as CompanyBudget;
    return data.companyId === companyId;
  });
  return matches.length > 0 ? asCompanyBudget(matches[0]) : null;
}

async function upsertCompanyBudget(
  ctx: PluginContext,
  budget: CompanyBudget
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.companyBudget,
    scopeKind: "company",
    scopeId: budget.companyId,
    externalId: budget.budgetId,
    title: `Budget for company ${budget.companyId}`,
    status: "active",
    data: budget as unknown as Record<string, unknown>
  });
}

// ─── ConvoyTask Helpers ──────────────────────────────────────────────────────

async function upsertConvoyTask(
  ctx: PluginContext,
  task: ConvoyTask
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.convoyTask,
    scopeKind: "project",
    scopeId: task.projectId,
    externalId: task.taskId,
    title: task.title.slice(0, 80),
    status: task.status === "passed" || task.status === "failed" || task.status === "skipped" ? "inactive" : "active",
    data: task as unknown as Record<string, unknown>
  });
}

async function findConvoyTask(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  taskId: string
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.convoyTask,
    scopeKind: "project",
    scopeId: projectId,
    limit: 200,
    offset: 0
  });
  return entities.find((e) => {
    const data = e.data as unknown as ConvoyTask;
    return data.companyId === companyId && data.taskId === taskId;
  }) ?? null;
}

async function listConvoyTaskEntities(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  runId?: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.convoyTask,
    scopeKind: "project",
    scopeId: projectId,
    limit: 500,
    offset: 0
  });
  return entities.filter((e) => {
    const data = e.data as unknown as ConvoyTask;
    if (data.companyId !== companyId) return false;
    if (runId && data.runId !== runId) return false;
    return true;
  });
}

async function findBlockingLock(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  targetBranch: string,
  excludeRunId?: string
): Promise<ProductLock | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.productLock,
    scopeKind: "project",
    scopeId: projectId,
    limit: 200,
    offset: 0
  });
  const matches = entities
    .map(asProductLock)
    .filter(
      (lock) =>
        lock.isActive &&
        lock.targetBranch === targetBranch &&
        lock.runId !== excludeRunId
    );
  return matches.length > 0 ? matches[0] : null;
}

// ─── Checkpoint Helpers ───────────────────────────────────────────────────────

async function upsertCheckpoint(
  ctx: PluginContext,
  checkpoint: Checkpoint
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.checkpoint,
    scopeKind: "project",
    scopeId: checkpoint.projectId,
    externalId: checkpoint.checkpointId,
    title: `Checkpoint ${checkpoint.checkpointId.slice(0, 8)}`,
    status: "active",
    data: checkpoint as unknown as Record<string, unknown>
  });
}

async function findCheckpoint(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  checkpointId: string
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.checkpoint,
    scopeKind: "project",
    scopeId: projectId,
    limit: 100,
    offset: 0
  });
  return entities.find((e) => {
    const data = e.data as unknown as Checkpoint;
    return data.companyId === companyId && data.checkpointId === checkpointId;
  }) ?? null;
}

// ─── ProductLock Helpers ─────────────────────────────────────────────────────

async function upsertProductLock(
  ctx: PluginContext,
  lock: ProductLock
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.productLock,
    scopeKind: "project",
    scopeId: lock.projectId,
    externalId: lock.lockId,
    title: `${lock.lockType} on ${lock.targetBranch}`,
    status: lock.isActive ? "active" : "inactive",
    data: lock as unknown as Record<string, unknown>
  });
}

async function findProductLock(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  lockId: string
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.productLock,
    scopeKind: "project",
    scopeId: projectId,
    limit: 100,
    offset: 0
  });
  return entities.find((e) => {
    const data = e.data as unknown as ProductLock;
    return data.companyId === companyId && data.lockId === lockId;
  }) ?? null;
}

// ─── OperatorIntervention Helpers ────────────────────────────────────────────

async function upsertOperatorIntervention(
  ctx: PluginContext,
  intervention: OperatorIntervention
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.operatorIntervention,
    scopeKind: "project",
    scopeId: intervention.projectId,
    externalId: intervention.interventionId,
    title: `${intervention.interventionType} on run ${intervention.runId.slice(0, 8)}`,
    status: "active",
    data: intervention as unknown as Record<string, unknown>
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

    // Planning artifact data handlers
    ctx.data.register(DATA_KEYS.planningArtifact, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const artifactId = typeof params.artifactId === "string" ? params.artifactId : "";
      if (!companyId || !projectId || !artifactId) return null;
      const entity = await findPlanningArtifact(ctx, companyId, projectId, artifactId);
      if (!entity) return null;
      const artifact = asPlanningArtifact(entity);
      if (artifact.companyId !== companyId) return null;
      return artifact;
    });

    ctx.data.register(DATA_KEYS.planningArtifacts, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const ideaId = typeof params.ideaId === "string" ? params.ideaId : undefined;
      if (!companyId || !projectId) return [];
      const entities = await listPlanningArtifactEntities(ctx, companyId, projectId, ideaId);
      return entities.map(asPlanningArtifact).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });

    // Delivery run data handlers
    ctx.data.register(DATA_KEYS.deliveryRun, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      if (!companyId || !projectId || !runId) return null;
      const entity = await findDeliveryRun(ctx, companyId, projectId, runId);
      if (!entity) return null;
      const run = asDeliveryRun(entity);
      if (run.companyId !== companyId) return null;
      return run;
    });

    ctx.data.register(DATA_KEYS.deliveryRuns, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      if (!companyId || !projectId) return [];
      const entities = await listDeliveryRunEntities(ctx, companyId, projectId);
      return entities.map(asDeliveryRun).sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });

    // Company budget data handler
    ctx.data.register(DATA_KEYS.companyBudget, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      if (!companyId) return null;
      return await findCompanyBudget(ctx, companyId);
    });

    // Convoy task data handlers
    ctx.data.register(DATA_KEYS.convoyTask, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const taskId = typeof params.taskId === "string" ? params.taskId : "";
      if (!companyId || !projectId || !taskId) return null;
      const entity = await findConvoyTask(ctx, companyId, projectId, taskId);
      if (!entity) return null;
      const task = asConvoyTask(entity);
      if (task.companyId !== companyId) return null;
      return task;
    });

    ctx.data.register(DATA_KEYS.convoyTasks, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : undefined;
      if (!companyId || !projectId) return [];
      const entities = await listConvoyTaskEntities(ctx, companyId, projectId, runId);
      return entities.map(asConvoyTask).sort((a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });

    // Checkpoint data handlers
    ctx.data.register(DATA_KEYS.checkpoint, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const checkpointId = typeof params.checkpointId === "string" ? params.checkpointId : "";
      if (!companyId || !projectId || !checkpointId) return null;
      const entity = await findCheckpoint(ctx, companyId, projectId, checkpointId);
      if (!entity) return null;
      const checkpoint = asCheckpoint(entity);
      if (checkpoint.companyId !== companyId) return null;
      return checkpoint;
    });

    ctx.data.register(DATA_KEYS.checkpoints, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : undefined;
      if (!companyId || !projectId) return [];
      const entities = await ctx.entities.list({
        entityType: ENTITY_TYPES.checkpoint,
        scopeKind: "project",
        scopeId: projectId,
        limit: 200,
        offset: 0
      });
      return entities
        .filter((e) => {
          const data = e.data as unknown as Checkpoint;
          if (data.companyId !== companyId) return false;
          if (runId && data.runId !== runId) return false;
          return true;
        })
        .map(asCheckpoint)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    });

    // Product lock data handlers
    ctx.data.register(DATA_KEYS.productLock, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const lockId = typeof params.lockId === "string" ? params.lockId : "";
      if (!companyId || !projectId || !lockId) return null;
      const entity = await findProductLock(ctx, companyId, projectId, lockId);
      if (!entity) return null;
      const lock = asProductLock(entity);
      if (lock.companyId !== companyId) return null;
      return lock;
    });

    ctx.data.register(DATA_KEYS.productLocks, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : undefined;
      if (!companyId || !projectId) return [];
      const entities = await ctx.entities.list({
        entityType: ENTITY_TYPES.productLock,
        scopeKind: "project",
        scopeId: projectId,
        limit: 200,
        offset: 0
      });
      return entities
        .filter((e) => {
          const data = e.data as unknown as ProductLock;
          if (data.companyId !== companyId) return false;
          if (runId && data.runId !== runId) return false;
          return true;
        })
        .map(asProductLock)
        .sort((a, b) => new Date(b.acquiredAt).getTime() - new Date(a.acquiredAt).getTime());
    });

    // Operator intervention data handlers
    ctx.data.register(DATA_KEYS.operatorIntervention, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const interventionId = typeof params.interventionId === "string" ? params.interventionId : "";
      if (!companyId || !projectId || !interventionId) return null;
      const entities = await ctx.entities.list({
        entityType: ENTITY_TYPES.operatorIntervention,
        scopeKind: "project",
        scopeId: projectId,
        limit: 100,
        offset: 0
      });
      const match = entities.find((e) => {
        const data = e.data as unknown as OperatorIntervention;
        return data.companyId === companyId && data.interventionId === interventionId;
      });
      return match ? asOperatorIntervention(match) : null;
    });

    ctx.data.register(DATA_KEYS.operatorInterventions, async (params) => {
      const companyId = typeof params.companyId === "string" ? params.companyId : "";
      const projectId = typeof params.projectId === "string" ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : undefined;
      if (!companyId || !projectId) return [];
      const entities = await ctx.entities.list({
        entityType: ENTITY_TYPES.operatorIntervention,
        scopeKind: "project",
        scopeId: projectId,
        limit: 500,
        offset: 0
      });
      return entities
        .filter((e) => {
          const data = e.data as unknown as OperatorIntervention;
          if (data.companyId !== companyId) return false;
          if (runId && data.runId !== runId) return false;
          return true;
        })
        .map(asOperatorIntervention)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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

      // Auto-create planning artifact and delivery run for approved ideas
      let planningArtifact: PlanningArtifact | null = null;
      let deliveryRun: DeliveryRun | null = null;

      if (decision === "yes" || decision === "now") {
        // Get automation tier from autopilot project
        const autopilotEntity = await findAutopilotProject(ctx, companyId, projectId);
        const autopilot = autopilotEntity ? asAutopilotProject(autopilotEntity) : null;
        const automationTier = autopilot?.automationTier ?? "supervised";

        // Create planning artifact
        planningArtifact = {
          artifactId: randomUUID(),
          companyId,
          projectId,
          ideaId,
          title: idea.title,
          scope: idea.description || "",
          dependencies: [],
          tests: [],
          executionMode: "simple",
          approvalMode: automationTier === "fullauto" ? "auto_approve" : "manual",
          automationTier,
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        await upsertPlanningArtifact(ctx, planningArtifact);

        // Check budget constraints before creating delivery run
        const companyBudget = await findCompanyBudget(ctx, companyId);
        if (companyBudget && companyBudget.paused) {
          // Budget paused — skip delivery run creation but still created the artifact
        } else if (autopilot?.paused) {
          // Autopilot paused — skip delivery run creation but still created the artifact
        } else {
          const runId = randomUUID();
          const branchName = `autopilot-run-${runId.slice(0, 8)}`;

          const lease: WorkspaceLease = {
            leaseId: randomUUID(),
            companyId,
            projectId,
            runId,
            workspacePath: autopilot?.workspaceId ?? "",
            branchName,
            leasedPort: null,
            gitRepoRoot: autopilot?.repoUrl ?? null,
            isActive: true,
            createdAt: nowIso(),
            releasedAt: null
          };
          await upsertWorkspaceLease(ctx, lease);

          deliveryRun = {
            runId,
            companyId,
            projectId,
            ideaId,
            artifactId: planningArtifact.artifactId,
            status: "pending",
            automationTier,
            branchName,
            workspacePath: autopilot?.workspaceId ?? "",
            leasedPort: null,
            commitSha: null,
            paused: false,
            completedAt: null,
            createdAt: nowIso(),
            updatedAt: nowIso()
          };
          await upsertDeliveryRun(ctx, deliveryRun);

          // Track used minutes against company budget
          if (companyBudget) {
            companyBudget.autopilotUsedMinutes += autopilot?.budgetMinutes ?? 0;
            companyBudget.updatedAt = nowIso();
            if (companyBudget.autopilotUsedMinutes >= companyBudget.autopilotBudgetMinutes) {
              companyBudget.paused = true;
              companyBudget.pauseReason = "Autopilot budget minutes exceeded";
            }
            await upsertCompanyBudget(ctx, companyBudget);
          }
        }
      }

      return { swipe, idea, profile, planningArtifact, deliveryRun };
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

    ctx.actions.register(ACTION_KEYS.createPlanningArtifact, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const ideaId = typeof params.ideaId === "string" ? params.ideaId : "";
      if (!companyId || !projectId || !ideaId) {
        throw new Error("companyId, projectId, and ideaId are required");
      }

      // Get the idea to determine the automation tier from the autopilot project
      const autopilotEntity = await findAutopilotProject(ctx, companyId, projectId);
      const autopilot = autopilotEntity ? asAutopilotProject(autopilotEntity) : null;
      const automationTier = autopilot?.automationTier ?? "supervised";

      const artifact: PlanningArtifact = {
        artifactId: randomUUID(),
        companyId,
        projectId,
        ideaId,
        title: typeof params.title === "string" ? params.title : "Planning Artifact",
        scope: typeof params.scope === "string" ? params.scope : "",
        dependencies: Array.isArray(params.dependencies) ? params.dependencies : [],
        tests: Array.isArray(params.tests) ? params.tests : [],
        executionMode: (params.executionMode === "convoy") ? "convoy" : "simple",
        approvalMode: automationTier === "fullauto" ? "auto_approve" : "manual",
        automationTier,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      await upsertPlanningArtifact(ctx, artifact);
      return artifact;
    });

    ctx.actions.register(ACTION_KEYS.createDeliveryRun, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const ideaId = typeof params.ideaId === "string" ? params.ideaId : "";
      const artifactId = typeof params.artifactId === "string" ? params.artifactId : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      // Check budget cap before creating run
      const companyBudget = await findCompanyBudget(ctx, companyId);
      if (companyBudget && companyBudget.paused) {
        throw new Error("Company autopilot budget is paused: " + (companyBudget.pauseReason ?? "Budget exceeded"));
      }

      // Check project budget via autopilot settings
      const autopilotEntity = await findAutopilotProject(ctx, companyId, projectId);
      const autopilot = autopilotEntity ? asAutopilotProject(autopilotEntity) : null;
      if (autopilot?.paused) {
        throw new Error("Project autopilot is paused: " + (autopilot.pauseReason ?? "Budget or policy pause"));
      }

      const automationTier = autopilot?.automationTier ?? "supervised";

      const runId = randomUUID();
      const branchName = typeof params.branchName === "string" ? params.branchName : `autopilot-run-${runId.slice(0, 8)}`;
      const workspacePath = typeof params.workspacePath === "string" ? params.workspacePath : "";
      const leasedPort = typeof params.leasedPort === "number" ? params.leasedPort : null;

      // Create workspace lease
      const lease: WorkspaceLease = {
        leaseId: randomUUID(),
        companyId,
        projectId,
        runId,
        workspacePath,
        branchName,
        leasedPort,
        gitRepoRoot: autopilot?.repoUrl ?? null,
        isActive: true,
        createdAt: nowIso(),
        releasedAt: null
      };
      await upsertWorkspaceLease(ctx, lease);

      const run: DeliveryRun = {
        runId,
        companyId,
        projectId,
        ideaId,
        artifactId,
        status: "pending",
        automationTier,
        branchName,
        workspacePath,
        leasedPort,
        commitSha: null,
        paused: false,
        completedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      await upsertDeliveryRun(ctx, run);

      // Update company budget used minutes
      if (companyBudget) {
        companyBudget.autopilotUsedMinutes += autopilot?.budgetMinutes ?? 0;
        companyBudget.updatedAt = nowIso();
        // Check if autopilot portion is exceeded
        if (companyBudget.autopilotUsedMinutes >= companyBudget.autopilotBudgetMinutes) {
          companyBudget.paused = true;
          companyBudget.pauseReason = "Autopilot budget minutes exceeded";
        }
        await upsertCompanyBudget(ctx, companyBudget);
      }

      return { run, lease };
    });

    ctx.actions.register(ACTION_KEYS.pauseAutopilot, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const existing = await findAutopilotProject(ctx, companyId, projectId);
      if (!existing) {
        throw new Error("Autopilot project not found");
      }

      const autopilot = asAutopilotProject(existing);
      autopilot.paused = true;
      autopilot.pauseReason = typeof params.reason === "string" ? params.reason : "Operator paused";
      autopilot.updatedAt = nowIso();

      await upsertAutopilotProject(ctx, autopilot);
      return { status: "paused", pauseReason: autopilot.pauseReason };
    });

    ctx.actions.register(ACTION_KEYS.resumeAutopilot, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const existing = await findAutopilotProject(ctx, companyId, projectId);
      if (!existing) {
        throw new Error("Autopilot project not found");
      }

      const autopilot = asAutopilotProject(existing);
      autopilot.paused = false;
      autopilot.pauseReason = undefined;
      autopilot.updatedAt = nowIso();

      await upsertAutopilotProject(ctx, autopilot);
      return { status: "running", pauseReason: undefined };
    });

    ctx.actions.register(ACTION_KEYS.pauseDeliveryRun, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      if (!companyId || !projectId || !runId) {
        throw new Error("companyId, projectId, and runId are required");
      }

      const entity = await findDeliveryRun(ctx, companyId, projectId, runId);
      if (!entity) {
        throw new Error("Delivery run not found");
      }

      const run = asDeliveryRun(entity);
      run.paused = true;
      run.pauseReason = typeof params.reason === "string" ? params.reason : "Operator paused";
      run.status = "paused";
      run.updatedAt = nowIso();

      await upsertDeliveryRun(ctx, run);
      return { status: "paused", pauseReason: run.pauseReason };
    });

    ctx.actions.register(ACTION_KEYS.resumeDeliveryRun, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      if (!companyId || !projectId || !runId) {
        throw new Error("companyId, projectId, and runId are required");
      }

      const entity = await findDeliveryRun(ctx, companyId, projectId, runId);
      if (!entity) {
        throw new Error("Delivery run not found");
      }

      const run = asDeliveryRun(entity);
      run.paused = false;
      run.pauseReason = undefined;
      run.status = "running";
      run.updatedAt = nowIso();

      await upsertDeliveryRun(ctx, run);
      return { status: "running", pauseReason: undefined };
    });

    ctx.actions.register(ACTION_KEYS.updateCompanyBudget, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      if (!companyId) {
        throw new Error("companyId is required");
      }

      const existing = await findCompanyBudget(ctx, companyId);
      const budgetId = existing?.budgetId ?? randomUUID();

      const budget: CompanyBudget = {
        budgetId,
        companyId,
        totalBudgetMinutes: typeof params.totalBudgetMinutes === "number" ? params.totalBudgetMinutes : (existing?.totalBudgetMinutes ?? 0),
        usedBudgetMinutes: typeof params.usedBudgetMinutes === "number" ? params.usedBudgetMinutes : (existing?.usedBudgetMinutes ?? 0),
        autopilotBudgetMinutes: typeof params.autopilotBudgetMinutes === "number" ? params.autopilotBudgetMinutes : (existing?.autopilotBudgetMinutes ?? 0),
        autopilotUsedMinutes: typeof params.autopilotUsedMinutes === "number" ? params.autopilotUsedMinutes : (existing?.autopilotUsedMinutes ?? 0),
        paused: params.paused === true || (existing?.paused ?? false),
        pauseReason: typeof params.pauseReason === "string" ? params.pauseReason : existing?.pauseReason,
        updatedAt: nowIso()
      };

      await upsertCompanyBudget(ctx, budget);
      return budget;
    });

    ctx.actions.register(ACTION_KEYS.checkBudgetAndPauseIfNeeded, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      if (!companyId || !projectId) {
        throw new Error("companyId and projectId are required");
      }

      const autopilotEntity = await findAutopilotProject(ctx, companyId, projectId);
      if (!autopilotEntity) return { paused: false, reason: null };

      const autopilot = asAutopilotProject(autopilotEntity);
      const companyBudget = await findCompanyBudget(ctx, companyId);

      // Check company-level autopilot budget
      if (companyBudget && companyBudget.autopilotUsedMinutes >= companyBudget.autopilotBudgetMinutes) {
        if (!companyBudget.paused) {
          companyBudget.paused = true;
          companyBudget.pauseReason = "Company-wide autopilot budget minutes exceeded";
          companyBudget.updatedAt = nowIso();
          await upsertCompanyBudget(ctx, companyBudget);
        }
        return { paused: true, reason: companyBudget.pauseReason ?? "Budget exceeded" };
      }

      return { paused: autopilot.paused, reason: autopilot.pauseReason ?? null };
    });

    // ─── Convoy Task Actions ─────────────────────────────────────────────────

    ctx.actions.register(ACTION_KEYS.decomposeIntoConvoyTasks, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      const artifactId = typeof params.artifactId === "string" ? params.artifactId : "";
      const tasksRaw = Array.isArray(params.tasks) ? params.tasks : [];
      if (!companyId || !projectId || !runId || !artifactId) {
        throw new Error("companyId, projectId, runId, and artifactId are required");
      }

      const createdTasks: ConvoyTask[] = [];
      for (let i = 0; i < tasksRaw.length; i++) {
        const raw = tasksRaw[i];
        const taskId = typeof raw.taskId === "string" && raw.taskId
          ? raw.taskId
          : randomUUID();
        const title = typeof raw.title === "string" ? raw.title : `Task ${i + 1}`;
        const description = typeof raw.description === "string" ? raw.description : "";
        const dependsOnTaskIds = Array.isArray(raw.dependsOnTaskIds) ? raw.dependsOnTaskIds : [];

        const task: ConvoyTask = {
          taskId,
          companyId,
          projectId,
          runId,
          artifactId,
          title,
          description,
          status: dependsOnTaskIds.length > 0 ? "blocked" : "pending",
          dependsOnTaskIds,
          startedAt: null,
          completedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        await upsertConvoyTask(ctx, task);
        createdTasks.push(task);
      }

      return createdTasks;
    });

    ctx.actions.register(ACTION_KEYS.updateConvoyTaskStatus, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const taskId = typeof params.taskId === "string" ? params.taskId : "";
      const newStatus = isValidConvoyTaskStatus(params.status) ? params.status : "pending";
      if (!companyId || !projectId || !taskId) {
        throw new Error("companyId, projectId, and taskId are required");
      }

      const entity = await findConvoyTask(ctx, companyId, projectId, taskId);
      if (!entity) {
        throw new Error("Convoy task not found");
      }

      const task = asConvoyTask(entity);
      task.status = newStatus;
      task.updatedAt = nowIso();
      if (newStatus === "running") {
        task.startedAt = nowIso();
      } else if (newStatus === "passed" || newStatus === "failed" || newStatus === "skipped") {
        task.completedAt = nowIso();
      }

      await upsertConvoyTask(ctx, task);

      // Update blocked tasks if a dependency passed - re-evaluate blocking status
      if (newStatus === "passed") {
        const allTaskEntities = await listConvoyTaskEntities(ctx, companyId, projectId, task.runId);
        const allTasks = allTaskEntities.map(asConvoyTask);
        for (const t of allTasks) {
          if (t.status === "blocked") {
            const depsAllPassed = t.dependsOnTaskIds.every((depId) => {
              const dep = allTasks.find((x) => x.taskId === depId);
              return dep && dep.status === "passed";
            });
            if (depsAllPassed) {
              t.status = "pending";
              t.updatedAt = nowIso();
              await upsertConvoyTask(ctx, t);
            }
          }
        }
      }

      return task;
    });

    // ─── Checkpoint Actions ─────────────────────────────────────────────────

    ctx.actions.register(ACTION_KEYS.createCheckpoint, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      if (!companyId || !projectId || !runId) {
        throw new Error("companyId, projectId, and runId are required");
      }

      const runEntity = await findDeliveryRun(ctx, companyId, projectId, runId);
      if (!runEntity) {
        throw new Error("Delivery run not found");
      }
      const run = asDeliveryRun(runEntity);

      const taskEntities = await listConvoyTaskEntities(ctx, companyId, projectId, runId);
      const taskStates: Record<string, ConvoyTaskStatus> = {};
      for (const entity of taskEntities) {
        const task = asConvoyTask(entity);
        taskStates[task.taskId] = task.status;
      }

      const checkpoint: Checkpoint = {
        checkpointId: randomUUID(),
        companyId,
        projectId,
        runId,
        snapshotState: {
          runStatus: run.status,
          paused: run.paused,
          pauseReason: run.pauseReason,
          commitSha: run.commitSha
        },
        taskStates,
        workspaceSnapshot: {
          branchName: run.branchName,
          commitSha: run.commitSha,
          workspacePath: run.workspacePath,
          leasedPort: run.leasedPort
        },
        pauseReason: run.pauseReason,
        createdAt: nowIso()
      };

      await upsertCheckpoint(ctx, checkpoint);
      return checkpoint;
    });

    ctx.actions.register(ACTION_KEYS.resumeFromCheckpoint, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      const checkpointId = typeof params.checkpointId === "string" ? params.checkpointId : "";
      if (!companyId || !projectId || !runId || !checkpointId) {
        throw new Error("companyId, projectId, runId, and checkpointId are required");
      }

      const checkpointEntity = await findCheckpoint(ctx, companyId, projectId, checkpointId);
      if (!checkpointEntity) {
        throw new Error("Checkpoint not found");
      }
      const checkpoint = asCheckpoint(checkpointEntity);

      const runEntity = await findDeliveryRun(ctx, companyId, projectId, runId);
      if (!runEntity) {
        throw new Error("Delivery run not found");
      }
      const run = asDeliveryRun(runEntity);

      // Restore run state from checkpoint
      run.status = (checkpoint.snapshotState.runStatus as RunStatus) ?? "running";
      run.paused = (checkpoint.snapshotState.paused as boolean) ?? false;
      run.pauseReason = checkpoint.snapshotState.pauseReason as string | undefined;
      run.commitSha = checkpoint.snapshotState.commitSha as string | null;
      run.updatedAt = nowIso();
      await upsertDeliveryRun(ctx, run);

      // Restore task states from checkpoint
      const taskEntities = await listConvoyTaskEntities(ctx, companyId, projectId, runId);
      for (const entity of taskEntities) {
        const task = asConvoyTask(entity);
        const savedStatus = checkpoint.taskStates[task.taskId];
        if (savedStatus) {
          task.status = savedStatus;
          task.updatedAt = nowIso();
          await upsertConvoyTask(ctx, task);
        }
      }

      return { run, checkpoint };
    });

    // ─── Product Lock Actions ────────────────────────────────────────────────

    ctx.actions.register(ACTION_KEYS.acquireProductLock, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      const targetBranch = typeof params.targetBranch === "string" ? params.targetBranch : "";
      const lockType = (params.lockType === "product_lock" || params.lockType === "merge_lock")
        ? params.lockType
        : "product_lock";
      const blockReason = typeof params.blockReason === "string" ? params.blockReason : undefined;
      if (!companyId || !projectId || !runId || !targetBranch) {
        throw new Error("companyId, projectId, runId, and targetBranch are required");
      }

      // Check if there's already an active lock on this branch
      const existingLock = await findBlockingLock(ctx, companyId, projectId, targetBranch, runId);
      if (existingLock) {
        throw new Error(
          `Cannot acquire lock: ${existingLock.lockType} already held by run ${existingLock.runId} on branch ${targetBranch}. Block reason: ${existingLock.blockReason ?? "None"}`
        );
      }

      const runEntity = await findDeliveryRun(ctx, companyId, projectId, runId);
      const run = runEntity ? asDeliveryRun(runEntity) : null;

      const lock: ProductLock = {
        lockId: randomUUID(),
        companyId,
        projectId,
        runId,
        lockType,
        targetBranch,
        targetPath: run?.workspacePath ?? "",
        acquiredAt: nowIso(),
        releasedAt: null,
        isActive: true,
        blockReason
      };

      await upsertProductLock(ctx, lock);
      return lock;
    });

    ctx.actions.register(ACTION_KEYS.releaseProductLock, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const lockId = typeof params.lockId === "string" ? params.lockId : "";
      if (!companyId || !projectId || !lockId) {
        throw new Error("companyId, projectId, and lockId are required");
      }

      const lockEntity = await findProductLock(ctx, companyId, projectId, lockId);
      if (!lockEntity) {
        throw new Error("Product lock not found");
      }

      const lock = asProductLock(lockEntity);
      lock.isActive = false;
      lock.releasedAt = nowIso();
      await upsertProductLock(ctx, lock);
      return lock;
    });

    ctx.actions.register(ACTION_KEYS.checkMergeConflict, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      const targetBranch = typeof params.targetBranch === "string" ? params.targetBranch : "";
      if (!companyId || !projectId || !runId || !targetBranch) {
        throw new Error("companyId, projectId, runId, and targetBranch are required");
      }

      const blockingLock = await findBlockingLock(ctx, companyId, projectId, targetBranch, runId);
      if (blockingLock) {
        return {
          hasConflict: true,
          conflictReason: `Branch "${targetBranch}" is locked by ${blockingLock.lockType} from run ${blockingLock.runId}. ${blockingLock.blockReason ?? ""}`.trim(),
          blockingLock
        };
      }
      return { hasConflict: false, conflictReason: null, blockingLock: null };
    });

    // ─── Operator Intervention Actions ──────────────────────────────────────

    ctx.actions.register(ACTION_KEYS.addOperatorNote, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      const note = typeof params.note === "string" ? params.note : "";
      if (!companyId || !projectId || !runId) {
        throw new Error("companyId, projectId, and runId are required");
      }

      const intervention: OperatorIntervention = {
        interventionId: randomUUID(),
        companyId,
        projectId,
        runId,
        interventionType: "note",
        note,
        createdAt: nowIso()
      };

      await upsertOperatorIntervention(ctx, intervention);
      return intervention;
    });

    ctx.actions.register(ACTION_KEYS.requestCheckpoint, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      const checkpointId = typeof params.checkpointId === "string" ? params.checkpointId : "";
      if (!companyId || !projectId || !runId) {
        throw new Error("companyId, projectId, and runId are required");
      }

      const intervention: OperatorIntervention = {
        interventionId: randomUUID(),
        companyId,
        projectId,
        runId,
        interventionType: "checkpoint_request",
        checkpointId: checkpointId || undefined,
        createdAt: nowIso()
      };

      await upsertOperatorIntervention(ctx, intervention);
      return intervention;
    });

    ctx.actions.register(ACTION_KEYS.nudgeRun, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      const note = typeof params.note === "string" ? params.note : "Operator nudged this run";
      if (!companyId || !projectId || !runId) {
        throw new Error("companyId, projectId, and runId are required");
      }

      const intervention: OperatorIntervention = {
        interventionId: randomUUID(),
        companyId,
        projectId,
        runId,
        interventionType: "nudge",
        note,
        createdAt: nowIso()
      };

      await upsertOperatorIntervention(ctx, intervention);
      return intervention;
    });

    ctx.actions.register(ACTION_KEYS.inspectLinkedIssue, async (params) => {
      const companyId = isValidCompanyId(params.companyId) ? params.companyId : "";
      const projectId = isValidProjectId(params.projectId) ? params.projectId : "";
      const runId = typeof params.runId === "string" ? params.runId : "";
      const linkedIssueId = typeof params.linkedIssueId === "string" ? params.linkedIssueId : "";
      const linkedIssueUrl = typeof params.linkedIssueUrl === "string" ? params.linkedIssueUrl : undefined;
      const linkedIssueTitle = typeof params.linkedIssueTitle === "string" ? params.linkedIssueTitle : undefined;
      const linkedIssueComments = Array.isArray(params.linkedIssueComments) ? params.linkedIssueComments : undefined;
      if (!companyId || !projectId || !runId) {
        throw new Error("companyId, projectId, and runId are required");
      }

      const intervention: OperatorIntervention = {
        interventionId: randomUUID(),
        companyId,
        projectId,
        runId,
        interventionType: "linked_issue_inspection",
        linkedIssueId: linkedIssueId || undefined,
        linkedIssueUrl,
        linkedIssueTitle,
        linkedIssueComments,
        createdAt: nowIso()
      };

      await upsertOperatorIntervention(ctx, intervention);
      return intervention;
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
