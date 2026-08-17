import { describe, expect, it } from "vitest";
import { buildCanonicalDataset } from "./canonicalize";
import { inferFieldMappings } from "./field-mapping";
import { parseDelimitedText } from "./workbook";
import { assessImportReadiness, getSourceCapabilities } from "./readiness";

describe("field mapping", () => {
  it("maps English and Chinese synonyms while keeping mean Cq separate", () => {
    const mappings = inferFieldMappings(
      ["样本编号", "Assay", "Well Position", "Ct", "CT Mean"],
      [["S01", "GAPDH", "A01", 22.4, 22.5]],
    );
    expect(mappings.map((mapping) => mapping.canonicalField)).toEqual([
      "sampleName", "targetName", "well", "cq", "cqMean",
    ]);
  });
});

describe("Roche LightCycler 480 adapter", () => {
  it("recognizes Cp export and treats Roche Cp=0 as non-detected", () => {
    const source = parseDelimitedText(
      "Experiment: Demo  Selected Filter: 465-510\r\nInclude\tColor\tPos\tName\tCp\tConcentration\tStandard\tStatus\r\n1\t\tA1\tSample 1\t22.5\t0\t0\tPassed\r\n1\t\tA2\tSample 2\t0\t0\t0\tPassed\r\n",
      "demo.txt",
    );
    expect(source.adapterId).toBe("roche-lightcycler-480:cq-results");
    const dataset = buildCanonicalDataset([source]);
    expect(dataset.wells[0].cq).toBe(22.5);
    expect(dataset.wells[1].cq).toBeNull();
    expect(dataset.wells[1].cqStatus).toBe("not-detected");
    expect(dataset.plate.plateFormat).toBe(96);
    expect(dataset.plate.requiresConfirmation).toBe(true);
  });

  it("detects complete 384-well boundaries", () => {
    const source = parseDelimitedText("Well\tSample\tTarget\tCq\nA1\tS1\tG1\t20\nP24\tS2\tG1\t21\n", "plate.tsv");
    const dataset = buildCanonicalDataset([source]);
    expect(dataset.plate.plateFormat).toBe(384);
    expect(dataset.plate.requiresConfirmation).toBe(false);
  });

  it("keeps the same well position separate when a Plate column is present", () => {
    const source = parseDelimitedText(
      "Plate\tWell\tSample\tTarget\tCq\nPlate 01\tA1\tS7\tGAPDH\t20\nPlate 02\tA1\tS7\tGAPDH\t25\n",
      "two-plates.tsv",
    );
    const dataset = buildCanonicalDataset([source]);
    expect(dataset.wells).toHaveLength(2);
    expect(new Set(dataset.wells.map((well) => well.plateId)).size).toBe(2);
    expect(dataset.assumptions.join(" ")).toContain("检测到 2 块板");
  });
});

describe("staged import readiness", () => {
  it("skips a separate layout when the primary result already contains sample and target", () => {
    const source = parseDelimitedText(
      "Well\tSample\tTarget\tCq\nA1\tS01\tGAPDH\t20.1\nA2\tS01\tGENE1\t22.4\n",
      "complete-result.tsv",
    );
    expect(getSourceCapabilities(source).includesPlateLayout).toBe(true);
    expect(assessImportReadiness([source])).toMatchObject({
      status: "ready",
      canAnalyze: true,
      analysisMode: "quantification",
      resultIncludesPlateLayout: true,
      layoutRequired: false,
    });
  });

  it("requires a plate layout when the instrument result only identifies wells", () => {
    const result = parseDelimitedText(
      "Pos\tName\tCp\nA1\t1\t20.1\nA2\t1\t22.4\n",
      "roche-cp.txt",
    );
    expect(assessImportReadiness([result])).toMatchObject({
      status: "waiting-layout",
      canAnalyze: false,
      layoutRequired: true,
    });

    const layout = parseDelimitedText(
      "Well\tSample Name\tTarget Name\nA1\tS01\tGAPDH\nA2\tS01\tGENE1\n",
      "layout.tsv",
    );
    expect(assessImportReadiness([result, layout])).toMatchObject({
      status: "ready",
      canAnalyze: true,
      analysisMode: "quantification",
      resultIncludesPlateLayout: false,
      layoutCount: 1,
    });
  });

  it("allows a Tm-only result to proceed after a separate layout is supplied", () => {
    const tm = parseDelimitedText("Pos\tName\tTm1\nA1\t1\t82.4\n", "tm.txt");
    expect(getSourceCapabilities(tm).role).toBe("supplemental-result");
    expect(assessImportReadiness([tm])).toMatchObject({
      status: "waiting-layout",
      canAnalyze: false,
      analysisMode: "melt-only",
    });
    const layout = parseDelimitedText(
      "Well\tSample Name\tTarget Name\nA1\tS01\tGENE1\n",
      "layout.tsv",
    );
    expect(assessImportReadiness([tm, layout])).toMatchObject({
      status: "ready",
      canAnalyze: true,
      analysisMode: "melt-only",
    });
  });
});
