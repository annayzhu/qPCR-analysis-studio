import { describe, expect, it } from "vitest";
import { buildCanonicalDataset } from "./canonicalize";
import { inferFieldMappings } from "./field-mapping";
import { parseDelimitedText } from "./workbook";
import XLSX from "xlsx-js-style";
import {
  buildQpcrInputTemplateWorkbook,
  parseWorkbookBytes,
  QPCR_INPUT_TEMPLATE_HEADERS,
  validateAnalysisStartSource,
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
  it("offers one workbook-level analysis start and downstream calculation columns", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    const settings = XLSX.utils.sheet_to_json<Array<string | number>>(
      workbook.Sheets["Analysis Settings"],
      { header: 1 },
    );

    expect(workbook.SheetNames).toEqual(["Analysis Settings", "Data", "Example", "Field Dictionary"]);
    expect(settings).toEqual(expect.arrayContaining([
      ["Analysis Start / 分析起点", "Cq/Ct/Cp"],
      ["Allowed / 可选值", "Cq/Ct/Cp", "Delta Cq", "Delta Delta Cq"],
    ]));
    expect(QPCR_INPUT_TEMPLATE_HEADERS).toEqual(expect.arrayContaining([
      "Cycle Type", "Delta Cq", "Delta Delta Cq",
    ]));
    expect(workbook.Sheets["Field Dictionary"].B2?.v).toBe("2.1.0");
  });

  it("documents required fields separately for every analysis start", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    const settings = XLSX.utils.sheet_to_json<Array<string | number>>(
      workbook.Sheets["Analysis Settings"],
      { header: 1 },
    );
    const dictionary = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets["Field Dictionary"],
      { range: 6 },
    );

    expect(settings).toEqual(expect.arrayContaining([
      ["Cq/Ct/Cp required / 必填", "Well, Sample, Assay, Assay Type, Replicate, Cq/Ct/Cp"],
      ["Delta Cq required / 必填", "Sample, Assay, Replicate, Delta Cq"],
      ["Delta Delta Cq required / 必填", "Sample, Assay, Replicate, Delta Delta Cq"],
    ]));
    expect(dictionary.find((row) => row.Field === "Well")?.Requirement).toBe("Required for Cq start; optional for Delta starts");
    expect(dictionary.find((row) => row.Field === "Assay Type")?.Requirement).toBe("Required for Cq start; optional for Delta starts");
    expect(dictionary.find((row) => row.Field === "Sample")?.Requirement).toBe("Required for all starts");
  });

  it("validates a template from the selected Delta Cq start without requiring Cq values", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets["Analysis Settings"].B1.v = "Delta Cq";
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      [...QPCR_INPUT_TEMPLATE_HEADERS],
      ["Plate 01", 96, "A1", "Control", "GENE", "Target", 1, "Ct", "", 3.0, "", "", ""],
      ["Plate 01", 96, "A2", "Control", "GENE", "Target", 2, "Ct", "", 3.2, "", "", ""],
    ]);

    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const source = parseWorkbookBytes(bytes, "delta-cq-template.xlsx");
    const validation = validateQpcrInputTemplate(source);

    expect(source.metadata.qpcrAnalysisStart).toBe("delta-cq");
    expect(validation).toMatchObject({ totalRows: 2, detectedCount: 2, errorCount: 0 });
  });

  it("treats a Delta Cq template without an unused Cq column as a quantification source", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets["Analysis Settings"].B1.v = "Delta Cq";
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      ["Plate", "Plate Format", "Well", "Sample", "Assay", "Assay Type", "Replicate", "Delta Cq"],
      ["Plate 01", 96, "A1", "Control", "GENE", "Target", 1, 3.0],
      ["Plate 01", 96, "A2", "Control", "GENE", "Target", 2, 3.2],
    ]);

    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const source = parseWorkbookBytes(bytes, "delta-cq-without-cq-column.xlsx");

    expect(validateQpcrInputTemplate(source)).toMatchObject({ errorCount: 0 });
    expect(getSourceCapabilities(source)).toMatchObject({ role: "primary-result", hasCq: false });
    expect(assessImportReadiness([source])).toMatchObject({
      analysisMode: "quantification",
      canAnalyze: true,
    });
  });

  it("does not block a Delta start when optional Well synonyms conflict", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets["Analysis Settings"].B1.v = "Delta Cq";
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      ["Well", "Position", "Sample", "Assay", "Replicate", "Delta Cq"],
      ["A1", "A1", "Control", "GENE", 1, 3.0],
      ["A2", "A2", "Control", "GENE", 2, 3.2],
    ]);
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const source = parseWorkbookBytes(bytes, "delta-cq-optional-well-conflict.xlsx");

    expect(getSourceCapabilities(source).blockingConflicts).toEqual([]);
    expect(validateQpcrInputTemplate(source)).toMatchObject({ errorCount: 0 });
    expect(assessImportReadiness([source])).toMatchObject({ status: "ready", canAnalyze: true, layoutRequired: false });
  });

  it("does not silently use Cq when a generic source is switched to a Delta start", () => {
    const source = parseDelimitedText(
      "Well\tSample\tAssay\tReplicate\tCq\nA1\tControl\tGENE\t1\t23.0\n",
      "cq-only.tsv",
    );
    source.metadata.qpcrAnalysisStart = "delta-cq";

    expect(getSourceCapabilities(source).role).not.toBe("primary-result");
    expect(assessImportReadiness([source])).toMatchObject({ canAnalyze: false, status: "waiting-results" });
  });

  it("blocks a generic Delta source with missing required columns or row values", () => {
    const missingColumns = parseDelimitedText(
      "Delta Cq\n3.0\n",
      "delta-missing-columns.tsv",
    );
    missingColumns.metadata.qpcrAnalysisStart = "delta-cq";
    const blankValue = parseDelimitedText(
      "Sample\tAssay\tReplicate\tDelta Cq\nControl\tGENE\t1\t\n",
      "delta-blank-value.tsv",
    );
    blankValue.metadata.qpcrAnalysisStart = "delta-cq";

    expect(validateAnalysisStartSource(missingColumns)?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-column", column: "Sample" }),
      expect.objectContaining({ code: "missing-column", column: "Assay" }),
      expect.objectContaining({ code: "missing-column", column: "Replicate" }),
    ]));
    expect(validateAnalysisStartSource(blankValue)?.issues).toContainEqual(expect.objectContaining({
      code: "missing-value",
      sourceSheet: "Sheet1",
      sourceRowNumber: 2,
      column: "Delta Cq",
    }));
    expect(assessImportReadiness([missingColumns])).toMatchObject({ canAnalyze: false, status: "review-mapping" });
    expect(assessImportReadiness([blankValue])).toMatchObject({ canAnalyze: false, status: "review-mapping" });
  });

  it("does not validate an independent layout source as a Delta result after switching starts", () => {
    const result = parseDelimitedText(
      "Sample\tAssay\tReplicate\tDelta Cq\nControl\tGENE\t1\t3.0\n",
      "delta-result.tsv",
    );
    const layout = parseDelimitedText(
      "Well\tSample\tAssay\tAssay Type\nA1\tControl\tGENE\tTarget\n",
      "old-layout.tsv",
    );
    result.metadata.qpcrAnalysisStart = "delta-cq";
    layout.metadata.qpcrAnalysisStart = "delta-cq";

    expect(validateAnalysisStartSource(layout)).toBeNull();
    expect(assessImportReadiness([result, layout])).toMatchObject({
      canAnalyze: true,
      status: "ready",
      layoutRequired: false,
    });
  });

  it("blocks an unsupported analysis start instead of silently falling back to Cq", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets["Analysis Settings"].B1.v = "Start wherever data exists";
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const source = parseWorkbookBytes(bytes, "invalid-analysis-start.xlsx");
    const validation = validateQpcrInputTemplate(source)!;

    expect(source.metadata.qpcrAnalysisStart).toBe("invalid");
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "invalid-analysis-start",
      severity: "error",
      sourceSheet: "Analysis Settings",
      column: "Analysis Start",
    }));
    expect(assessImportReadiness([source])).toMatchObject({ canAnalyze: false, status: "review-mapping" });
  });

  it("contains the four specified sheets and exact canonical headers", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    expect(workbook.SheetNames).toEqual(["Analysis Settings", "Data", "Example", "Field Dictionary"]);
    const headers = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Data, { header: 1 })[0];
    expect(headers).toEqual(QPCR_INPUT_TEMPLATE_HEADERS);
    expect(workbook.Sheets["Field Dictionary"].A2?.v).toContain("Template Schema Version");
    expect(workbook.Sheets["Field Dictionary"].B2?.v).toBe("2.1.0");
  });

  it("blocks malformed rows with row-specific template diagnostics", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      [...QPCR_INPUT_TEMPLATE_HEADERS],
      ["Plate 01", 96, "Z99", "S01", "GENE", "Target", 0, "bad", "warm", ""],
      ["Plate 01", 96, "A1", "S01", "GENE", "Target", 1, 22.1, 84.1, ""],
      ["Plate 01", 96, "A1", "S01", "GENE", "Target", 1, 22.2, 84.2, ""],
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

  it("blocks blank Plate cells when the same template contains a named plate", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      [...QPCR_INPUT_TEMPLATE_HEADERS],
      ["Plate 01", 96, "A1", "S01", "REF", "Reference", 1, 20, "", ""],
      ["", 96, "A2", "S01", "GENE", "Target", 1, 23, "", ""],
    ]);
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const validation = validateQpcrInputTemplate(parseWorkbookBytes(bytes, "mixed-plate-template.xlsx"))!;

    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "missing-plate",
      severity: "error",
      sourceRowNumber: 3,
      column: "Plate",
    }));
  });

  it("rejects a 384-only coordinate when Plate Format explicitly selects 96 wells", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      [...QPCR_INPUT_TEMPLATE_HEADERS],
      ["Plate 01", 96, "A13", "S01", "GENE", "Target", 1, 22.1, "", ""],
    ]);
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const validation = validateQpcrInputTemplate(parseWorkbookBytes(bytes, "96-well-template.xlsx"))!;

    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: "invalid-well",
      suppliedValue: "A13",
    }));
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
    expect(dataset.plate!.plateFormat).toBe(96);
    expect(dataset.plate!.requiresConfirmation).toBe(true);
  });

  it("detects complete 384-well boundaries", () => {
    const source = parseDelimitedText("Well\tSample\tTarget\tCq\nA1\tS1\tG1\t20\nP24\tS2\tG1\t21\n", "plate.tsv");
    const dataset = buildCanonicalDataset([source]);
    expect(dataset.plate!.plateFormat).toBe(384);
    expect(dataset.plate!.requiresConfirmation).toBe(false);
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

  it("reports ambiguous plate identity and incomplete replicate groups as distinct diagnostics", () => {
    const resultOne = parseDelimitedText("Pos\tName\tCp\nA1\t1\t20\n", "result-one.txt");
    const resultTwo = parseDelimitedText("Pos\tName\tCp\nA1\t1\t21\n", "result-two.txt");
    const layout = parseDelimitedText(
      "Plate\tWell\tSample\tTarget\tReplicate\nNamed plate\tA1\tS1\tGENE\t1\nNamed plate\tA2\tS1\tGENE\t3\n",
      "layout.tsv",
    );
    const alignment = assessDatasetAlignment(buildCanonicalDataset([resultOne, resultTwo, layout]), "quantification");

    expect(alignment.plateIdentityConflicts).toHaveLength(1);
    expect(alignment.incompleteReplicateGroups).toContainEqual(expect.objectContaining({
      sampleName: "S1",
      targetName: "GENE",
    }));
  });
});
