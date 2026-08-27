import type { AnalysisStart, SuppliedCalculationProvenance, SuppliedCalculationRecord } from "../../schemas/src";

export type { SuppliedCalculationRecord } from "../../schemas/src";

export interface SuppliedCalculationSettings {
  analysisStart: Exclude<AnalysisStart, "cq">;
  calibratorValue: string;
}

export interface SuppliedCalculationResult {
  sampleName: string;
  targetName: string;
  analysisStart: Exclude<AnalysisStart, "cq">;
  valueProvenance: "user-supplied";
  validReplicates: number;
  deltaCq: number | null;
  deltaCqSd: number | null;
  deltaCqSem: number | null;
  normalizedQuantity: number | null;
  normalizedQuantitySd: number | null;
  normalizedQuantitySem: number | null;
  deltaDeltaCq: number | null;
  deltaDeltaCqSd: number | null;
  deltaDeltaCqSem: number | null;
  relativeExpression: number | null;
  relativeExpressionSd: number | null;
  relativeExpressionSem: number | null;
  calibratorValue: string;
  warningCodes: string[];
}

export const SUPPLIED_COMPLETE_HEADERS = [
  "analysis_start", "value_provenance", "reference_targets", "reference_method", "source_calibrator", "sample", "target", "valid_replicates",
  "delta_cq", "delta_cq_technical_sd", "delta_cq_technical_sem",
  "normalized_quantity_2^-delta_cq", "normalized_quantity_technical_sd", "normalized_quantity_technical_sem",
  "delta_delta_cq", "delta_delta_cq_technical_sd", "delta_delta_cq_technical_sem",
  "relative_expression_2^-delta_delta_cq", "relative_expression_technical_sd", "relative_expression_technical_sem",
  "calibrator", "warnings",
] as const;

export type SuppliedCompleteRow = Record<(typeof SUPPLIED_COMPLETE_HEADERS)[number], string | number | null>;

export const SUPPLIED_TRACEABILITY_HEADERS = [
  "analysis_start", "value_provenance", "reference_targets", "reference_method", "source_calibrator", "verification_status", "plate", "plate_format", "well",
  "sample", "target", "assay_type", "replicate", "supplied_value", "cycle_type", "tm1", "tm2",
  "source_sheet", "source_row", "warnings",
] as const;

export type SuppliedTraceabilityRow = Record<(typeof SUPPLIED_TRACEABILITY_HEADERS)[number], string | number | null>;

export const SUPPLIED_RESULTS_EXPORT_SCHEMA_VERSION = "1.1.0";

export interface SuppliedExportDictionaryEntry {
  sheet: "Complete Results" | "Supplied Values";
  field: string;
  definitionZh: string;
  definitionEn: string;
}

const SHARED_SUPPLIED_EXPORT_DEFINITIONS: Record<string, [string, string]> = {
  analysis_start: ["本次分析采用的用户计算起点：delta-cq 或 delta-delta-cq。", "Authoritative user-supplied calculation start: delta-cq or delta-delta-cq."],
  value_provenance: ["数值来源；user-supplied 表示由用户提供，不由系统从 Cq 重建。", "Value origin; user-supplied means the value was provided by the user and not reconstructed from Cq."],
  reference_targets: ["用户声明的上游内参基因；仅用于溯源，不参与再次归一化。", "User-declared upstream reference target(s); provenance only and never used to normalize again."],
  reference_method: ["用户声明的多内参或归一化处理方法；系统不据此重算。", "User-declared reference/normalization method; the system does not recalculate from it."],
  source_calibrator: ["导入文件声明的上游校准样本；与结果页后来选择的下游校准样本分开保存。", "Upstream calibrator declared by the imported file, stored separately from any downstream calibrator selected later."],
  sample: ["样本名称。", "Sample name."],
  target: ["目标基因或 Assay 名称。", "Target gene or assay name."],
  warnings: ["与该结果或原始输入行相关的可追溯警告代码。", "Traceable warning codes associated with the result or supplied row."],
};

