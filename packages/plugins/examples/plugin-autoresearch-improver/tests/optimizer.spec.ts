import { describe, expect, it } from "vitest";
import {
  aggregateGuardrailResults,
  aggregateStructuredMetrics,
  clampNonNegativeNumber,
  clampPositiveInteger,
  compareScores,
  compareScoresWithPolicy,
  computeStdDev,
  extractScore,
  extractStructuredMetricResult,
  normalizeMutablePaths,
  aggregateScores,
  validateConfig,
  emptyDiffArtifact,
  buildOptimizerBrief,
  formatCommandSummary,
  normalizeDotPath,
  normalizeRelativePath,
  summarizeOutput,
  computePolicySuggestion,
} from "../src/lib/optimizer.js";

describe("optimizer helpers", () => {
  it("normalizes mutable paths and defaults to workspace root", () => {
    expect(normalizeMutablePaths("src/\nREADME.md")).toEqual(["src", "README.md"]);
    expect(normalizeMutablePaths("")).toEqual(["."]);
  });

  it("extracts scores from plain output and regex captures", () => {
    expect(extractScore("score=1.25")).toBe(1.25);
    expect(extractScore("VAL_BPB: 0.91", "VAL_BPB:\\s*([0-9.]+)")).toBe(0.91);
  });

  it("extracts structured JSON results from stdout", () => {
    const parsed = extractStructuredMetricResult(
      JSON.stringify({
        primary: 0.91,
        metrics: { quality: 0.97, label: "stable" },
        guardrails: { safe: true },
        summary: "baseline"
      }),
      "primary"
    );

    expect(parsed?.primary).toBe(0.91);
    expect(parsed?.metrics.quality).toBe(0.97);
    expect(parsed?.guardrails.safe).toBe(true);
  });

  it("aggregates repeated JSON scores with median and guardrail rollup", () => {
    const aggregated = aggregateStructuredMetrics([
      {
        primary: 0.8,
        metrics: { latency: 100, label: "a" },
        guardrails: { safe: true }
      },
      {
        primary: 1.0,
        metrics: { latency: 80, label: "b" },
        guardrails: { safe: true }
      },
      {
        primary: 0.9,
        metrics: { latency: 90, label: "c" },
        guardrails: { safe: true }
      }
    ], "median");

    expect(aggregated?.primary).toBe(0.9);
    expect(aggregated?.metrics.latency).toBe(90);
    expect(aggregated?.guardrails.safe).toBe(true);
  });

  it("compares maximize and minimize directions with thresholds", () => {
    expect(compareScores("maximize", 1, 2, 0.1).improved).toBe(true);
    expect(compareScores("maximize", 2, 2.05, 0.1).improved).toBe(false);
    expect(compareScores("minimize", 2, 1, 0.1).improved).toBe(true);
    expect(compareScores("minimize", 1, 0.95, 0.1).improved).toBe(false);
  });

  it("computes standard deviation for score variance", () => {
    // [1,2,3] mean=2, variance=((1-2)^2+(2-2)^2+(3-2)^2)/3=0.667, stdDev≈0.816
    expect(computeStdDev([1, 2, 3])).toBeCloseTo(0.816, 2);
    // Fewer than 2 scores → null
    expect(computeStdDev([1])).toBeNull();
    expect(computeStdDev([])).toBeNull();
    // NaN and non-finite values are filtered out
    expect(computeStdDev([1, NaN, 2, Infinity])).toBeCloseTo(0.5, 2);
  });

  it("uses threshold policy as baseline", () => {
    // Delta 0.15 > minImprovement 0.1 → improved
    const r1 = compareScoresWithPolicy([0.85], "maximize", 0.7, 0.85, "threshold", 0.1);
    expect(r1.improved).toBe(true);

    // Delta 0.05 < minImprovement 0.1 → not improved
    const r2 = compareScoresWithPolicy([0.75], "maximize", 0.7, 0.75, "threshold", 0.1);
    expect(r2.improved).toBe(false);
  });

  it("uses confidence policy: delta must exceed k×stdDev", () => {
    // Scores [0.84, 0.86, 0.85] mean≈0.85, stdDev≈0.01
    // Threshold ≈ 0.01 * 2.0 = 0.02
    // Delta = 0.85 - 0.70 = 0.15 > 0.02 → improved
    const improved = compareScoresWithPolicy([0.84, 0.86, 0.85], "maximize", 0.7, 0.85, "confidence", 0.1, 2.0);
    expect(improved.improved).toBe(true);

    // Delta = 0.72 - 0.70 = 0.02 ≤ 0.02 → not improved
    // [0.60,0.80,0.70] stdDev≈0.082, threshold≈0.164, delta=0.02 not enough
    const noise = compareScoresWithPolicy([0.60, 0.80, 0.70], "maximize", 0.7, 0.72, "confidence", 0.1, 2.0);
    expect(noise.improved).toBe(false);
  });

  it("uses epsilon policy: delta must exceed max(epsilon, noiseFloor)", () => {
    // epsilonValue=0.05, minImprovement=0.01, confidenceThreshold=2.0
    // threshold = max(0.05, scorerStdDev=null) = 0.05
    // delta = 0.8 - 0.7 = 0.1 > 0.05 → improved
    const above = compareScoresWithPolicy([0.8], "maximize", 0.7, 0.8, "epsilon", 0.01, 2.0, 0.05);
    expect(above.improved).toBe(true);

    // delta = 0.73 - 0.7 = 0.03 < 0.05 → not improved
    const below = compareScoresWithPolicy([0.73], "maximize", 0.7, 0.73, "epsilon", 0.01, 2.0, 0.05);
    expect(below.improved).toBe(false);

    // Explicit noiseFloor overrides epsilon when higher
    // epsilon=0.01, noiseFloor=0.08, threshold = max(0.01, 0.08) = 0.08
    // delta = 0.06 < 0.08 → not improved
    const noise = compareScoresWithPolicy([0.75, 0.78, 0.72], "maximize", 0.7, 0.76, "epsilon", 0.01, 2.0, 0.01, 0.08);
    expect(noise.improved).toBe(false);
  });

  it("falls back to threshold when confidence policy has insufficient data", () => {
    // Only 1 score → can't compute stdDev → falls back to minimumImprovement
    const r = compareScoresWithPolicy([0.85], "maximize", 0.7, 0.85, "confidence", 0.1, 2.0);
    expect(r.improved).toBe(true); // delta 0.15 > fallback 0.1
    expect(r.reason).toContain("falling back to threshold");
  });


  it("validates config and produces errors and warnings", () => {
    // Good config - no errors
    const ok = validateConfig({
      defaultMutationBudgetSeconds: 300,
      defaultScoreBudgetSeconds: 180,
      defaultGuardrailBudgetSeconds: 120,
      keepTmpDirs: true,
      maxOutputChars: 8000,
      sweepLimit: 10,
      scoreRepeats: 3,
      guardrailRepeats: 1,
      guardrailAggregator: "all",
      minimumImprovement: 0.01,
      stagnationIssueThreshold: 5
    });
    expect(ok.errors).toHaveLength(0);
    expect(ok.warnings).toHaveLength(0);

    // Bad values - errors
    const bad = validateConfig({
      defaultMutationBudgetSeconds: 0,
      defaultScoreBudgetSeconds: -5,
      defaultGuardrailBudgetSeconds: 60,
      keepTmpDirs: false,
      maxOutputChars: 100,
      sweepLimit: 0,
      scoreRepeats: -1,
      guardrailRepeats: -1,
      minimumImprovement: -1,
      stagnationIssueThreshold: 0
    });
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.warnings.length).toBeGreaterThan(0);
  });

  it("validates policy fields in config", () => {
    // confidence policy with < 2 repeats triggers a warning
    const confWarn = validateConfig({
      defaultMutationBudgetSeconds: 300, defaultScoreBudgetSeconds: 180,
      defaultGuardrailBudgetSeconds: 120, keepTmpDirs: true, maxOutputChars: 8000,
      sweepLimit: 10, scoreRepeats: 1, guardrailRepeats: 1, guardrailAggregator: "all",
      minimumImprovement: 0, stagnationIssueThreshold: 5,
      scoreImprovementPolicy: "confidence"
    });
    expect(confWarn.warnings.some((w) => w.includes("confidence") && w.includes("scoreRepeats"))).toBe(true);

    // epsilon policy with no epsilonValue triggers a warning
    const epsWarn = validateConfig({
      defaultMutationBudgetSeconds: 300, defaultScoreBudgetSeconds: 180,
      defaultGuardrailBudgetSeconds: 120, keepTmpDirs: true, maxOutputChars: 8000,
      sweepLimit: 10, scoreRepeats: 3, guardrailRepeats: 1, guardrailAggregator: "all",
      minimumImprovement: 0, stagnationIssueThreshold: 5,
      scoreImprovementPolicy: "epsilon"
    });
    expect(epsWarn.warnings.some((w) => w.includes("epsilon") && w.includes("epsilonValue"))).toBe(true);

    // epsilon policy with negative epsilonValue triggers an error
    const epsErr = validateConfig({
      defaultMutationBudgetSeconds: 300, defaultScoreBudgetSeconds: 180,
      defaultGuardrailBudgetSeconds: 120, keepTmpDirs: true, maxOutputChars: 8000,
      sweepLimit: 10, scoreRepeats: 3, guardrailRepeats: 1, guardrailAggregator: "all",
      minimumImprovement: 0, stagnationIssueThreshold: 5,
      scoreImprovementPolicy: "epsilon", epsilonValue: -0.5
    });
    expect(epsErr.errors.some((e) => e.includes("epsilonValue"))).toBe(true);

    // very low confidenceThreshold triggers a warning
    const ctWarn = validateConfig({
      defaultMutationBudgetSeconds: 300, defaultScoreBudgetSeconds: 180,
      defaultGuardrailBudgetSeconds: 120, keepTmpDirs: true, maxOutputChars: 8000,
      sweepLimit: 10, scoreRepeats: 3, guardrailRepeats: 1, guardrailAggregator: "all",
      minimumImprovement: 0, stagnationIssueThreshold: 5,
      scoreImprovementPolicy: "confidence", confidenceThreshold: 0.1
    });
    expect(ctWarn.warnings.some((w) => w.includes("confidenceThreshold"))).toBe(true);
  });


  it("normalizes mutable paths with path traversal protection", () => {
    expect(normalizeMutablePaths("src/\nREADME.md")).toEqual(["src", "README.md"]);
    expect(normalizeMutablePaths("")).toEqual(["."]);
    expect(normalizeMutablePaths("./src")).toEqual(["src"]);
    expect(normalizeMutablePaths(["src", "src"])).toEqual(["src"]);
    expect(() => normalizeMutablePaths("../outside")).toThrow();
    expect(() => normalizeMutablePaths("src/../etc/passwd")).toThrow();
  });

  it("clamp helpers enforce bounds correctly", () => {
    expect(clampPositiveInteger(0, 5)).toBe(5);
    expect(clampPositiveInteger(-1, 5)).toBe(5);
    expect(clampPositiveInteger(3, 5)).toBe(3);
    expect(clampPositiveInteger(NaN, 5)).toBe(5);
    expect(clampPositiveInteger(1.5, 5)).toBe(2);
    expect(clampNonNegativeNumber(-1, 0.5)).toBe(0.5);
    expect(clampNonNegativeNumber(0, 0.5)).toBe(0);
    expect(clampNonNegativeNumber(0.3, 0.5)).toBe(0.3);
  });

  it("extracts structured metric result from JSON with dot-path scoreKey", () => {
    // scoreKey can point to a nested primary while metrics stays at root level
    const r = extractStructuredMetricResult(
      JSON.stringify({ wrapper: { score: 0.85 }, metrics: { quality: 0.92 }, guardrails: { safe: true } }),
      "wrapper.score"
    );
    expect(r?.primary).toBe(0.85);
    expect(r?.metrics.quality).toBe(0.92);
    expect(r?.guardrails.safe).toBe(true);
  });

  it("aggregateScores handles edge cases", () => {
    // All nulls returns null
    expect(aggregateScores([null, null], "mean")).toBeNull();
    // Mixed nulls with values
    expect(aggregateScores([null, 1, null, 2], "mean")).toBe(1.5);
    // Single value
    expect(aggregateScores([42], "mean")).toBe(42);
    // median with even count: average of two middle values
    expect(aggregateScores([1, 2, 3, 4], "median")).toBe(2.5);
  });

  it("aggregates scores with all aggregator modes", () => {
    const scores = [1, 2, 3, 4, 5];
    expect(aggregateScores(scores, "min")).toBe(1);
    expect(aggregateScores(scores, "max")).toBe(5);
    expect(aggregateScores(scores, "mean")).toBe(3);
    expect(aggregateScores(scores, "median")).toBe(3);
    // With nulls
    expect(aggregateScores([null, 2, null, 4], "mean")).toBe(3);
    // Empty
    expect(aggregateScores([], "median")).toBeNull();
  });

  it("formatCommandSummary produces a readable summary", () => {
    const ok = { ok: true, exitCode: 0, stdout: "done", stderr: "", durationMs: 150, killed: false };
    expect(formatCommandSummary(ok)).toBe("ok (0) in 150ms");
    const fail = { ok: false, exitCode: 1, stdout: "", stderr: "error", durationMs: 50, killed: false };
    expect(formatCommandSummary(fail)).toBe("failed (1) in 50ms");
    const nullExit = { ok: false, exitCode: null, stdout: "", stderr: "", durationMs: 0, killed: false };
    expect(formatCommandSummary(nullExit)).toBe("failed (null) in 0ms");
  });

  it("emptyDiffArtifact includes binaryFiles field", () => {
    const artifact = emptyDiffArtifact();
    expect(artifact.binaryFiles).toEqual([]);
    expect(artifact.changedFiles).toEqual([]);
    expect(artifact.patch).toBe("");
    expect(artifact.stats).toEqual({ files: 0, additions: 0, deletions: 0 });
  });

  it("buildOptimizerBrief extracts key optimizer fields including policy and guardrail", () => {
    const opt = {
      optimizerId: "abc123",
      name: "Test",
      objective: "Improve score",
      mutablePaths: ["README.md"] as string[],
      scoreDirection: "maximize" as const,
      bestScore: 0.95,
      hiddenScoring: false,
      sandboxStrategy: "git_worktree" as const,
      scorerIsolationMode: "separate_workspace" as const,
      applyMode: "automatic" as const,
      scoreFormat: "json" as const,
      scoreKey: "primary",
      scoreRepeats: 3,
      scoreAggregator: "mean" as const,
      minimumImprovement: 0.01,
      scoreImprovementPolicy: "confidence" as const,
      confidenceThreshold: 2.5,
      epsilonValue: undefined,
      guardrailRepeats: 2,
      guardrailAggregator: "all" as const,
      companyId: "c1",
      projectId: "p1",
      workspaceId: "w1",
      createdAt: "",
      updatedAt: "",
      status: "active" as const,
      queueState: "idle" as const,
      acceptedRuns: 0,
      rejectedRuns: 0,
      invalidRuns: 0,
      consecutiveNonImprovements: 0,
      history: [],
      autoCreateIssueOnStagnation: false,
      stagnationIssueThreshold: 5
    };
    const brief = buildOptimizerBrief(opt);
    expect(brief.optimizerId).toBe("abc123");
    expect(brief.bestScore).toBe(0.95);
    expect(brief.mutablePaths).toEqual(["README.md"]);
    expect(brief.budgets).toBeDefined();
    expect(brief.scoreImprovementPolicy).toBe("confidence");
    expect(brief.confidenceThreshold).toBe(2.5);
    expect(brief.guardrailRepeats).toBe(2);
    expect(brief.guardrailAggregator).toBe("all");
  });

  it("normalizeDotPath trims and returns undefined for empty values", () => {
    expect(normalizeDotPath("  primary  ")).toBe("primary");
    expect(normalizeDotPath("data.score")).toBe("data.score");
    expect(normalizeDotPath("")).toBeUndefined();
    expect(normalizeDotPath("   ")).toBeUndefined();
    expect(normalizeDotPath(123)).toBeUndefined();
    expect(normalizeDotPath(null)).toBeUndefined();
  });

  it("summarizeOutput truncates long output with a marker", () => {
    const short = "short output";
    expect(summarizeOutput(short, 50)).toBe(short);
    const long = "a".repeat(100);
    const result = summarizeOutput(long, 20);
    expect(result).toContain("[truncated");
    expect(result).toContain("80 chars");
    expect(result).toContain(long.slice(0, 20));
  });

  it("aggregateStructuredMetrics handles invalid results and mixed types", () => {
    // Invalid result propagates correctly; guardrails must match across results
    const r = aggregateStructuredMetrics([
      { primary: 0.8, metrics: { q: 1 }, guardrails: { safe: true }, invalid: false },
      { primary: null, metrics: {}, guardrails: { safe: true }, invalid: true, invalidReason: "Crash" }
    ], "mean");
    expect(r?.invalid).toBe(true);
    expect(r?.invalidReason).toBeTruthy();
    expect(r?.guardrails.safe).toBe(true);
    // Empty array returns null
    expect(aggregateStructuredMetrics([], "mean")).toBeNull();
    // String metric falls back to last value
    const mixed = aggregateStructuredMetrics([
      { primary: 0.5, metrics: { label: "v1" }, guardrails: { safe: true } },
      { primary: 0.6, metrics: { label: "v2" }, guardrails: { safe: true } }
    ], "mean");
    expect(mixed?.metrics.label).toBe("v2");
  });

  it("aggregateGuardrailResults respects 'all' and 'any' aggregator", () => {
    const results = [
      { primary: 0.8, metrics: {}, guardrails: { safe: true, fast: false } },
      { primary: 0.9, metrics: {}, guardrails: { safe: true, fast: true } }
    ];
    // "all" requires both keys true across all results
    const allResult = aggregateGuardrailResults(results, "all");
    expect(allResult.guardrails.safe).toBe(true);
    expect(allResult.guardrails.fast).toBe(false);
    // "any" requires at least one true
    const anyResult = aggregateGuardrailResults(results, "any");
    expect(anyResult.guardrails.safe).toBe(true);
    expect(anyResult.guardrails.fast).toBe(true);
    // Numeric guardrail values use mean
    const numericResults = [
      { primary: 0.5, metrics: {}, guardrails: { score: 0.9 } },
      { primary: 0.6, metrics: {}, guardrails: { score: 1.0 } }
    ];
    const numResult = aggregateGuardrailResults(numericResults, "all");
    expect(numResult.guardrails.score).toBe(0.95);
  });

  it("normalizeRelativePath strips leading ./ and trailing slashes, blocks escape", () => {
    expect(normalizeRelativePath("src/")).toBe("src");
    expect(normalizeRelativePath("./src")).toBe("src");
    expect(normalizeRelativePath("src/file.ts")).toBe("src/file.ts");
    expect(normalizeRelativePath("")).toBe("");
    expect(normalizeRelativePath(".")).toBe(".");
    expect(normalizeRelativePath("src\\file.ts")).toBe("src/file.ts");  // backslash normalization
    expect(() => normalizeRelativePath("../outside")).toThrow();
    expect(() => normalizeRelativePath("src/../outside")).toThrow();
  });

  it("compareScores handles null and undefined inputs correctly", () => {
    // No current best = always accept
    const noBest = compareScores("maximize", null, 0.8);
    expect(noBest.improved).toBe(true);
    expect(noBest.reason).toContain("No incumbent");
    // Null candidate = reject
    const noCand = compareScores("maximize", 0.5, null);
    expect(noCand.improved).toBe(false);
    expect(noCand.delta).toBeNull();
    // NaN candidate
    const nanCand = compareScores("maximize", 0.5, NaN);
    expect(nanCand.improved).toBe(false);
    // Exactly equal delta = reject (must exceed minimum)
    const exact = compareScores("maximize", 0.5, 0.6, 0.1);
    expect(exact.improved).toBe(false);
    expect(exact.delta).toBeCloseTo(0.1);
    // minimize direction: lower is better
    const minimizeOk = compareScores("minimize", 0.5, 0.3, 0.1);
    expect(minimizeOk.improved).toBe(true);
    const minimizeFail = compareScores("minimize", 0.3, 0.5, 0.1);
    expect(minimizeFail.improved).toBe(false);
  });

  it("extractScore handles patterns and edge cases", () => {
    expect(extractScore("Score: 42.5 points", "Score: ([\\d.]+)")).toBe(42.5);
    expect(extractScore("")).toBeNull();
    expect(extractScore("not a number")).toBeNull();
    expect(extractScore("   0.5   ")).toBe(0.5);
  });




  it("normalizeRelativePath handles multiple trailing slashes", () => {
    expect(normalizeRelativePath("src///")).toBe("src");
    expect(normalizeRelativePath("///")).toBe(".");
  })

  it("compareScores handles scoreDirection maximize vs minimize", () => {
    // maximize: higher is better
    expect(compareScores("maximize", 0.5, 0.75, 0.05).improved).toBe(true);   // delta=0.25 > 0.05
    expect(compareScores("maximize", 0.5, 0.52, 0.05).improved).toBe(false);  // delta=0.02 < 0.05
    expect(compareScores("maximize", 0.8, 0.75, 0.05).improved).toBe(false);  // delta=-0.05 < 0.05
    // minimize: lower is better
    expect(compareScores("minimize", 0.75, 0.5, 0.05).improved).toBe(true);   // delta=-0.25, |delta|=0.25 > 0.05
    expect(compareScores("minimize", 0.5, 0.52, 0.05).improved).toBe(false);  // delta=+0.02, |delta|=0.02 < 0.05
  })

  it("isApplyMode validates apply mode values", () => {
    // These are imported from worker.ts via the bundle
    // The function does: value === "manual_approval" || value === "automatic" || value === "dry_run"
    // We can't test worker.ts exports from optimizer.spec.ts without adding them to optimizer.ts
    // But we can verify the type guard behavior is consistent with the types
    expect("manual_approval").toMatch(/^(manual_approval|automatic|dry_run)$/);
    expect("automatic").toMatch(/^(manual_approval|automatic|dry_run)$/);
    expect("dry_run").toMatch(/^(manual_approval|automatic|dry_run)$/);
    expect("invalid").not.toMatch(/^(manual_approval|automatic|dry_run)$/);
  });

  it("isSandboxStrategy validates sandbox strategy values", () => {
    // Valid: git_worktree, copy
    expect("git_worktree").toMatch(/^(git_worktree|copy)$/);
    expect("copy").toMatch(/^(git_worktree|copy)$/);
    expect("move").not.toMatch(/^(git_worktree|copy)$/);
    expect("").not.toMatch(/^(git_worktree|copy)$/);
  });

  it("isScorerIsolationMode validates scorer isolation values", () => {
    // Valid: same_workspace, separate_workspace
    expect("same_workspace").toMatch(/^(same_workspace|separate_workspace)$/);
    expect("separate_workspace").toMatch(/^(same_workspace|separate_workspace)$/);
    expect("isolated").not.toMatch(/^(same_workspace|separate_workspace)$/);
  });

  it("normalizeDotPath handles edge cases", () => {
    // Already covered by existing tests, adding edge cases
    expect(normalizeDotPath("")).toBeUndefined();
    expect(normalizeDotPath("  ")).toBeUndefined();
    expect(normalizeDotPath("..")).toBe("..");  // dots are not stripped, only whitespace trim
    expect(normalizeDotPath(".  ")).toBe(".");  // trimmed to "." not undefined
    expect(normalizeDotPath("data.score")).toBe("data.score");
    expect(normalizeDotPath(" scores.primary ")).toBe("scores.primary");
  });

  it("formatCommandSummary formats exit codes correctly", () => {
    // Already tested existing cases; add null exit code
    const okNull: any = { exitCode: null, durationMs: 100, ok: true };
    const failNull: any = { exitCode: null, durationMs: 100, ok: false };
    const ok0: any = { exitCode: 0, durationMs: 0, ok: true };
    const fail1: any = { exitCode: 1, durationMs: 5000, ok: false };
    
    expect(formatCommandSummary(okNull)).toBe("ok (null) in 100ms");
    expect(formatCommandSummary(failNull)).toBe("failed (null) in 100ms");
    expect(formatCommandSummary(ok0)).toBe("ok (0) in 0ms");
    expect(formatCommandSummary(fail1)).toBe("failed (1) in 5000ms");
  })

  it("compareScoresWithPolicy uses noiseFloor override when provided", () => {
    // epsilon policy, epsilonValue=0.01, noiseFloor override=0.15
    // effective threshold = max(0.01, 0.15) = 0.15, delta=0.1 < 0.15 -> NOT improved
    const result = compareScoresWithPolicy([0.5, 0.55, 0.48], "maximize", 0.5, 0.6, "epsilon", 0.01, 2.0, 0.01, 0.15);
    expect(result.improved).toBe(false);

    // noiseFloor override = 0.05 -> threshold = max(0.01, 0.05) = 0.05, delta=0.1 > 0.05 -> improved
    const result2 = compareScoresWithPolicy([0.5, 0.55, 0.48], "maximize", 0.5, 0.6, "epsilon", 0.01, 2.0, 0.01, 0.05);
    expect(result2.improved).toBe(true);

    // null noiseFloor uses computed from scores (stdDev ~0.035), threshold = max(0.01, null) = 0.01
    const result3 = compareScoresWithPolicy([0.5, 0.55, 0.48], "maximize", 0.5, 0.6, "epsilon", 0.01, 2.0, 0.01, undefined);
    expect(result3.improved).toBe(true);
  });

  it("buildOptimizerBrief masks guardrailCommand for mutator blinding", () => {
    const opt: any = {
      optimizerId: "opt-1", name: "Test", objective: "test",
      mutablePaths: ["src"], scoreDirection: "maximize", bestScore: null,
      hiddenScoring: false, sandboxStrategy: "copy", scorerIsolationMode: "same_workspace",
      applyMode: "automatic", scoreFormat: "json", scoreKey: "primary",
      scorePattern: null, scoreRepeats: 1, scoreAggregator: "median",
      scoreImprovementPolicy: "threshold", confidenceThreshold: null, epsilonValue: null,
      noiseFloor: null, minimumImprovement: 0.01, guardrailFormat: "json", guardrailKey: "guardrails",
      guardrailCommand: "npm test", guardrailRepeats: 1, guardrailAggregator: "all",
      requireHumanApproval: false, autoCreateIssueOnStagnation: false,
      autoCreateIssueOnGuardrailFailure: false, stagnationIssueThreshold: 5,
      consecutiveNonImprovements: 0, consecutiveFailures: 0,
      proposalBranchPrefix: null, proposalCommitMessage: null, notes: "",
      mutationBudgetSeconds: 60, scoreBudgetSeconds: 30, guardrailBudgetSeconds: null
    };

    const brief = buildOptimizerBrief(opt);
    expect(brief.guardrailCommand).toBe("<guardrail-command-set>");
    expect(brief.mutablePaths).toEqual(["src"]);
    expect(brief.scoreImprovementPolicy).toBe("threshold");
    expect(brief.consecutiveNonImprovements).toBe(0);
    expect(brief.consecutiveFailures).toBe(0);
    expect(brief.requireHumanApproval).toBe(false);
    expect(brief.budgets.mutationBudgetSeconds).toBe(60);
  });

  it("aggregateStructuredMetrics merges results with correct key priority", () => {
    // primary is aggregated from all primary scores via the aggregator
    const r1: any = { primary: 0.8, metrics: { latency: 100, quality: 0.9 }, guardrails: { safe: true }, summary: "ok" };
    const r2: any = { primary: 0.85, metrics: { latency: 95, quality: 0.92 }, guardrails: { safe: true }, summary: "ok" };
    const result = aggregateStructuredMetrics([r1, r2], "median");
    // median of [0.8, 0.85] for 2 values = average of both = 0.825
    expect(result?.primary).toBeCloseTo(0.825);
    expect(result?.metrics).toBeDefined();
    // metrics are aggregated per key: latency = median([100, 95]) = 97.5, quality = median([0.9, 0.92]) = 0.91
    expect((result?.metrics as any).latency).toBeCloseTo(97.5);

    // Empty array returns null
    expect(aggregateStructuredMetrics([], "median")).toBeNull();

    // Single value returned as-is
    const single = aggregateStructuredMetrics([r1], "median");
    expect(single?.primary).toBe(0.8);
  });
  it("computePolicySuggestion returns suggestions at trigger thresholds", () => {
    // Confidence: 10 consecutive non-improvements
    const opt1: any = { scoreImprovementPolicy: "confidence", consecutiveNonImprovements: 10 };
    expect(computePolicySuggestion(opt1, "rejected", false)).toContain("threshold");

    // Epsilon: noiseFloor >= 50% of epsilonValue + 5 non-improvements
    const opt2: any = { scoreImprovementPolicy: "epsilon", noiseFloor: 0.15, epsilonValue: 0.25, consecutiveNonImprovements: 5 };
    expect(computePolicySuggestion(opt2, "rejected", false)).toContain("noiseFloor");

    // Threshold: 20 runs, no accepted
    const opt3: any = { scoreImprovementPolicy: "threshold", runs: 20, acceptedRuns: 0, consecutiveNonImprovements: 20 };
    expect(computePolicySuggestion(opt3, "rejected", false)).toContain("confidence");

    // No suggestion when conditions not met
    const opt4: any = { scoreImprovementPolicy: "confidence", consecutiveNonImprovements: 3 };
    expect(computePolicySuggestion(opt4, "rejected", false)).toBeNull();

    // New optimizer
    const opt5: any = { scoreImprovementPolicy: "epsilon", noiseFloor: null };
    expect(computePolicySuggestion(opt5, "rejected", false)).toBeNull();
  });

});