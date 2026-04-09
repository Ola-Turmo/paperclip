export const PLUGIN_ID = "paperclip.autoresearch-improver-example";
export const PLUGIN_VERSION = "0.1.0";

export const ENTITY_TYPES = {
  optimizer: "optimizer",
  run: "optimizer-run",
  autopilotProject: "autopilot-project",
  productProgramRevision: "product-program-revision"
} as const;

export const DATA_KEYS = {
  overview: "overview",
  projects: "projects",
  autopilotProject: "autopilot-project",
  autopilotProjects: "autopilot-projects",
  productProgramRevision: "product-program-revision",
  productProgramRevisions: "product-program-revisions",
  projectWorkspaces: "project-workspaces",
  projectOptimizers: "project-optimizers",
  optimizerRuns: "optimizer-runs",
  optimizerTemplates: "optimizer-templates",
  optimizerHistory: "optimizer-history",
  optimizerComparison: "optimizer-comparison"
} as const;

export const ACTION_KEYS = {
  saveAutopilotProject: "save-autopilot-project",
  enableAutopilot: "enable-autopilot",
  disableAutopilot: "disable-autopilot",
  saveProductProgramRevision: "save-product-program-revision",
  createProductProgramRevision: "create-product-program-revision",
  saveOptimizer: "save-optimizer",
  deleteOptimizer: "delete-optimizer",
  cloneOptimizer: "clone-optimizer",
  runOptimizerCycle: "run-optimizer-cycle",
  enqueueOptimizerRun: "enqueue-optimizer-run",
  approveOptimizerRun: "approve-optimizer-run",
  rejectOptimizerRun: "reject-optimizer-run",
  createIssueFromRun: "create-issue-from-run",
  createPullRequestFromRun: "create-pull-request-from-run",
  deleteProposalBranch: "delete-proposal-branch",
  pauseOptimizer: "pause-optimizer",
  resumeOptimizer: "resume-optimizer"
} as const;

export const TOOL_KEYS = {
  listOptimizers: "list-optimizers",
  createIssueFromAcceptedRun: "create-issue-from-accepted-run",
  createPullRequestFromAcceptedRun: "create-pull-request-from-accepted-run",
  exportOptimizerRuns: "export-optimizer-runs"
} as const;

export const JOB_KEYS = {
  optimizerSweep: "optimizer-sweep"
} as const;

export const DEFAULTS = {
  mutationBudgetSeconds: 300,
  scoreBudgetSeconds: 180,
  guardrailBudgetSeconds: 120,
  keepTmpDirs: false,
  maxOutputChars: 8000,
  sweepLimit: 10,
  scoreRepeats: 3,
  guardrailRepeats: 1,
  guardrailAggregator: "all" as const,
  minimumImprovement: 0,
  stagnationIssueThreshold: 5
} as const;

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
