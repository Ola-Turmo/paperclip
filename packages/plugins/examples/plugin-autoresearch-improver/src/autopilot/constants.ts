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
  operatorIntervention: "operator-intervention"
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
  operatorInterventions: "operator-interventions"
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
  inspectLinkedIssue: "inspect-linked-issue"
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
