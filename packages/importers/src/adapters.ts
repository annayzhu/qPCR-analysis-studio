import type {
  CanonicalField,
  FieldMapping,
  ImportedSource,
  ImportedTable,
} from "../../schemas/src";
import { normalizeHeader } from "./field-mapping";

const ROCHE_FIELDS: Record<string, CanonicalField> = {
  pos: "well",
  cp: "cq",
  cq: "cq",
  ct: "cq",
  tm1: "tm1",
  tm2: "tm2",
  group: "meltGroup",
  score: "meltScore",
  res: "meltResolution",
  status: "instrumentFlag",
  include: "omit",
  color: "reporter",
};

function adapterMapping(table: ImportedTable): FieldMapping[] {
  return table.suggestedMappings.map((mapping) => {
    const canonicalField = ROCHE_FIELDS[normalizeHeader(mapping.sourceColumn)];
    if (!canonicalField) return mapping;
    return {
      ...mapping,
      canonicalField,
      confidence: 1,
      matchMethod: "adapter",
      evidence: ["Roche LightCycler 480 导出列定义"],
      conflict: false,
    };
  });
}

function rocheKind(table: ImportedTable): string | null {
  const headers = new Set(table.headers.map(normalizeHeader));
  if (!headers.has("pos") || !headers.has("name")) return null;
  if (headers.has("cp") || headers.has("cq") || headers.has("ct")) return "cq-results";
  if (headers.has("tm1") || headers.has("tm2")) return "tm-summary";
  if (headers.has("group") && headers.has("score") && headers.has("res")) {
    return "melt-grouping";
  }
  return null;
}

/**
 * Detects instrument-specific structure without changing the immutable raw rows.
 * Unknown sources remain generic and can still be mapped manually.
 */
export function applyInstrumentAdapter(source: ImportedSource): ImportedSource {
  const detectedKinds = source.tables
    .map((table) => ({ table, kind: rocheKind(table) }))
    .filter((item): item is { table: ImportedTable; kind: string } => Boolean(item.kind));

  if (!detectedKinds.length) return source;
  const kind = detectedKinds[0].kind;
  return {
    ...source,
    adapterId: `roche-lightcycler-480:${kind}`,
    instrumentType: "roche-lightcycler-480",
    tables: source.tables.map((table) =>
      rocheKind(table) ? { ...table, suggestedMappings: adapterMapping(table) } : table,
    ),
    warnings: [
      ...source.warnings,
      kind === "melt-grouping"
        ? "该文件是熔解分组摘要，不是温度-荧光原始曲线。"
        : "",
    ].filter(Boolean),
  };
}

export function selectedTable(source: ImportedSource): ImportedTable | null {
  return source.tables.find((table) => table.id === source.selectedTableId) ?? source.tables[0] ?? null;
}

