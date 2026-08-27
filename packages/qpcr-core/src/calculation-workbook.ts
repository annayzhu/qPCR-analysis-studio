import XLSX from "xlsx-js-style";
import {
  COMPLETE_RESULTS_HEADERS,
  PLATE_SUMMARY_HEADERS,
  WELL_CALCULATION_HEADERS,
  type CalculationDictionaryEntry,
  type CalculationGuideRow,
  type CompleteResultRow,
  type PlateSummaryRow,
  type WellCalculationRow,
} from "./complete-results-export";

export interface CalculationWorkbookInput {
  completeRows: CompleteResultRow[];
  plateRows: PlateSummaryRow[];
  wellRows: WellCalculationRow[];
  guide: CalculationGuideRow[];
  dictionary: CalculationDictionaryEntry[];
}

function dataSheet(headers: readonly string[], rows: Array<Record<string, string | number | null>>) {
  const values = rows.map((row) => headers.map((header) => row[header] ?? ""));
  const worksheet = XLSX.utils.aoa_to_sheet([[...headers], ...values]);
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.min(44, Math.max(13, header.length + 2)) }));
  worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${values.length + 1}` };
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  headers.forEach((_, index) => {
    const cell = worksheet[XLSX.utils.encode_cell({ r: 0, c: index })];
    if (!cell) return;
    cell.s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { patternType: "solid", fgColor: { rgb: "315F5B" } },
      alignment: { horizontal: "center", wrapText: true },
    };
  });
  return worksheet;
}

/** Build the exact multi-sheet workbook downloaded by the browser UI. */
export function buildCalculationWorkbookBytes(input: CalculationWorkbookInput): ArrayBuffer {
  const guideSheet = XLSX.utils.json_to_sheet(input.guide.map((item) => ({
    "步骤": item.step,
    "计算步骤": item.nameZh,
    "Calculation step": item.nameEn,
    "公式": item.formula,
    "中文说明": item.explanationZh,
    "English explanation": item.explanationEn,
  })));
  guideSheet["!cols"] = [{ wch: 8 }, { wch: 24 }, { wch: 28 }, { wch: 54 }, { wch: 72 }, { wch: 72 }];

  const dictionarySheet = XLSX.utils.json_to_sheet(input.dictionary.map((item) => ({
    "工作表": item.sheet,
    field: item.field,
    "层级": item.levelZh,
    "中文定义": item.definitionZh,
    "English definition": item.definitionEn,
    "公式或来源": item.formula,
    "单位": item.unit,
    "中文注意事项": item.cautionZh,
    "English caution": item.cautionEn,
  })));
  dictionarySheet["!cols"] = [{ wch: 22 }, { wch: 46 }, { wch: 18 }, { wch: 66 }, { wch: 72 }, { wch: 54 }, { wch: 18 }, { wch: 64 }, { wch: 68 }];

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: "qPCR auditable calculation results",
    Subject: "Well measurements, intermediate calculations, final results, and technical uncertainty",
    Author: "qPCR Analysis Studio",
  };
  XLSX.utils.book_append_sheet(workbook, dataSheet(COMPLETE_RESULTS_HEADERS, input.completeRows), "Complete Results");
  XLSX.utils.book_append_sheet(workbook, dataSheet(WELL_CALCULATION_HEADERS, input.wellRows), "Well Calculations");
  XLSX.utils.book_append_sheet(workbook, dataSheet(PLATE_SUMMARY_HEADERS, input.plateRows), "Plate Summaries");
  XLSX.utils.book_append_sheet(workbook, guideSheet, "Calculation Guide");
  XLSX.utils.book_append_sheet(workbook, dictionarySheet, "Data Dictionary");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true }) as ArrayBuffer;
}
