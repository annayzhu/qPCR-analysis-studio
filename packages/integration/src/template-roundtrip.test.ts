import { describe, expect, it } from "vitest";
import XLSX from "xlsx-js-style";
import {
  buildCanonicalDataset,
  buildQpcrInputTemplateWorkbook,
  parseWorkbookBytes,
  QPCR_INPUT_TEMPLATE_HEADERS,
  validateQpcrInputTemplate,
} from "../../importers/src";
import {
  buildCompleteResultRows,
  buildCalculationExportBundle,
  buildCalculationWorkbookBytes,
  buildVisualizationBarRows,
  calculateRelativeQuantification,
  COMPLETE_RESULTS_HEADERS,
  VISUALIZATION_BAR_HEADERS,
} from "../../qpcr-core/src";

function filledTemplateBytes(): ArrayBuffer {
  const workbook = buildQpcrInputTemplateWorkbook();
  const rows: Array<Array<string | number>> = [
    [...QPCR_INPUT_TEMPLATE_HEADERS],
    ["Plate 01", 96, "A1", "Control", "REF", "Reference", 1, 20.0, 82.1, ""],
    ["Plate 01", 96, "A2", "Control", "REF", "Reference", 2, 20.2, 82.2, ""],
    ["Plate 01", 96, "A3", "Control", "GENE", "Target", 1, 23.0, 84.1, ""],
    ["Plate 01", 96, "A4", "Control", "GENE", "Target", 2, 23.2, 84.2, ""],
    ["Plate 01", 96, "B1", "Treat", "REF", "Reference", 1, 20.1, 82.1, ""],
    ["Plate 01", 96, "B2", "Treat", "REF", "Reference", 2, 20.3, 82.2, ""],
    ["Plate 01", 96, "B3", "Treat", "GENE", "Target", 1, 22.1, 84.1, ""],
    ["Plate 01", 96, "B4", "Treat", "GENE", "Target", 2, 22.3, 84.2, ""],
  ];
  workbook.Sheets.Data = XLSX.utils.aoa_to_sheet(rows);
  return XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true }) as ArrayBuffer;
}

describe("downloadable template to complete-results export", () => {
  it("round-trips the template through the canonical calculation workflow", () => {
    const source = parseWorkbookBytes(filledTemplateBytes(), "qpcr-input-template.xlsx");
    const validation = validateQpcrInputTemplate(source);
    expect(source.metadata.qpcrTemplateSchemaVersion).toBe("1.0.0");
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
