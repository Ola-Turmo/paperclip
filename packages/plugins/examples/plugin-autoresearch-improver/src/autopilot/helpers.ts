/**
 * Shared autopilot entity helpers for use by both the root worker and
 * the autopilot sub-worker. All autopilot entities (ideas, research,
 * swipes, budgets, etc.) are managed through these functions.
 */
import { randomUUID } from "node:crypto";
import type { PluginContext, PluginEntityRecord } from "@paperclipai/plugin-sdk";
import type {
  AutomationTier,
  Idea,
  IdeaStatus,
  SwipeDecision,
  ResearchCycle,
  ResearchFinding,
  SwipeEvent,
  PreferenceProfile,
  PlanningArtifact,
  DeliveryRun,
  WorkspaceLease,
  CompanyBudget,
} from "./constants.js";
import { ENTITY_TYPES } from "./constants.js";

// ─── Type Casters ────────────────────────────────────────────────────────────

export function asIdea(record: PluginEntityRecord): Idea {
  return record.data as unknown as Idea;
}

export function asSwipeEvent(record: PluginEntityRecord): SwipeEvent {
  return record.data as unknown as SwipeEvent;
}

export function asPreferenceProfile(record: PluginEntityRecord): PreferenceProfile {
  return record.data as unknown as PreferenceProfile;
}

export function asResearchCycle(record: PluginEntityRecord): ResearchCycle {
  return record.data as unknown as ResearchCycle;
}

export function asResearchFinding(record: PluginEntityRecord): ResearchFinding {
  return record.data as unknown as ResearchFinding;
}

export function asPlanningArtifact(record: PluginEntityRecord): PlanningArtifact {
  return record.data as unknown as PlanningArtifact;
}

export function asDeliveryRun(record: PluginEntityRecord): DeliveryRun {
  return record.data as unknown as DeliveryRun;
}

export function asWorkspaceLease(record: PluginEntityRecord): WorkspaceLease {
  return record.data as unknown as WorkspaceLease;
}

export function asCompanyBudget(record: PluginEntityRecord): CompanyBudget {
  return record.data as unknown as CompanyBudget;
}

// ─── Validators ─────────────────────────────────────────────────────────────

export function isValidSwipeDecision(value: unknown): value is SwipeDecision {
  return value === "pass" || value === "maybe" || value === "yes" || value === "now";
}

export function isValidIdeaStatus(value: unknown): value is IdeaStatus {
  return ["active", "maybe", "approved", "rejected", "in_progress", "completed"].includes(String(value));
}

// ─── Text Helpers ────────────────────────────────────────────────────────────

export function normalizeIdeaText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function computeIdeaSimilarity(textA: string, textB: string): number {
  const normA = normalizeIdeaText(textA);
  const normB = normalizeIdeaText(textB);
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.9;
  const wordsA = new Set(normA.split(" "));
  const wordsB = new Set(normB.split(" "));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

// ─── Research Cycle Helpers ──────────────────────────────────────────────────

export async function upsertResearchCycle(
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
    data: cycle as unknown as Record<string, unknown>,
  });
}

export async function findResearchCycle(
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
    offset: 0,
  });
  return entities.find((e) => {
    const data = e.data as unknown as ResearchCycle;
    return data.companyId === companyId && data.cycleId === cycleId;
  }) ?? null;
}

export async function listResearchCycleEntities(
  ctx: PluginContext,
  companyId: string,
  projectId?: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.researchCycle,
    scopeKind: projectId ? "project" : undefined,
    scopeId: projectId,
    limit: 500,
    offset: 0,
  });
  return entities.filter((e) => {
    const data = e.data as unknown as ResearchCycle;
    return data.companyId === companyId;
  });
}

// ─── Research Finding Helpers ────────────────────────────────────────────────

export async function upsertResearchFinding(
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
    data: finding as unknown as Record<string, unknown>,
  });
}

export async function listResearchFindingEntities(
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
    offset: 0,
  });
  return entities.filter((e) => {
    const data = e.data as unknown as ResearchFinding;
    return data.companyId === companyId && (!cycleId || data.cycleId === cycleId);
  });
}

// ─── Idea Helpers ────────────────────────────────────────────────────────────

export async function upsertIdea(ctx: PluginContext, idea: Idea): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.idea,
    scopeKind: "project",
    scopeId: idea.projectId,
    externalId: idea.ideaId,
    title: idea.title.slice(0, 80),
    status: idea.status === "active" ? "active" : idea.status === "rejected" ? "inactive" : "active",
    data: idea as unknown as Record<string, unknown>,
  });
}

export async function listIdeaEntities(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.idea,
    scopeKind: "project",
    scopeId: projectId,
    limit: 500,
    offset: 0,
  });
  return entities.filter((e) => {
    const data = e.data as unknown as Idea;
    return data.companyId === companyId;
  });
}

export async function findIdeaById(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  ideaId: string
): Promise<Idea | null> {
  const entities = await listIdeaEntities(ctx, companyId, projectId);
  const match = entities.find((e) => asIdea(e).ideaId === ideaId);
  return match ? asIdea(match) : null;
}

export async function findDuplicateIdea(
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
    if (excludeIdeaId && idea.ideaId === excludeIdeaId) continue;
    if (!["active", "maybe"].includes(idea.status)) continue;

    const existing = `${normalizeIdeaText(idea.title)} ${normalizeIdeaText(idea.description)}`.trim();
    const similarity = computeIdeaSimilarity(candidate, existing);
    if (similarity >= 0.75) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { idea, similarity };
      }
    }
  }

  return bestMatch;
}

