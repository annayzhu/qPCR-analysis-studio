import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { buildCanonicalDataset } from "../packages/importers/src/canonicalize";
import { parseDelimitedText, parseWorkbookBytes } from "../packages/importers/src/workbook";
import { buildQcWorkspaceState } from "../packages/qpcr-core/src/qc";
import { calculateRelativeQuantification } from "../packages/qpcr-core/src/calculations";
import { buildCalculationExportBundle } from "../packages/qpcr-core/src/complete-results-export";

const [cqPath, tmPath, meltPath, layoutPath] = process.argv.slice(2);
if (!cqPath || !tmPath || !meltPath || !layoutPath) {
  throw new Error("Usage: npm run test:real -- <cq.txt> <tm.txt> <melt-grouping.txt> <layout.xlsx>");
}

const [cqText, tmText, meltText, layoutBytes] = await Promise.all([
  readFile(cqPath, "utf8"), readFile(tmPath, "utf8"), readFile(meltPath, "utf8"), readFile(layoutPath),
]);
const layoutArrayBuffer = layoutBytes.buffer.slice(layoutBytes.byteOffset, layoutBytes.byteOffset + layoutBytes.byteLength) as ArrayBuffer;
const sources = [
  parseDelimitedText(cqText, basename(cqPath)),
  parseDelimitedText(tmText, basename(tmPath)),
  parseDelimitedText(meltText, basename(meltPath)),
  parseWorkbookBytes(layoutArrayBuffer, basename(layoutPath)),
];

assert.equal(sources[0].adapterId, "roche-lightcycler-480:cq-results");
assert.equal(sources[1].adapterId, "roche-lightcycler-480:tm-summary");
assert.equal(sources[2].adapterId, "roche-lightcycler-480:melt-grouping");
assert.equal(sources[0].tables[0].rawRows.length, 384);
assert.equal(sources[1].tables[0].rawRows.length, 384);
assert.equal(sources[2].tables[0].rawRows.length, 384);

const layoutTable = sources[3].tables.find((table) => table.id === sources[3].selectedTableId);
assert.equal(layoutTable?.sourceSheet, "Well_Detail");
const dataset = buildCanonicalDataset(sources);
assert.equal(dataset.plate?.plateFormat, 384);
assert.equal(dataset.wells.length, 384);
assert.equal(dataset.wells.filter((well) => well.sampleName || well.targetName).length, 240);
assert.equal(dataset.wells.filter((well) => well.tm2 !== null).length, 7);
assert.equal(dataset.wells.filter((well) => well.meltGroup === "Unknown").length, 5);
assert.ok(dataset.assumptions.some((note) => note.includes("加了两遍")));
assert.ok(dataset.assumptions.some((note) => note.includes("错了一位")));
assert.equal(dataset.wells.find((well) => well.well === "A14")?.sampleName, "NC-FAM");
assert.equal(dataset.wells.find((well) => well.well === "A14")?.targetName, "FBN2-2");
assert.equal(dataset.wells.find((well) => well.well === "F1")?.cq, null);

const qcWorkspace = buildQcWorkspaceState(dataset.wells);
assert.ok([...qcWorkspace.specificWarnings.values()].every((warnings) => warnings.size > 0));
assert.ok([...qcWorkspace.groupWarnings.values()].every((warnings) => warnings.size > 0));

const samples = [...new Set(dataset.wells.map((well) => well.sampleName).filter(Boolean))].sort();
const assays = [...new Set(dataset.wells.map((well) => well.targetName).filter(Boolean))].sort();
assert.ok(assays.includes("GAPDH"), "Real-file export check requires the known GAPDH reference assay");
const targetAssays = assays.filter((assay) => assay !== "GAPDH");
const settings = {
  referenceTargets: ["GAPDH"], calibratorType: "sample" as const, calibratorValue: "",
  replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5,
  efficiencyByTarget: {}, calculationMode: "delta-cq" as const,
};
const relativeResults = calculateRelativeQuantification(dataset.wells, settings);
const calculationExport = buildCalculationExportBundle(dataset.wells, relativeResults, samples, targetAssays, settings);
assert.ok(calculationExport.wellRows.length > 0);
assert.ok(calculationExport.plateRows.length > 0);
for (const exported of calculationExport.wellRows) {
  const original = dataset.wells.find((well) => well.id === exported.record_id);
  assert.ok(original);
  assert.equal(exported.cq, original.cq, `Export changed the source Cq at ${exported.plate}:${exported.well}`);
}
const referenceDeltaGroups = new Map<string, number[]>();
for (const row of calculationExport.wellRows) {
  if (row.assay !== "GAPDH" || row.included_in_calculation !== "yes") continue;
  const value = row.well_delta_cq_cq_minus_reference_center;
  if (typeof value !== "number") continue;
  const key = `${row.plate}\u241f${row.sample}`;
  referenceDeltaGroups.set(key, [...(referenceDeltaGroups.get(key) ?? []), value]);
}
for (const values of referenceDeltaGroups.values()) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(Math.abs(average) < 1e-10, "Single-reference per-well delta Cq values must average to zero");
}

console.log(JSON.stringify({
  adapters: sources.slice(0, 3).map((source) => source.adapterId),
  selectedLayoutSheet: layoutTable?.sourceSheet,
  plateFormat: dataset.plate?.plateFormat,
  wells: dataset.wells.length,
  definedReactions: dataset.wells.filter((well) => well.sampleName || well.targetName).length,
  secondaryTmPeaks: dataset.wells.filter((well) => well.tm2 !== null).length,
  unknownMeltGroups: dataset.wells.filter((well) => well.meltGroup === "Unknown").length,
  replicateReviewGroups: qcWorkspace.replicateQc.filter((group) => group.warningCodes.length > 0).length,
  wellLevelAlerts: qcWorkspace.specificWarnings.size,
  capturedPlateNotes: dataset.assumptions.filter((note) => note.startsWith("板布局备注")).length,
  exportedWellCalculations: calculationExport.wellRows.length,
  exportedPlateSummaries: calculationExport.plateRows.length,
  exportedFinalResults: calculationExport.completeRows.length,
}, null, 2));
