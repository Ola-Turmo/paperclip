export const PLUGIN_ID = "paperclip.autopilot";

export const ENTITY_TYPES = {
  autopilotProject: "autopilot-project",
  productProgramRevision: "product-program-revision"
} as const;

export const DATA_KEYS = {
  autopilotProject: "autopilot-project",
  autopilotProjects: "autopilot-projects",
  productProgramRevision: "product-program-revision",
  productProgramRevisions: "product-program-revisions",
  projects: "projects"
} as const;

export const ACTION_KEYS = {
  saveAutopilotProject: "save-autopilot-project",
  enableAutopilot: "enable-autopilot",
  disableAutopilot: "disable-autopilot",
  saveProductProgramRevision: "save-product-program-revision",
  createProductProgramRevision: "create-product-program-revision"
} as const;

export const JOB_KEYS = {} as const;

export const TOOL_KEYS = {} as const;

export type AutomationTier = "supervised" | "semiauto" | "fullauto";

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
