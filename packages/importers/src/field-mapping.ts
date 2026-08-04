import type { CanonicalField, FieldMapping } from "../../schemas/src";
import { normalizeWell } from "../../schemas/src";
import { FIELD_SYNONYMS } from "./field-dictionary";

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_\-–—/\\|｜:：;；,.，。()（）\[\]【】]+/g, "");
}

const normalizedSynonyms = Object.fromEntries(
  Object.entries(FIELD_SYNONYMS).map(([field, values]) => [
    field,
    new Set(values.map(normalizeHeader)),
  ]),
) as Record<CanonicalField, Set<string>>;

function headerCandidates(header: string): Array<{
  field: CanonicalField;
  confidence: number;
  method: FieldMapping["matchMethod"];
  evidence: string;
}> {
  const normalized = normalizeHeader(header);
  const parts = header
    .normalize("NFKC")
    .split(/[\/|｜;；,，]+/)
    .map(normalizeHeader)
    .filter(Boolean);
  const candidates: ReturnType<typeof headerCandidates> = [];
  for (const field of Object.keys(normalizedSynonyms) as CanonicalField[]) {
    if (normalizedSynonyms[field].has(normalized)) {
      candidates.push({
        field,
        confidence: 1,
        method: "exact-synonym",
        evidence: "表头与同义词词典精确匹配",
      });
      continue;
    }
    if (parts.some((part) => normalizedSynonyms[field].has(part))) {
      candidates.push({
        field,
        confidence: 0.96,
        method: "combined-header",
        evidence: "中英文组合表头中的一个分段精确匹配",
      });
    }
  }
  return candidates;
}

function contentCandidate(values: unknown[]): {
  field: CanonicalField;
  confidence: number;
  evidence: string;
} | null {
  const present = values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, 120);
  if (present.length < 2) return null;
  const wellRatio = present.filter((value) => normalizeWell(value)).length / present.length;
  if (wellRatio >= 0.8) {
    return { field: "well", confidence: 0.9, evidence: `${Math.round(wellRatio * 100)}% 内容符合孔位格式` };
  }
  const rowRatio = present.filter((value) => /^[A-P]$/i.test(value)).length / present.length;
  if (rowRatio >= 0.85) {
    return { field: "row", confidence: 0.82, evidence: `${Math.round(rowRatio * 100)}% 内容为 A–P 行标` };
  }
  const columnRatio =
    present.filter((value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 24).length /
    present.length;
  if (columnRatio >= 0.9) {
    return { field: "column", confidence: 0.78, evidence: `${Math.round(columnRatio * 100)}% 内容为 1–24 整数` };
  }
  const cqLike = present.filter(
    (value) =>
      /^(undetermined|no\s*ct|n\/?a|na|nan|failed|无扩增)$/i.test(value) ||
      (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 60),
  ).length / present.length;
  if (cqLike >= 0.9) {
    return { field: "cq", confidence: 0.72, evidence: `${Math.round(cqLike * 100)}% 内容为 Cq 数值或未检出标记` };
  }
  return null;
}

export function inferFieldMappings(headers: string[], dataRows: unknown[][]): FieldMapping[] {
  const mappings = headers.map((sourceColumn, columnIndex) => {
    const byHeader = headerCandidates(sourceColumn).sort((a, b) => b.confidence - a.confidence);
    const byContent = contentCandidate(dataRows.map((row) => row[columnIndex]));
    const winner = byHeader[0] ?? byContent;
    return {
      sourceColumn,
      canonicalField: winner?.field ?? null,
      confidence: winner?.confidence ?? 0,
      matchMethod: winner?.method ?? (winner ? "content" : "unmapped"),
      evidence: winner ? [winner.evidence] : ["未找到可靠匹配"],
      conflict: byHeader.length > 1,
      userConfirmed: false,
    } satisfies FieldMapping;
  });

  const byCanonical = new Map<CanonicalField, FieldMapping[]>();
  for (const mapping of mappings) {
    if (!mapping.canonicalField) continue;
    byCanonical.set(mapping.canonicalField, [
      ...(byCanonical.get(mapping.canonicalField) ?? []),
      mapping,
    ]);
  }
  for (const [field, candidates] of byCanonical) {
    if (candidates.length < 2) continue;
    const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
    if (sorted[0].confidence - sorted[1].confidence < 0.2) {
      for (const candidate of candidates) {
        candidate.conflict = true;
        candidate.evidence.push(`多个输入列可能映射为 ${field}，需要人工确认`);
      }
    }
  }
  return mappings;
}

export function scoreTable(headers: string[], mappings: FieldMapping[]): number {
  const fields = new Set(
    mappings.filter((mapping) => mapping.confidence >= 0.7).map((mapping) => mapping.canonicalField),
  );
  const explicitHeaderMatches = mappings.filter((mapping) =>
    mapping.matchMethod === "exact-synonym" || mapping.matchMethod === "combined-header",
  ).length;
  return (
    (fields.has("well") ? 8 : 0) +
    (fields.has("cq") ? 5 : 0) +
    (fields.has("sampleName") ? 4 : 0) +
    (fields.has("targetName") ? 4 : 0) +
    (fields.has("row") ? 1 : 0) +
    (fields.has("column") ? 1 : 0) +
    explicitHeaderMatches * 1.5 +
    Math.min(headers.filter(Boolean).length, 20) / 20
  );
}

export function findHeaderRow(matrix: unknown[][]): number {
  let best = { index: -1, score: -Infinity };
  matrix.slice(0, 25).forEach((row, index) => {
    const headers = row.map((value) => String(value ?? "").trim());
    const dataRows = matrix.slice(index + 1, index + 21);
    const score = scoreTable(headers, inferFieldMappings(headers, dataRows));
    if (score > best.score) best = { index, score };
  });
  return best.score >= 4 ? best.index : 0;
}
