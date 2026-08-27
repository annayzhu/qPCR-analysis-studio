import { describe, expect, it } from "vitest";
import XLSX from "xlsx-js-style";
import {
  buildCanonicalDataset,
  buildQpcrInputTemplateWorkbook,
  assessImportReadiness,
  parseWorkbookBytes,
  QPCR_INPUT_TEMPLATE_HEADERS,
  validateQpcrInputTemplate,
} from "../../importers/src";
import {
  buildSuppliedCompleteRows,
  buildSuppliedTraceabilityRows,
  SUPPLIED_EXPORT_DICTIONARY,
  SUPPLIED_COMPLETE_HEADERS,
  SUPPLIED_RESULTS_EXPORT_SCHEMA_VERSION,
  SUPPLIED_TRACEABILITY_HEADERS,
  buildCompleteResultRows,
  buildCalculationExportBundle,
  buildCalculationWorkbookBytes,
  buildVisualizationBarRows,
  calculateRelativeQuantification,
  calculateFromSuppliedCalculations,
  COMPLETE_RESULTS_HEADERS,
  VISUALIZATION_BAR_HEADERS,
} from "../../qpcr-core/src";
import { createAnalysisSession, projectAnalysisSession } from "../../analysis-session/src";

function filledTemplateBytes(): ArrayBuffer {
  const workbook = buildQpcrInputTemplateWorkbook();
  const rows: Array<Array<string | number>> = [
    [...QPCR_INPUT_TEMPLATE_HEADERS],
    ["Plate 01", 96, "A1", "Control", "REF", "Reference", 1, "Cq", 20.0, "", "", 82.1, ""],
    ["Plate 01", 96, "A2", "Control", "REF", "Reference", 2, "Cq", 20.2, "", "", 82.2, ""],
    ["Plate 01", 96, "A3", "Control", "GENE", "Target", 1, "Cq", 23.0, "", "", 84.1, ""],
    ["Plate 01", 96, "A4", "Control", "GENE", "Target", 2, "Cq", 23.2, "", "", 84.2, ""],
    ["Plate 01", 96, "B1", "Treat", "REF", "Reference", 1, "Cq", 20.1, "", "", 82.1, ""],
    ["Plate 01", 96, "B2", "Treat", "REF", "Reference", 2, "Cq", 20.3, "", "", 82.2, ""],
    ["Plate 01", 96, "B3", "Treat", "GENE", "Target", 1, "Cq", 22.1, "", "", 84.1, ""],
    ["Plate 01", 96, "B4", "Treat", "GENE", "Target", 2, "Cq", 22.3, "", "", 84.2, ""],
  ];
  workbook.Sheets.Data = XLSX.utils.aoa_to_sheet(rows);
  return XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true }) as ArrayBuffer;
}

