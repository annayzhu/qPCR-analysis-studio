import type { CanonicalField, ImportedSource } from "../../schemas/src";
import { selectedTable } from "./adapters";

export type ImportSourceRole = "primary-result" | "supplemental-result" | "plate-layout" | "unknown";

export interface SourceCapabilities {
  role: ImportSourceRole;
  fields: CanonicalField[];
  hasWell: boolean;
  hasCq: boolean;
  hasTm: boolean;
  hasMeltSummary: boolean;
  hasSampleName: boolean;
  hasTargetName: boolean;
  includesPlateLayout: boolean;
  blockingConflicts: string[];
}

export interface ImportReadiness {
  status: "waiting-results" | "waiting-layout" | "review-mapping" | "ready";
  canAnalyze: boolean;
  resultIncludesPlateLayout: boolean;
  layoutRequired: boolean;
  primaryResultCount: number;
  supplementalResultCount: number;
  layoutCount: number;
  message: string;
}

const CRITICAL_FIELDS = new Set<CanonicalField>(["well", "sampleName", "targetName", "cq"]);

export function getSourceCapabilities(source: ImportedSource): SourceCapabilities {
  const table = selectedTable(source);
  if (!table) {
    return {
      role: "unknown",
      fields: [],
      hasWell: false,
      hasCq: false,
      hasTm: false,
      hasMeltSummary: false,
      hasSampleName: false,
      hasTargetName: false,
      includesPlateLayout: false,
      blockingConflicts: [],
    };
  }

  const acceptedMappings = table.suggestedMappings.filter(
    (mapping) => mapping.canonicalField && mapping.confidence >= 0.7 && !mapping.conflict,
  );
  const fields = [...new Set(acceptedMappings.map((mapping) => mapping.canonicalField!))];
  const fieldSet = new Set(fields);
  const blockingConflicts = table.suggestedMappings
    .filter((mapping) => mapping.conflict && mapping.canonicalField && CRITICAL_FIELDS.has(mapping.canonicalField))
    .map((mapping) => mapping.sourceColumn);
  const hasWell = fieldSet.has("well") || (fieldSet.has("row") && fieldSet.has("column"));
  const hasCq = fieldSet.has("cq");
  const hasTm = fieldSet.has("tm1") || fieldSet.has("tm2");
  const hasMeltSummary = fieldSet.has("meltGroup") || fieldSet.has("meltScore") || fieldSet.has("meltResolution");
  const hasSampleName = fieldSet.has("sampleName");
  const hasTargetName = fieldSet.has("targetName");
  const includesPlateLayout = hasWell && hasSampleName && hasTargetName;

  let role: ImportSourceRole = "unknown";
  if (hasCq) role = "primary-result";
  else if (hasTm || hasMeltSummary) role = "supplemental-result";
  else if (includesPlateLayout) role = "plate-layout";

  return {
    role,
    fields,
    hasWell,
    hasCq,
    hasTm,
    hasMeltSummary,
    hasSampleName,
    hasTargetName,
    includesPlateLayout,
    blockingConflicts,
  };
}

export function assessImportReadiness(sources: ImportedSource[]): ImportReadiness {
  const capabilities = sources.map(getSourceCapabilities);
  const primaryResults = capabilities.filter((item) => item.role === "primary-result");
  const supplementalResults = capabilities.filter((item) => item.role === "supplemental-result");
  const layouts = capabilities.filter((item) => item.role === "plate-layout");
  const hasBlockingConflict = capabilities.some((item) => item.blockingConflicts.length > 0);
  const resultIncludesPlateLayout = primaryResults.some((item) => item.includesPlateLayout);
  const layoutRequired = primaryResults.length > 0 && !resultIncludesPlateLayout;

  if (!primaryResults.length) {
    return {
      status: "waiting-results",
      canAnalyze: false,
      resultIncludesPlateLayout: false,
      layoutRequired: false,
      primaryResultCount: 0,
      supplementalResultCount: supplementalResults.length,
      layoutCount: layouts.length,
      message: "请先导入至少一个包含单孔 Cq/Ct/Cp 的仪器结果文件。",
    };
  }

  if (hasBlockingConflict) {
    return {
      status: "review-mapping",
      canAnalyze: false,
      resultIncludesPlateLayout,
      layoutRequired,
      primaryResultCount: primaryResults.length,
      supplementalResultCount: supplementalResults.length,
      layoutCount: layouts.length,
      message: "关键字段存在映射冲突，请确认孔位、样本、基因或 Cq 字段后再计算。",
    };
  }

  if (layoutRequired && !layouts.length) {
    return {
      status: "waiting-layout",
      canAnalyze: false,
      resultIncludesPlateLayout: false,
      layoutRequired: true,
      primaryResultCount: primaryResults.length,
      supplementalResultCount: supplementalResults.length,
      layoutCount: 0,
      message: "结果文件未包含完整的 Sample/Target 信息，请再导入板布局。",
    };
  }

  return {
    status: "ready",
    canAnalyze: true,
    resultIncludesPlateLayout,
    layoutRequired,
    primaryResultCount: primaryResults.length,
    supplementalResultCount: supplementalResults.length,
    layoutCount: layouts.length,
    message: resultIncludesPlateLayout
      ? "结果文件已包含板布局信息，无需另传布局；数据已具备自动计算条件。"
      : "仪器结果与板布局均已就绪；数据已具备自动计算条件。",
  };
}
