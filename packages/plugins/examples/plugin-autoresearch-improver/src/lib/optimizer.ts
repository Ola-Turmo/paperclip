import type {
  CommandExecutionResult,
  OptimizerDefinition,
  RunDiffArtifact,
  ScoreAggregator,
  ScoreDirection,
  StructuredMetricResult
} from "../types.js";

const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/;

export function clampPositiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
}

export function clampNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function normalizeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  if (normalized === "") return "";
  if (normalized === ".") return ".";
  const withoutPrefix = normalized.replace(/^\.\/+/, "");
  if (withoutPrefix.startsWith("../") || withoutPrefix.includes("/../") || withoutPrefix === "..") {
    throw new Error(`Mutable path escapes the workspace: ${value}`);
  }
  return withoutPrefix.replace(/\/+$/, "") || ".";
}

export function normalizeMutablePaths(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value.map((entry) => String(entry ?? ""))
    : String(value ?? "")
      .split(/\r?\n|,/)
      .map((entry) => entry.trim());

  const unique = new Set<string>();
  for (const entry of rawValues) {
    if (!entry) continue;
    unique.add(normalizeRelativePath(entry));
  }
  return unique.size > 0 ? [...unique] : ["."];
}

export function normalizeDotPath(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

export function extractScore(output: string, pattern?: string): number | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  if (pattern) {
    const regex = new RegExp(pattern, "m");
    const match = trimmed.match(regex);
    if (!match) return null;
    const candidate = match[1] ?? match[0];
    const value = Number(candidate);
    return Number.isFinite(value) ? value : null;
  }
  const match = trimmed.match(NUMBER_PATTERN);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function getByDotPath(value: unknown, dotPath?: string): unknown {
  if (!dotPath) return value;
  return dotPath.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);
}

function asMetricMap(value: unknown): Record<string, number | string | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number | string | boolean | null> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof entry === "number" ||
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      entry === null
    ) {
      out[key] = entry;
    }
  }
  return out;
}

export function extractStructuredMetricResult(
  stdout: string,
  scoreKey?: string
): StructuredMetricResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const candidate = getByDotPath(parsed, scoreKey);
    const primary = typeof candidate === "number"
      ? candidate
      : typeof candidate === "string" && Number.isFinite(Number(candidate))
        ? Number(candidate)
        : null;
    const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    const invalid = root.invalid === true;
    const invalidReason = typeof root.invalidReason === "string" ? root.invalidReason
      : invalid ? "Scorer marked this run as invalid."
      : undefined;
    return {
      primary,
      metrics: asMetricMap(root.metrics ?? root),
      guardrails: asMetricMap(root.guardrails),
      summary: typeof root.summary === "string" ? root.summary : undefined,
      raw: parsed,
      invalid,
      invalidReason
    };
  } catch {
    return null;
  }
}

export function aggregateScores(scores: Array<number | null>, aggregator: ScoreAggregator): number | null {
  const filtered = scores.filter((value): value is number => value != null && Number.isFinite(value));
  if (filtered.length === 0) return null;
  const sorted = [...filtered].sort((a, b) => a - b);
  switch (aggregator) {
    case "min":
      return sorted[0] ?? null;
    case "max":
      return sorted[sorted.length - 1] ?? null;
    case "mean":
      return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
    case "median":
    default: {
      const middle = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 1) return sorted[middle] ?? null;
      return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
    }
  }
}

export function aggregateStructuredMetrics(
  results: StructuredMetricResult[],
  aggregator: ScoreAggregator
): StructuredMetricResult | null {
  if (results.length === 0) return null;
  const primary = aggregateScores(results.map((entry) => entry.primary), aggregator);
  const metricKeys = new Set<string>();
  const guardrailKeys = new Set<string>();

  for (const result of results) {
    Object.keys(result.metrics).forEach((key) => metricKeys.add(key));
    Object.keys(result.guardrails).forEach((key) => guardrailKeys.add(key));
  }

  const metrics: Record<string, number | string | boolean | null> = {};
  for (const key of metricKeys) {
    const values = results.map((entry) => entry.metrics[key]);
    if (values.every((value) => typeof value === "number")) {
      metrics[key] = aggregateScores(values as number[], aggregator);
    } else {
      metrics[key] = values[values.length - 1] ?? null;
    }
  }

  const guardrails: Record<string, boolean | number | string | null> = {};
  for (const key of guardrailKeys) {
    const values = results.map((entry) => entry.guardrails[key]);
    if (values.every((value) => typeof value === "boolean")) {
      guardrails[key] = values.every(Boolean);
    } else if (values.every((value) => typeof value === "number")) {
      guardrails[key] = aggregateScores(values as number[], aggregator);
    } else {
      guardrails[key] = values[values.length - 1] ?? null;
    }
  }

  const anyInvalid = results.some((entry) => entry.invalid === true);
  const firstInvalidReason = results.find((entry) => entry.invalid === true)?.invalidReason;
  const allInvalidReasons = results
    .map((entry) => entry.invalidReason)
    .filter(Boolean) as string[];

  return {
    primary,
    metrics,
    guardrails,
    summary: results.map((entry) => entry.summary).filter(Boolean).join(" | ") || undefined,
    raw: results.map((entry) => entry.raw ?? null),
    invalid: anyInvalid,
    invalidReason: anyInvalid ? (firstInvalidReason ?? `One or more scoring repeats marked invalid.`) : undefined
  };
}

