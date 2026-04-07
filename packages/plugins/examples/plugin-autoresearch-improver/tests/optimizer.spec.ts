import { describe, expect, it } from "vitest";
import {
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
  validateConfig
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
});
