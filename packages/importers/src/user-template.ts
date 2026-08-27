import XLSX from "xlsx-js-style";
import type { CanonicalField, ImportedSource, ImportedTable, RawImportedRow } from "../../schemas/src";
import { normalizeWell } from "../../schemas/src";
import { selectedTable } from "./adapters";

export const QPCR_INPUT_TEMPLATE_SCHEMA_VERSION = "2.0.0";
export const QPCR_INPUT_TEMPLATE_HEADERS = [
  "Plate",
  "Plate Format",
  "Well",
  "Sample",
  "Assay",
  "Assay Type",
  "Replicate",
  "Cycle Type",
  "Cq/Ct/Cp",
  "Delta Cq",
  "Delta Delta Cq",
  "Tm1",
  "Tm2",
] as const;

const REQUIRED_HEADERS = new Set(["Well", "Sample", "Assay", "Assay Type", "Replicate", "Cq/Ct/Cp"]);
const NON_DETECTED = /^(?:undetermined|no\s*ct|no\s*cq|n\/?a|na|nan|failed|无扩增|未检出)$/i;

export interface TemplateValidationIssue {
  code:
    | "invalid-analysis-start"
    | "missing-column"
    | "mean-column-not-allowed"
    | "missing-value"
    | "invalid-well"
    | "invalid-plate-format"
    | "invalid-replicate"
    | "invalid-number"
    | "missing-plate"
    | "duplicate-well"
    | "duplicate-replicate";
  severity: "error" | "warning";
  sourceSheet: string;
  sourceRowNumber: number | null;
  column: string;
  suppliedValue: string;
  messageZh: string;
  messageEn: string;
}

export interface TemplateValidationSummary {
  totalRows: number;
  detectedCount: number;
  nonDetectedCount: number;
  warningCount: number;
  errorCount: number;
  issues: TemplateValidationIssue[];
}

function headerStyle(required: boolean) {
  return {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: required ? "315F5B" : "718783" } },
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      bottom: { style: "thin", color: { rgb: "FFFFFF" } },
    },
  };
}

