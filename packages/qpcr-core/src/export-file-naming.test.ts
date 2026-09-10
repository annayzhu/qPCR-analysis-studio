import { describe, expect, it } from "vitest";
import { buildAnalysisExportStem } from "./export-file-naming";

describe("analysis export file naming", () => {
  it("identifies a single source, calculation start, and analysis date", () => {
    expect(buildAnalysisExportStem(
      ["20260821-ZHY-01.txt"],
      "cq",
      "2026-08-28T02:30:00.000Z",
    )).toBe("20260821-ZHY-01-cq-20260828");
  });

  it("summarizes additional sources without exposing internal IDs", () => {
    expect(buildAnalysisExportStem(
      ["A549 results.xlsx", "H358 results.xlsx", "H596 results.xlsx"],
      "delta-cq",
      "2026-08-28T02:30:00.000Z",
    )).toBe("A549-results-plus-2-files-delta-cq-20260828");
  });

  it("preserves meaningful Chinese source names and handles invalid dates", () => {
    expect(buildAnalysisExportStem(
      ["20260821-ZHY-qPCR按细胞系拆分.xlsx"],
      "delta-delta-cq",
      "unknown",
    )).toBe("20260821-ZHY-qPCR按细胞系拆分-delta-delta-cq");
  });
});
