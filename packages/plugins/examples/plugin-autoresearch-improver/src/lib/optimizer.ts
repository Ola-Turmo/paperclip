import type { CommandExecutionResult, OptimizerDefinition, ScoreDirection } from "../types.js";

const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/;

export function clampPositiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
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

export function compareScores(
  direction: ScoreDirection,
  currentBest: number | null | undefined,
  candidate: number | null | undefined
): { improved: boolean; reason: string } {
  if (candidate == null || !Number.isFinite(candidate)) {
    return { improved: false, reason: "Candidate score was missing or invalid." };
  }
  if (currentBest == null || !Number.isFinite(currentBest)) {
    return { improved: true, reason: "No incumbent score existed, so this run becomes the baseline." };
  }
  if (direction === "maximize") {
    return candidate > currentBest
      ? { improved: true, reason: `Candidate score ${candidate} beat incumbent ${currentBest}.` }
      : { improved: false, reason: `Candidate score ${candidate} did not beat incumbent ${currentBest}.` };
  }
  return candidate < currentBest
    ? { improved: true, reason: `Candidate score ${candidate} beat incumbent ${currentBest}.` }
    : { improved: false, reason: `Candidate score ${candidate} did not beat incumbent ${currentBest}.` };
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
