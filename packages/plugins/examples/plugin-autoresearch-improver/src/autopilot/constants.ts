export const PLUGIN_ID = "paperclip.autopilot";

export const ENTITY_TYPES = {
  autopilotProject: "autopilot-project",
  productProgramRevision: "product-program-revision",
  researchCycle: "research-cycle",
  researchFinding: "research-finding",
  idea: "idea",
  swipeEvent: "swipe-event",
  preferenceProfile: "preference-profile"
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
  preferenceProfile: "preference-profile"
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
  updatePreferenceProfile: "update-preference-profile"
} as const;

export const JOB_KEYS = {} as const;

export const TOOL_KEYS = {} as const;

export type AutomationTier = "supervised" | "semiauto" | "fullauto";

export type IdeaStatus = "active" | "maybe" | "approved" | "rejected" | "in_progress" | "completed";
export type SwipeDecision = "pass" | "maybe" | "yes" | "now";
export type ResearchStatus = "pending" | "running" | "completed" | "failed";

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