function styleDataSheet(sheet: XLSX.WorkSheet, rowCount: number) {
  sheet["!cols"] = [
    { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 24 }, { wch: 20 }, { wch: 18 },
    { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
  ];
  sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(QPCR_INPUT_TEMPLATE_HEADERS.length - 1)}${Math.max(1, rowCount)}` };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" };
  QPCR_INPUT_TEMPLATE_HEADERS.forEach((header, index) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: index })];
    if (cell) cell.s = headerStyle(REQUIRED_HEADERS.has(header));
  });
}

export function buildQpcrInputTemplateWorkbook(): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: "qPCR Analysis Studio input template",
    Subject: `qPCR input template schema ${QPCR_INPUT_TEMPLATE_SCHEMA_VERSION}`,
    Author: "qPCR Analysis Studio",
    Comments: "Generated locally in the browser. Synthetic example data only.",
  };

  const settingsRows = [
    ["Analysis Start / 分析起点", "Cq/Ct/Cp"],
    ["Allowed / 可选值", "Cq/Ct/Cp", "Delta Cq", "Delta Delta Cq"],
    ["Rule / 规则", "Choose one authoritative start for the entire import set / 整个导入数据只能选择一个正式分析起点"],
  ];
  const settingsSheet = XLSX.utils.aoa_to_sheet(settingsRows);
  settingsSheet["!cols"] = [{ wch: 30 }, { wch: 78 }, { wch: 20 }, { wch: 24 }];
  if (settingsSheet.A1) settingsSheet.A1.s = headerStyle(false);
  if (settingsSheet.B1) settingsSheet.B1.s = { font: { bold: true, color: { rgb: "315F5B" } } };
  XLSX.utils.book_append_sheet(workbook, settingsSheet, "Analysis Settings");

  const dataSheet = XLSX.utils.aoa_to_sheet([[...QPCR_INPUT_TEMPLATE_HEADERS]]);
  styleDataSheet(dataSheet, 1);
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Data");

  const exampleRows: Array<Array<string | number>> = [
    [...QPCR_INPUT_TEMPLATE_HEADERS],
    ["Plate 01", 96, "A1", "CAL_01", "REF1", "Reference", 1, "Cq", 20.0, "", "", 82.1, ""],
    ["Plate 01", 96, "A2", "CAL_01", "REF1", "Reference", 2, "Cq", 20.2, "", "", 82.2, ""],
    ["Plate 01", 96, "A3", "CAL_01", "GENE_A", "Target", 1, "Cq", 23.0, "", "", 84.5, ""],
    ["Plate 01", 96, "A4", "CAL_01", "GENE_A", "Target", 2, "Cq", 23.2, "", "", 84.4, ""],
    ["Plate 01", 96, "A5", "SAMPLE_01", "REF1", "Reference", 1, "Cq", 20.4, "", "", 82.1, ""],
    ["Plate 01", 96, "A6", "SAMPLE_01", "GENE_A", "Target", 1, "Cq", 22.1, "", "", 84.6, ""],
    ["Plate 01", 96, "A7", "NTC_01", "GENE_A", "NTC", 1, "Cq", "Undetermined", "", "", "", ""],
  ];
  const exampleSheet = XLSX.utils.aoa_to_sheet(exampleRows);
  styleDataSheet(exampleSheet, exampleRows.length);
  XLSX.utils.book_append_sheet(workbook, exampleSheet, "Example");

  const dictionaryRows: Array<Array<string | number>> = [
    ["qPCR Analysis Studio Input Template / qPCR 分析数据导入模板"],
    ["Template Schema Version / 模板版本", QPCR_INPUT_TEMPLATE_SCHEMA_VERSION],
    ["Privacy / 隐私", "Generated and processed locally in the browser / 在浏览器本地生成和处理"],
    ["Row rule / 行规则", "One physical reaction well per row; do not enter Ct Mean / 每行一个物理反应孔，不要填写预先求均值的 Ct Mean"],
    ["Uncertainty / 误差", "SD and SEM describe technical replicates only / SD 和 SEM 仅描述技术复孔"],
    [],
    ["Field", "Requirement", "中文说明", "English definition", "Allowed values / unit", "Accepted synonyms"],
    ["Plate", "Conditional", "孔板名称；多板数据必填", "Plate identifier; required for multi-plate data", "Text", "Plate Name, Plate ID, 板编号"],
    ["Plate Format", "Optional", "显式板型；填写后孔位必须在该板范围内", "Explicit plate format; wells must fit this format when supplied", "96 or 384", "板型, Plate Size"],
    ["Well", "Required", "物理孔位", "Physical well coordinate", "A1–H12 (96) or A1–P24 (384)", "Well Position, Pos, 孔位"],
    ["Sample", "Required", "生物学样本名称", "Biological sample identifier", "Text", "Sample Name, 样本, 样本编号"],
    ["Assay", "Required", "基因或检测项目", "Target gene or assay", "Text", "Target, Gene, 基因, 靶标"],
    ["Assay Type", "Required", "反应角色；保留原值", "Reaction role; original text is preserved", "Target, Reference, NTC, no-RT, Standard, Unknown", "Type, Role, 类型"],
    ["Replicate", "Required", "技术复孔序号", "Positive technical-replicate identifier", "Positive integer", "Rep, Technical Replicate, 复孔序号"],
    ["Cycle Type", "Optional", "原始扩增定量术语，仅用于溯源", "Original quantification-cycle term; provenance only", "Ct, Cq, or Cp", "Quantification Type, 定量类型"],
    ["Cq/Ct/Cp", "Required", "单孔扩增定量值", "Single-well quantification cycle", "0–60 or Undetermined / 未检出", "Cq, Ct, Cp"],
    ["Delta Cq", "Conditional", "用户计算的复孔级 ΔCq；选择 Delta Cq 起点时必填", "User-supplied replicate-level delta Cq; required for Delta Cq start", "Numeric", "Delta Ct, Delta Cp, ΔCq, ΔCt, ΔCp"],
    ["Delta Delta Cq", "Conditional", "用户计算的复孔级 ΔΔCq；选择 Delta Delta Cq 起点时必填", "User-supplied replicate-level delta-delta Cq; required for Delta Delta Cq start", "Numeric", "Delta Delta Ct, ΔΔCq, ΔΔCt"],
    ["Tm1", "Optional", "主熔解峰温度", "Primary melt-peak temperature", "Numeric, °C", "Tm, 主峰Tm"],
    ["Tm2", "Optional", "第二熔解峰温度", "Secondary melt-peak temperature", "Numeric, °C", "Second Tm, 第二峰Tm"],
  ];
  const dictionarySheet = XLSX.utils.aoa_to_sheet(dictionaryRows);
  dictionarySheet["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 32 }, { wch: 44 }, { wch: 34 }, { wch: 42 }];
  dictionarySheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  if (dictionarySheet.A1) dictionarySheet.A1.s = { font: { bold: true, sz: 15, color: { rgb: "FFFFFF" } }, fill: { patternType: "solid", fgColor: { rgb: "315F5B" } }, alignment: { horizontal: "left" } };
  for (let column = 0; column < 6; column += 1) {
    const cell = dictionarySheet[XLSX.utils.encode_cell({ r: 6, c: column })];
    if (cell) cell.s = headerStyle(false);
  }
  XLSX.utils.book_append_sheet(workbook, dictionarySheet, "Field Dictionary");
  return workbook;
}

export function writeQpcrInputTemplate(): ArrayBuffer {
  return XLSX.write(buildQpcrInputTemplateWorkbook(), { bookType: "xlsx", type: "array", cellStyles: true }) as ArrayBuffer;
}

function acceptedMapping(table: ImportedTable): Partial<Record<CanonicalField, string>> {
  const record: Partial<Record<CanonicalField, string>> = {};
  for (const mapping of table.suggestedMappings) {
    if (mapping.canonicalField && mapping.confidence >= 0.7 && !mapping.conflict) {
      record[mapping.canonicalField] ??= mapping.sourceColumn;
    }
  }
  return record;
}

function rawText(row: RawImportedRow, header: string | undefined): string {
  return header ? String(row.rawValues[header] ?? "").normalize("NFKC").trim() : "";
}

function issue(
  code: TemplateValidationIssue["code"],
  severity: TemplateValidationIssue["severity"],
  table: ImportedTable,
  row: RawImportedRow | null,
  column: string,
  value: string,
  messageZh: string,
  messageEn: string,
): TemplateValidationIssue {
  return {
    code,
    severity,
    sourceSheet: table.sourceSheet,
    sourceRowNumber: row?.sourceRowNumber ?? null,
    column,
    suppliedValue: value,
    messageZh,
    messageEn,
  };
}

export function validateQpcrInputTemplate(source: ImportedSource): TemplateValidationSummary | null {
  if (!source.metadata.qpcrTemplateSchemaVersion) return null;
  const table = selectedTable(source);
  if (!table) return { totalRows: 0, detectedCount: 0, nonDetectedCount: 0, warningCount: 0, errorCount: 1, issues: [] };
  const mappings = acceptedMapping(table);
  const plateFormatHeader = table.headers.find((header) => /^(?:plate\s*format|plate\s*size|板型)$/i.test(header.normalize("NFKC").trim()));
  const issues: TemplateValidationIssue[] = [];
  if (!table.rawRows.length) issues.push(issue(
    "missing-value", "error", table, null, "Data", "",
    "Data 工作表没有数据行。请保留表头并从第 2 行开始填写单孔数据。",
    "The Data sheet has no data rows. Keep the headers and enter single-well records from row 2.",
  ));
  const analysisStart = source.metadata.qpcrAnalysisStart ?? "cq";
  const selectedValue: [CanonicalField, string] = analysisStart === "delta-cq"
    ? ["deltaCq", "Delta Cq"]
    : analysisStart === "delta-delta-cq"
      ? ["deltaDeltaCq", "Delta Delta Cq"]
      : ["cq", "Cq/Ct/Cp"];
  const required: Array<[CanonicalField, string]> = [
    ["well", "Well"], ["sampleName", "Sample"], ["targetName", "Assay"],
    ["taskType", "Assay Type"], ["replicate", "Replicate"], selectedValue,
  ];
  if (analysisStart === "invalid") issues.push({
    code: "invalid-analysis-start",
    severity: "error",
    sourceSheet: "Analysis Settings",
    sourceRowNumber: 1,
    column: "Analysis Start",
    suppliedValue: "",
    messageZh: "分析起点必须选择 Cq/Ct/Cp、Delta Cq 或 Delta Delta Cq。系统不会自动改用其他起点。",
    messageEn: "Analysis Start must be Cq/Ct/Cp, Delta Cq, or Delta Delta Cq. The system will not silently switch to another start.",
  });
  for (const [field, label] of required) {
    if (!mappings[field]) issues.push(issue(
      "missing-column", "error", table, null, label, "",
      `缺少必需列 ${label}。`, `Required column ${label} is missing.`,
    ));
  }
  if (!mappings.cq && mappings.cqMean) issues.push(issue(
    "mean-column-not-allowed", "error", table, null, mappings.cqMean, "",
    "模板工作流不接受 Ct Mean/Cq Mean 代替单孔值。请填写每个物理孔的 Cq/Ct/Cp。",
    "Ct Mean/Cq Mean cannot replace a single-well value in the template workflow. Enter Cq/Ct/Cp for every physical well.",
  ));

  let detectedCount = 0;
  let nonDetectedCount = 0;
  const physicalKeys = new Map<string, RawImportedRow>();
  const replicateKeys = new Map<string, RawImportedRow>();
  const namedPlateValues = new Set(table.rawRows.map((row) => rawText(row, mappings.plateName)).filter(Boolean));
  for (const row of table.rawRows) {
    const suppliedPlate = rawText(row, mappings.plateName);
    const suppliedPlateFormat = rawText(row, plateFormatHeader);
    const plate = suppliedPlate || "Plate 1";
    const wellValue = rawText(row, mappings.well);
    const sample = rawText(row, mappings.sampleName);
    const assay = rawText(row, mappings.targetName);
    const assayType = rawText(row, mappings.taskType);
    const replicate = rawText(row, mappings.replicate);
    const cq = rawText(row, mappings.cq);
    const selectedCycleValue = rawText(row, mappings[selectedValue[0]]);
    if (namedPlateValues.size > 0 && !suppliedPlate) issues.push(issue(
      "missing-plate", "error", table, row, "Plate", suppliedPlate,
      `第 ${row.sourceRowNumber} 行的 Plate 为空；同一工作表已出现具名孔板，多板数据必须逐行填写 Plate。`,
      `Plate is blank on row ${row.sourceRowNumber}; this sheet contains a named plate, so Plate is required on every row of multi-plate data.`,
    ));
    for (const [field, label] of required) {
      const supplied = rawText(row, mappings[field]);
      if (!supplied) issues.push(issue(
        "missing-value", "error", table, row, label, supplied,
        `第 ${row.sourceRowNumber} 行的 ${label} 为空。`,
        `${label} is blank on row ${row.sourceRowNumber}.`,
      ));
    }
    const well = normalizeWell(wellValue);
    const plateFormat = suppliedPlateFormat ? Number(suppliedPlateFormat) : null;
    if (suppliedPlateFormat && plateFormat !== 96 && plateFormat !== 384) issues.push(issue(
      "invalid-plate-format", "error", table, row, "Plate Format", suppliedPlateFormat,
      `第 ${row.sourceRowNumber} 行的 Plate Format 必须为 96 或 384。`,
      `Plate Format on row ${row.sourceRowNumber} must be 96 or 384.`,
    ));
    if (wellValue && !well) issues.push(issue(
      "invalid-well", "error", table, row, "Well", wellValue,
      `第 ${row.sourceRowNumber} 行孔位“${wellValue}”无效；请使用 A1–P24。`,
      `Well “${wellValue}” on row ${row.sourceRowNumber} is invalid; use A1–P24.`,
    ));
    if (well && plateFormat === 96 && (well.charCodeAt(0) > 72 || Number(well.slice(1)) > 12)) issues.push(issue(
      "invalid-well", "error", table, row, "Well", wellValue,
      `第 ${row.sourceRowNumber} 行孔位“${wellValue}”超出 96 孔板范围 A1–H12。`,
      `Well “${wellValue}” on row ${row.sourceRowNumber} is outside the 96-well range A1–H12.`,
    ));
    if (replicate && (!Number.isInteger(Number(replicate)) || Number(replicate) <= 0)) issues.push(issue(
      "invalid-replicate", "error", table, row, "Replicate", replicate,
      `第 ${row.sourceRowNumber} 行 Replicate 必须是正整数。`,
      `Replicate on row ${row.sourceRowNumber} must be a positive integer.`,
    ));
    if (analysisStart === "cq" && cq) {
      if (NON_DETECTED.test(cq)) nonDetectedCount += 1;
      else if (!Number.isFinite(Number(cq)) || Number(cq) < 0 || Number(cq) > 60) issues.push(issue(
        "invalid-number", "error", table, row, "Cq/Ct/Cp", cq,
        `第 ${row.sourceRowNumber} 行 Cq/Ct/Cp 必须为 0–60 数值或未检出标记。`,
        `Cq/Ct/Cp on row ${row.sourceRowNumber} must be numeric from 0 to 60 or a non-detected marker.`,
      ));
      else detectedCount += 1;
    }
    if (analysisStart !== "cq" && selectedCycleValue) {
      if (!Number.isFinite(Number(selectedCycleValue))) issues.push(issue(
        "invalid-number", "error", table, row, selectedValue[1], selectedCycleValue,
        `第 ${row.sourceRowNumber} 行 ${selectedValue[1]} 必须为数值。`,
        `${selectedValue[1]} on row ${row.sourceRowNumber} must be numeric.`,
      ));
      else detectedCount += 1;
    }
    for (const [field, label] of [["tm1", "Tm1"], ["tm2", "Tm2"]] as const) {
      const supplied = rawText(row, mappings[field]);
      if (supplied && !Number.isFinite(Number(supplied))) issues.push(issue(
        "invalid-number", "error", table, row, label, supplied,
        `第 ${row.sourceRowNumber} 行 ${label} 必须为数值。`,
        `${label} on row ${row.sourceRowNumber} must be numeric.`,
      ));
    }
    if (well) {
      const physicalKey = `${plate}\u241f${well}`;
      const previous = physicalKeys.get(physicalKey);
      if (previous) issues.push(issue(
        "duplicate-well", "error", table, row, "Plate + Well", `${plate} ${well}`,
        `第 ${row.sourceRowNumber} 行与第 ${previous.sourceRowNumber} 行占用同一物理孔 ${plate} ${well}。`,
        `Row ${row.sourceRowNumber} and row ${previous.sourceRowNumber} use the same physical well ${plate} ${well}.`,
      ));
      else physicalKeys.set(physicalKey, row);
    }
    if (sample && assay && replicate && Number.isInteger(Number(replicate)) && Number(replicate) > 0) {
      const replicateKey = `${plate}\u241f${sample}\u241f${assay}\u241f${Number(replicate)}`;
      const previous = replicateKeys.get(replicateKey);
      if (previous) issues.push(issue(
        "duplicate-replicate", "warning", table, row, "Replicate", replicate,
        `第 ${row.sourceRowNumber} 行与第 ${previous.sourceRowNumber} 行在同一 Plate + Sample + Assay 中使用了相同复孔序号。`,
        `Row ${row.sourceRowNumber} and row ${previous.sourceRowNumber} reuse the same replicate identifier within Plate + Sample + Assay.`,
      ));
      else replicateKeys.set(replicateKey, row);
    }
    void assayType;
  }

  return {
    totalRows: table.rawRows.length,
    detectedCount,
    nonDetectedCount,
    warningCount: issues.filter((item) => item.severity === "warning").length,
    errorCount: issues.filter((item) => item.severity === "error").length,
    issues,
  };
}
