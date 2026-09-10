import { describe, expect, it } from "vitest";
import { buildCanonicalDataset, parseDelimitedText } from "../../importers/src";
import { createAnalysisSession, transitionAnalysisSession, type AnalysisSessionState } from "./session";
import { createAnalysisSessionProjector, projectAnalysisSession } from "./projection";

function fixture() {
  const data = buildCanonicalDataset([parseDelimitedText(
    "Plate\tWell\tSample\tTarget\tReplicate\tCq\nP1\tA1\tControl\tREF\t1\t20\nP1\tA2\tControl\tGENE\t1\t24\nP1\tA3\tTreated\tREF\t1\t20\nP1\tA4\tTreated\tGENE\t1\t23\n",
    "synthetic.tsv",
  )]);
  return createAnalysisSession(data, "quantification", {
    referenceTargets: ["REF"], calibratorType: "sample", calibratorValue: "Control",
    replicateWarningThreshold: .5, tmWarningThreshold: .5, efficiencyByTarget: {}, calculationMode: "delta-delta-cq",
  });
}

describe("session projection dependencies", () => {
  it("reuses applied analysis while editing a draft, then recalculates after apply", () => {
    const project = createAnalysisSessionProjector();
    const initial = fixture();
    const before = project(initial);
    expect(before.draftQcState).toBe(before.appliedQcState);
    expect(project(initial)).toBe(before);
    const edited = transitionAnalysisSession(initial, {
      type: "assign-annotations", operation: "batch-edit", reason: "Rename",
      assignments: [{ wellId: initial.draftWells[3].id, changes: { targetName: "OTHER" } }],
    });
    expect(edited).not.toHaveProperty("readModel");
    const draft = project(edited.state);
    expect(draft).toEqual(projectAnalysisSession(edited.state));
    expect(draft.relativeResults).toBe(before.relativeResults);
    expect(draft.appliedQcState).toBe(before.appliedQcState);
    expect(draft.draftQcState).not.toBe(before.draftQcState);
    expect(draft.analysisLocked).toBe(true);
    const applied = transitionAnalysisSession(edited.state, { type: "apply", reason: "Apply" });
    expect(applied.ok).toBe(true);
    const after = project(applied.state);
    expect(after).toEqual(projectAnalysisSession(applied.state));
    expect(after.appliedQcState).toBe(draft.draftQcState);
    expect(after.relativeResults).not.toBe(before.relativeResults);
    expect(after.relativeResults.some(row => row.targetName === "OTHER")).toBe(true);
    expect(after.analysisLocked).toBe(false);
  });

  it("reuses QC on settings changes but invalidates results and observes undo/failures", () => {
    const project = createAnalysisSessionProjector();
    const initial = fixture();
    const before = project(initial);
    const configured = transitionAnalysisSession(initial, { type: "configure-analysis", settings: { ...initial.settings, calibratorValue: "Treated" } });
    const configuredView = project(configured.state);
    expect(configuredView.relativeResults).not.toBe(before.relativeResults);
    expect(configuredView.appliedQcState).toBe(before.appliedQcState);
    expect(configuredView).toEqual(projectAnalysisSession(configured.state));
    const excluded = transitionAnalysisSession(configured.state, { type: "set-exclusion", wellIds: [initial.draftWells[0].id], excluded: true, reason: "Review" });
    project(excluded.state);
    const undone = transitionAnalysisSession(excluded.state, { type: "undo" });
    expect(project(undone.state)).toEqual(projectAnalysisSession(undone.state));
    const failed = transitionAnalysisSession(undone.state, { type: "undo" });
    expect(failed.ok).toBe(false);
    expect(failed).not.toHaveProperty("readModel");
    expect(project(failed.state)).toBe(project(undone.state));
  });

  it("invalidates alignment on provenance/disposition changes, and isolates workspace instances", () => {
    const project = createAnalysisSessionProjector();
    const initial = fixture();
    project(initial);
    const changed = { ...initial, dataset: { ...initial.dataset, warnings: ["plate identity conflict"] } };
    expect(project(changed).draftAlignment.plateIdentityConflicts).toEqual(["plate identity conflict"]);
    expect(project(changed)).toEqual(projectAnalysisSession(changed));
    const another = createAnalysisSessionProjector();
    expect(another(initial)).toEqual(projectAnalysisSession(initial));
    expect(another(initial)).not.toBe(project(initial));
  });

  it.each(["delta-cq", "delta-delta-cq"] as const)("keeps supplied %s provenance separate from upstream calculations", analysisStart => {
    const data = buildCanonicalDataset([parseDelimitedText(
      `Sample\tAssay\tAssay Type\tReplicate\t${analysisStart === "delta-cq" ? "Delta Cq" : "Delta Delta Cq"}\nControl\tGENE\tTarget\t1\t3\nControl\tGENE\tTarget\t2\t3.2\n`,
      "supplied.tsv",
    )]);
    // Input-stage policy is explicit, never inferred from an available Cq column.
    const source = data.sources[0];
    source.metadata.qpcrAnalysisStart = analysisStart;
    const imported = buildCanonicalDataset([source]);
    const initial = createAnalysisSession(imported, "quantification", fixture().settings);
    const project = createAnalysisSessionProjector();
    const before = project(initial);
    expect(before.suppliedResults).toHaveLength(1);
    expect(before.relativeResults).toEqual([]);
    const change: AnalysisSessionState = { ...initial, settings: { ...initial.settings, referenceTargets: ["OTHER"] } };
    expect(project(change).suppliedResults).toBe(before.suppliedResults);
    const newCalibrator = { ...change, settings: { ...change.settings, calibratorValue: "" } };
    expect(project(newCalibrator)).toEqual(projectAnalysisSession(newCalibrator));
    expect(project(newCalibrator).suppliedResults).not.toBe(before.suppliedResults);
  });
});
