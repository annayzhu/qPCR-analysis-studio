import type { ImportDecision } from "../../schemas/src";

export const IMPORT_DECISION_HEADERS = [
  "timestamp", "actor", "source_file", "source_sheet", "source_row", "scope", "field",
  "action", "issue_code", "original_value", "new_value", "reason",
] as const;

export type ImportDecisionExportRow = Record<(typeof IMPORT_DECISION_HEADERS)[number], string | number | null>;

export interface ImportDecisionExportDictionaryEntry {
  sheet: "Import Decisions";
  field: (typeof IMPORT_DECISION_HEADERS)[number];
  definitionZh: string;
  definitionEn: string;
}

const IMPORT_DECISION_DEFINITIONS: Record<(typeof IMPORT_DECISION_HEADERS)[number], [string, string]> = {
  timestamp: ["用户作出该导入决定的 ISO 8601 时间。", "ISO 8601 time when the import decision was recorded."],
  actor: ["执行修正、排除、确认或恢复的主体。", "Actor who edited, excluded, confirmed, or restored the import item."],
  source_file: ["原始上传文件名。", "Original uploaded file name."],
  source_sheet: ["决定所属的原始工作表。", "Original worksheet associated with the decision."],
  source_row: ["原始工作表中的 1-based 行号；文件级决定为空。", "One-based row number in the source worksheet; blank for source-level decisions."],
  scope: ["决定范围：source 或 row。", "Decision scope: source or row."],
  field: ["被审核的统一字段，row 表示整行。", "Canonical field under review; row denotes the entire source row."],
  action: ["导入动作：edit、exclude、confirm 或 restore。", "Import action: edit, exclude, confirm, or restore."],
  issue_code: ["触发该决定的稳定问题代码。", "Stable issue code that prompted the decision."],
  original_value: ["原始上传值，保持不变。", "Original uploaded value, retained unchanged."],
  new_value: ["用户修正值；非 edit 动作通常为空。", "User-corrected value; normally blank for actions other than edit."],
  reason: ["用户决定的原因或处理说明。", "Reason or handling note recorded for the decision."],
};

export const IMPORT_DECISION_EXPORT_DICTIONARY: ImportDecisionExportDictionaryEntry[] = IMPORT_DECISION_HEADERS.map((field) => {
  const [definitionZh, definitionEn] = IMPORT_DECISION_DEFINITIONS[field];
  return { sheet: "Import Decisions", field, definitionZh, definitionEn };
});

export function buildImportDecisionRows(decisions: ImportDecision[]): ImportDecisionExportRow[] {
  return decisions.map((decision) => ({
    timestamp: decision.timestamp,
    actor: decision.actor,
    source_file: decision.sourceFileName,
    source_sheet: decision.sourceSheet,
    source_row: decision.sourceRowNumber,
    scope: decision.scope,
    field: decision.field,
    action: decision.action,
    issue_code: decision.issueCode,
    original_value: decision.originalValue,
    new_value: decision.newValue,
    reason: decision.reason,
  }));
}
