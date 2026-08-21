import { describe, expect, it } from "vitest";
import { buildCanonicalDataset } from "./canonicalize";
import { inferFieldMappings } from "./field-mapping";
import { parseDelimitedText } from "./workbook";
import XLSX from "xlsx-js-style";
import {
  buildQpcrInputTemplateWorkbook,
  parseWorkbookBytes,
  QPCR_INPUT_TEMPLATE_HEADERS,
  validateQpcrInputTemplate,
} from "./index";
import {
  assessDatasetAlignment,
  assessImportReadiness,
  getAnalysisBlockingError,
  getUnresolvedAlignmentIssues,
  getSourceCapabilities,
} from "./readiness";

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

describe("qPCR user input template", () => {
  it("contains the three specified sheets and exact canonical headers", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    expect(workbook.SheetNames).toEqual(["Data", "Example", "Field Dictionary"]);
    const headers = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Data, { header: 1 })[0];
    expect(headers).toEqual(QPCR_INPUT_TEMPLATE_HEADERS);
    expect(workbook.Sheets["Field Dictionary"].A2?.v).toContain("Template Schema Version");
    expect(workbook.Sheets["Field Dictionary"].B2?.v).toBe("1.0.0");
  });

  it("blocks malformed rows with row-specific template diagnostics", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      [...QPCR_INPUT_TEMPLATE_HEADERS],
      ["Plate 01", "Z99", "S01", "GENE", "Target", 0, "bad", "warm", ""],
      ["Plate 01", "A1", "S01", "GENE", "Target", 1, 22.1, 84.1, ""],
      ["Plate 01", "A1", "S01", "GENE", "Target", 1, 22.2, 84.2, ""],
    ]);
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const source = parseWorkbookBytes(bytes, "invalid-template.xlsx");
    const validation = validateQpcrInputTemplate(source)!;
    expect(validation.errorCount).toBeGreaterThanOrEqual(4);
    expect(validation.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "invalid-well", "invalid-replicate", "invalid-number", "duplicate-well", "duplicate-replicate",
    ]));
    expect(validation.issues.find((item) => item.code === "invalid-well")).toMatchObject({
      sourceSheet: "Data", sourceRowNumber: 2, column: "Well", suppliedValue: "Z99",
    });
    expect(assessImportReadiness([source])).toMatchObject({ status: "review-mapping", canAnalyze: false });
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

  it("joins a plate-less Roche Cp result to the single named corrected layout", () => {
    const result = parseDelimitedText(
      "Experiment: Demo  Selected Filter: 465-510\r\nInclude\tColor\tPos\tName\tCp\tConcentration\tStandard\tStatus\r\nTrue\t255\tA1\tSample 1\t16.33\t\t0\t\r\nTrue\t255\tA2\tSample 2\t24.99\t\t0\t\r\n",
      "roche-cp.txt",
    );
    const layout = parseDelimitedText(
      "Plate Name\tWell\tSample Name\tTarget Name\nqPCR Plate 01\tA1\tSYNTHETIC_01\tREF1\nqPCR Plate 01\tA2\tSYNTHETIC_01\tGENE_A\n",
      "corrected-layout.tsv",
    );

    const dataset = buildCanonicalDataset([result, layout]);

    expect(dataset.wells).toHaveLength(2);
    expect(dataset.wells.map((well) => ({
      well: well.well,
      sampleName: well.sampleName,
      targetName: well.targetName,
      cq: well.cq,
    }))).toEqual([
      { well: "A1", sampleName: "SYNTHETIC_01", targetName: "REF1", cq: 16.33 },
      { well: "A2", sampleName: "SYNTHETIC_01", targetName: "GENE_A", cq: 24.99 },
    ]);
  });

  it("does not collapse multiple anonymous Cp result files onto one named layout plate", () => {
    const resultOne = parseDelimitedText("Pos\tName\tCp\nA1\t1\t20.1\n", "plate-one-cp.txt");
    const resultTwo = parseDelimitedText("Pos\tName\tCp\nA1\t1\t23.4\n", "plate-two-cp.txt");
    const layout = parseDelimitedText(
      "Plate\tWell\tSample\tTarget\nNamed Layout\tA1\tS01\tREF\n",
      "layout.tsv",
    );

    const dataset = buildCanonicalDataset([resultOne, resultTwo, layout]);

    expect(dataset.wells).toHaveLength(3);
    expect(dataset.wells.filter((well) => well.well === "A1").map((well) => well.cq)).toEqual(expect.arrayContaining([20.1, 23.4, null]));
    expect(new Set(dataset.wells.map((well) => well.plateId)).size).toBe(3);
    expect(dataset.warnings.join(" ")).toContain("无法自动判断板布局对应哪一个结果文件");
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

  it("blocks quantification when Cp values did not join to annotated wells", () => {
    const result = parseDelimitedText(
      "Pos\tName\tCp\nA1\t1\t20.1\nA2\t2\t22.4\n",
      "roche-cp.txt",
    );
    const twoPlateLayout = parseDelimitedText(
      "Plate\tWell\tSample\tTarget\nPlate A\tA1\tS01\tGAPDH\nPlate B\tA2\tS01\tGENE1\n",
      "ambiguous-layout.tsv",
    );
    const dataset = buildCanonicalDataset([result, twoPlateLayout]);

    expect(getAnalysisBlockingError(dataset, "quantification")).toBe(
      "未找到与样本和基因正确合并的有效 Cq/Ct/Cp。请检查结果文件与板布局的板名和孔位是否对应。",
    );
  });

  it("requires alignment review when detected Cp and imported annotations occupy different wells", () => {
    const result = parseDelimitedText(
      "Pos\tName\tCp\nA1\t1\t20.1\nA2\t2\t21.2\n",
      "instrument-result.txt",
    );
    const shiftedLayout = parseDelimitedText(
      "Plate\tWell\tSample\tTarget\nPlate 01\tA1\tS01\tREF\nPlate 01\tA3\tS01\tGENE\n",
      "corrected-layout.tsv",
    );
    const dataset = buildCanonicalDataset([result, shiftedLayout]);

    const alignment = assessDatasetAlignment(dataset, "quantification");

    expect(alignment.status).toBe("needs-correction");
    expect(alignment.joinedDetectedCount).toBe(1);
    expect(alignment.resultWithoutAnnotation.map((issue) => issue.well)).toEqual(["A2"]);
    expect(alignment.annotationWithoutResult.map((issue) => issue.well)).toEqual(["A3"]);
    expect(dataset.wells.find((well) => well.well === "A2")?.cq).toBe(21.2);

    expect(getUnresolvedAlignmentIssues(alignment, [])).toHaveLength(2);
    expect(getUnresolvedAlignmentIssues(alignment, [
      alignment.resultWithoutAnnotation[0].wellId,
      alignment.annotationWithoutResult[0].wellId,
    ])).toHaveLength(0);
  });
});
