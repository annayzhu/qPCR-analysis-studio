import XLSX from "xlsx-js-style";
import type { ImportedSource, ImportedTable, RawImportedRow } from "../../schemas/src";
import { findHeaderRow, inferFieldMappings, scoreTable } from "./field-mapping";
import { applyInstrumentAdapter } from "./adapters";

function id(prefix: string, value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function sheetMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true,
  });
}

function tableFromMatrix(
  sourceId: string,
  fileName: string,
  sheetName: string,
  matrix: unknown[][],
): ImportedTable {
  const headerRowIndex = findHeaderRow(matrix);
  const headers = (matrix[headerRowIndex] ?? []).map((value, index) =>
    String(value ?? "").trim() || `Unnamed ${index + 1}`,
  );
  const dataRows = matrix
    .slice(headerRowIndex + 1)
    .filter((row) => row.some((value) => String(value ?? "").trim()));
  const suggestedMappings = inferFieldMappings(headers, dataRows);
  const rawRows: RawImportedRow[] = dataRows.map((row, index) => ({
    sourceId,
    sourceFileName: fileName,
    sourceSheet: sheetName,
    sourceRowNumber: headerRowIndex + index + 2,
    rawHeaders: Object.freeze([...headers]),
    rawValues: Object.freeze(
      Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""])),
    ),
  }));
  return {
    id: id("table", `${sourceId}:${sheetName}`),
    sourceId,
    sourceFileName: fileName,
    sourceSheet: sheetName,
    matrix,
    headerRowIndex,
    headers,
    rawRows,
    suggestedMappings,
    score: scoreTable(headers, suggestedMappings),
    warnings: [],
  };
}

function metadataFromText(text: string): Record<string, string> {
  const firstLines = text.replaceAll("\r\n", "\n").split("\n").slice(0, 5).join(" ");
  const roche = firstLines.match(/Experiment:\s*(.*?)\s+Selected Filter:\s*(.*?)(?:\s{2,}|$)/i);
  return roche
    ? { experimentName: roche[1].trim(), selectedFilter: roche[2].trim() }
    : {};
}

export function parseWorkbookBytes(
  bytes: ArrayBuffer,
  fileName: string,
): ImportedSource {
  const sourceId = id("source", `${fileName}:${bytes.byteLength}`);
  const workbook = XLSX.read(bytes, { type: "array", cellStyles: true });
  const dictionarySheet = workbook.Sheets["Field Dictionary"];
  const dictionaryMatrix = dictionarySheet ? sheetMatrix(dictionarySheet) : [];
  const isQpcrTemplate = String(dictionaryMatrix[0]?.[0] ?? "").includes("qPCR Analysis Studio Input Template");
  const templateVersion = isQpcrTemplate ? String(dictionaryMatrix[1]?.[1] ?? "").trim() : "";
  const tables = workbook.SheetNames.map((sheetName) =>
    tableFromMatrix(sourceId, fileName, sheetName, sheetMatrix(workbook.Sheets[sheetName])),
  ).sort((a, b) => b.score - a.score);
  const selectedTableId = isQpcrTemplate
    ? tables.find((table) => table.sourceSheet === "Data")?.id ?? tables[0]?.id ?? ""
    : tables[0]?.id ?? "";
  return applyInstrumentAdapter({
    id: sourceId,
    fileName,
    fileType: "xlsx",
    adapterId: "generic-tabular",
    instrumentType: "generic",
    tables,
    selectedTableId,
    metadata: templateVersion ? { qpcrTemplateSchemaVersion: templateVersion } : {},
    warnings: tables.length ? [] : ["工作簿中没有可读取的工作表"],
  });
}

export function parseDelimitedText(
  text: string,
  fileName: string,
): ImportedSource {
  const sourceId = id("source", `${fileName}:${text.length}`);
  const fileType = fileName.toLowerCase().endsWith(".csv") ? "csv" : "txt";
  const normalizedText = text.replace(/^\uFEFF/, "");
  const probeLines = normalizedText.replaceAll("\r\n", "\n").split("\n").slice(0, 12);
  const delimiter = fileType === "csv"
    ? ","
    : probeLines.some((line) => line.includes("\t"))
      ? "\t"
      : probeLines.some((line) => line.includes(";")) ? ";" : ",";
  const workbook = XLSX.read(normalizedText, { type: "string", raw: true, FS: delimiter });
  const tables = workbook.SheetNames.map((sheetName) =>
    tableFromMatrix(sourceId, fileName, sheetName, sheetMatrix(workbook.Sheets[sheetName])),
  ).sort((a, b) => b.score - a.score);
  return applyInstrumentAdapter({
    id: sourceId,
    fileName,
    fileType,
    adapterId: "generic-tabular",
    instrumentType: "generic",
    tables,
    selectedTableId: tables[0]?.id ?? "",
    metadata: metadataFromText(text),
    warnings: tables.length ? [] : ["文本中没有可读取的数据表"],
  });
}

export async function parseBrowserFile(file: File): Promise<ImportedSource> {
  if (/\.xlsx$/i.test(file.name)) return parseWorkbookBytes(await file.arrayBuffer(), file.name);
  if (/\.(csv|txt|tsv)$/i.test(file.name)) return parseDelimitedText(await file.text(), file.name);
  throw new Error(`暂不支持 ${file.name}；请选择 XLSX、CSV、TXT 或 TSV。`);
}
