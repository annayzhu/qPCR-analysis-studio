import type { CanonicalDataset, CanonicalField, ImportedSource } from "../../schemas/src";
import { physicalWellIdOf } from "../../schemas/src";
import { selectedTable } from "./adapters";
import { validateQpcrInputTemplate } from "./user-template";

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
  analysisMode: "quantification" | "melt-only" | null;
  resultIncludesPlateLayout: boolean;
  layoutRequired: boolean;
  primaryResultCount: number;
  supplementalResultCount: number;
  layoutCount: number;
  message: string;
}

export interface AlignmentIssue {
  wellId: string;
  plateId: string;
  well: string;
}

export interface DatasetAlignment {
  status: "aligned" | "needs-correction" | "not-applicable";
  joinedDetectedCount: number;
  resultWithoutAnnotation: AlignmentIssue[];
  annotationWithoutResult: AlignmentIssue[];
  plateIdentityConflicts: string[];
  duplicateDestinations: AlignmentIssue[];
  incompleteReplicateGroups: Array<{
    plateId: string;
    sampleName: string;
    targetName: string;
    wellIds: string[];
  }>;
}

const CYCLE_START_CRITICAL_FIELDS = new Set<CanonicalField>(["well", "sampleName", "targetName", "cq"]);

export function assessDatasetAlignment(
  dataset: CanonicalDataset,
  analysisMode: ImportReadiness["analysisMode"],
): DatasetAlignment {
  if (analysisMode !== "quantification" || dataset.analysisStart !== "cq") {
    return {
      status: "not-applicable",
      joinedDetectedCount: 0,
      resultWithoutAnnotation: [],
      annotationWithoutResult: [],
      plateIdentityConflicts: [],
      duplicateDestinations: [],
      incompleteReplicateGroups: [],
    };
  }

  const issue = (well: CanonicalDataset["wells"][number]): AlignmentIssue => ({
    wellId: well.id,
    plateId: well.plateId,
    well: well.well,
  });
  const resultWithoutAnnotation = dataset.wells
    .filter((well) => well.cqStatus === "detected" && well.cq !== null && (!well.sampleName || !well.targetName))
    .map(issue);
  const annotationWithoutResult = dataset.wells
    .filter((well) => well.sampleName && well.targetName && well.cqStatus === "missing")
    .map(issue);
  const joinedDetectedCount = dataset.wells.filter(
    (well) => well.cqStatus === "detected" && well.cq !== null && well.sampleName && well.targetName,
  ).length;
  const plateIdentityConflicts = dataset.warnings.filter((warning) =>
    /无法自动判断板布局|plate identity|孔板身份/i.test(warning));
  const physicalGroups = new Map<string, CanonicalDataset["wells"]>();
  const replicateGroups = new Map<string, CanonicalDataset["wells"]>();
  for (const well of dataset.wells) {
    const physicalKey = physicalWellIdOf(well);
    physicalGroups.set(physicalKey, [...(physicalGroups.get(physicalKey) ?? []), well]);
    if (well.sampleName && well.targetName) {
      const replicateKey = `${well.plateId}\u241f${well.sampleName}\u241f${well.targetName}`;
      replicateGroups.set(replicateKey, [...(replicateGroups.get(replicateKey) ?? []), well]);
    }
  }
  const duplicateDestinations = [...physicalGroups.values()]
    .filter((wells) => wells.length > 1)
    .flatMap((wells) => wells.map(issue));
  const incompleteReplicateGroups = [...replicateGroups.values()].flatMap((wells) => {
    if (wells.length < 2) return [];
    const identifiers = wells.map((well) => well.replicate);
    const numeric = identifiers.filter((value): value is number => value !== null);
    const unique = new Set(numeric);
    const complete = numeric.length === wells.length
      && unique.size === wells.length
      && Math.min(...numeric) === 1
      && Math.max(...numeric) === wells.length;
    return complete ? [] : [{
      plateId: wells[0].plateId,
      sampleName: wells[0].sampleName,
      targetName: wells[0].targetName,
      wellIds: wells.map((well) => well.id),
    }];
  });

  return {
    status: resultWithoutAnnotation.length || annotationWithoutResult.length || plateIdentityConflicts.length || duplicateDestinations.length
      ? "needs-correction"
      : "aligned",
    joinedDetectedCount,
    resultWithoutAnnotation,
    annotationWithoutResult,
    plateIdentityConflicts,
    duplicateDestinations,
    incompleteReplicateGroups,
  };
}

export function getUnresolvedAlignmentIssues(
  alignment: DatasetAlignment,
  reviewedWellIds: Iterable<string>,
): AlignmentIssue[] {
  const reviewed = new Set(reviewedWellIds);
  return [...alignment.resultWithoutAnnotation, ...alignment.annotationWithoutResult]
    .filter((issue) => !reviewed.has(issue.wellId));
}

