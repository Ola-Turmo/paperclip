export type ScoreDirection = "maximize" | "minimize";
export type OptimizerStatus = "active" | "paused";

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
  mutationBudgetSeconds: number;
  scoreBudgetSeconds: number;
  guardrailBudgetSeconds?: number;
  hiddenScoring: boolean;
  autoRun: boolean;
  status: OptimizerStatus;
  notes?: string;
  bestScore?: number;
  bestRunId?: string;
  lastRunId?: string;
  runs: number;
  acceptedRuns: number;
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
  baselineScore: number | null;
  candidateScore: number | null;
  accepted: boolean;
  reason: string;
  mutation: CommandExecutionResult;
  scoring: CommandExecutionResult;
  guardrail?: CommandExecutionResult;
  mutablePaths: string[];
}

export interface PluginConfigValues {
  defaultMutationBudgetSeconds: number;
  defaultScoreBudgetSeconds: number;
  defaultGuardrailBudgetSeconds: number;
  keepTmpDirs: boolean;
  maxOutputChars: number;
  sweepLimit: number;
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
  };
  latestAcceptedRun: OptimizerRunRecord | null;
}
