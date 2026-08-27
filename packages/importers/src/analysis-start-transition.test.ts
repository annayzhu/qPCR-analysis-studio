import { describe, expect, it } from "vitest";
import type { ImportedSource } from "../../schemas/src";
import { resolveAnalysisStartForImport, transitionAnalysisStart } from "./analysis-start-transition";

const importedSource = { id: "delta-source" } as ImportedSource;

describe("analysis-start import reset", () => {
  it("clears stale imports and analysis state when the user selects a different start", () => {
    const current = {
      analysisStart: "delta-cq" as const,
      sources: [importedSource],
      analysisSession: { id: "applied-analysis" },
      needsRebuild: true,
      error: "stale validation error",
    };

    expect(transitionAnalysisStart(current, "delta-delta-cq")).toEqual({
      analysisStart: "delta-delta-cq",
      sources: [],
      analysisSession: null,
      needsRebuild: false,
      error: "",
    });
  });

  it("keeps the current import state when the selected start did not change", () => {
    const current = {
      analysisStart: "delta-cq" as const,
      sources: [importedSource],
      analysisSession: { id: "applied-analysis" },
      needsRebuild: false,
      error: "",
    };

    expect(transitionAnalysisStart(current, "delta-cq")).toBe(current);
  });
});

describe("analysis-start import authority", () => {
  it("keeps a user-confirmed Delta Cq start when an imported template still declares Cq", () => {
    expect(resolveAnalysisStartForImport({
      selectedStart: "delta-cq",
      selectedByUser: true,
      declaredStart: "cq",
    })).toBe("delta-cq");
  });

  it("uses a valid template declaration before the user has selected a start", () => {
    expect(resolveAnalysisStartForImport({
      selectedStart: "cq",
      selectedByUser: false,
      declaredStart: "delta-cq",
    })).toBe("delta-cq");
  });
});
