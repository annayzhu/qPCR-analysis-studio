import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { buildCanonicalDataset } from "../packages/importers/src/canonicalize";
import { parseDelimitedText, parseWorkbookBytes } from "../packages/importers/src/workbook";
import { buildQcWorkspaceState } from "../packages/qpcr-core/src/qc";

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
assert.equal(dataset.plate.plateFormat, 384);
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

console.log(JSON.stringify({
  adapters: sources.slice(0, 3).map((source) => source.adapterId),
  selectedLayoutSheet: layoutTable?.sourceSheet,
  plateFormat: dataset.plate.plateFormat,
  wells: dataset.wells.length,
  definedReactions: dataset.wells.filter((well) => well.sampleName || well.targetName).length,
  secondaryTmPeaks: dataset.wells.filter((well) => well.tm2 !== null).length,
  unknownMeltGroups: dataset.wells.filter((well) => well.meltGroup === "Unknown").length,
  replicateReviewGroups: qcWorkspace.replicateQc.filter((group) => group.warningCodes.length > 0).length,
  wellLevelAlerts: qcWorkspace.specificWarnings.size,
  capturedPlateNotes: dataset.assumptions.filter((note) => note.startsWith("板布局备注")).length,
}, null, 2));