/**
 * Aggregate guardrail results across repeated runs.
 * Boolean guardrails: "all" requires all true, "any" requires at least one true.
 * The aggregate is marked invalid if any repeat was invalid.
 */
export function aggregateGuardrailResults(
  results: StructuredMetricResult[],
  aggregator: "all" | "any"
): StructuredMetricResult {
  const guardrailKeys = new Set<string>();
  for (const result of results) {
    Object.keys(result.guardrails).forEach((key) => guardrailKeys.add(key));
  }

  const guardrails: Record<string, boolean | number | string | null> = {};
  for (const key of guardrailKeys) {
    const values = results.map((entry) => entry.guardrails[key]);
    if (values.every((value) => typeof value === "boolean")) {
      const bools = values as boolean[];
      guardrails[key] = aggregator === "all" ? bools.every(Boolean) : bools.some(Boolean);
    } else if (values.every((value) => typeof value === "number")) {
      // For numeric guardrail values, use mean as a sensible default
      guardrails[key] = aggregateScores(values as number[], "mean");
    } else {
      guardrails[key] = values[values.length - 1] ?? null;
    }
  }

  const anyInvalid = results.some((entry) => entry.invalid === true);
  const invalidReasons = results
    .map((entry) => entry.invalidReason)
    .filter(Boolean) as string[];

  return {
    primary: null,
    metrics: {},
    guardrails,
    summary: invalidReasons.length > 0
      ? `Invalid reasons: ${invalidReasons.join(" | ")}`
      : results.map((entry) => entry.summary).filter(Boolean).join(" | ") || undefined,
    invalid: anyInvalid,
    invalidReason: anyInvalid
      ? `One or more guardrail repeats marked invalid: ${invalidReasons.join(" | ")}`
      : undefined
  };
}

export function compareScores(
  direction: ScoreDirection,
  currentBest: number | null | undefined,
  candidate: number | null | undefined,
  minimumImprovement = 0
): { improved: boolean; reason: string; delta: number | null } {
  if (candidate == null || !Number.isFinite(candidate)) {
    return { improved: false, reason: "Candidate score was missing or invalid.", delta: null };
  }
  if (currentBest == null || !Number.isFinite(currentBest)) {
    return { improved: true, reason: "No incumbent score existed, so this run becomes the baseline.", delta: null };
  }
  const delta = direction === "maximize" ? candidate - currentBest : currentBest - candidate;
  if (delta > minimumImprovement) {
    return {
      improved: true,
      reason: `Candidate score ${candidate} beat incumbent ${currentBest} by ${delta}.`,
      delta
    };
  }
  return {
    improved: false,
    reason: `Candidate score ${candidate} did not clear the minimum improvement threshold against incumbent ${currentBest}.`,
    delta
  };
}

export function summarizeOutput(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

export function buildOptimizerBrief(optimizer: OptimizerDefinition): Record<string, unknown> {
  return {
    optimizerId: optimizer.optimizerId,
    name: optimizer.name,
    objective: optimizer.objective,
    mutablePaths: optimizer.mutablePaths,
    scoreDirection: optimizer.scoreDirection,
    bestScore: optimizer.bestScore ?? null,
    hiddenScoring: optimizer.hiddenScoring,
    sandboxStrategy: optimizer.sandboxStrategy,
    scorerIsolationMode: optimizer.scorerIsolationMode,
    applyMode: optimizer.applyMode,
    scoreFormat: optimizer.scoreFormat,
    scoreKey: optimizer.scoreKey ?? null,
    scoreRepeats: optimizer.scoreRepeats,
    scoreAggregator: optimizer.scoreAggregator,
    minimumImprovement: optimizer.minimumImprovement,
    proposalBranchPrefix: optimizer.proposalBranchPrefix ?? null,
    proposalCommitMessage: optimizer.proposalCommitMessage ?? null,
    notes: optimizer.notes ?? "",
    budgets: {
      mutationBudgetSeconds: optimizer.mutationBudgetSeconds,
      scoreBudgetSeconds: optimizer.scoreBudgetSeconds,
      guardrailBudgetSeconds: optimizer.guardrailBudgetSeconds ?? null
    }
  };
}

export function formatCommandSummary(result: CommandExecutionResult): string {
  const status = result.ok ? "ok" : "failed";
  return `${status} (${result.exitCode ?? "null"}) in ${result.durationMs}ms`;
}

export function emptyDiffArtifact(): RunDiffArtifact {
  return {
    changedFiles: [],
    unauthorizedChangedFiles: [],
    binaryFiles: [],
    patch: "",
    stats: { files: 0, additions: 0, deletions: 0 }
  };
}
