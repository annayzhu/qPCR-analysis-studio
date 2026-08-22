import { describe, expect, it } from "vitest";
import { buildLogRatioAxis, chartLabelVisualUnits, mapRatioToY, wrapChartLabel } from "./charting";
import type { RawImportedRow, WellRecord } from "../../schemas/src";
import { calculateRelativeQuantification } from "./calculations";
import { buildQcWorkspaceState, calculateReplicateQc } from "./qc";
import { summarizeMeltWells } from "./melt";
import { restoreWellsToBaseline, setWellExclusion, updateWellFields } from "./audit";
import { transferLayoutAnnotations } from "./layout-correction";
import { buildVisualizationBarRows, VISUALIZATION_BAR_HEADERS } from "./visualization-export";
import { buildCompleteResultRows, COMPLETE_RESULTS_HEADERS } from "./complete-results-export";

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

function wellOnPlate(plateId: string, id: string, position: string, sample: string, target: string, cq: number | null): WellRecord {
  return { ...well(id, position, sample, target, cq), plateId };
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

    const workspace = buildQcWorkspaceState(wells);
    expect(workspace.groupWarnings.get("A1")).toContain("CQ_RANGE_HIGH");
    expect(workspace.groupWarnings.get("A2")).toContain("CQ_RANGE_HIGH");
    expect(workspace.groupWarnings.get("A3")).toContain("CQ_RANGE_HIGH");
    expect(workspace.specificWarnings.has("A1")).toBe(false);
    expect(workspace.specificWarnings.get("A3")).toContain("CQ_RANGE_HIGH");
  });

  it("keeps overview and plate warnings synchronized for imported well flags", () => {
    const instrumentFlagged = well("1", "A1", "S1", "G1", 20);
    instrumentFlagged.instrumentFlag = "Review";
    instrumentFlagged.qcFlags.push({
      code: "INSTRUMENT_FLAG",
      severity: "warning",
      message: "仪器状态: Review",
      source: "instrument",
    });
    const invalid = well("2", "A2", "S2", "G1", null);
    invalid.cqStatus = "invalid";
    invalid.cqReason = "无效 Cq: bad";
    invalid.qcFlags.push({ code: "INVALID_CQ", severity: "error", message: invalid.cqReason, source: "import" });

    const workspace = buildQcWorkspaceState([instrumentFlagged, invalid]);
    expect(workspace.replicateQc.find((row) => row.sampleName === "S1")?.warningCodes).toContain("INSTRUMENT_FLAG");
    expect(workspace.replicateQc.find((row) => row.sampleName === "S2")?.warningCodes).toContain("INVALID_CQ");
    expect(workspace.specificWarnings.get("A1")).toContain("INSTRUMENT_FLAG");
    expect(workspace.specificWarnings.get("A2")).toContain("INVALID_CQ");
    expect(workspace.groupWarnings.has("A1")).toBe(false);
    expect(workspace.groupWarnings.has("A2")).toBe(false);
    expect([...workspace.specificWarnings.values()].every((warnings) => warnings.size > 0)).toBe(true);
  });

  it("does not mark an intentional empty non-detected well as a yellow QC alert", () => {
    const empty = well("1", "P24", "", "", null);
    empty.cqStatus = "not-detected";
    empty.cqReason = "Roche 480 导出的 0 值按未检出处理";
    const workspace = buildQcWorkspaceState([empty]);
    expect(workspace.replicateQc).toHaveLength(0);
    expect(workspace.specificWarnings.has("P24")).toBe(false);
  });

  it("keeps an unnamed instrument warning visible as a well-level alert", () => {
    const unnamed = well("1", "P23", "", "", null);
    unnamed.instrumentFlag = "Review";
    unnamed.qcFlags.push({
      code: "INSTRUMENT_FLAG",
      severity: "warning",
      message: "仪器状态: Review",
      source: "instrument",
    });
    const workspace = buildQcWorkspaceState([unnamed]);
    expect(workspace.replicateQc).toHaveLength(0);
    expect(workspace.specificWarnings.get("P23")).toContain("INSTRUMENT_FLAG");
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

  it("wraps long mixed-language sample names without truncating them", () => {
    const sampleName = "Control_处理组_24h_technical-replicate-01";
    const lines = wrapChartLabel(sampleName, 16);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe(sampleName);
    expect(lines.every((line) => chartLabelVisualUnits(line) <= 16)).toBe(true);
    expect(lines.some((line) => line.includes("…"))).toBe(false);
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

  it("restores selected plate annotations and exclusion state to the imported baseline", () => {
    const baseline = [well("1", "A1", "Imported-S1", "GAPDH", 20), well("2", "A2", "Imported-S2", "GENE1", 22)];
    const edited = baseline.map((item) => ({ ...item }));
    edited[0] = { ...edited[0], sampleName: "Edited", targetName: "GENE2", taskType: "Positive", userExcluded: true, exclusionReason: "manual" };
    const restored = restoreWellsToBaseline(edited, baseline, ["1"], "恢复为导入值", "2026-08-07T12:00:00Z");
    expect(restored.wells[0].sampleName).toBe("Imported-S1");
    expect(restored.wells[0].targetName).toBe("GAPDH");
    expect(restored.wells[0].taskType).toBe("Unknown");
    expect(restored.wells[0].userExcluded).toBe(false);
    expect(restored.wells[0].exclusionReason).toBe("");
    expect(restored.wells[1]).toEqual(edited[1]);
    expect(restored.editLogs).toHaveLength(3);
    expect(restored.exclusionLogs).toHaveLength(1);
  });

  it("moves layout annotations while keeping raw Cp fixed to physical wells", () => {
    const baseline = [
      well("a1", "A1", "S1", "REF", 20),
      well("a2", "A2", "S1", "GENE", 24),
      well("b1", "B1", "", "", 30),
      well("b2", "B2", "", "", 31),
    ];
    baseline[0].replicate = 1;
    baseline[1].replicate = 2;

    const moved = transferLayoutAnnotations(baseline, {
      mode: "move",
      sourceWellIds: ["a1", "a2"],
      destinationAnchorWellId: "b1",
      timestamp: "2026-08-21T00:00:00Z",
    });

    expect(moved.ok).toBe(true);
    expect(moved.wells.map(({ well: position, sampleName, targetName, replicate, cq }) => ({ position, sampleName, targetName, replicate, cq }))).toEqual([
      { position: "A1", sampleName: "", targetName: "", replicate: null, cq: 20 },
      { position: "A2", sampleName: "", targetName: "", replicate: null, cq: 24 },
      { position: "B1", sampleName: "S1", targetName: "REF", replicate: 1, cq: 30 },
      { position: "B2", sampleName: "S1", targetName: "GENE", replicate: 2, cq: 31 },
    ]);
    expect(baseline[0].sampleName).toBe("S1");
    expect(baseline[2].cq).toBe(30);
    expect(moved.logs.length).toBeGreaterThan(0);
  });

  it("rejects a layout move before mutation when the destination is occupied", () => {
    const baseline = [well("a1", "A1", "S1", "REF", 20), well("b1", "B1", "S2", "GENE", 30)];
    const result = transferLayoutAnnotations(baseline, {
      mode: "move",
      sourceWellIds: ["a1"],
      destinationAnchorWellId: "b1",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("collision");
    expect(result.wells).toBe(baseline);
    expect(result.logs).toHaveLength(0);
  });

  it("copies and swaps annotations without moving either well's Cp", () => {
    const copyBaseline = [well("a1", "A1", "S1", "REF", 20), well("b1", "B1", "", "", 30)];
    const copied = transferLayoutAnnotations(copyBaseline, {
      mode: "copy",
      sourceWellIds: ["a1"],
      destinationAnchorWellId: "b1",
    });
    expect(copied.wells.map((item) => [item.well, item.sampleName, item.targetName, item.cq])).toEqual([
      ["A1", "S1", "REF", 20], ["B1", "S1", "REF", 30],
    ]);

    const swapBaseline = [well("a1", "A1", "S1", "REF", 20), well("b1", "B1", "S2", "GENE", 30)];
    const swapped = transferLayoutAnnotations(swapBaseline, {
      mode: "swap",
      sourceWellIds: ["a1"],
      destinationAnchorWellId: "b1",
    });
    expect(swapped.wells.map((item) => [item.well, item.sampleName, item.targetName, item.cq])).toEqual([
      ["A1", "S2", "GENE", 20], ["B1", "S1", "REF", 30],
    ]);
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
    expect(results[0].targetSemCq).toBeCloseTo(1);
    expect(results[0].targetValidReplicates).toBe(2);
    expect(results[0].referenceValidReplicates).toEqual({ GAPDH: 2 });
    expect(results[0].deltaCqSd).toBeCloseTo(Math.sqrt(2));
    expect(results[0].deltaCqSem).toBeCloseTo(1);
    expect(results[0].normalizedQuantitySd).toBeCloseTo(Math.log(2) * 0.125 * Math.sqrt(2));
    expect(results[0].normalizedQuantitySem).toBeCloseTo(Math.log(2) * 0.125);
  });

  it("propagates technical-replicate SD through multiple-reference normalization", () => {
    const wells = [
      well("1", "A1", "S1", "REF1", 20), well("2", "A2", "S1", "REF1", 22),
      well("3", "A3", "S1", "REF2", 19), well("4", "A4", "S1", "REF2", 19),
      well("5", "A5", "S1", "GENE", 22), well("6", "A6", "S1", "GENE", 24),
    ];
    const [result] = calculateRelativeQuantification(wells, {
      referenceTargets: ["REF1", "REF2"], calibratorType: "sample", calibratorValue: "",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5, efficiencyByTarget: {}, calculationMode: "delta-cq",
    });
    const expectedReferenceSd = Math.sqrt(2) / 2;
    const expectedDeltaSd = Math.sqrt(2 + expectedReferenceSd ** 2);
    expect(result.referenceMeanCq).toBe(20);
    expect(result.referenceSdCq).toBeCloseTo(expectedReferenceSd);
    expect(result.referenceValidReplicates).toEqual({ REF1: 2, REF2: 2 });
    expect(result.deltaCqSd).toBeCloseTo(expectedDeltaSd);
    expect(result.normalizedQuantitySd).toBeCloseTo(Math.log(2) * 0.125 * expectedDeltaSd);
  });

  it("propagates sample and calibrator SD while keeping the calibrator anchor fixed", () => {
    const wells = [
      well("1", "A1", "Control", "REF", 19), well("2", "A2", "Control", "REF", 21),
      well("3", "A3", "Control", "GENE", 22), well("4", "A4", "Control", "GENE", 24),
      well("5", "B1", "Treat", "REF", 19), well("6", "B2", "Treat", "REF", 21),
      well("7", "B3", "Treat", "GENE", 21), well("8", "B4", "Treat", "GENE", 23),
    ];
    const results = calculateRelativeQuantification(wells, {
      referenceTargets: ["REF"], calibratorType: "sample", calibratorValue: "Control",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5, efficiencyByTarget: {}, calculationMode: "delta-delta-cq",
    });
    const control = results.find((row) => row.sampleName === "Control")!;
    const treated = results.find((row) => row.sampleName === "Treat")!;
    const deltaSd = 2;
    const deltaDeltaSd = Math.sqrt(deltaSd ** 2 + deltaSd ** 2);
    expect(control.relativeExpression).toBe(1);
    expect(control.deltaDeltaCqSd).toBeCloseTo(deltaSd);
    expect(control.relativeExpressionSd).toBeCloseTo(Math.log(2) * deltaSd);
    expect(control.deltaCqSem).toBeCloseTo(Math.sqrt(2));
    expect(control.deltaDeltaCqSem).toBeCloseTo(Math.sqrt(2));
    expect(control.relativeExpressionSem).toBeCloseTo(Math.log(2) * Math.sqrt(2));
    expect(treated.relativeExpression).toBe(2);
    expect(treated.deltaDeltaCqSd).toBeCloseTo(deltaDeltaSd);
    expect(treated.relativeExpressionSd).toBeCloseTo(Math.log(2) * 2 * deltaDeltaSd);
  });

  it("does not fabricate propagated SD when any required replicate group is a singleton", () => {
    const wells = [
      well("1", "A1", "S1", "REF", 20),
      well("2", "A2", "S1", "GENE", 22), well("3", "A3", "S1", "GENE", 22.2),
    ];
    const [result] = calculateRelativeQuantification(wells, {
      referenceTargets: ["REF"], calibratorType: "sample", calibratorValue: "",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5, efficiencyByTarget: {}, calculationMode: "delta-cq",
    });
    expect(result.referenceSdCq).toBeNull();
    expect(result.deltaCqSd).toBeNull();
    expect(result.deltaCqSem).toBeNull();
    expect(result.normalizedQuantitySd).toBeNull();
    expect(result.normalizedQuantitySem).toBeNull();
  });

  it("pairs split samples with the same-plate reference instead of pooling references across plates", () => {
    const wells = [
      wellOnPlate("plate-1", "1", "A1", "S7", "T1", 20), wellOnPlate("plate-1", "2", "A2", "S7", "T1", 20), wellOnPlate("plate-1", "3", "A3", "S7", "T1", 20),
      wellOnPlate("plate-1", "4", "B1", "S7", "T2", 22), wellOnPlate("plate-1", "5", "B2", "S7", "T2", 22), wellOnPlate("plate-1", "6", "B3", "S7", "T2", 22),
      wellOnPlate("plate-2", "7", "A1", "S7", "T1", 25), wellOnPlate("plate-2", "8", "A2", "S7", "T1", 25), wellOnPlate("plate-2", "9", "A3", "S7", "T1", 25),
      wellOnPlate("plate-2", "10", "B1", "S7", "T3", 26), wellOnPlate("plate-2", "11", "B2", "S7", "T3", 26), wellOnPlate("plate-2", "12", "B3", "S7", "T3", 26),
    ];
    const results = calculateRelativeQuantification(wells, {
      referenceTargets: ["T1"], calibratorType: "sample", calibratorValue: "",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5, efficiencyByTarget: {}, calculationMode: "delta-cq",
    });

    const t2 = results.find((row) => row.targetName === "T2")!;
    const t3 = results.find((row) => row.targetName === "T3")!;
    expect(t2.deltaCq).toBeCloseTo(2);
    expect(t2.normalizedQuantity).toBeCloseTo(0.25);
    expect(t3.deltaCq).toBeCloseTo(1);
    expect(t3.normalizedQuantity).toBeCloseTo(0.5);
    expect(t2.warningCodes).toContain("PLATE_AWARE_REFERENCE_PAIRING");
    expect(t3.warningCodes).toContain("PLATE_AWARE_REFERENCE_PAIRING");
  });

  it("calculates each plate-level delta Cq before merging repeated target segments", () => {
    const wells = [
      wellOnPlate("plate-1", "1", "A1", "S1", "REF", 20), wellOnPlate("plate-1", "2", "A2", "S1", "REF", 20), wellOnPlate("plate-1", "3", "A3", "S1", "REF", 20),
      wellOnPlate("plate-1", "4", "B1", "S1", "GENE", 22), wellOnPlate("plate-1", "5", "B2", "S1", "GENE", 22), wellOnPlate("plate-1", "6", "B3", "S1", "GENE", 22),
      wellOnPlate("plate-2", "7", "A1", "S1", "REF", 30), wellOnPlate("plate-2", "8", "A2", "S1", "REF", 30), wellOnPlate("plate-2", "9", "A3", "S1", "REF", 30),
      wellOnPlate("plate-2", "10", "B1", "S1", "GENE", 34), wellOnPlate("plate-2", "11", "B2", "S1", "GENE", 34), wellOnPlate("plate-2", "12", "B3", "S1", "GENE", 34),
    ];
    const [result] = calculateRelativeQuantification(wells, {
      referenceTargets: ["REF"], calibratorType: "sample", calibratorValue: "",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5, efficiencyByTarget: {}, calculationMode: "delta-cq",
    });

    expect(result.targetMeanCq).toBeCloseTo(28);
    expect(result.referenceMeanCq).toBeCloseTo(25);
    expect(result.deltaCq).toBeCloseTo(result.targetMeanCq - result.referenceMeanCq);
    expect(result.normalizedQuantity).toBeCloseTo(0.125);
    expect(result.targetValidReplicates).toBe(6);
    expect(result.referenceValidReplicates).toEqual({ REF: 6 });
    expect(result.warningCodes).toEqual(expect.arrayContaining([
      "PLATE_AWARE_REFERENCE_PAIRING",
      "MULTI_PLATE_TARGET_MERGED",
    ]));
    expect(result.targetSdCq).toBeCloseTo(Math.sqrt(43.2));
    expect(result.targetSemCq).toBeCloseTo(result.targetSdCq! / Math.sqrt(6));
    expect(result.referenceSdCq).toBeCloseTo(Math.sqrt(30));
    expect(result.referenceSemCq).toBeCloseTo(result.referenceSdCq! / Math.sqrt(6));
    expect(result.normalizedQuantitySd).toBeCloseTo(Math.log(2) * result.normalizedQuantity * result.deltaCqSd!);
  });
});

describe("Visualization Studio bar export", () => {
  it("uses the selected sample and target order with the exact five-column schema", () => {
    const wells = [
      well("1", "A1", "Control", "REF", 20), well("2", "A2", "Control", "REF", 20),
      well("3", "A3", "Control", "GENE1", 23), well("4", "A4", "Control", "GENE1", 23.2),
      well("5", "A5", "Control", "GENE2", 25), well("6", "A6", "Control", "GENE2", 25.2),
      well("7", "B1", "Treat", "REF", 20), well("8", "B2", "Treat", "REF", 20),
      well("9", "B3", "Treat", "GENE1", 22), well("10", "B4", "Treat", "GENE1", 22.2),
      well("11", "B5", "Treat", "GENE2", 24), well("12", "B6", "Treat", "GENE2", 24.2),
    ];
    const results = calculateRelativeQuantification(wells, {
      referenceTargets: ["REF"], calibratorType: "sample", calibratorValue: "Control",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5, efficiencyByTarget: {}, calculationMode: "delta-delta-cq",
    });

    const rows = buildVisualizationBarRows(results, ["Treat", "Control"], ["GENE2", "GENE1"]);

    expect(VISUALIZATION_BAR_HEADERS).toEqual(["category", "value", "sd", "sem", "group"]);
    expect(rows.map((row) => `${row.group}:${row.category}`)).toEqual([
      "GENE2:Treat", "GENE2:Control", "GENE1:Treat", "GENE1:Control",
    ]);
    expect(Object.keys(rows[0])).toEqual(VISUALIZATION_BAR_HEADERS);
    expect(rows[0].value).toBeCloseTo(2);
    expect(rows[0].sd).not.toBeNull();
    expect(rows[0].sem).not.toBeNull();
    const calibrator = rows.find((row) => row.category === "Control" && row.group === "GENE2")!;
    expect(calibrator.value).toBe(1);
    expect(calibrator.sd).toBeGreaterThan(0);
    expect(calibrator.sem).toBeGreaterThan(0);
  });

  it("falls back to normalized quantity and its propagated SD when no calibrator is selected", () => {
    const results = calculateRelativeQuantification([
      well("1", "A1", "S1", "REF", 20), well("2", "A2", "S1", "REF", 20.2),
      well("3", "A3", "S1", "GENE", 23), well("4", "A4", "S1", "GENE", 23.2),
    ], {
      referenceTargets: ["REF"], calibratorType: "sample", calibratorValue: "",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5, efficiencyByTarget: {}, calculationMode: "delta-cq",
    });

    const [row] = buildVisualizationBarRows(results, ["S1"], ["GENE"]);
    expect(row.value).toBe(results[0].normalizedQuantity);
    expect(row.sd).toBe(results[0].normalizedQuantitySd);
    expect(row.sem).toBe(results[0].normalizedQuantitySem);
  });
});

describe("complete calculation-results export", () => {
  it("keeps unavailable technical SD/SEM blank when n is one", () => {
    const results = calculateRelativeQuantification([
      well("1", "A1", "S1", "REF", 20),
      well("2", "A2", "S1", "GENE", 23),
    ], {
      referenceTargets: ["REF"], calibratorType: "sample", calibratorValue: "",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5,
      efficiencyByTarget: {}, calculationMode: "delta-cq",
    });
    const [row] = buildCompleteResultRows(results, ["S1"], ["GENE"], "delta-cq");
    expect(Object.keys(row)).toEqual(COMPLETE_RESULTS_HEADERS);
    expect(row.target_valid_replicates).toBe(1);
    expect(row.target_technical_sd).toBeNull();
    expect(row.target_technical_sem).toBeNull();
    expect(row.reference_technical_sd).toBeNull();
    expect(row.reference_technical_sem).toBeNull();
    expect(row.notes).toContain("fewer than two valid technical replicates");
  });

  it("preserves the supplied assay role and carries import/QC warnings into the complete export", () => {
    const wells = [
      { ...well("1", "A1", "S1", "REF", 20), taskType: "Reference" },
      { ...well("2", "A2", "S1", "REF", 20.2), taskType: "Reference" },
      { ...well("3", "A3", "S1", "GENE", 23), taskType: "Gene of interest" },
      { ...well("4", "A4", "S1", "GENE", 23.2), taskType: "Gene of interest" },
    ];
    const results = calculateRelativeQuantification(wells, {
      referenceTargets: ["REF"], calibratorType: "sample", calibratorValue: "",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5,
      efficiencyByTarget: {}, calculationMode: "delta-cq",
    });
    const [row] = buildCompleteResultRows(
      results,
      ["S1"],
      ["GENE"],
      "delta-cq",
      ["IMPORT_WARNING: synthetic warning"],
    );

    expect(row.assay_type_role).toBe("Gene of interest");
    expect(row.warnings).toContain("IMPORT_WARNING: synthetic warning");
  });
});
