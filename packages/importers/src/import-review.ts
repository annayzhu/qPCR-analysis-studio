import type {
  CanonicalField,
  ImportDecision,
  ImportDecisionField,
  ImportedSource,
  ImportedTable,
  RawImportedRow,
} from "../../schemas/src";
import { selectedTable } from "./adapters";

export interface RecordImportDecisionInput {
  scope: "source" | "row";
  sourceSheet?: string;
  sourceRowNumber?: number;
  field: ImportDecisionField;
  action: ImportDecision["action"];
  issueCode?: string;
  newValue?: string;
  reason: string;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim();
}

function stableDecisionId(source: ImportedSource, input: RecordImportDecisionInput, sequence: number): string {
  const seed = [source.id, input.scope, input.sourceSheet ?? "", input.sourceRowNumber ?? "", input.field, input.action, sequence].join("\u241f");
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `import-decision-${(hash >>> 0).toString(36)}`;
}

export function sourceColumnForImportField(table: ImportedTable, field: ImportDecisionField): string {
  if (field === "plateFormat") {
    return table.headers.find((header) => /^(?:plate\s*format|plate\s*size|板型)$/i.test(header.normalize("NFKC").trim())) ?? "";
  }
  if (field === "referenceTargets" || field === "row") return "";
  return table.suggestedMappings.find((mapping) => (
    mapping.canonicalField === field
    && mapping.confidence >= 0.7
    && !mapping.conflict
  ))?.sourceColumn ?? "";
}

function originalValueForDecision(source: ImportedSource, input: RecordImportDecisionInput): { sourceSheet: string; sourceColumn: string; value: string } {
  if (input.scope === "source") {
    return {
      sourceSheet: "Analysis Settings",
      sourceColumn: "Reference Target(s)",
      value: normalizeText(source.metadata.qpcrReferenceTargets),
    };
  }
  const table = source.tables.find((item) => item.sourceSheet === input.sourceSheet) ?? selectedTable(source);
  const row = table?.rawRows.find((item) => item.sourceRowNumber === input.sourceRowNumber);
  const sourceColumn = table ? sourceColumnForImportField(table, input.field) : "";
  return {
    sourceSheet: table?.sourceSheet ?? input.sourceSheet ?? "",
    sourceColumn,
    value: sourceColumn && row ? normalizeText(row.rawValues[sourceColumn]) : "",
  };
}

export function recordImportDecision(source: ImportedSource, input: RecordImportDecisionInput): ImportedSource {
  const original = originalValueForDecision(source, input);
  const decisions = source.importDecisions ?? [];
  const decision: ImportDecision = {
    id: stableDecisionId(source, input, decisions.length),
    scope: input.scope,
    sourceId: source.id,
    sourceFileName: source.fileName,
    sourceSheet: original.sourceSheet,
    sourceRowNumber: input.scope === "row" ? input.sourceRowNumber ?? null : null,
    sourceColumn: original.sourceColumn,
    field: input.field,
    action: input.action,
    issueCode: input.issueCode ?? "manual-import-review",
    originalValue: original.value,
    newValue: normalizeText(input.newValue),
    reason: input.reason.trim(),
    actor: "user",
    timestamp: new Date().toISOString(),
  };
  return { ...source, importDecisions: [...decisions, decision] };
}

function latestDecision(source: ImportedSource, predicate: (decision: ImportDecision) => boolean): ImportDecision | undefined {
  return [...(source.importDecisions ?? [])].reverse().find(predicate);
}

export function latestImportRowDecision(
  source: ImportedSource,
  row: RawImportedRow,
  field: ImportDecisionField,
  sourceColumn = "",
): ImportDecision | undefined {
  return latestDecision(source, (decision) => (
    decision.scope === "row"
    && decision.sourceSheet === row.sourceSheet
    && decision.sourceRowNumber === row.sourceRowNumber
    && decision.field === field
    && (!sourceColumn || !decision.sourceColumn || decision.sourceColumn === sourceColumn)
  ));
}

export function effectiveImportRowValue(
  source: ImportedSource,
  table: ImportedTable,
  row: RawImportedRow,
  field: ImportDecisionField,
): string {
  const sourceColumn = sourceColumnForImportField(table, field);
  const original = sourceColumn ? normalizeText(row.rawValues[sourceColumn]) : "";
  const decision = latestImportRowDecision(source, row, field, sourceColumn);
  return decision?.action === "edit" ? decision.newValue : original;
}

export function isImportRowExcluded(source: ImportedSource, row: RawImportedRow): boolean {
  return latestImportRowDecision(source, row, "row")?.action === "exclude";
}

export function latestImportRowExclusion(source: ImportedSource, row: RawImportedRow): ImportDecision | undefined {
  const decision = latestImportRowDecision(source, row, "row");
  return decision?.action === "exclude" ? decision : undefined;
}

export function isImportIssueConfirmed(
  source: ImportedSource,
  issueCode: string,
  field: ImportDecisionField,
  sourceSheet: string,
  sourceRowNumber: number | null,
): boolean {
  return latestDecision(source, (decision) => (
    decision.issueCode === issueCode
    && decision.field === field
    && decision.sourceSheet === sourceSheet
    && decision.sourceRowNumber === sourceRowNumber
  ))?.action === "confirm";
}

export function effectiveImportMetadata(source: ImportedSource, field: "referenceTargets"): string {
  const decision = latestDecision(source, (item) => item.scope === "source" && item.field === field);
  if (decision?.action === "edit") return decision.newValue;
  return normalizeText(source.metadata.qpcrReferenceTargets);
}

export function importRowDecisionStatus(source: ImportedSource, row: RawImportedRow): {
  status: "included" | "corrected" | "excluded";
  exclusion: ImportDecision | undefined;
  latestTimestamp: string | null;
  corrected: boolean;
} {
  const rowDecisions = (source.importDecisions ?? []).filter((decision) => (
    decision.scope === "row"
    && decision.sourceSheet === row.sourceSheet
    && decision.sourceRowNumber === row.sourceRowNumber
  ));
  const latestByField = new Map<ImportDecisionField, ImportDecision>();
  for (const decision of rowDecisions) latestByField.set(decision.field, decision);
  const activeRowDecisions = [...latestByField.values()].filter((decision) => decision.action !== "restore");
  const exclusion = latestImportRowExclusion(source, row);
  const corrected = activeRowDecisions.some((decision) => decision.action === "edit");
  return {
    status: exclusion ? "excluded" : corrected ? "corrected" : "included",
    exclusion,
    latestTimestamp: rowDecisions.at(-1)?.timestamp ?? null,
    corrected,
  };
}

export function activeImportDecisions(source: ImportedSource): ImportDecision[] {
  return source.importDecisions ?? [];
}

export function importDecisionFieldLabel(field: ImportDecisionField): string {
  const labels: Partial<Record<ImportDecisionField, string>> = {
    sampleName: "Sample",
    targetName: "Assay",
    replicate: "Replicate",
    cq: "Cq/Ct/Cp",
    deltaCq: "Delta Cq",
    deltaDeltaCq: "Delta Delta Cq",
    well: "Well",
    plateName: "Plate",
    plateFormat: "Plate Format",
    tm1: "Tm1",
    tm2: "Tm2",
    referenceTargets: "Reference Target(s)",
    row: "Row",
  };
  return labels[field] ?? field;
}

export function isEditableImportField(field: ImportDecisionField): field is CanonicalField | "plateFormat" | "referenceTargets" {
  return field !== "row";
}
