import { describe, expect, it } from "vitest";
import {
  aggregateStructuredMetrics,
  compareScores,
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
});
