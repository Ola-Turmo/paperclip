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
  companyBudget: "company-budget"
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
  companyBudgets: "company-budgets"
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
  checkBudgetAndPauseIfNeeded: "check-budget-and-pause-if-needed"
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
