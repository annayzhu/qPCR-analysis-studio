import { describe, expect, it } from "vitest";
import type { AnalysisSettings } from "../../schemas/src";
import { buildCanonicalDataset, parseDelimitedText } from "../../importers/src";
import {
  createAnalysisSession,
  previewAnalysisSessionChange,
  projectAnalysisSession,
  transitionAnalysisSession,
} from "./session";

const settings: AnalysisSettings = {
  referenceTargets: ["REF"],
  calibratorType: "sample",
  calibratorValue: "Control",
  replicateWarningThreshold: 0.5,
  tmWarningThreshold: 0.5,
  efficiencyByTarget: {},
  calculationMode: "delta-delta-cq",
};

function dependencies() {
  let sequence = 0;
  return {
    now: () => "2026-08-23T00:00:00.000Z",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
}

function shiftedDataset() {
  const result = parseDelimitedText(
    "Pos\tName\tCp\nA1\t1\t20.0\nA2\t2\t24.0\n",
    "instrument-result.txt",
  );
  const layout = parseDelimitedText(
    "Plate\tWell\tSample\tTarget\nPlate 01\tA1\tControl\tREF\nPlate 01\tA3\tControl\tGENE\n",
    "corrected-layout.tsv",
  );
  return buildCanonicalDataset([result, layout]);
}

describe("analysis session workflow", () => {
  it("projects supplied Delta Cq results without pretending missing Cq is an alignment issue", () => {
    const source = parseDelimitedText(
      "Plate\tWell\tSample\tAssay\tAssay Type\tReplicate\tDelta Cq\nPlate 01\tA1\tControl\tGENE\tTarget\t1\t3.0\nPlate 01\tA2\tControl\tGENE\tTarget\t2\t3.2\n",
      "delta-cq.tsv",
    );
    source.metadata.qpcrAnalysisStart = "delta-cq";
    const dataset = buildCanonicalDataset([source]);
    const state = createAnalysisSession(dataset, "quantification", {
      ...settings,
      referenceTargets: [],
      calibratorValue: "",
      calculationMode: "delta-cq",
    }, dependencies());
    const projected = projectAnalysisSession(state);

    expect(projected.alignmentReviewPending).toBe(false);
    expect(projected.blockingError).toBeNull();
    expect(projected.relativeResults).toEqual([]);
    expect(projected.suppliedResults[0]).toMatchObject({
      sampleName: "Control",
      targetName: "GENE",
      analysisStart: "delta-cq",
      deltaCq: 3.1,
    });
  });

  it("moves layout annotations without moving physical Cp, then atomically applies and recalculates", () => {
    const deps = dependencies();
    const imported = shiftedDataset();
    const source = imported.wells.find((well) => well.well === "A3")!;
    const destination = imported.wells.find((well) => well.well === "A2")!;
    const physicalCpBefore = new Map(imported.wells.map((well) => [well.id, well.cq]));
    let state = createAnalysisSession(imported, "quantification", settings, deps);

    const preview = previewAnalysisSessionChange(state, {
      type: "transfer-annotations",
      request: { mode: "move", sourceWellIds: [source.id], destinationAnchorWellId: destination.id },
      reason: "Correct shifted plate layout",
    });
    expect(preview).toMatchObject({ kind: "layout-transfer", result: { ok: true } });

    const changed = transitionAnalysisSession(state, {
      type: "transfer-annotations",
      request: { mode: "move", sourceWellIds: [source.id], destinationAnchorWellId: destination.id },
      reason: "Correct shifted plate layout",
    }, deps);
    expect(changed.ok).toBe(true);
    state = changed.state;
    expect(state.importedWells.find((well) => well.id === source.id)?.targetName).toBe("GENE");
    expect(state.appliedWells.find((well) => well.id === destination.id)?.targetName).toBe("");
    expect(state.draftWells.find((well) => well.id === destination.id)).toMatchObject({
      sampleName: "Control",
      targetName: "GENE",
      cq: 24,
    });
    expect(state.draftWells.every((well) => well.cq === physicalCpBefore.get(well.id))).toBe(true);
    const draftReadModel = projectAnalysisSession(state);
    expect(draftReadModel).toMatchObject({
      analysisLocked: true,
      alignmentReviewPending: false,
    });
    expect(draftReadModel.pendingCount).toBeGreaterThan(0);

    const applied = transitionAnalysisSession(state, {
      type: "apply",
      reason: "Apply layout snapshot and recalculate",
    }, deps);
    expect(applied.ok).toBe(true);
    expect(applied.state.appliedWells).toBe(applied.state.draftWells);
    expect(applied.state.dataset.wells).toBe(applied.state.appliedWells);
    expect(applied.state.appliedRevision).toBe(applied.state.revision);
    expect(applied.readModel).toMatchObject({ analysisLocked: false, pendingCount: 0 });
    expect(applied.readModel.relativeResults.find((row) => row.targetName === "GENE")).toMatchObject({
      sampleName: "Control",
      deltaCq: 4,
      relativeExpression: 1,
    });
    expect(applied.state.auditLogs.at(-1)).toMatchObject({ operation: "apply" });
  });

  it("rejects apply while alignment issues remain and leaves the session unchanged", () => {
    const deps = dependencies();
    const state = createAnalysisSession(shiftedDataset(), "quantification", settings, deps);
    const applied = transitionAnalysisSession(state, { type: "apply", reason: "apply" }, deps);

    expect(applied.ok).toBe(false);
    expect(applied.state).toBe(state);
    if (!applied.ok) {
      expect(applied.error.code).toBe("alignment-review-required");
      expect(applied.error.wellIds).toHaveLength(2);
    }
  });

  it("invalidates a reviewed alignment disposition when that well is edited", () => {
    const deps = dependencies();
    const imported = shiftedDataset();
    const a2 = imported.wells.find((well) => well.well === "A2")!;
    let state = createAnalysisSession(imported, "quantification", settings, deps);
    const reviewed = transitionAnalysisSession(state, {
      type: "record-alignment-dispositions",
      wellIds: [a2.id],
      reasonByIssueType: {
        "result-without-annotation": "Reviewed result-only well",
        "annotation-without-result": "Reviewed annotation-only well",
      },
    }, deps);
    expect(reviewed.ok).toBe(true);
    state = reviewed.state;
    expect(state.alignmentDispositions[a2.id]).toBe("result-without-annotation");

    const edited = transitionAnalysisSession(state, {
      type: "assign-annotations",
      assignments: [{ wellId: a2.id, changes: { sampleName: "Control", targetName: "GENE" } }],
      operation: "batch-edit",
      reason: "Add missing annotation",
    }, deps);
    expect(edited.ok).toBe(true);
    expect(edited.state.alignmentDispositions[a2.id]).toBeUndefined();
    expect(edited.state.pendingDispositionLogs).toHaveLength(0);
  });

  it("undoes a complete draft transition, including audit and dispositions", () => {
    const deps = dependencies();
    const imported = shiftedDataset();
    const a2 = imported.wells.find((well) => well.well === "A2")!;
    const state = createAnalysisSession(imported, "quantification", settings, deps);
    const edited = transitionAnalysisSession(state, {
      type: "assign-annotations",
      assignments: [{ wellId: a2.id, changes: { sampleName: "Control", targetName: "GENE" } }],
      operation: "batch-edit",
      reason: "Add missing annotation",
    }, deps);
    const undone = transitionAnalysisSession(edited.state, { type: "undo" }, deps);

    expect(undone.ok).toBe(true);
    expect(undone.state.draftWells).toBe(state.draftWells);
    expect(undone.state.pendingEditLogs).toEqual([]);
    expect(undone.state.pendingOperationLogs).toEqual([]);
    expect(undone.readModel.canUndo).toBe(false);
  });

  it("changes analysis settings against the applied snapshot, never an unapplied draft", () => {
    const deps = dependencies();
    const source = parseDelimitedText(
      "Well\tSample\tTarget\tCq\nA1\tControl\tREF\t20\nA2\tControl\tGENE\t24\n",
      "complete.tsv",
    );
    const imported = buildCanonicalDataset([source]);
    const gene = imported.wells.find((well) => well.targetName === "GENE")!;
    let state = createAnalysisSession(imported, "quantification", settings, deps);
    const edited = transitionAnalysisSession(state, {
      type: "assign-annotations",
      assignments: [{ wellId: gene.id, changes: { targetName: "OTHER" } }],
      operation: "batch-edit",
      reason: "Draft-only target rename",
    }, deps);
    state = edited.state;
    const configured = transitionAnalysisSession(state, {
      type: "configure-analysis",
      settings: { ...settings, calibratorValue: "", calculationMode: "delta-cq" },
    }, deps);

    expect(configured.readModel.relativeResults.map((row) => row.targetName)).toEqual(["GENE"]);
    expect(configured.state.draftWells.find((well) => well.id === gene.id)?.targetName).toBe("OTHER");
    expect(configured.state.appliedWells.find((well) => well.id === gene.id)?.targetName).toBe("GENE");
  });
});
