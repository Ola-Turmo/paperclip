export const PLUGIN_ID = "paperclip.autopilot";

export const ENTITY_TYPES = {
  autopilotProject: "autopilot-project",
  productProgramRevision: "product-program-revision",
  researchCycle: "research-cycle",
  researchFinding: "research-finding",
  idea: "idea",
  swipeEvent: "swipe-event",
  preferenceProfile: "preference-profile",
  planningArtifact: "planning-artifact",
  deliveryRun: "delivery-run",
  workspaceLease: "workspace-lease",
  companyBudget: "company-budget",
  convoyTask: "convoy-task",
  checkpoint: "checkpoint",
  productLock: "product-lock",
  operatorIntervention: "operator-intervention",
  learnerSummary: "learner-summary",
  knowledgeEntry: "knowledge-entry",
  digest: "digest",
  releaseHealth: "release-health",
  rollbackAction: "rollback-action"
} as const;

export const DATA_KEYS = {
  autopilotProject: "autopilot-project",
  autopilotProjects: "autopilot-projects",
  productProgramRevision: "product-program-revision",
  productProgramRevisions: "product-program-revisions",
  projects: "projects",
  researchCycle: "research-cycle",
  researchCycles: "research-cycles",
  researchFinding: "research-finding",
  researchFindings: "research-findings",
  idea: "idea",
  ideas: "ideas",
  maybePoolIdeas: "maybe-pool-ideas",
  swipeEvent: "swipe-event",
  swipeEvents: "swipe-events",
  preferenceProfile: "preference-profile",
  planningArtifact: "planning-artifact",
  planningArtifacts: "planning-artifacts",
  deliveryRun: "delivery-run",
  deliveryRuns: "delivery-runs",
  workspaceLease: "workspace-lease",
  workspaceLeases: "workspace-leases",
  companyBudget: "company-budget",
  companyBudgets: "company-budgets",
  convoyTask: "convoy-task",
  convoyTasks: "convoy-tasks",
  checkpoint: "checkpoint",
  checkpoints: "checkpoints",
  productLock: "product-lock",
  productLocks: "product-locks",
  operatorIntervention: "operator-intervention",
  operatorInterventions: "operator-interventions",
  learnerSummary: "learner-summary",
  learnerSummaries: "learner-summaries",
  knowledgeEntry: "knowledge-entry",
  knowledgeEntries: "knowledge-entries",
  digest: "digest",
  digests: "digests",
  releaseHealth: "release-health",
  releaseHealthChecks: "release-health-checks",
  rollbackAction: "rollback-action",
  rollbackActions: "rollback-actions"
} as const;

export const ACTION_KEYS = {
  saveAutopilotProject: "save-autopilot-project",
  enableAutopilot: "enable-autopilot",
  disableAutopilot: "disable-autopilot",
  saveProductProgramRevision: "save-product-program-revision",
  createProductProgramRevision: "create-product-program-revision",
  startResearchCycle: "start-research-cycle",
  completeResearchCycle: "complete-research-cycle",
  addResearchFinding: "add-research-finding",
  generateIdeas: "generate-ideas",
  recordSwipe: "record-swipe",
  updatePreferenceProfile: "update-preference-profile",
  createPlanningArtifact: "create-planning-artifact",
  createDeliveryRun: "create-delivery-run",
  completeDeliveryRun: "complete-delivery-run",
  pauseAutopilot: "pause-autopilot",
  resumeAutopilot: "resume-autopilot",
  pauseDeliveryRun: "pause-delivery-run",
  resumeDeliveryRun: "resume-delivery-run",
  updateCompanyBudget: "update-company-budget",
  checkBudgetAndPauseIfNeeded: "check-budget-and-pause-if-needed",
  decomposeIntoConvoyTasks: "decompose-into-convoy-tasks",
  updateConvoyTaskStatus: "update-convoy-task-status",
  createCheckpoint: "create-checkpoint",
  resumeFromCheckpoint: "resume-from-checkpoint",
  acquireProductLock: "acquire-product-lock",
  releaseProductLock: "release-product-lock",
  checkMergeConflict: "check-merge-conflict",
  addOperatorNote: "add-operator-note",
  requestCheckpoint: "request-checkpoint",
  nudgeRun: "nudge-run",
  inspectLinkedIssue: "inspect-linked-issue",
  createLearnerSummary: "create-learner-summary",
  createKnowledgeEntry: "create-knowledge-entry",
  getKnowledgeForRun: "get-knowledge-for-run",
  markKnowledgeAsUsed: "mark-knowledge-as-used",
  createDigest: "create-digest",
  generateStuckRunDigest: "generate-stuck-run-digest",
  generateBudgetAlertDigest: "generate-budget-alert-digest",
  createReleaseHealthCheck: "create-release-health-check",
  updateReleaseHealthStatus: "update-release-health-status",
  triggerRollback: "trigger-rollback",
  checkStuckRuns: "check-stuck-runs"
} as const;

