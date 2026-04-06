import { describe, expect, it } from "vitest";
import { compareScores, extractScore, normalizeMutablePaths } from "../src/lib/optimizer.js";

describe("optimizer helpers", () => {
  it("normalizes mutable paths and defaults to workspace root", () => {
    expect(normalizeMutablePaths("src/\nREADME.md")).toEqual(["src", "README.md"]);
    expect(normalizeMutablePaths("")).toEqual(["."]);
  });

  it("extracts scores from plain output and regex captures", () => {
    expect(extractScore("score=1.25")).toBe(1.25);
    expect(extractScore("VAL_BPB: 0.91", "VAL_BPB:\\s*([0-9.]+)")).toBe(0.91);
  });

  it("compares maximize and minimize directions correctly", () => {
    expect(compareScores("maximize", 1, 2).improved).toBe(true);
    expect(compareScores("maximize", 2, 1).improved).toBe(false);
    expect(compareScores("minimize", 2, 1).improved).toBe(true);
    expect(compareScores("minimize", 1, 2).improved).toBe(false);
  });
});