export function getAnalysisBlockingError(
  dataset: CanonicalDataset,
  analysisMode: ImportReadiness["analysisMode"],
): string | null {
  if (analysisMode !== "quantification" || dataset.analysisStart !== "cq") return null;
  return assessDatasetAlignment(dataset, analysisMode).joinedDetectedCount
    ? null
    : "未找到与样本和基因正确合并的有效 Cq/Ct/Cp。请检查结果文件与板布局的板名和孔位是否对应。";
}

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
  const analysisStart = source.metadata.qpcrAnalysisStart;
  const criticalFields = analysisStart === "delta-cq"
    ? new Set<CanonicalField>(["sampleName", "targetName", "replicate", "deltaCq"])
    : analysisStart === "delta-delta-cq"
      ? new Set<CanonicalField>(["sampleName", "targetName", "replicate", "deltaDeltaCq"])
      : CYCLE_START_CRITICAL_FIELDS;
  const blockingConflicts = table.suggestedMappings
    .filter((mapping) => mapping.conflict && mapping.canonicalField && criticalFields.has(mapping.canonicalField))
    .map((mapping) => mapping.sourceColumn);
  const hasWell = fieldSet.has("well") || (fieldSet.has("row") && fieldSet.has("column"));
  const hasCq = fieldSet.has("cq");
  const hasTm = fieldSet.has("tm1") || fieldSet.has("tm2");
  const hasMeltSummary = fieldSet.has("meltGroup") || fieldSet.has("meltScore") || fieldSet.has("meltResolution");
  const hasSampleName = fieldSet.has("sampleName");
  const hasTargetName = fieldSet.has("targetName");
  const includesPlateLayout = analysisStart !== "delta-cq"
    && analysisStart !== "delta-delta-cq"
    && hasWell
    && hasSampleName
    && hasTargetName;
  const hasSelectedCalculation =
    (analysisStart === "delta-cq" && fieldSet.has("deltaCq"))
    || (analysisStart === "delta-delta-cq" && fieldSet.has("deltaDeltaCq"));
  const hasAuthoritativeQuantification = analysisStart === "delta-cq" || analysisStart === "delta-delta-cq"
    ? hasSelectedCalculation
    : hasCq;

  let role: ImportSourceRole = "unknown";
  if (hasAuthoritativeQuantification) role = "primary-result";
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
  const templateValidation = sources.map(validateQpcrInputTemplate).filter((item) => item !== null);
  const hasTemplateErrors = templateValidation.some((item) => item.errorCount > 0);
  const analysisResults = [...primaryResults, ...supplementalResults];
  const analysisMode = primaryResults.length ? "quantification" : supplementalResults.length ? "melt-only" : null;
  const resultIncludesPlateLayout = analysisResults.some((item) => item.includesPlateLayout);
  const calculationOnly = sources.some((source) => source.metadata.qpcrAnalysisStart === "delta-cq"
    || source.metadata.qpcrAnalysisStart === "delta-delta-cq");
  const layoutRequired = !calculationOnly && analysisResults.length > 0 && !resultIncludesPlateLayout;

  if (hasTemplateErrors) {
    return {
      status: "review-mapping",
      canAnalyze: false,
      analysisMode,
      resultIncludesPlateLayout,
      layoutRequired,
      primaryResultCount: primaryResults.length,
      supplementalResultCount: supplementalResults.length,
      layoutCount: layouts.length,
      message: "数据模板存在阻断错误。请按工作表、行号和列提示修正后重新导入。",
    };
  }

  if (!analysisResults.length) {
    return {
      status: "waiting-results",
      canAnalyze: false,
      analysisMode: null,
      resultIncludesPlateLayout: false,
      layoutRequired: false,
      primaryResultCount: 0,
      supplementalResultCount: supplementalResults.length,
      layoutCount: layouts.length,
      message: "请先导入 Cq/Ct/Cp 或 Tm/熔解结果文件。",
    };
  }

  if (hasBlockingConflict) {
    return {
      status: "review-mapping",
      canAnalyze: false,
      analysisMode,
      resultIncludesPlateLayout,
      layoutRequired,
      primaryResultCount: primaryResults.length,
      supplementalResultCount: supplementalResults.length,
      layoutCount: layouts.length,
      message: "关键字段存在映射冲突，请确认孔位、样本、基因或结果字段后再分析。",
    };
  }

  if (layoutRequired && !layouts.length) {
    return {
      status: "waiting-layout",
      canAnalyze: false,
      analysisMode,
      resultIncludesPlateLayout: false,
      layoutRequired: true,
      primaryResultCount: primaryResults.length,
      supplementalResultCount: supplementalResults.length,
      layoutCount: 0,
      message: "结果文件未包含完整的 Sample/Target 信息，请再导入修正后的板布局。",
    };
  }

  return {
    status: "ready",
    canAnalyze: true,
    analysisMode,
    resultIncludesPlateLayout,
    layoutRequired,
    primaryResultCount: primaryResults.length,
    supplementalResultCount: supplementalResults.length,
    layoutCount: layouts.length,
    message: calculationOnly
      ? "当前分析从用户提供的 ΔCq/ΔΔCq 开始，无需板布局；计算结果已就绪。"
      : analysisMode === "melt-only"
      ? "Tm/熔解结果与板布局已就绪，可进入熔解分析；相对定量仍需 Cq/Ct/Cp。"
      : resultIncludesPlateLayout
        ? "结果文件已包含板布局信息，无需另传布局；相对定量已就绪。"
        : "仪器结果与板布局均已就绪；相对定量已自动计算。",
  };
}
