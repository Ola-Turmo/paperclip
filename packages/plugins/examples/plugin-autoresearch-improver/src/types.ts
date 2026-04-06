export type ScoreDirection = "maximize" | "minimize";
export type OptimizerStatus = "active" | "paused";
export type RunQueueState = "idle" | "queued" | "running" | "awaiting_approval";
export type ApplyMode = "automatic" | "manual_approval" | "dry_run";
export type ScoreFormat = "number" | "json";
export type ScoreAggregator = "median" | "mean" | "max" | "min";
export type RunOutcome = "accepted" | "pending_approval" | "dry_run_candidate" | "rejected" | "invalid";

export interface StructuredMetricResult {
  primary: number | null;
  metrics: Record<string, number | string | boolean | null>;
  guardrails: Record<string, boolean | number | string | null>;
  summary?: string;
  raw?: unknown;
}

export interface RunDiffArtifact {
  changedFiles: string[];
  unauthorizedChangedFiles: string[];
  patch: string;
  stats: {
    files: number;
    additions: number;
    deletions: number;
  };
}

export interface OptimizerDefinition {
  optimizerId: string;
  companyId: string;
  projectId: string;
  workspaceId?: string;
  name: string;
  objective: string;
  mutablePaths: string[];
  mutationCommand: string;
  scoreCommand: string;
  guardrailCommand?: string;
  scoreDirection: ScoreDirection;
  scorePattern?: string;
  scoreFormat: ScoreFormat;
  scoreKey?: string;
  guardrailFormat: ScoreFormat;
  guardrailKey?: string;
  scoreRepeats: number;
  scoreAggregator: ScoreAggregator;
  minimumImprovement: number;
  mutationBudgetSeconds: number;
  scoreBudgetSeconds: number;
  guardrailBudgetSeconds?: number;
  hiddenScoring: boolean;
  autoRun: boolean;
  applyMode: ApplyMode;
  status: OptimizerStatus;
  queueState: RunQueueState;
  requireHumanApproval: boolean;
  autoCreateIssueOnGuardrailFailure: boolean;
  autoCreateIssueOnStagnation: boolean;
  stagnationIssueThreshold: number;
  notes?: string;
  bestScore?: number;
  bestRunId?: string;
  lastRunId?: string;
  runs: number;
  acceptedRuns: number;
  rejectedRuns: number;
  pendingApprovalRuns: number;
  consecutiveFailures: number;
  consecutiveNonImprovements: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommandExecutionResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  ok: boolean;
}

export interface OptimizerRunRecord {
  runId: string;
  optimizerId: string;
  companyId: string;
  projectId: string;
  workspaceId?: string;
  startedAt: string;
  finishedAt: string;
  outcome: RunOutcome;
  baselineScore: number | null;
  candidateScore: number | null;
  accepted: boolean;
  applied: boolean;
  approvalStatus: "not_needed" | "pending" | "approved" | "rejected";
  reason: string;
  mutation: CommandExecutionResult;
  scoring: CommandExecutionResult;
  scoringRepeats: Array<{
    execution: CommandExecutionResult;
    score: number | null;
    structured: StructuredMetricResult | null;
  }>;
  scoringAggregate: StructuredMetricResult | null;
  guardrail?: CommandExecutionResult;
  guardrailResult?: StructuredMetricResult | null;
  mutablePaths: string[];
  sandboxStrategy: "copy" | "git_worktree";
  sandboxPath?: string;
  artifacts: RunDiffArtifact;
}

export interface PluginConfigValues {
  defaultMutationBudgetSeconds: number;
  defaultScoreBudgetSeconds: number;
  defaultGuardrailBudgetSeconds: number;
  keepTmpDirs: boolean;
  maxOutputChars: number;
  sweepLimit: number;
  scoreRepeats: number;
  minimumImprovement: number;
  stagnationIssueThreshold: number;
}

export interface OverviewData {
  pluginId: string;
  version: string;
  companyId: string | null;
  config: PluginConfigValues;
  counts: {
    optimizers: number;
    activeOptimizers: number;
    acceptedRuns: number;
    pendingApprovalRuns: number;
  };
  latestAcceptedRun: OptimizerRunRecord | null;
}

export interface OptimizerTemplate {
  key: string;
  name: string;
  description: string;
  values: Partial<OptimizerDefinition>;
}