// ─── Swipe Event Helpers ─────────────────────────────────────────────────────

export async function upsertSwipeEvent(
  ctx: PluginContext,
  swipe: SwipeEvent
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.swipeEvent,
    scopeKind: "project",
    scopeId: swipe.projectId,
    externalId: swipe.swipeId,
    title: `Swipe ${swipe.decision} on ${swipe.ideaId.slice(0, 8)}`,
    status: "active",
    data: swipe as unknown as Record<string, unknown>,
  });
}

export async function listSwipeEventEntities(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.swipeEvent,
    scopeKind: "project",
    scopeId: projectId,
    limit: 500,
    offset: 0,
  });
  return entities.filter((e) => {
    const data = e.data as unknown as SwipeEvent;
    return data.companyId === companyId;
  });
}

// ─── Preference Profile Helpers ───────────────────────────────────────────────

export async function findPreferenceProfile(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<PreferenceProfile | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.preferenceProfile,
    scopeKind: "project",
    scopeId: projectId,
    limit: 10,
    offset: 0,
  });
  const matches = entities.filter((e) => {
    const data = e.data as unknown as PreferenceProfile;
    return data.companyId === companyId && data.projectId === projectId;
  });
  return matches.length > 0 ? asPreferenceProfile(matches[0]) : null;
}

export async function upsertPreferenceProfile(
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
    data: profile as unknown as Record<string, unknown>,
  });
}

// ─── Planning Artifact Helpers ───────────────────────────────────────────────

export async function findPlanningArtifact(
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
    offset: 0,
  });
  return (
    entities.find((e) => {
      const data = e.data as unknown as PlanningArtifact;
      return data.companyId === companyId && data.artifactId === artifactId;
    }) ?? null
  );
}

export async function listPlanningArtifactEntities(
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
    offset: 0,
  });
  return entities.filter((e) => {
    const data = e.data as unknown as PlanningArtifact;
    if (data.companyId !== companyId) return false;
    if (ideaId && data.ideaId !== ideaId) return false;
    return true;
  });
}

export async function upsertPlanningArtifact(
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
    data: artifact as unknown as Record<string, unknown>,
  });
}

// ─── Delivery Run Helpers ───────────────────────────────────────────────────

export async function findDeliveryRun(
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
    offset: 0,
  });
  return (
    entities.find((e) => {
      const data = e.data as unknown as DeliveryRun;
      return data.companyId === companyId && data.runId === runId;
    }) ?? null
  );
}

export async function listDeliveryRunEntities(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.deliveryRun,
    scopeKind: "project",
    scopeId: projectId,
    limit: 500,
    offset: 0,
  });
  return entities.filter((e) => {
    const data = e.data as unknown as DeliveryRun;
    return data.companyId === companyId;
  });
}

export async function upsertDeliveryRun(
  ctx: PluginContext,
  run: DeliveryRun
): Promise<PluginEntityRecord> {
  return await ctx.entities.upsert({
    entityType: ENTITY_TYPES.deliveryRun,
    scopeKind: "project",
    scopeId: run.projectId,
    externalId: run.runId,
    title: `Run ${run.runId.slice(0, 8)}`,
    status:
      run.status === "completed" || run.status === "failed" || run.status === "cancelled"
        ? "inactive"
        : "active",
    data: run as unknown as Record<string, unknown>,
  });
}

// ─── Workspace Lease Helpers ──────────────────────────────────────────────────

export async function findWorkspaceLease(
  ctx: PluginContext,
  companyId: string,
  projectId: string,
  leaseId: string
): Promise<PluginEntityRecord | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.workspaceLease,
    scopeKind: "project",
    scopeId: projectId,
    limit: 100,
    offset: 0,
  });
  return (
    entities.find((e) => {
      const data = e.data as unknown as WorkspaceLease;
      return data.companyId === companyId && data.leaseId === leaseId;
    }) ?? null
  );
}

export async function listWorkspaceLeaseEntities(
  ctx: PluginContext,
  companyId: string,
  projectId: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.workspaceLease,
    scopeKind: "project",
    scopeId: projectId,
    limit: 500,
    offset: 0,
  });
  return entities.filter((e) => {
    const data = e.data as unknown as WorkspaceLease;
    return data.companyId === companyId;
  });
}

export async function upsertWorkspaceLease(
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
    data: lease as unknown as Record<string, unknown>,
  });
}

// ─── Company Budget Helpers ───────────────────────────────────────────────────

export async function findCompanyBudget(
  ctx: PluginContext,
  companyId: string
): Promise<CompanyBudget | null> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.companyBudget,
    scopeKind: "company",
    scopeId: companyId,
    limit: 10,
    offset: 0,
  });
  const matches = entities.filter((e) => {
    const data = e.data as unknown as CompanyBudget;
    return data.companyId === companyId;
  });
  return matches.length > 0 ? asCompanyBudget(matches[0]) : null;
}

export async function listCompanyBudgetEntities(
  ctx: PluginContext,
  companyId: string
): Promise<PluginEntityRecord[]> {
  const entities = await ctx.entities.list({
    entityType: ENTITY_TYPES.companyBudget,
    scopeKind: "company",
    scopeId: companyId,
    limit: 100,
    offset: 0,
  });
  return entities.filter((e) => {
    const data = e.data as unknown as CompanyBudget;
    return data.companyId === companyId;
  });
}

export async function upsertCompanyBudget(
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
    data: budget as unknown as Record<string, unknown>,
  });
}