const COMPLETE_ONLY_DEFINITIONS: Record<string, [string, string]> = {
  valid_replicates: ["进入汇总计算的有效技术复孔数；不是生物学样本量。", "Valid technical-replicate count used in the summary; not biological sample size."],
  delta_cq: ["用户提供 ΔCq 的技术复孔算术均值。", "Arithmetic mean of user-supplied technical-replicate ΔCq values."],
  delta_cq_technical_sd: ["用户提供 ΔCq 技术复孔的样本标准差（n−1）。", "Sample standard deviation (n−1) of user-supplied technical-replicate ΔCq values."],
  delta_cq_technical_sem: ["ΔCq 技术复孔 SD/√n。", "ΔCq technical-replicate SD divided by √n."],
  "normalized_quantity_2^-delta_cq": ["由平均 ΔCq 计算的 2^-ΔCq。", "2^-ΔCq calculated from the mean ΔCq."],
  normalized_quantity_technical_sd: ["将 ΔCq 技术 SD 通过 2^-x 一阶传播得到的 SD。", "SD propagated from ΔCq technical SD through the 2^-x transform."],
  normalized_quantity_technical_sem: ["将 ΔCq 技术 SEM 通过 2^-x 一阶传播得到的 SEM。", "SEM propagated from ΔCq technical SEM through the 2^-x transform."],
  delta_delta_cq: ["用户提供 ΔΔCq 的均值，或由用户提供 ΔCq 与当前下游校准样本计算。", "Mean user-supplied ΔΔCq, or ΔΔCq calculated from supplied ΔCq and the active downstream calibrator."],
  delta_delta_cq_technical_sd: ["ΔΔCq 的技术复孔传播 SD。", "Propagated technical-replicate SD of ΔΔCq."],
  delta_delta_cq_technical_sem: ["ΔΔCq 的技术复孔传播 SEM。", "Propagated technical-replicate SEM of ΔΔCq."],
  "relative_expression_2^-delta_delta_cq": ["由 ΔΔCq 计算的相对表达量 2^-ΔΔCq。", "Relative expression 2^-ΔΔCq calculated from ΔΔCq."],
  relative_expression_technical_sd: ["相对表达量的一阶传播技术 SD。", "First-order propagated technical SD of relative expression."],
  relative_expression_technical_sem: ["相对表达量的一阶传播技术 SEM。", "First-order propagated technical SEM of relative expression."],
  calibrator: ["本次结果计算实际使用的下游校准样本；为空表示未进行该步校准。", "Active downstream calibrator actually used for this result; blank means no downstream calibration was performed."],
};

const TRACEABILITY_ONLY_DEFINITIONS: Record<string, [string, string]> = {
  verification_status: ["该用户提供值的核验状态。", "Verification status of the user-supplied value."],
  plate: ["可选的来源孔板标识，仅用于溯源。", "Optional source plate identifier for provenance only."],
  plate_format: ["可选的来源板规格（96 或 384）。", "Optional source plate format (96 or 384)."],
  well: ["可选的来源物理孔位，仅用于溯源。", "Optional source physical well for provenance only."],
  assay_type: ["用户提供的 Assay 类型或角色。", "User-supplied assay type or role."],
  replicate: ["用户提供的技术复孔序号。", "User-supplied technical-replicate identifier."],
  supplied_value: ["用户导入的原始 ΔCq 或 ΔΔCq 数值，未被系统改写。", "Original imported ΔCq or ΔΔCq value, unchanged by the system."],
  cycle_type: ["用户提供的周期值类型标签。", "User-supplied cycle-value type label."],
  tm1: ["可选的第一熔解峰温度。", "Optional first melting-peak temperature."],
  tm2: ["可选的第二熔解峰温度。", "Optional second melting-peak temperature."],
  source_sheet: ["原始工作表名称。", "Original worksheet name."],
  source_row: ["原始工作表中的 1-based 行号。", "One-based row number in the original worksheet."],
};

function suppliedDictionaryEntries(
  sheet: SuppliedExportDictionaryEntry["sheet"],
  headers: readonly string[],
  specific: Record<string, [string, string]>,
): SuppliedExportDictionaryEntry[] {
  return headers.map((field) => {
    const [definitionZh, definitionEn] = SHARED_SUPPLIED_EXPORT_DEFINITIONS[field] ?? specific[field] ?? [field, field];
    return { sheet, field, definitionZh, definitionEn };
  });
}

