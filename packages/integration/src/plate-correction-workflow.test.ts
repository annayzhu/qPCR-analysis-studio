import { describe, expect, it } from "vitest";
import {
  assessDatasetAlignment,
  buildCanonicalDataset,
  getAnalysisBlockingError,
  parseDelimitedText,
} from "../../importers/src";
import {
  calculateRelativeQuantification,
  previewLayoutTransfer,
  restoreWellsToBaseline,
  transferLayoutAnnotations,
  updateWellFields,
} from "../../qpcr-core/src";

describe("plate-layout correction workflow", () => {
  it("imports a shifted layout, relocates annotations, and recalculates without moving physical Cp", () => {
    const result = parseDelimitedText(
      "Pos\tName\tCp\nA1\t1\t20.0\nA2\t2\t24.0\n",
      "instrument-result.txt",
    );
    const shiftedLayout = parseDelimitedText(
      "Plate\tWell\tSample\tTarget\nPlate 01\tA1\tControl\tREF\nPlate 01\tA3\tControl\tGENE\n",
      "corrected-layout.tsv",
    );
    const imported = buildCanonicalDataset([result, shiftedLayout]);
    const initialAlignment = assessDatasetAlignment(imported, "quantification");

    expect(initialAlignment.status).toBe("needs-correction");
    expect(initialAlignment.resultWithoutAnnotation.map((issue) => issue.well)).toEqual(["A2"]);
    expect(initialAlignment.annotationWithoutResult.map((issue) => issue.well)).toEqual(["A3"]);

    const source = imported.wells.find((well) => well.well === "A3")!;
    const destination = imported.wells.find((well) => well.well === "A2")!;
    const physicalCpBefore = new Map(imported.wells.map((well) => [well.id, well.cq]));
    const corrected = transferLayoutAnnotations(imported.wells, {
      mode: "move",
      sourceWellIds: [source.id],
      destinationAnchorWellId: destination.id,
      timestamp: "2026-08-21T00:00:00Z",
    });

    expect(corrected.ok).toBe(true);
    expect(corrected.wells.every((well) => well.cq === physicalCpBefore.get(well.id))).toBe(true);
    expect(imported.wells.find((well) => well.well === "A3")?.targetName).toBe("GENE");
    expect(corrected.wells.find((well) => well.well === "A2")).toMatchObject({
      sampleName: "Control",
      targetName: "GENE",
      cq: 24,
    });

    const correctedDataset = { ...imported, wells: corrected.wells };
    expect(assessDatasetAlignment(correctedDataset, "quantification").status).toBe("aligned");
    expect(getAnalysisBlockingError(correctedDataset, "quantification")).toBeNull();

    const analysis = calculateRelativeQuantification(corrected.wells, {
      referenceTargets: ["REF"],
      calibratorType: "sample",
      calibratorValue: "Control",
      replicateWarningThreshold: 0.5,
      tmWarningThreshold: 0.5,
      efficiencyByTarget: {},
      calculationMode: "delta-delta-cq",
    });
    expect(analysis.find((row) => row.targetName === "GENE")).toMatchObject({
      sampleName: "Control",
      deltaCq: 4,
      relativeExpression: 1,
    });
  });

  it("previews collisions and out-of-bounds transfers before mutating any annotation or measurement", () => {
    const source = parseDelimitedText(
      "Plate\tWell\tSample\tTarget\tCq\nPlate 01\tA1\tS01\tREF\t20\nPlate 01\tA2\tS01\tGENE\t22\nPlate 01\tH12\tS02\tGENE\t24\n",
      "synthetic.tsv",
    );
    const wells = buildCanonicalDataset([source]).wells;
    const snapshot = structuredClone(wells);
    const a1 = wells.find((well) => well.well === "A1")!;
    const a2 = wells.find((well) => well.well === "A2")!;
    const h12 = wells.find((well) => well.well === "H12")!;

    expect(previewLayoutTransfer(wells, {
      mode: "copy", sourceWellIds: [a1.id], destinationAnchorWellId: a2.id,
    })).toMatchObject({ ok: false, error: "collision", collisionWellIds: [a2.id] });
    expect(previewLayoutTransfer(wells, {
      mode: "copy", sourceWellIds: [a1.id, a2.id], destinationAnchorWellId: h12.id,
    })).toMatchObject({ ok: false, error: "out-of-bounds" });
    expect(wells).toEqual(snapshot);
  });

  it("copies, swaps, clears, and restores annotations while keeping raw Cq on physical wells", () => {
    const result = parseDelimitedText("Pos\tName\tCp\nA1\t1\t20\nA2\t2\t21\nA3\t3\t22\n", "instrument.txt");
    const layout = parseDelimitedText(
      "Plate\tWell\tSample\tTarget\nPlate 01\tA1\tS01\tREF\nPlate 01\tA2\tS01\tGENE\n",
      "layout.tsv",
    );
    const baseline = buildCanonicalDataset([result, layout]).wells;
    const cpById = new Map(baseline.map((well) => [well.id, well.cq]));
    const a1 = baseline.find((well) => well.well === "A1")!;
    const a2 = baseline.find((well) => well.well === "A2")!;
    const a3 = baseline.find((well) => well.well === "A3")!;

    const copied = transferLayoutAnnotations(baseline, {
      mode: "copy", sourceWellIds: [a2.id], destinationAnchorWellId: a3.id,
    });
    expect(copied.ok).toBe(true);
    expect(copied.wells.find((well) => well.id === a2.id)?.targetName).toBe("GENE");
    expect(copied.wells.find((well) => well.id === a3.id)?.targetName).toBe("GENE");

    const swapped = transferLayoutAnnotations(copied.wells, {
      mode: "swap", sourceWellIds: [a1.id], destinationAnchorWellId: a3.id,
    });
    expect(swapped.ok).toBe(true);
    expect(swapped.wells.find((well) => well.id === a1.id)?.targetName).toBe("GENE");
    expect(swapped.wells.find((well) => well.id === a3.id)?.targetName).toBe("REF");

    const cleared = updateWellFields(swapped.wells, [a1.id], {
      sampleName: "", targetName: "", taskType: "Unknown", replicate: null,
    });
    expect(cleared.wells.find((well) => well.id === a1.id)).toMatchObject({ sampleName: "", targetName: "", cq: 20 });
    const restored = restoreWellsToBaseline(cleared.wells, baseline, [a1.id, a3.id], "restore synthetic baseline");
    expect(restored.wells.find((well) => well.id === a1.id)?.targetName).toBe("REF");
    expect(restored.wells.find((well) => well.id === a3.id)?.targetName).toBe("");
    expect(restored.wells.every((well) => well.cq === cpById.get(well.id))).toBe(true);
  });
});