export const JOB_KEYS = {} as const;

export const TOOL_KEYS = {} as const;

export type AutomationTier = "supervised" | "semiauto" | "fullauto";
export type IdeaStatus = "active" | "maybe" | "approved" | "rejected" | "in_progress" | "completed";
export type SwipeDecision = "pass" | "maybe" | "yes" | "now";
export type ResearchStatus = "pending" | "running" | "completed" | "failed";
export type RunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type ExecutionMode = "simple" | "convoy";
export type ApprovalMode = "manual" | "auto_approve";
export type ConvoyTaskStatus = "pending" | "blocked" | "running" | "passed" | "failed" | "skipped";
export type InterventionType = "note" | "checkpoint_request" | "nudge" | "linked_issue_inspection";
export type LockType = "product_lock" | "merge_lock";

export interface AutopilotProject {
  autopilotId: string;
  companyId: string;
  projectId: string;
  enabled: boolean;
  automationTier: AutomationTier;
  budgetMinutes: number;
  repoUrl?: string;
  workspaceId?: string;
  agentId?: string;
  paused: boolean;
  pauseReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductProgramRevision {
  revisionId: string;
  companyId: string;
  projectId: string;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchFinding {
  findingId: string;
  companyId: string;
  projectId: string;
  cycleId: string;
  title: string;
  description: string;
  sourceUrl?: string;
  sourceLabel?: string;
  evidenceText?: string;
  confidence: number; // 0-1
  createdAt: string;
}

export interface ResearchCycle {
  cycleId: string;
  companyId: string;
  projectId: string;
  status: ResearchStatus;
  query: string;
  reportContent?: string;
  findingsCount: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface Idea {
  ideaId: string;
  companyId: string;
  projectId: string;
  cycleId?: string;
  title: string;
  description: string;
  rationale: string;
  sourceReferences: string[];
  score: number; // 0-100
  status: IdeaStatus;
  duplicateOfIdeaId?: string;
  duplicateAnnotated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SwipeEvent {
  swipeId: string;
  companyId: string;
  projectId: string;
  ideaId: string;
  decision: SwipeDecision;
  createdAt: string;
}

export interface PreferenceProfile {
  profileId: string;
  companyId: string;
  projectId: string;
  passCount: number;
  maybeCount: number;
  yesCount: number;
  nowCount: number;
  lastUpdated: string;
}

export interface PlanningArtifact {
  artifactId: string;
  companyId: string;
  projectId: string;
  ideaId: string;
  title: string;
  scope: string;
  dependencies: string[];
  tests: string[];
  executionMode: ExecutionMode;
  approvalMode: ApprovalMode;
  automationTier: AutomationTier;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryRun {
  runId: string;
  companyId: string;
  projectId: string;
  ideaId: string;
  artifactId: string;
  status: RunStatus;
  automationTier: AutomationTier;
  branchName: string;
  workspacePath: string;
  leasedPort: number | null;
  commitSha: string | null;
  paused: boolean;
  pauseReason?: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceLease {
  leaseId: string;
  companyId: string;
  projectId: string;
  runId: string;
  workspacePath: string;
  branchName: string;
  leasedPort: number | null;
  gitRepoRoot: string | null;
  isActive: boolean;
  createdAt: string;
  releasedAt: string | null;
}

export interface CompanyBudget {
  budgetId: string;
  companyId: string;
  totalBudgetMinutes: number;
  usedBudgetMinutes: number;
  autopilotBudgetMinutes: number;
  autopilotUsedMinutes: number;
  paused: boolean;
  pauseReason?: string;
  updatedAt: string;
}

export interface ConvoyTask {
  taskId: string;
  companyId: string;
  projectId: string;
  runId: string;
  artifactId: string;
  title: string;
  description: string;
  status: ConvoyTaskStatus;
  dependsOnTaskIds: string[];
  startedAt: string | null;
  completedAt: string | null;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Checkpoint {
  checkpointId: string;
  companyId: string;
  projectId: string;
  runId: string;
  snapshotState: Record<string, unknown>;
  taskStates: Record<string, ConvoyTaskStatus>;
  workspaceSnapshot: {
    branchName: string;
    commitSha: string | null;
    workspacePath: string;
    leasedPort: number | null;
  };
  pauseReason?: string;
  createdAt: string;
}

export interface ProductLock {
  lockId: string;
  companyId: string;
  projectId: string;
  runId: string;
  lockType: LockType;
  targetBranch: string;
  targetPath: string;
  acquiredAt: string;
  releasedAt: string | null;
  isActive: boolean;
  blockReason?: string;
}

export interface OperatorIntervention {
  interventionId: string;
  companyId: string;
  projectId: string;
  runId: string;
  interventionType: InterventionType;
  note?: string;
  checkpointId?: string;
  linkedIssueId?: string;
  linkedIssueUrl?: string;
  linkedIssueTitle?: string;
  linkedIssueComments?: string[];
  createdAt: string;
}

// ─── Learner Summary ────────────────────────────────────────────────────────────

export interface LearnerSummary {
  summaryId: string;
  companyId: string;
  projectId: string;
  runId: string;
  ideaId: string;
  title: string;
  summaryText: string;
  keyLearnings: string[];
  skillsReinjected: string[];
  metrics: {
    duration?: number;
    commits?: number;
    testsAdded?: number;
    testsPassed?: number;
    filesChanged?: number;
  };
  createdAt: string;
}

// ─── Knowledge Entry ───────────────────────────────────────────────────────────

export type KnowledgeType = "procedure" | "pattern" | "lesson" | "skill";

export interface KnowledgeEntry {
  entryId: string;
  companyId: string;
  projectId: string;
  knowledgeType: KnowledgeType;
  title: string;
  content: string;
  reinjectionCommand?: string;
  sourceRunId?: string;
  sourceSummaryId?: string;
  usedInRunId?: string;
  lastUsedAt?: string;
  usageCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Digest ───────────────────────────────────────────────────────────────────

export type DigestType = "budget_alert" | "stuck_run" | "opportunity" | "weekly_summary" | "health_check_failed";
export type DigestStatus = "pending" | "delivered" | "read" | "dismissed";

export interface Digest {
  digestId: string;
  companyId: string;
  projectId: string;
  digestType: DigestType;
  title: string;
  summary: string;
  details: string[];
  priority: "low" | "medium" | "high" | "critical";
  status: DigestStatus;
  deliveredAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  relatedRunId?: string;
  relatedBudgetId?: string;
  createdAt: string;
}

// ─── Release Health ────────────────────────────────────────────────────────────

export type HealthCheckStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type HealthCheckType = "smoke_test" | "integration_test" | "custom_check" | "merge_check";

export interface ReleaseHealthCheck {
  checkId: string;
  companyId: string;
  projectId: string;
  runId: string;
  checkType: HealthCheckType;
  name: string;
  status: HealthCheckStatus;
  errorMessage?: string;
  failedAt?: string;
  passedAt?: string;
  createdAt: string;
}

// ─── Rollback Action ───────────────────────────────────────────────────────────

export type RollbackStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";
export type RollbackType = "revert_commit" | "restore_checkpoint" | "full_rollback";

export interface RollbackAction {
  rollbackId: string;
  companyId: string;
  projectId: string;
  runId: string;
  checkId: string;
  rollbackType: RollbackType;
  status: RollbackStatus;
  targetCommitSha?: string;
  checkpointId?: string;
  errorMessage?: string;
  completedAt?: string;
  createdAt: string;
}