describe("downloadable template to complete-results export", () => {
  it("preserves supplied-calculation reference provenance without renormalizing Delta Cq", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets["Analysis Settings"].B1.v = "Delta Cq";
    XLSX.utils.sheet_add_aoa(workbook.Sheets["Analysis Settings"], [
      ["Reference Target(s) / 内参基因", "GAPDH; ACTB"],
      ["Reference Method / 内参处理方法", "Geometric mean of relative quantities"],
      ["Calibrator / 校准样本", "Control"],
    ], { origin: -1 });
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      ["Sample", "Assay", "Replicate", "Delta Cq"],
      ["Control", "GENE", 1, 3.0],
      ["Control", "GENE", 2, 3.2],
    ]);
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const source = parseWorkbookBytes(bytes, "delta-cq-with-reference-provenance.xlsx");
    const dataset = buildCanonicalDataset([source]);

    expect(source.metadata).toMatchObject({
      qpcrReferenceTargets: "GAPDH; ACTB",
      qpcrReferenceMethod: "Geometric mean of relative quantities",
      qpcrCalibratorValue: "Control",
    });
    expect(dataset.suppliedCalculationProvenance).toEqual({
      referenceTargets: ["GAPDH", "ACTB"],
      referenceMethod: "Geometric mean of relative quantities",
      calibratorValue: "Control",
    });

    const results = calculateFromSuppliedCalculations(dataset.suppliedCalculations, {
      analysisStart: "delta-cq",
      calibratorValue: "Alternate downstream calibrator",
    });
    expect(results[0].deltaCq).toBeCloseTo(3.1);
    const [complete] = buildSuppliedCompleteRows(results, ["Control"], ["GENE"], dataset.suppliedCalculationProvenance);
    expect(complete).toMatchObject({
      reference_targets: "GAPDH; ACTB",
      reference_method: "Geometric mean of relative quantities",
      calibrator: "Alternate downstream calibrator",
      source_calibrator: "Control",
    });
    const [trace] = buildSuppliedTraceabilityRows(dataset.suppliedCalculations, dataset.suppliedCalculationProvenance);
    expect(trace).toMatchObject({
      reference_targets: "GAPDH; ACTB",
      reference_method: "Geometric mean of relative quantities",
      source_calibrator: "Control",
    });
    expect(SUPPLIED_RESULTS_EXPORT_SCHEMA_VERSION).toBe("1.1.0");
    expect(new Set(SUPPLIED_EXPORT_DICTIONARY.filter((entry) => entry.sheet === "Complete Results").map((entry) => entry.field)))
      .toEqual(new Set(SUPPLIED_COMPLETE_HEADERS));
    expect(new Set(SUPPLIED_EXPORT_DICTIONARY.filter((entry) => entry.sheet === "Supplied Values").map((entry) => entry.field)))
      .toEqual(new Set(SUPPLIED_TRACEABILITY_HEADERS));
  });

  it("keeps supplied-provenance warnings out of raw-Cq workflows", () => {
    const makeSource = (referenceTargets: string, method: string, calibrator: string, suffix: string) => {
      const workbook = buildQpcrInputTemplateWorkbook();
      workbook.Sheets["Analysis Settings"].B2.v = referenceTargets;
      workbook.Sheets["Analysis Settings"].B3.v = method;
      workbook.Sheets["Analysis Settings"].B4.v = calibrator;
      workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
        ["Plate", "Well", "Sample", "Assay", "Assay Type", "Replicate", "Cq/Ct/Cp"],
        [`Plate ${suffix}`, "A1", `Sample ${suffix}`, "GENE", "Target", 1, 23],
      ]);
      const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
      return parseWorkbookBytes(bytes, `raw-${suffix}.xlsx`);
    };
    const dataset = buildCanonicalDataset([
      makeSource("GAPDH", "Arithmetic mean", "Control A", "A"),
      makeSource("ACTB", "Geometric mean", "Control B", "B"),
    ]);

    expect(dataset.analysisStart).toBe("cq");
    expect(dataset.suppliedCalculationProvenance).toBeNull();
    expect(dataset.warnings.join("\n")).not.toMatch(/内参基因集合|内参处理方法|校准样本/);
  });

  it("blocks supplied-calculation workbooks with conflicting source provenance", () => {
    const makeSource = (referenceTarget: string, calibrator: string, suffix: string) => {
      const workbook = buildQpcrInputTemplateWorkbook();
      workbook.Sheets["Analysis Settings"].B1.v = "Delta Cq";
      workbook.Sheets["Analysis Settings"].B2.v = referenceTarget;
      workbook.Sheets["Analysis Settings"].B3.v = "Arithmetic mean";
      workbook.Sheets["Analysis Settings"].B4.v = calibrator;
      workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
        ["Sample", "Assay", "Replicate", "Delta Cq"],
        [`Sample ${suffix}`, "GENE", 1, 2.5],
      ]);
      const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
      return parseWorkbookBytes(bytes, `delta-${suffix}.xlsx`);
    };

    expect(() => buildCanonicalDataset([
      makeSource("GAPDH", "Control A", "A"),
      makeSource("ACTB", "Control B", "B"),
    ])).toThrow(/不能合并分析/);
    expect(() => buildCanonicalDataset([
      makeSource("GAPDH", "Control A", "A"),
      makeSource("", "", "Legacy"),
    ])).toThrow(/不能合并分析/);
  });

  it("runs a Delta Cq template without plate context through the calculation-only seam", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets["Analysis Settings"].B1.v = "Delta Cq";
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      ["Sample", "Assay", "Replicate", "Delta Cq"],
      ["Control", "GENE", 1, 3.0],
      ["Control", "GENE", 2, 3.2],
    ]);
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const source = parseWorkbookBytes(bytes, "delta-cq-calculation-only.xlsx");

    expect(validateQpcrInputTemplate(source)).toMatchObject({ errorCount: 0, warningCount: 1 });
    expect(validateQpcrInputTemplate(source)?.issues).toContainEqual(expect.objectContaining({
      code: "missing-reference-target",
      severity: "warning",
    }));
    expect(assessImportReadiness([source])).toMatchObject({
      status: "ready",
      canAnalyze: true,
      layoutRequired: false,
      resultIncludesPlateLayout: false,
    });

    const dataset = buildCanonicalDataset([source]);
    expect(dataset.plate).toBeNull();
    expect(dataset.wells).toEqual([]);
    expect(dataset.suppliedCalculations).toHaveLength(2);
    expect(dataset.warnings).toContain("用户计算结果未提供内参基因；数值仍可分析，但计算依据不完整。");
    expect(dataset.suppliedCalculations.every((row) => row.plateId === undefined && row.well === undefined)).toBe(true);

    const state = createAnalysisSession(dataset, "quantification", {
      referenceTargets: [], calibratorType: "sample", calibratorValue: "",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5,
      efficiencyByTarget: {}, calculationMode: "delta-cq",
    });
    const projected = projectAnalysisSession(state);
    expect(projected.alignmentReviewPending).toBe(false);
    expect(projected.suppliedResults[0]).toMatchObject({
      sampleName: "Control",
      targetName: "GENE",
      deltaCq: 3.1,
      normalizedQuantity: 0.11662912394210093,
    });
    expect(buildSuppliedCompleteRows(projected.suppliedResults, ["Control"], ["GENE"], dataset.suppliedCalculationProvenance)[0]).toMatchObject({
      analysis_start: "delta-cq",
      value_provenance: "user-supplied",
      sample: "Control",
      target: "GENE",
      reference_targets: null,
      warnings: "REFERENCE_TARGET_NOT_PROVIDED",
    });
  });

  it("keeps optional plate provenance traceable without creating a plate for Delta Delta Cq", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets["Analysis Settings"].B1.v = "Delta Delta Cq";
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      ["Plate", "Plate Format", "Well", "Sample", "Assay", "Assay Type", "Replicate", "Delta Delta Cq", "Tm1", "Tm2"],
      ["Source Plate", 96, "A1", "Treat", "GENE", "Target", 1, -1.0, 84.2, 86.1],
      ["Source Plate", 96, "A2", "Treat", "GENE", "Target", 2, -0.8, 84.3, ""],
    ]);
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const source = parseWorkbookBytes(bytes, "delta-delta-cq-with-provenance.xlsx");

    expect(validateQpcrInputTemplate(source)).toMatchObject({ errorCount: 0 });
    expect(assessImportReadiness([source])).toMatchObject({
      status: "ready",
      layoutRequired: false,
      resultIncludesPlateLayout: false,
    });
    const dataset = buildCanonicalDataset([source]);
    expect(dataset.plate).toBeNull();
    expect(dataset.wells).toEqual([]);

    const state = createAnalysisSession(dataset, "quantification", {
      referenceTargets: [], calibratorType: "sample", calibratorValue: "",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5,
      efficiencyByTarget: {}, calculationMode: "delta-delta-cq",
    });
    const [result] = projectAnalysisSession(state).suppliedResults;
    expect(result.deltaDeltaCq).toBeCloseTo(-0.9);
    expect(result.relativeExpression).toBeCloseTo(1.8660659830736148);

    expect(buildSuppliedTraceabilityRows(dataset.suppliedCalculations)).toEqual([
      expect.objectContaining({
        analysis_start: "delta-delta-cq",
        value_provenance: "user-supplied",
        plate: "Source Plate",
        well: "A1",
        plate_format: 96,
        assay_type: "Target",
        tm1: 84.2,
        tm2: 86.1,
        verification_status: "unverified",
        sample: "Treat",
        target: "GENE",
        replicate: 1,
        supplied_value: -1,
        source_sheet: "Data",
        source_row: 2,
      }),
      expect.objectContaining({ well: "A2", replicate: 2, supplied_value: -0.8 }),
    ]);
  });

  it("keeps version 1.0 workbooks on the Cq start", () => {
    const workbook = XLSX.utils.book_new();
    const oldHeaders = ["Plate", "Plate Format", "Well", "Sample", "Assay", "Assay Type", "Replicate", "Cq/Ct/Cp", "Tm1", "Tm2"];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      oldHeaders,
      ["Plate 01", 96, "A1", "Control", "REF", "Reference", 1, 20.0, 82.1, ""],
      ["Plate 01", 96, "A2", "Control", "GENE", "Target", 1, 23.0, 84.1, ""],
    ]), "Data");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["qPCR Analysis Studio Input Template / qPCR 分析数据导入模板"],
      ["Template Schema Version / 模板版本", "1.0.0"],
    ]), "Field Dictionary");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const source = parseWorkbookBytes(bytes, "legacy-v1-template.xlsx");

    expect(source.metadata).toMatchObject({ qpcrTemplateSchemaVersion: "1.0.0", qpcrAnalysisStart: "cq" });
    expect(validateQpcrInputTemplate(source)?.errorCount).toBe(0);
    expect(buildCanonicalDataset([source]).analysisStart).toBe("cq");
  });

  it("round-trips user-supplied Delta Cq from the workbook start into analysis", () => {
    const workbook = buildQpcrInputTemplateWorkbook();
    workbook.Sheets["Analysis Settings"].B1.v = "Delta Cq";
    workbook.Sheets.Data = XLSX.utils.aoa_to_sheet([
      [...QPCR_INPUT_TEMPLATE_HEADERS],
      ["Plate 01", 96, "A1", "Control", "GENE", "Target", 1, "Ct", "", 3.0, "", "", ""],
      ["Plate 01", 96, "A2", "Control", "GENE", "Target", 2, "Ct", "", 3.2, "", "", ""],
    ]);
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const source = parseWorkbookBytes(bytes, "delta-cq-template.xlsx");

    expect(validateQpcrInputTemplate(source)?.errorCount).toBe(0);
    expect(assessImportReadiness([source])).toMatchObject({ status: "ready", canAnalyze: true });
    const dataset = buildCanonicalDataset([source]);
    expect(dataset.analysisStart).toBe("delta-cq");
    expect(dataset.suppliedCalculations.map((row) => row.value)).toEqual([3, 3.2]);
    expect(dataset.wells.every((well) => well.cq === null)).toBe(true);

    const [result] = calculateFromSuppliedCalculations(dataset.suppliedCalculations, {
      analysisStart: "delta-cq",
      calibratorValue: "",
    });
    expect(result.deltaCq).toBeCloseTo(3.1);
    expect(result.normalizedQuantity).toBeCloseTo(0.1166291239);
  });

  it("round-trips the template through the canonical calculation workflow", () => {
    const source = parseWorkbookBytes(filledTemplateBytes(), "qpcr-input-template.xlsx");
    const validation = validateQpcrInputTemplate(source);
    expect(source.metadata.qpcrTemplateSchemaVersion).toBe("2.2.0");
    expect(source.tables.find((table) => table.id === source.selectedTableId)?.sourceSheet).toBe("Data");
    expect(validation).toMatchObject({ totalRows: 8, detectedCount: 8, nonDetectedCount: 0, errorCount: 0 });

    const dataset = buildCanonicalDataset([source]);
    expect(dataset.wells.find((well) => well.well === "A3")).toMatchObject({
      sampleName: "Control", targetName: "GENE", cq: 23, tm1: 84.1,
    });
    const results = calculateRelativeQuantification(dataset.wells, {
      referenceTargets: ["REF"], calibratorType: "sample", calibratorValue: "Control",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5,
      efficiencyByTarget: {}, calculationMode: "delta-delta-cq",
    });
    const exported = buildCompleteResultRows(results, ["Treat", "Control"], ["GENE"], "delta-delta-cq");

    expect(Object.keys(exported[0])).toEqual(COMPLETE_RESULTS_HEADERS);
    expect(exported.map((row) => row.sample)).toEqual(["Treat", "Control"]);
    expect(exported[0].target_valid_replicates).toBe(2);
    expect(exported[0].target_mean_cq).toBeCloseTo(22.2);
    expect(exported[0].target_technical_sd).toBeCloseTo(Math.sqrt(0.02));
    expect(exported[0].target_technical_sem).toBeCloseTo(0.1);
    expect(exported[0].reference_valid_replicates).toBe(2);
    expect(exported[0].reference_mean_cq).toBeCloseTo(20.2);
    const calibrator = exported[1];
    expect(calibrator.relative_expression).toBe(1);
    expect(calibrator.relative_expression_technical_sd).toBeTypeOf("number");
    expect(Number(calibrator.relative_expression_technical_sd)).toBeGreaterThan(0);
    expect(Number(calibrator.relative_expression_technical_sem)).toBeGreaterThan(0);

    const visualization = buildVisualizationBarRows(results, ["Treat", "Control"], ["GENE"]);
    expect(Object.keys(visualization[0])).toEqual(VISUALIZATION_BAR_HEADERS);

    const settings = {
      referenceTargets: ["REF"], calibratorType: "sample" as const, calibratorValue: "Control",
      replicateWarningThreshold: 0.5, tmWarningThreshold: 0.5,
      efficiencyByTarget: {}, calculationMode: "delta-delta-cq" as const,
    };
    const bundle = buildCalculationExportBundle(dataset.wells, results, ["Treat", "Control"], ["GENE"], settings);
    const workbookBytes = buildCalculationWorkbookBytes(bundle);
    const workbook = XLSX.read(workbookBytes, { type: "array" });
    expect(workbook.SheetNames).toEqual([
      "Complete Results", "Well Calculations", "Plate Summaries", "Calculation Guide", "Data Dictionary",
    ]);
    const wellRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(workbook.Sheets["Well Calculations"]);
    expect(wellRows).toHaveLength(8);
    expect(wellRows.find((row) => row.well === "A1")).toMatchObject({ cq: 20, assay: "REF" });
    expect(Number(wellRows.find((row) => row.well === "A1")?.well_delta_cq_cq_minus_reference_center)).toBeCloseTo(-0.1);
    const dictionaryRows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets["Data Dictionary"]);
    expect(dictionaryRows.find((row) => row.field === "delta_cq_technical_sd")?.["中文定义"]).toContain("平方和开根号");
    expect(dictionaryRows.find((row) => row.field === "delta_cq_technical_sem")?.["中文定义"]).toContain("SD/√n");
  });
});
