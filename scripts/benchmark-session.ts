/** Synthetic, de-identified workload. Run with node --import tsx scripts/benchmark-session.ts. */
import { performance } from "node:perf_hooks";
import { buildCanonicalDataset, parseDelimitedText } from "../packages/importers/src";
import * as session from "../packages/analysis-session/src";
import type { AnalysisSettings } from "../packages/schemas/src";

const settings: AnalysisSettings = {
  referenceTargets: ["REF"], calibratorType: "sample", calibratorValue: "S1",
  replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5,
  efficiencyByTarget: {}, calculationMode: "delta-delta-cq",
};
const trials = 15;
function measure(run: () => void, prepare = () => {}) {
  for (let i = 0; i < 3; i++) { prepare(); run(); }
  const times = Array.from({ length: trials }, () => {
    prepare();
    const start = performance.now(); run(); return performance.now() - start;
  }).sort((a, b) => a - b);
  return { medianMs: +times[Math.floor(trials / 2)].toFixed(3), p95Ms: +times.at(-1)!.toFixed(3) };
}
for (const plates of [1, 10]) {
  const rows = ["Plate\tWell\tSample\tTarget\tReplicate\tCq"];
  for (let p = 0; p < plates; p++) for (let r = 0; r < 16; r++) for (let c = 1; c <= 24; c++) {
    rows.push(`P${p + 1}\t${String.fromCharCode(65 + r)}${c}\tS${r + 1}\t${c <= 3 ? "REF" : `G${Math.floor((c - 1) / 3)}`}\t${(c - 1) % 3 + 1}\t${20 + c / 10 + p / 100}`);
  }
  const data = buildCanonicalDataset([parseDelimitedText(rows.join("\n"), "benchmark.tsv")]);
  const state = session.createAnalysisSession(data, "quantification", settings);
  const command: session.AnalysisSessionCommand = {
    type: "assign-annotations", operation: "batch-edit", reason: "Synthetic benchmark",
    assignments: state.draftWells.slice(0, 384).map(well => ({ wellId: well.id, changes: { sampleName: `edited-${well.sampleName}` } })),
  };
  // The fallback allows exactly the same harness to run against the pre-refactor API.
  const projector = session.createAnalysisSessionProjector?.() ?? session.projectAnalysisSession;
  projector(state);
  console.log(JSON.stringify({ plates, wells: data.wells.length, trials,
    transition: measure(() => { session.transitionAnalysisSession(state, command); }),
    editAndRender: measure(() => { projector(session.transitionAnalysisSession(state, command).state); }, () => { projector(state); }),
    repeatedProjection: measure(() => { projector(state); }),
  }));
}
