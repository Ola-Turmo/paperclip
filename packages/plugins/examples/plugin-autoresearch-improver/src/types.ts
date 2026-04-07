export type ScoreDirection = "maximize" | "minimize";
export type OptimizerStatus = "active" | "paused";
export type RunQueueState = "idle" | "queued" | "running" | "awaiting_approval";
export type ApplyMode = "automatic" | "manual_approval" | "dry_run";
export type ScoreFormat = "number" | "json";
export type ScoreAggregator = "median" | "mean" | "max" | "min";
export type RunOutcome = "accepted" | "pending_approval" | "dry_run_candidate" | "rejected" | "invalid";
export type SandboxStrategy = "copy" | "git_worktree";
export type ScorerIsolationMode = "same_workspace" | "separate_workspace";

export type GuardrailAggregator = "all" | "any";

/**
 * Policy for deciding whether a score improvement is real or noise.
 *
 * - "threshold": accept if delta > minimumImprovement (existing behavior)
 * - "confidence": accept if delta > confidenceThreshold * stdDev(scores)
 *   (requires scoreRepeats >= 2 to compute variance; useful for noisy scorers)
 * - "epsilon": accept if delta > max(epsilonValue, noiseFloor)
 *   (absolute minimum improvement regardless of variance)
 */
export type ScoreImprovementPolicy = "threshold" | "confidence" | "epsilon";

export interface StructuredMetricResult {
  primary: number | null;
  metrics: Record<string, number | string | boolean | null>;
  guardrails: Record<string, boolean | number | string | null>;
  summary?: string;
  raw?: unknown;
  /** Set by the scorer when the run should be treated as invalid regardless of score. */
  invalid?: boolean;
  /** Human-readable reason for invalidation, set by the scorer. */
  invalidReason?: string;
}

export interface RunDiffArtifact {
  changedFiles: string[];
  unauthorizedChangedFiles: string[];
  /** Files that differ in binary content (null bytes detected). Excluded from patch. */
  binaryFiles: string[];
  patch: string;
  stats: {
    files: number;
    additions: number;
    deletions: number;
  };
}

export interface PullRequestArtifact {
  branchName?: string;
  baseBranch?: string;
  remoteName?: string;
  commitSha?: string;
  pullRequestUrl?: string;
  /** PR number extracted from the command output, e.g. from `gh pr create` output like "!123" or "#123". */
  pullRequestNumber?: number | null;
  /** Whether the branch was pushed to a remote. `undefined` means no push was attempted. */
  pushed?: boolean;
  /** Remote that the branch was pushed to. */
  pushRemote?: string;
  /** Exit code from the optional push step. */
  pushExitCode?: number | null;
  command?: string;
  commandResult?: CommandExecutionResult;
  createdAt?: string;
}

/**
 * Structured information about a patch-apply conflict.
 * Populated when `git apply` fails with a non-zero exit code.
 */
export interface PatchConflictInfo {
  /** Whether conflict markers were detected in the patch output. */
  hasConflicts: boolean;
  /** Paths that had conflicts, extracted from conflict markers. */
  conflictingFiles: string[];
  /** Raw git apply stderr output. */
  stderr: string;
  /** Exit code from git apply. */
  exitCode: number;
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
  guardrailRepeats: number;
  guardrailAggregator: GuardrailAggregator;
  minimumImprovement: number;
  /** Policy for determining whether a score improvement is real or noise. */
  scoreImprovementPolicy?: ScoreImprovementPolicy;
  /** For policy="confidence": multiplier on standard deviation. Default: 2.0 */
  confidenceThreshold?: number;
  /** For policy="epsilon": minimum absolute improvement. Default: 0.01 */
  epsilonValue?: number;
  /** Computed noise floor from scorer variance; set internally after first scoring run. */
  noiseFloor?: number | null;
  mutationBudgetSeconds: number;
  scoreBudgetSeconds: number;
  guardrailBudgetSeconds?: number;
  hiddenScoring: boolean;
  autoRun: boolean;
  sandboxStrategy: SandboxStrategy;
  scorerIsolationMode: ScorerIsolationMode;
  applyMode: ApplyMode;
  status: OptimizerStatus;
  queueState: RunQueueState;
  requireHumanApproval: boolean;
  autoCreateIssueOnGuardrailFailure: boolean;
  autoCreateIssueOnStagnation: boolean;
  stagnationIssueThreshold: number;
  proposalBranchPrefix?: string;
  proposalCommitMessage?: string;
  /** Base branch for the proposal. Defaults to the current checked-out branch. */
  proposalBaseBranch?: string;
  /** Optional push command run after the commit but before the PR command. E.g. `git push origin $PAPERCLIP_PROPOSAL_BRANCH`. */
  proposalPushCommand?: string;
  proposalPrCommand?: string;
  notes?: string;
  /** Number of times this optimizer's config has been cloned (duplicated). */
  cloneCount?: number;
  /** Reason for pausing the optimizer. Shown in the UI when status is paused. */
  pauseReason?: string;
  /** Change history: records significant config changes. */
  history?: ConfigChangeRecord[];
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
  baselineRunId?: string | null;
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
  guardrailRepeats?: Array<{
    execution: CommandExecutionResult;
    result: StructuredMetricResult | null;
    passed: boolean;
  }>;
  guardrailAggregate?: StructuredMetricResult | null;
  guardrailResult?: StructuredMetricResult | null;
  mutablePaths: string[];
  sandboxStrategy: SandboxStrategy;
  sandboxPath?: string;
  scorerIsolationMode: ScorerIsolationMode;
  scorerSandboxPath?: string;
  gitRepoRoot?: string;
  gitWorkspaceRelativePath?: string;
  artifacts: RunDiffArtifact;
  /** Populated when `git apply` fails with a non-zero exit code during automatic
   *  or promoted apply. Contains structured conflict details. */
  patchConflict?: PatchConflictInfo | null;
  pullRequest?: PullRequestArtifact | null;
  /** Git commit SHA of the workspace HEAD at the time the run was created.
   *  Used for stale-candidate and workspace-change detection before approval or PR creation. */
  workspaceHeadAtRun?: string | null;
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
    rejectedRuns: number;
    invalidRuns: number;
    pendingApprovalRuns: number;
    totalRuns: number;
  };
  metrics: {
    /** Average score improvement (delta) across all runs with valid deltas. */
    avgScoreDelta: number | null;
    /** Average candidate score across all runs. */
    avgCandidateScore: number | null;
    /** Rejection rate: rejected / (accepted + rejected + invalid). */
    rejectionRate: number | null;
  };
  latestAcceptedRun: OptimizerRunRecord | null;
}

export interface ConfigChangeRecord {
  /** ISO timestamp of the change. */
  timestamp: string;
  /** What kind of change occurred. */
  action: "created" | "cloned" | "config_updated" | "run_accepted" | "run_rejected" | "paused" | "resumed";
  /** Human-readable description of the change. */
  description: string;
  /** Run ID associated with this change (for run-related actions). */
  runId?: string;
  /** Who or what triggered the change. Defaults to "system". */
  triggeredBy?: string;
}

export interface OptimizerTemplate {
  key: string;
  name: string;
  description: string;
  values: Partial<OptimizerDefinition>;
}
