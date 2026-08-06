import { describe, expect, it } from "vitest";
import { buildLogRatioAxis, mapRatioToY } from "./charting";
import type { RawImportedRow, WellRecord } from "../../schemas/src";
import { calculateRelativeQuantification } from "./calculations";
import { calculateReplicateQc } from "./qc";
import { summarizeMeltWells } from "./melt";
import { setWellExclusion, updateWellFields } from "./audit";

const raw: RawImportedRow = {
  sourceId: "s", sourceFileName: "demo.tsv", sourceSheet: "Sheet1", sourceRowNumber: 2,
  rawHeaders: Object.freeze(["Well", "Sample", "Target", "Cq"]),
  rawValues: Object.freeze({ Well: "A1", Sample: "S1", Target: "G1", Cq: 20 }),
};

function well(id: string, position: string, sample: string, target: string, cq: number | null): WellRecord {
  return {
    id, plateId: "p", well: position, row: position[0], column: Number(position.slice(1)),
    sampleName: sample, targetName: target, cq, cqStatus: cq === null ? "not-detected" : "detected", cqReason: "",
    reporter: "FAM", taskType: "Unknown", replicate: null, tm1: null, tm2: null, meltGroup: "",
    meltScore: null, meltResolution: null, instrumentFlag: "Passed", instrumentOmit: false,
    userExcluded: false, exclusionReason: "", sourceSheet: "Sheet1", sourceRowNumber: 2, rawRow: raw, qcFlags: [],
  };
}

describe("replicate QC", () => {
  it("warns without auto-excluding and leaves singleton SD/CV null", () => {
    const wells = [well("1", "A1", "S1", "G1", 20), well("2", "A2", "S1", "G1", 20.2), well("3", "A3", "S1", "G1", 21)];
    const [qc] = calculateReplicateQc(wells);
    expect(qc.warningCodes).toContain("CQ_RANGE_HIGH");
    expect(qc.suspectWell).toBe("A3");
    expect(wells.every((item) => !item.userExcluded)).toBe(true);
    const [singleton] = calculateReplicateQc([well("4", "B1", "S2", "G1", 23)]);
    expect(singleton.sdCq).toBeNull();
    expect(singleton.linearQuantityCvPercent).toBeNull();
  });
});

describe("publication chart ratio axis", () => {
  it("always includes the no-change reference and expands to all observations", () => {
    const axis = buildLogRatioAxis([0.2, 1, 9]);
    expect(axis.tickValues).toContain(1);
    expect(axis.minExponent).toBeLessThanOrEqual(Math.log2(0.2));
    expect(axis.maxExponent).toBeGreaterThanOrEqual(Math.log2(9));
    expect(mapRatioToY(9, axis, 40, 300)).toBeLessThan(mapRatioToY(1, axis, 40, 300));
    expect(mapRatioToY(0.2, axis, 40, 300)).toBeGreaterThan(mapRatioToY(1, axis, 40, 300));
  });
});

describe("melt summary", () => {
  it("flags secondary peaks and target-relative Tm shifts without excluding wells", () => {
    const wells = [well("1", "A1", "S1", "G1", null), well("2", "A2", "S2", "G1", null), well("3", "A3", "S3", "G1", null)];
    wells[0].tm1 = 82.0;
    wells[1].tm1 = 82.1;
    wells[2].tm1 = 84.0;
    wells[2].tm2 = 72.4;
    wells[2].meltGroup = "Unknown";
    const summary = summarizeMeltWells(wells, 0.5);
    expect(summary.targets[0].medianTm1).toBe(82.1);
    expect(summary.wells[2].warningCodes).toEqual(expect.arrayContaining([
      "SECONDARY_MELT_PEAK",
      "UNKNOWN_MELT_GROUP",
      "TM_SHIFT_FROM_TARGET_MEDIAN",
    ]));
    expect(wells[2].userExcluded).toBe(false);
  });
});

describe("audited edits", () => {
  it("returns new wells and logs without overwriting raw input", () => {
    const original = [well("1", "A1", "S1", "G1", 20)];
    const edited = updateWellFields(original, ["1"], { sampleName: "S2" }, "2026-08-04T00:00:00Z");
    expect(original[0].sampleName).toBe("S1");
    expect(edited.wells[0].sampleName).toBe("S2");
    expect(edited.wells[0].rawRow.rawValues.Sample).toBe("S1");
    expect(edited.logs).toHaveLength(1);
    const excluded = setWellExclusion(edited.wells, ["1"], true, "manual", "2026-08-04T00:01:00Z");
    expect(excluded.wells[0].userExcluded).toBe(true);
    expect(excluded.logs[0].action).toBe("exclude");
  });
});

describe("relative quantification", () => {
  it("calculates classic delta-delta Cq after technical replicate means", () => {
    const wells = [
      well("1", "A1", "Control", "GAPDH", 20), well("2", "A2", "Control", "GAPDH", 20),
      well("3", "A3", "Control", "GENE", 23), well("4", "A4", "Control", "GENE", 23),
      well("5", "B1", "Treat", "GAPDH", 20), well("6", "B2", "Treat", "GAPDH", 20),
      well("7", "B3", "Treat", "GENE", 22), well("8", "B4", "Treat", "GENE", 22),
    ];
    const results = calculateRelativeQuantification(wells, {
      referenceTargets: ["GAPDH"], calibratorType: "sample", calibratorValue: "Control",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5, efficiencyByTarget: {}, calculationMode: "delta-delta-cq",
    });
    const treated = results.find((row) => row.sampleName === "Treat");
    expect(treated?.relativeExpression).toBeCloseTo(2);
    expect(treated?.targetSdCq).toBe(0);
  });

  it("reports the sample SD of active target technical replicates", () => {
    const wells = [
      well("1", "A1", "S1", "GAPDH", 20), well("2", "A2", "S1", "GAPDH", 20),
      well("3", "A3", "S1", "GENE", 22), well("4", "A4", "S1", "GENE", 24),
    ];
    const results = calculateRelativeQuantification(wells, {
      referenceTargets: ["GAPDH"], calibratorType: "sample", calibratorValue: "",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5, efficiencyByTarget: {}, calculationMode: "delta-cq",
    });
    expect(results[0].targetMeanCq).toBe(23);
    expect(results[0].targetSdCq).toBeCloseTo(Math.sqrt(2));
  });
});
