export const PLUGIN_ID = "paperclip.autoresearch-improver-example";
export const PLUGIN_VERSION = "0.1.0";

export const ENTITY_TYPES = {
  optimizer: "optimizer",
  run: "optimizer-run"
} as const;

export const DATA_KEYS = {
  overview: "overview",
  projects: "projects",
  projectWorkspaces: "project-workspaces",
  projectOptimizers: "project-optimizers",
  optimizerRuns: "optimizer-runs",
  optimizerTemplates: "optimizer-templates"
} as const;

export const ACTION_KEYS = {
  saveOptimizer: "save-optimizer",
  deleteOptimizer: "delete-optimizer",
  runOptimizerCycle: "run-optimizer-cycle",
  enqueueOptimizerRun: "enqueue-optimizer-run",
  approveOptimizerRun: "approve-optimizer-run",
  rejectOptimizerRun: "reject-optimizer-run",
  createIssueFromRun: "create-issue-from-run"
} as const;

export const TOOL_KEYS = {
  listOptimizers: "list-optimizers",
  createIssueFromAcceptedRun: "create-issue-from-accepted-run"
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
  minimumImprovement: 0,
  stagnationIssueThreshold: 5
} as const;
