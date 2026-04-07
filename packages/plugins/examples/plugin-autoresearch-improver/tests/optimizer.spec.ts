import { describe, expect, it } from "vitest";
import {
  aggregateStructuredMetrics,
  compareScores,
  compareScoresWithPolicy,
  computeStdDev,
  extractScore,
  extractStructuredMetricResult,
  normalizeMutablePaths
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
});