export const SUPPLIED_EXPORT_DICTIONARY: SuppliedExportDictionaryEntry[] = [
  ...suppliedDictionaryEntries("Complete Results", SUPPLIED_COMPLETE_HEADERS, COMPLETE_ONLY_DEFINITIONS),
  ...suppliedDictionaryEntries("Supplied Values", SUPPLIED_TRACEABILITY_HEADERS, TRACEABILITY_ONLY_DEFINITIONS),
];

export interface SuppliedVisualizationBarRow {
  category: string;
  value: number;
  sd: number | null;
  sem: number | null;
  group: string;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

function sem(sd: number | null, count: number): number | null {
  return sd === null ? null : sd / Math.sqrt(count);
}

function exponentialError(quantity: number, cycleError: number | null): number | null {
  return cycleError === null ? null : Math.log(2) * quantity * cycleError;
}

function combineErrors(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : Math.sqrt(left ** 2 + right ** 2);
}

export function calculateFromSuppliedCalculations(
  records: SuppliedCalculationRecord[],
  settings: SuppliedCalculationSettings,
): SuppliedCalculationResult[] {
  const groups = new Map<string, SuppliedCalculationRecord[]>();
  for (const record of records) {
    if (!record.sampleName || !record.targetName || !Number.isFinite(record.value)) continue;
    const key = `${record.sampleName}\u241f${record.targetName}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  const summarized = [...groups.values()].map((group): SuppliedCalculationResult => {
    const values = group.map((record) => record.value);
    const center = mean(values);
    const sd = sampleSd(values);
    const standardError = sem(sd, values.length);
    const normalizedQuantity = settings.analysisStart === "delta-cq" ? 2 ** -center : null;
    const relativeExpression = settings.analysisStart === "delta-delta-cq" ? 2 ** -center : null;
    return {
      sampleName: group[0].sampleName,
      targetName: group[0].targetName,
      analysisStart: settings.analysisStart,
      valueProvenance: "user-supplied",
      validReplicates: values.length,
      deltaCq: settings.analysisStart === "delta-cq" ? center : null,
      deltaCqSd: settings.analysisStart === "delta-cq" ? sd : null,
      deltaCqSem: settings.analysisStart === "delta-cq" ? standardError : null,
      normalizedQuantity,
      normalizedQuantitySd: normalizedQuantity === null ? null : exponentialError(normalizedQuantity, sd),
      normalizedQuantitySem: normalizedQuantity === null ? null : exponentialError(normalizedQuantity, standardError),
      deltaDeltaCq: settings.analysisStart === "delta-delta-cq" ? center : null,
      deltaDeltaCqSd: settings.analysisStart === "delta-delta-cq" ? sd : null,
      deltaDeltaCqSem: settings.analysisStart === "delta-delta-cq" ? standardError : null,
      relativeExpression,
      relativeExpressionSd: relativeExpression === null ? null : exponentialError(relativeExpression, sd),
      relativeExpressionSem: relativeExpression === null ? null : exponentialError(relativeExpression, standardError),
      calibratorValue: settings.calibratorValue,
      warningCodes: values.length < 2 ? ["SUPPLIED_CALCULATION_SINGLETON"] : [],
    };
  });

  if (settings.analysisStart !== "delta-cq" || !settings.calibratorValue) return summarized;
  const calibrators = new Map(
    summarized
      .filter((row) => row.sampleName === settings.calibratorValue)
      .map((row) => [row.targetName, row]),
  );
  return summarized.map((row) => {
    const calibrator = calibrators.get(row.targetName);
    if (!calibrator || row.deltaCq === null || calibrator.deltaCq === null) {
      return { ...row, warningCodes: [...row.warningCodes, "CALIBRATOR_MISSING"] };
    }
    const deltaDeltaCq = row.deltaCq - calibrator.deltaCq;
    const deltaDeltaCqSd = row.sampleName === settings.calibratorValue
      ? row.deltaCqSd
      : combineErrors(row.deltaCqSd, calibrator.deltaCqSd);
    const deltaDeltaCqSem = row.sampleName === settings.calibratorValue
      ? row.deltaCqSem
      : combineErrors(row.deltaCqSem, calibrator.deltaCqSem);
    const relativeExpression = 2 ** -deltaDeltaCq;
    return {
      ...row,
      deltaDeltaCq,
      deltaDeltaCqSd,
      deltaDeltaCqSem,
      relativeExpression,
      relativeExpressionSd: exponentialError(relativeExpression, deltaDeltaCqSd),
      relativeExpressionSem: exponentialError(relativeExpression, deltaDeltaCqSem),
    };
  });
}

function orderResults(
  results: SuppliedCalculationResult[],
  sampleOrder: string[],
  targetOrder: string[],
): SuppliedCalculationResult[] {
  return results
    .filter((row) => sampleOrder.includes(row.sampleName) && targetOrder.includes(row.targetName))
    .sort((left, right) => {
      const targetComparison = targetOrder.indexOf(left.targetName) - targetOrder.indexOf(right.targetName);
      return targetComparison || sampleOrder.indexOf(left.sampleName) - sampleOrder.indexOf(right.sampleName);
    });
}

export function buildSuppliedCompleteRows(
  results: SuppliedCalculationResult[],
  sampleOrder: string[],
  targetOrder: string[],
  provenance: SuppliedCalculationProvenance | null = null,
): SuppliedCompleteRow[] {
  return orderResults(results, sampleOrder, targetOrder).map((row) => ({
    analysis_start: row.analysisStart,
    value_provenance: row.valueProvenance,
    reference_targets: provenance?.referenceTargets.join("; ") || null,
    reference_method: provenance?.referenceMethod || null,
    source_calibrator: provenance?.calibratorValue || null,
    sample: row.sampleName,
    target: row.targetName,
    valid_replicates: row.validReplicates,
    delta_cq: row.deltaCq,
    delta_cq_technical_sd: row.deltaCqSd,
    delta_cq_technical_sem: row.deltaCqSem,
    "normalized_quantity_2^-delta_cq": row.normalizedQuantity,
    normalized_quantity_technical_sd: row.normalizedQuantitySd,
    normalized_quantity_technical_sem: row.normalizedQuantitySem,
    delta_delta_cq: row.deltaDeltaCq,
    delta_delta_cq_technical_sd: row.deltaDeltaCqSd,
    delta_delta_cq_technical_sem: row.deltaDeltaCqSem,
    "relative_expression_2^-delta_delta_cq": row.relativeExpression,
    relative_expression_technical_sd: row.relativeExpressionSd,
    relative_expression_technical_sem: row.relativeExpressionSem,
    calibrator: row.calibratorValue || null,
    warnings: [...row.warningCodes, ...(!provenance?.referenceTargets.length ? ["REFERENCE_TARGET_NOT_PROVIDED"] : [])].join("; "),
  }));
}

export function buildSuppliedTraceabilityRows(
  records: SuppliedCalculationRecord[],
  provenance: SuppliedCalculationProvenance | null = null,
): SuppliedTraceabilityRow[] {
  return records.map((record) => ({
    analysis_start: record.analysisStart ?? null,
    value_provenance: "user-supplied",
    reference_targets: provenance?.referenceTargets.join("; ") || null,
    reference_method: provenance?.referenceMethod || null,
    source_calibrator: provenance?.calibratorValue || null,
    verification_status: record.verificationStatus,
    plate: record.plateName ?? null,
    plate_format: record.plateFormat ?? null,
    well: record.well ?? null,
    sample: record.sampleName,
    target: record.targetName,
    assay_type: record.assayType || null,
    replicate: record.replicate,
    supplied_value: record.value,
    cycle_type: record.cycleType || null,
    tm1: record.tm1 ?? null,
    tm2: record.tm2 ?? null,
    source_sheet: record.sourceSheet ?? null,
    source_row: record.sourceRowNumber ?? null,
    warnings: !provenance?.referenceTargets.length ? "REFERENCE_TARGET_NOT_PROVIDED" : "",
  }));
}

export function buildSuppliedVisualizationBarRows(
  results: SuppliedCalculationResult[],
  sampleOrder: string[],
  targetOrder: string[],
): SuppliedVisualizationBarRow[] {
  return orderResults(results, sampleOrder, targetOrder).flatMap((row) => {
    const value = row.relativeExpression ?? row.normalizedQuantity;
    if (value === null) return [];
    return [{
      category: row.sampleName,
      value,
      sd: row.relativeExpression !== null ? row.relativeExpressionSd : row.normalizedQuantitySd,
      sem: row.relativeExpression !== null ? row.relativeExpressionSem : row.normalizedQuantitySem,
      group: row.targetName,
    }];
  });
}
