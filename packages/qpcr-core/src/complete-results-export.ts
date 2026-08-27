import type { AnalysisSettings, RelativeQuantificationResult, WellRecord } from "../../schemas/src";

export const COMPLETE_RESULTS_SCHEMA_VERSION = "2.0.0";

export const COMPLETE_RESULTS_HEADERS = [
  "schema_version",
  "sample",
  "assay",
  "assay_type_role",
  "reference_assays",
  "calibrator",
  "calculation_mode",
  "target_valid_replicates",
  "target_mean_cq",
  "target_technical_sd",
  "target_technical_sem",
  "reference_valid_replicates",
  "reference_replicates_by_assay",
  "reference_mean_cq",
  "reference_technical_sd",
  "reference_technical_sem",
  "delta_cq",
  "delta_cq_technical_sd",
  "delta_cq_technical_sem",
  "normalized_quantity_2^-delta_cq",
  "normalized_quantity_technical_sd",
  "normalized_quantity_technical_sem",
  "delta_delta_cq",
  "delta_delta_cq_technical_sd",
  "delta_delta_cq_technical_sem",
  "relative_expression",
  "relative_expression_technical_sd",
  "relative_expression_technical_sem",
  "warnings",
  "notes",
] as const;

export type CompleteResultRow = Record<(typeof COMPLETE_RESULTS_HEADERS)[number], string | number | null>;

export const PLATE_SUMMARY_HEADERS = [
  "schema_version", "plate", "sample", "assay", "assay_type_role", "is_reference_assay",
  "valid_replicates", "mean_cq", "technical_sd", "technical_sem", "reference_assays",
  "reference_center_mean_cq", "reference_center_propagated_sd", "reference_center_propagated_sem",
  "plate_delta_cq", "plate_delta_cq_propagated_sd", "plate_delta_cq_propagated_sem",
  "plate_normalized_quantity", "plate_normalized_quantity_propagated_sd",
  "plate_normalized_quantity_propagated_sem", "calculation_base", "notes",
] as const;

export const WELL_CALCULATION_HEADERS = [
  "schema_version", "source_file", "source_sheet", "source_row", "raw_row_values_json", "plate", "well", "record_id",
  "sample", "assay", "assay_type_role", "is_reference_assay", "replicate", "cq", "cq_status",
  "instrument_omit", "user_excluded", "included_in_calculation", "inclusion_reason", "used_in_final_result",
  "reference_assays", "reference_center_mean_cq", "reference_center_propagated_sd",
  "reference_center_propagated_sem", "well_delta_cq_cq_minus_reference_center",
  "well_normalized_quantity", "plate_assay_mean_cq", "plate_assay_technical_sd",
  "plate_assay_technical_sem", "sample_assay_delta_cq", "calibrator_delta_cq_same_assay",
  "sample_assay_delta_delta_cq", "sample_assay_relative_expression", "warnings",
] as const;

export type PlateSummaryRow = Record<(typeof PLATE_SUMMARY_HEADERS)[number], string | number | null>;
export type WellCalculationRow = Record<(typeof WELL_CALCULATION_HEADERS)[number], string | number | null>;

export interface CalculationDictionaryEntry {
  sheet: string;
  field: string;
  levelZh: string;
  definitionZh: string;
  definitionEn: string;
  formula: string;
  unit: string;
  cautionZh: string;
  cautionEn: string;
}

export interface CalculationGuideRow {
  step: number;
  nameZh: string;
  nameEn: string;
  formula: string;
  explanationZh: string;
  explanationEn: string;
}

export const COMPLETE_RESULTS_DICTIONARY: Array<{
  field: (typeof COMPLETE_RESULTS_HEADERS)[number];
  definitionZh: string;
  definitionEn: string;
}> = [
  { field: "schema_version", definitionZh: "完整结果导出结构版本", definitionEn: "Complete-results export schema version" },
  { field: "sample", definitionZh: "生物学样本标识", definitionEn: "Biological sample identifier" },
  { field: "assay", definitionZh: "目标基因或检测项目", definitionEn: "Target assay" },
  { field: "assay_type_role", definitionZh: "本结果行的反应角色", definitionEn: "Reaction role represented by this result row" },
  { field: "reference_assays", definitionZh: "参与归一化的内参集合", definitionEn: "Reference assays used for normalization" },
  { field: "calibrator", definitionZh: "ΔΔCq 校准样本", definitionEn: "Delta-delta-Cq calibrator sample" },
  { field: "calculation_mode", definitionZh: "计算模式", definitionEn: "Calculation mode" },
  { field: "target_valid_replicates", definitionZh: "目标基因有效技术复孔数", definitionEn: "Valid target technical-replicate count" },
  { field: "target_mean_cq", definitionZh: "目标基因单孔 Cq 算术均值", definitionEn: "Arithmetic mean of target single-well Cq values" },
  { field: "target_technical_sd", definitionZh: "目标技术复孔样本 SD（n−1）", definitionEn: "Target technical-replicate sample SD (n-1)" },
  { field: "target_technical_sem", definitionZh: "目标技术复孔 SEM", definitionEn: "Target technical-replicate SEM" },
  { field: "reference_valid_replicates", definitionZh: "所有内参有效技术复孔总数", definitionEn: "Total valid technical replicates across references" },
  { field: "reference_replicates_by_assay", definitionZh: "各内参有效复孔数", definitionEn: "Valid replicate counts by reference assay" },
  { field: "reference_mean_cq", definitionZh: "多内参 mean Cq 的算术均值", definitionEn: "Arithmetic mean of reference-assay mean Cq values" },
  { field: "reference_technical_sd", definitionZh: "多内参经四分量传播的技术 SD", definitionEn: "Quadrature-propagated reference technical SD" },
  { field: "reference_technical_sem", definitionZh: "多内参经四分量传播的技术 SEM", definitionEn: "Quadrature-propagated reference technical SEM" },
  { field: "delta_cq", definitionZh: "目标 mean Cq − 内参 mean Cq", definitionEn: "Target mean Cq minus reference mean Cq" },
  { field: "delta_cq_technical_sd", definitionZh: "ΔCq 传播技术 SD", definitionEn: "Propagated technical SD of delta Cq" },
  { field: "delta_cq_technical_sem", definitionZh: "ΔCq 传播技术 SEM", definitionEn: "Propagated technical SEM of delta Cq" },
  { field: "normalized_quantity_2^-delta_cq", definitionZh: "归一化量 2^-ΔCq（效率校正时使用相应底数）", definitionEn: "Normalized quantity 2^-delta Cq (or efficiency-adjusted base)" },
  { field: "normalized_quantity_technical_sd", definitionZh: "归一化量传播技术 SD", definitionEn: "Propagated technical SD of normalized quantity" },
  { field: "normalized_quantity_technical_sem", definitionZh: "归一化量传播技术 SEM", definitionEn: "Propagated technical SEM of normalized quantity" },
  { field: "delta_delta_cq", definitionZh: "样本 ΔCq − 校准样本 ΔCq", definitionEn: "Sample delta Cq minus calibrator delta Cq" },
  { field: "delta_delta_cq_technical_sd", definitionZh: "ΔΔCq 传播技术 SD", definitionEn: "Propagated technical SD of delta-delta Cq" },
  { field: "delta_delta_cq_technical_sem", definitionZh: "ΔΔCq 传播技术 SEM", definitionEn: "Propagated technical SEM of delta-delta Cq" },
  { field: "relative_expression", definitionZh: "相对表达量；校准样本中心定义为 1", definitionEn: "Relative expression; calibrator center is defined as 1" },
  { field: "relative_expression_technical_sd", definitionZh: "相对表达量传播技术 SD；校准样本可非零", definitionEn: "Propagated technical SD of relative expression; may be nonzero for calibrator" },
  { field: "relative_expression_technical_sem", definitionZh: "相对表达量传播技术 SEM；校准样本可非零", definitionEn: "Propagated technical SEM of relative expression; may be nonzero for calibrator" },
  { field: "warnings", definitionZh: "计算警告代码", definitionEn: "Calculation warning codes" },
  { field: "notes", definitionZh: "技术复孔与缺失误差说明", definitionEn: "Technical-replicate and missing-uncertainty notes" },
];

function orderedResults(
  results: RelativeQuantificationResult[],
  sampleOrder: string[],
  targetOrder: string[],
): RelativeQuantificationResult[] {
  const samples = new Set(sampleOrder);
  const targets = new Set(targetOrder);
  return results
    .filter((row) => samples.has(row.sampleName) && targets.has(row.targetName))
    .sort((a, b) => targetOrder.indexOf(a.targetName) - targetOrder.indexOf(b.targetName)
      || sampleOrder.indexOf(a.sampleName) - sampleOrder.indexOf(b.sampleName));
}

export function buildCompleteResultRows(
  results: RelativeQuantificationResult[],
  sampleOrder: string[],
  targetOrder: string[],
  calculationMode: AnalysisSettings["calculationMode"],
  contextWarnings: string[] = [],
): CompleteResultRow[] {
  return orderedResults(results, sampleOrder, targetOrder).map((row) => {
    const referenceCount = Object.values(row.referenceValidReplicates).reduce((sum, count) => sum + count, 0);
    const notes = [
      "Technical-replicate statistics only; not biological-replicate variation or inferential uncertainty.",
      row.targetValidReplicates < 2 ? "Target SD/SEM unavailable because fewer than two valid technical replicates remain." : "",
      Object.values(row.referenceValidReplicates).some((count) => count < 2) ? "Reference SD/SEM unavailable because at least one reference has fewer than two valid technical replicates." : "",
      row.calibratorValue && row.sampleName === row.calibratorValue ? "Calibrator center is 1; its technical uncertainty is retained when available." : "",
    ].filter(Boolean).join(" ");
    return {
      schema_version: COMPLETE_RESULTS_SCHEMA_VERSION,
      sample: row.sampleName,
      assay: row.targetName,
      assay_type_role: row.assayTypeRole,
      reference_assays: row.referenceTargets.join("; "),
      calibrator: row.calibratorValue,
      calculation_mode: calculationMode,
      target_valid_replicates: row.targetValidReplicates,
      target_mean_cq: row.targetMeanCq,
      target_technical_sd: row.targetSdCq,
      target_technical_sem: row.targetSemCq,
      reference_valid_replicates: referenceCount,
      reference_replicates_by_assay: Object.entries(row.referenceValidReplicates).map(([assay, count]) => `${assay}:${count}`).join("; "),
      reference_mean_cq: row.referenceMeanCq,
      reference_technical_sd: row.referenceSdCq,
      reference_technical_sem: row.referenceSemCq,
      delta_cq: row.deltaCq,
      delta_cq_technical_sd: row.deltaCqSd,
      delta_cq_technical_sem: row.deltaCqSem,
      "normalized_quantity_2^-delta_cq": row.normalizedQuantity,
      normalized_quantity_technical_sd: row.normalizedQuantitySd,
      normalized_quantity_technical_sem: row.normalizedQuantitySem,
      delta_delta_cq: row.deltaDeltaCq,
      delta_delta_cq_technical_sd: row.deltaDeltaCqSd,
      delta_delta_cq_technical_sem: row.deltaDeltaCqSem,
      relative_expression: row.relativeExpression,
      relative_expression_technical_sd: row.relativeExpressionSd,
      relative_expression_technical_sem: row.relativeExpressionSem,
      warnings: [...new Set([...contextWarnings, ...row.warningCodes])].join("; "),
      notes,
    };
  });
}

interface SummaryStats {
  mean: number;
  sd: number | null;
  sem: number | null;
  count: number;
}

function summarize(values: number[]): SummaryStats {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sd = values.length < 2
    ? null
    : Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
  return { mean: average, sd, sem: sd === null ? null : sd / Math.sqrt(values.length), count: values.length };
}

function quadratureMean(values: Array<number | null>): number | null {
  if (!values.length || values.some((value) => value === null)) return null;
  return Math.sqrt(values.reduce<number>((sum, value) => sum + Number(value) ** 2, 0)) / values.length;
}

function quadrature(values: Array<number | null>): number | null {
  if (!values.length || values.some((value) => value === null)) return null;
  return Math.sqrt(values.reduce<number>((sum, value) => sum + Number(value) ** 2, 0));
}

function transformedUncertainty(quantity: number, cqUncertainty: number | null, base: number): number | null {
  return cqUncertainty === null ? null : Math.log(base) * quantity * cqUncertainty;
}

function exportInclusion(well: WellRecord): { included: boolean; reason: string } {
  if (!well.sampleName || !well.targetName) return { included: false, reason: "missing sample or assay annotation" };
  if (well.instrumentOmit) return { included: false, reason: "instrument omit" };
  if (well.userExcluded) return { included: false, reason: well.exclusionReason || "user excluded" };
  if (well.cq === null || well.cqStatus !== "detected") return { included: false, reason: well.cqReason || well.cqStatus };
  return { included: true, reason: "included" };
}

function traceKey(...parts: string[]): string {
  return parts.join("\u241f");
}

function baseForAssay(settings: AnalysisSettings, assay: string): number {
  return settings.calculationMode === "efficiency-corrected"
    ? 1 + (settings.efficiencyByTarget[assay] ?? 1)
    : 2;
}

const guide: CalculationGuideRow[] = [
  { step: 1, nameZh: "保留孔级原始值", nameEn: "Preserve well measurements", formula: "Cq_well", explanationZh: "逐孔保留仪器 Cq/Cp、孔位、样本、基因、复孔号和排除状态；缺失值不填补。", explanationEn: "Preserve Cq/Cp, position, sample, assay, replicate and exclusion provenance for every well; missing values are not imputed." },
  { step: 2, nameZh: "计算技术复孔统计", nameEn: "Summarize technical replicates", formula: "mean = ΣCq/n; SD = √[Σ(Cq-mean)²/(n-1)]; SEM = SD/√n", explanationZh: "在同板、同一样本、同一基因内计算。SD描述孔间离散；SEM描述该技术复孔均值的精度。", explanationEn: "Calculated within the same plate, sample and assay. SD describes well-to-well spread; SEM describes precision of that technical-replicate mean." },
  { step: 3, nameZh: "计算内参中心", nameEn: "Calculate reference center", formula: "reference mean = mean(reference-assay means)", explanationZh: "单内参直接使用其 mean Cq；多内参先分别求 mean Cq，再对这些均值取算术平均。", explanationEn: "Use the single reference mean Cq, or the arithmetic mean of per-reference mean Cq values for multiple references." },
  { step: 4, nameZh: "计算每孔 ΔCq", nameEn: "Calculate per-well delta Cq", formula: "well ΔCq = well Cq - same-plate, same-sample reference center", explanationZh: "目标孔和内参孔均计算，便于用户复核或自行作图；内参孔的平均偏差在单内参时为 0。", explanationEn: "Calculated for target and reference wells for audit and replotting; single-reference wells average to zero." },
  { step: 5, nameZh: "计算样本-基因 ΔCq", nameEn: "Calculate sample-assay delta Cq", formula: "ΔCq = target mean Cq - reference center mean Cq", explanationZh: "这是正式的样本×基因归一化结果。", explanationEn: "This is the formal normalized result for a sample-assay pair." },
  { step: 6, nameZh: "计算归一化量", nameEn: "Calculate normalized quantity", formula: "Q = base^(-ΔCq); base=2 or 1+efficiency", explanationZh: "经典模式使用 2；效率校正模式使用相应扩增底数。", explanationEn: "Classic mode uses 2; efficiency-corrected mode uses the assay-specific amplification base." },
  { step: 7, nameZh: "计算 ΔΔCq 与相对表达", nameEn: "Calculate delta-delta Cq and relative expression", formula: "ΔΔCq = sample ΔCq - calibrator ΔCq; relative expression = base^(-ΔΔCq)", explanationZh: "校准样本中心定义为 1，但其技术不确定性不被强制设为 0。", explanationEn: "The calibrator center is defined as 1, but its technical uncertainty is not forced to zero." },
  { step: 8, nameZh: "传播技术误差", nameEn: "Propagate technical uncertainty", formula: "subtraction: u=√(u₁²+u₂²); transform: u_Q=ln(base)×Q×u_Cq", explanationZh: "SD 路径使用各技术 SD，SEM 路径使用各技术 SEM。二者仅反映技术复孔，不代表生物学变异、置信区间或 P 值。", explanationEn: "The SD path starts from technical SD and the SEM path from technical SEM. Neither represents biological variation, a confidence interval, or a P value." },
];

function dictionaryEntry(
  sheet: string,
  field: string,
  levelZh: string,
  definitionZh: string,
  definitionEn: string,
  formula = "direct value",
  unit = "",
  cautionZh = "",
  cautionEn = "",
): CalculationDictionaryEntry {
  return { sheet, field, levelZh, definitionZh, definitionEn, formula, unit, cautionZh, cautionEn };
}

const sharedFieldDefinitions: Record<string, Omit<CalculationDictionaryEntry, "sheet" | "field">> = {
  schema_version: { levelZh: "文件", definitionZh: "导出结构版本，用于识别列定义变化。", definitionEn: "Export schema version used to track column-definition changes.", formula: "constant", unit: "", cautionZh: "", cautionEn: "" },
  plate: { levelZh: "孔板", definitionZh: "物理孔板标识。", definitionEn: "Physical plate identifier.", formula: "source annotation", unit: "", cautionZh: "", cautionEn: "" },
  sample: { levelZh: "样本", definitionZh: "生物学样本标识。", definitionEn: "Biological sample identifier.", formula: "layout annotation", unit: "", cautionZh: "", cautionEn: "" },
  assay: { levelZh: "基因", definitionZh: "目标基因、内参基因或检测项目。", definitionEn: "Target assay, reference assay, or test item.", formula: "layout annotation", unit: "", cautionZh: "", cautionEn: "" },
  assay_type_role: { levelZh: "反应", definitionZh: "导入或板布局提供的反应角色。", definitionEn: "Reaction role supplied by the import or plate layout.", formula: "source annotation", unit: "", cautionZh: "Unknown 表示源文件未明确标注。", cautionEn: "Unknown means the source did not explicitly label the role." },
  reference_assays: { levelZh: "分析", definitionZh: "本次归一化选用的内参基因列表。", definitionEn: "Reference assays selected for normalization.", formula: "analysis setting", unit: "", cautionZh: "", cautionEn: "" },
  reference_center_mean_cq: { levelZh: "同板样本", definitionZh: "同板、同一样本的内参中心 mean Cq。", definitionEn: "Reference-center mean Cq for the same plate and sample.", formula: "mean(per-reference mean Cq)", unit: "Cq cycles", cautionZh: "不会跨板拿另一个样本的内参替代。", cautionEn: "A reference from another plate/sample is not substituted." },
  reference_center_propagated_sd: { levelZh: "同板样本", definitionZh: "内参中心传播 SD：各内参技术 SD 的平方和开根号，再除以内参数量。", definitionEn: "Reference-center propagated SD: root-sum-of-squares of per-reference technical SD values, divided by the number of references.", formula: "√(ΣSD_ref²)/m", unit: "Cq cycles", cautionZh: "不是生物学重复 SD。", cautionEn: "Not a biological-replicate SD." },
  reference_center_propagated_sem: { levelZh: "同板样本", definitionZh: "内参中心传播 SEM：各内参 SEM（每个均为 SD/√n）的平方和开根号，再除以内参数量。", definitionEn: "Reference-center propagated SEM: root-sum-of-squares of per-reference SEM values (each SD/sqrt(n)), divided by the number of references.", formula: "√(ΣSEM_ref²)/m", unit: "Cq cycles", cautionZh: "不是置信区间，也不包含生物学重复。", cautionEn: "Not a confidence interval and does not include biological replication." },
};

function fieldDictionary(sheet: string, headers: readonly string[]): CalculationDictionaryEntry[] {
  const explicit: Record<string, [string, string, string, string, string, string, string?]> = {
    calibrator: ["分析", "ΔΔCq 使用的校准样本；未设置时为空。", "Calibrator sample used for delta-delta Cq; blank when none is selected.", "analysis setting", "sample", ""],
    calculation_mode: ["分析", "本行采用的计算模式：ΔCq、ΔΔCq 或效率校正。", "Calculation mode used for the row: delta Cq, delta-delta Cq, or efficiency corrected.", "analysis setting", "", ""],
    target_valid_replicates: ["最终样本基因", "目标基因实际进入最终汇总的有效技术复孔总数。", "Total valid target technical replicates used in the final summary.", "count(included target wells)", "wells", "跨板时为纳入板的合计。"],
    target_mean_cq: ["最终样本基因", "目标基因有效孔的最终 mean Cq；跨板时按有效孔数合并。", "Final target mean Cq; pooled by valid replicate count when supported across plates.", "ΣCq/n", "Cq cycles", ""],
    target_technical_sd: ["最终样本基因", "目标技术复孔 Cq 的样本 SD，分母 n−1。", "Sample SD of target technical-replicate Cq values, using n-1.", "√[Σ(Cq-mean)²/(n-1)]", "Cq cycles", "n<2 时为空；不是生物学重复 SD。"],
    target_technical_sem: ["最终样本基因", "目标 mean Cq 的技术 SEM。", "Technical SEM of the target mean Cq.", "target_technical_sd/√n", "Cq cycles", "n<2 时为空；不是置信区间。"],
    reference_valid_replicates: ["最终样本基因", "全部所选内参有效技术复孔数之和。", "Total valid technical-replicate count across all selected references.", "Σn_reference", "wells", ""],
    reference_replicates_by_assay: ["最终样本基因", "逐个内参列出有效技术复孔数。", "Valid technical-replicate count for each reference assay.", "assay:n", "wells", ""],
    reference_mean_cq: ["最终样本基因", "内参中心 mean Cq；多内参时为各内参 mean Cq 的算术平均。", "Reference-center mean Cq; arithmetic mean of per-reference mean Cq values for multiple references.", "mean(per-reference mean Cq)", "Cq cycles", ""],
    reference_technical_sd: ["最终样本基因", "内参中心传播技术 SD：各内参技术 SD 的平方和开根号，再除以内参数量。", "Propagated technical SD of the reference center.", "√(ΣSD_ref²)/m", "Cq cycles", "不是生物学重复 SD。"],
    reference_technical_sem: ["最终样本基因", "内参中心传播技术 SEM：各内参 SEM（SD/√n）的平方和开根号，再除以内参数量。", "Propagated technical SEM of the reference center.", "√(ΣSEM_ref²)/m", "Cq cycles", "不是置信区间或 P 值。"],
    delta_cq: ["最终样本基因", "目标 mean Cq 减去内参中心 mean Cq。", "Target mean Cq minus reference-center mean Cq.", "target_mean_cq-reference_mean_cq", "Cq cycles", ""],
    delta_cq_technical_sd: ["最终样本基因", "ΔCq 传播技术 SD：目标技术 SD 与内参中心技术 SD 的平方和开根号。", "Propagated technical SD of delta Cq.", "√(SD_target²+SD_reference²)", "Cq cycles", "不是生物学重复 SD。"],
    delta_cq_technical_sem: ["最终样本基因", "ΔCq 传播技术 SEM：目标 SEM 与内参中心 SEM 的平方和开根号；起始 SEM 均为 SD/√n。", "Propagated technical SEM of delta Cq.", "√(SEM_target²+SEM_reference²)", "Cq cycles", "不是生物学重复、置信区间或 P 值。"],
    "normalized_quantity_2^-delta_cq": ["最终样本基因", "由 ΔCq 转换得到的归一化量；经典法为 2^-ΔCq。", "Normalized quantity transformed from delta Cq; 2^-delta Cq in classic mode.", "base^(-delta_cq)", "relative quantity", "效率校正模式的 base 为 1+效率。"],
    normalized_quantity_technical_sd: ["最终样本基因", "归一化量的一阶传播技术 SD。", "First-order propagated technical SD of normalized quantity.", "ln(base)×Q×SD_ΔCq", "relative quantity", "不是生物学重复 SD。"],
    normalized_quantity_technical_sem: ["最终样本基因", "归一化量的一阶传播技术 SEM。", "First-order propagated technical SEM of normalized quantity.", "ln(base)×Q×SEM_ΔCq", "relative quantity", "不是置信区间。"],
    delta_delta_cq: ["最终样本基因", "样本 ΔCq 减去同一基因校准样本 ΔCq。", "Sample delta Cq minus calibrator delta Cq for the same assay.", "sample ΔCq-calibrator ΔCq", "Cq cycles", "未设置校准样本时为空。"],
    delta_delta_cq_technical_sd: ["最终样本基因", "ΔΔCq 传播技术 SD；非校准样本合并样本与校准样本的 ΔCq SD。", "Propagated technical SD of delta-delta Cq; combines sample and calibrator delta-Cq SD for non-calibrators.", "√(SD_sampleΔCq²+SD_calibratorΔCq²)", "Cq cycles", "校准样本中心为 0，但保留自身技术 SD。"],
    delta_delta_cq_technical_sem: ["最终样本基因", "ΔΔCq 传播技术 SEM；非校准样本合并样本与校准样本的 ΔCq SEM。", "Propagated technical SEM of delta-delta Cq; combines sample and calibrator delta-Cq SEM for non-calibrators.", "√(SEM_sampleΔCq²+SEM_calibratorΔCq²)", "Cq cycles", "不是置信区间或 P 值。"],
    relative_expression: ["最终样本基因", "相对校准样本的表达倍数；校准样本中心定义为 1。", "Expression fold change relative to the calibrator; calibrator center is defined as 1.", "base^(-delta_delta_cq)", "fold change", ""],
    relative_expression_technical_sd: ["最终样本基因", "相对表达量的一阶传播技术 SD。", "First-order propagated technical SD of relative expression.", "ln(base)×relative_expression×SD_ΔΔCq", "fold change", "校准样本可非零；不是生物学重复 SD。"],
    relative_expression_technical_sem: ["最终样本基因", "相对表达量的一阶传播技术 SEM。", "First-order propagated technical SEM of relative expression.", "ln(base)×relative_expression×SEM_ΔΔCq", "fold change", "校准样本可非零；不是置信区间。"],
    source_file: ["来源", "原始导入文件名。", "Original imported file name.", "source provenance", "", ""],
    source_sheet: ["来源", "原始工作表或数据区名称。", "Original worksheet or data-section name.", "source provenance", "", ""],
    source_row: ["来源", "原始文件中的行号。", "Original source-row number.", "source provenance", "row", ""],
    raw_row_values_json: ["来源", "原始导入行的全部字段和值，以 JSON 保留，便于核对仪器原名。", "All original imported row fields and values preserved as JSON for instrument-name auditing.", "JSON.stringify(rawValues)", "", "只用于追溯，不参与数值计算。"],
    well: ["孔", "物理孔位，例如 A1。", "Physical well position, for example A1.", "source measurement", "well", ""],
    record_id: ["孔", "系统中的孔记录标识。", "Internal well-record identifier.", "canonical record", "", ""],
    is_reference_assay: ["反应", "该基因是否为本次分析选中的内参。", "Whether the assay is selected as a reference in this analysis.", "assay in reference_assays", "yes/no", ""],
    replicate: ["孔", "技术复孔序号。", "Technical-replicate sequence number.", "layout annotation", "", ""],
    cq: ["孔", "仪器测得的单孔 Cq/Ct/Cp 原始数值。", "Original single-well Cq/Ct/Cp measurement.", "instrument measurement", "Cq cycles", "缺失值保持为空，不以 40 等数值替代。"],
    cq_status: ["孔", "Cq 状态，如 detected、not-detected、invalid。", "Cq status such as detected, not-detected, or invalid.", "import normalization", "", ""],
    instrument_omit: ["孔", "仪器是否将该孔标为 omit。", "Whether the instrument marked the well as omitted.", "instrument flag", "yes/no", ""],
    user_excluded: ["孔", "用户是否手动排除该孔。", "Whether the user manually excluded the well.", "audit state", "yes/no", ""],
    included_in_calculation: ["孔", "该孔是否实际进入 mean、SD、SEM 和后续计算。", "Whether the well was actually used in mean, SD, SEM and downstream calculations.", "detected and not omitted/excluded", "yes/no", ""],
    inclusion_reason: ["孔", "纳入或未纳入计算的直白原因。", "Plain-language reason for inclusion or exclusion.", "validation result", "", ""],
    used_in_final_result: ["孔", "该孔是否实际贡献到当前所选样本×基因的最终结果。", "Whether the well actually contributes to a final result for the currently selected sample-assay outputs.", "valid well and complete reference pairing", "yes/no", "内参孔可同时贡献多个目标基因结果。"],
    well_delta_cq_cq_minus_reference_center: ["孔", "单孔 ΔCq：该孔 Cq 减去同板同一样本内参中心。目标孔和内参孔都计算。", "Per-well delta Cq: well Cq minus the same-plate, same-sample reference center; calculated for target and reference wells.", "Cq_well - reference_center_mean_cq", "Cq cycles", "这是孔级复核值；正式样本结果使用技术复孔 mean Cq。"],
    well_normalized_quantity: ["孔", "由单孔 ΔCq 转换的孔级归一化量。", "Well-level normalized quantity transformed from per-well delta Cq.", "base^(-well ΔCq)", "relative quantity", "主要用于复核或自行作图，不替代样本×基因汇总。"],
    plate_assay_mean_cq: ["同板样本基因", "同板、同一样本、同一基因全部有效孔的 mean Cq。", "Mean Cq across valid wells for the same plate, sample and assay.", "ΣCq/n", "Cq cycles", ""],
    plate_assay_technical_sd: ["同板样本基因", "同板技术复孔的样本 SD，分母为 n−1。", "Sample SD of same-plate technical replicates, using n-1.", "√[Σ(Cq-mean)²/(n-1)]", "Cq cycles", "n<2 时为空；不是生物学重复 SD。"],
    plate_assay_technical_sem: ["同板样本基因", "同板技术复孔均值的 SEM。", "SEM of the same-plate technical-replicate mean.", "SD/√n", "Cq cycles", "n<2 时为空；不是生物学重复 SEM。"],
    valid_replicates: ["同板样本基因", "实际进入统计的有效技术复孔数。", "Number of valid technical replicates used in statistics.", "count(included wells)", "wells", ""],
    mean_cq: ["同板样本基因", "同板样本基因的 mean Cq。", "Mean Cq for a plate-sample-assay group.", "ΣCq/n", "Cq cycles", ""],
    technical_sd: ["同板样本基因", "有效技术复孔的样本 SD。", "Sample SD among valid technical replicates.", "√[Σ(Cq-mean)²/(n-1)]", "Cq cycles", "不是生物学重复 SD。"],
    technical_sem: ["同板样本基因", "技术复孔 mean Cq 的 SEM。", "SEM of the technical-replicate mean Cq.", "SD/√n", "Cq cycles", "不是生物学重复 SEM 或置信区间。"],
    plate_delta_cq: ["同板样本基因", "同板样本基因 mean Cq 减去内参中心 mean Cq。", "Plate-level assay mean Cq minus reference-center mean Cq.", "mean_cq - reference_center_mean_cq", "Cq cycles", ""],
    plate_delta_cq_propagated_sd: ["同板样本基因", "目标 SD 与内参中心 SD 的平方和开根号。", "Root-sum-of-squares of target SD and reference-center SD.", "√(SD_target²+SD_reference²)", "Cq cycles", "不是生物学重复 SD。"],
    plate_delta_cq_propagated_sem: ["同板样本基因", "目标 SEM 与内参中心 SEM 的平方和开根号；每个起始 SEM 均为 SD/√n。", "Root-sum-of-squares of target SEM and reference-center SEM; each source SEM equals SD/sqrt(n).", "√(SEM_target²+SEM_reference²)", "Cq cycles", "不是置信区间或 P 值。"],
    plate_normalized_quantity: ["同板样本基因", "同板 ΔCq 转换后的归一化量。", "Normalized quantity transformed from plate-level delta Cq.", "base^(-plate ΔCq)", "relative quantity", ""],
    plate_normalized_quantity_propagated_sd: ["同板样本基因", "通过指数变换传播得到的归一化量技术 SD。", "Technical SD propagated through the exponential transform.", "ln(base)×Q×SD_ΔCq", "relative quantity", "一阶近似；不是生物学重复 SD。"],
    plate_normalized_quantity_propagated_sem: ["同板样本基因", "通过指数变换传播得到的归一化量技术 SEM。", "Technical SEM propagated through the exponential transform.", "ln(base)×Q×SEM_ΔCq", "relative quantity", "一阶近似；不是置信区间。"],
    calculation_base: ["分析", "指数换算底数；经典法为 2，效率校正为 1+效率。", "Exponential base; 2 in classic mode or 1+efficiency in efficiency-corrected mode.", "2 or 1+E", "", ""],
    sample_assay_delta_cq: ["最终样本基因", "最终汇总的样本×基因 ΔCq。", "Final sample-assay delta Cq after any supported plate aggregation.", "target_mean_cq-reference_mean_cq", "Cq cycles", ""],
    calibrator_delta_cq_same_assay: ["最终样本基因", "同一基因校准样本的 ΔCq。", "Delta Cq of the calibrator for the same assay.", "lookup calibrator ΔCq", "Cq cycles", "未选校准样本或缺失时为空。"],
    sample_assay_delta_delta_cq: ["最终样本基因", "样本 ΔCq 减去同一基因校准样本 ΔCq。", "Sample delta Cq minus calibrator delta Cq for the same assay.", "sample ΔCq-calibrator ΔCq", "Cq cycles", ""],
    sample_assay_relative_expression: ["最终样本基因", "最终相对表达量。", "Final relative expression.", "base^(-ΔΔCq)", "fold change", "校准样本中心为 1。"],
    warnings: ["记录", "与该结果相关的导入、QC 或计算警告。", "Import, QC, or calculation warnings associated with the result.", "audit aggregation", "", ""],
    notes: ["记录", "计算范围、缺失值或解释注意事项。", "Notes about calculation scope, missing values, or interpretation.", "generated note", "", ""],
  };

  return headers.map((field) => {
    const shared = sharedFieldDefinitions[field];
    if (shared) return { sheet, field, ...shared };
    const item = explicit[field];
    if (item) return dictionaryEntry(sheet, field, item[0], item[1], item[2], item[3], item[4], item[5], item[6] ?? "");
    const complete = COMPLETE_RESULTS_DICTIONARY.find((entry) => entry.field === field);
    if (complete) {
      const propagated = field.includes("technical_sd") || field.includes("technical_sem");
      const isSem = field.includes("sem");
      const specialZh = field === "delta_cq_technical_sd"
        ? "ΔCq 传播技术 SD：目标技术 SD 与内参中心技术 SD 的平方和开根号。"
        : field === "delta_cq_technical_sem"
          ? "ΔCq 传播技术 SEM：目标 SEM 与内参中心 SEM 的平方和开根号；起始 SEM 均为 SD/√n。"
          : complete.definitionZh;
      return dictionaryEntry(
        sheet,
        field,
        "最终样本基因",
        specialZh,
        complete.definitionEn,
        field === "delta_cq_technical_sd" ? "√(SD_target²+SD_reference²)" : field === "delta_cq_technical_sem" ? "√(SEM_target²+SEM_reference²)" : "see Calculation Guide",
        field.includes("cq") ? "Cq cycles" : "",
        propagated ? (isSem ? "仅描述技术复孔均值的精度，不是生物学重复、置信区间或 P 值。" : "仅描述技术复孔传播的不确定性，不是生物学重复 SD。") : "",
        propagated ? (isSem ? "Technical-replicate precision only; not biological variation, a confidence interval, or a P value." : "Propagated technical uncertainty only; not biological-replicate SD.") : "",
      );
    }
    return dictionaryEntry(sheet, field, "记录", field, field);
  });
}

export function buildCalculationExportBundle(
  wells: WellRecord[],
  results: RelativeQuantificationResult[],
  sampleOrder: string[],
  targetOrder: string[],
  settings: AnalysisSettings,
  contextWarnings: string[] = [],
): {
  completeRows: CompleteResultRow[];
  plateRows: PlateSummaryRow[];
  wellRows: WellCalculationRow[];
  guide: CalculationGuideRow[];
  dictionary: CalculationDictionaryEntry[];
} {
  const selectedSamples = new Set(sampleOrder);
  const selectedAssays = new Set([...settings.referenceTargets, ...targetOrder]);
  const relevantWells = wells.filter((well) => selectedSamples.has(well.sampleName) && selectedAssays.has(well.targetName));
  const statsByGroup = new Map<string, SummaryStats>();
  const valuesByGroup = new Map<string, number[]>();
  const assayTypesByGroup = new Map<string, Set<string>>();

  for (const well of relevantWells) {
    const inclusion = exportInclusion(well);
    if (!inclusion.included || well.cq === null) continue;
    const key = traceKey(well.plateId, well.sampleName, well.targetName);
    valuesByGroup.set(key, [...(valuesByGroup.get(key) ?? []), well.cq]);
    const assayTypes = assayTypesByGroup.get(key) ?? new Set<string>();
    if (well.taskType) assayTypes.add(well.taskType);
    assayTypesByGroup.set(key, assayTypes);
  }
  for (const [key, values] of valuesByGroup) statsByGroup.set(key, summarize(values));

  const referenceCenterByPlateSample = new Map<string, { mean: number; sd: number | null; sem: number | null }>();
  for (const well of relevantWells) {
    const key = traceKey(well.plateId, well.sampleName);
    if (referenceCenterByPlateSample.has(key)) continue;
    const refs = settings.referenceTargets.map((assay) => statsByGroup.get(traceKey(well.plateId, well.sampleName, assay)));
    if (!refs.length || refs.some((item) => !item)) continue;
    const completeRefs = refs as SummaryStats[];
    referenceCenterByPlateSample.set(key, {
      mean: completeRefs.reduce((sum, item) => sum + item.mean, 0) / completeRefs.length,
      sd: quadratureMean(completeRefs.map((item) => item.sd)),
      sem: quadratureMean(completeRefs.map((item) => item.sem)),
    });
  }

  const finalBySampleAssay = new Map(results.map((row) => [traceKey(row.sampleName, row.targetName), row]));
  const calibratorByAssay = new Map(results
    .filter((row) => row.sampleName === settings.calibratorValue)
    .map((row) => [row.targetName, row]));
  const plateRows: PlateSummaryRow[] = [];
  for (const [key, stats] of statsByGroup) {
    const [plate, sample, assay] = key.split("\u241f");
    const reference = referenceCenterByPlateSample.get(traceKey(plate, sample));
    const base = baseForAssay(settings, assay);
    const delta = reference ? stats.mean - reference.mean : null;
    const deltaSd = reference ? quadrature([stats.sd, reference.sd]) : null;
    const deltaSem = reference ? quadrature([stats.sem, reference.sem]) : null;
    const quantity = delta === null ? null : base ** -delta;
    plateRows.push({
      schema_version: "2.0.0", plate, sample, assay,
      assay_type_role: [...(assayTypesByGroup.get(key) ?? [])].sort().join("; ") || "Unknown",
      is_reference_assay: settings.referenceTargets.includes(assay) ? "yes" : "no",
      valid_replicates: stats.count, mean_cq: stats.mean, technical_sd: stats.sd, technical_sem: stats.sem,
      reference_assays: settings.referenceTargets.join("; "), reference_center_mean_cq: reference?.mean ?? null,
      reference_center_propagated_sd: reference?.sd ?? null, reference_center_propagated_sem: reference?.sem ?? null,
      plate_delta_cq: delta, plate_delta_cq_propagated_sd: deltaSd, plate_delta_cq_propagated_sem: deltaSem,
      plate_normalized_quantity: quantity,
      plate_normalized_quantity_propagated_sd: quantity === null ? null : transformedUncertainty(quantity, deltaSd, base),
      plate_normalized_quantity_propagated_sem: quantity === null ? null : transformedUncertainty(quantity, deltaSem, base),
      calculation_base: base,
      notes: settings.referenceTargets.includes(assay) ? "Reference-assay row retained so its deviation from the combined reference center can be audited." : "",
    });
  }
  const assayRank = (assay: string) => settings.referenceTargets.includes(assay)
    ? settings.referenceTargets.indexOf(assay)
    : settings.referenceTargets.length + targetOrder.indexOf(assay);
  plateRows.sort((a, b) => sampleOrder.indexOf(String(a.sample)) - sampleOrder.indexOf(String(b.sample))
    || String(a.plate).localeCompare(String(b.plate)) || assayRank(String(a.assay)) - assayRank(String(b.assay)));

  const wellRows = relevantWells.map((well): WellCalculationRow => {
    const inclusion = exportInclusion(well);
    const groupKey = traceKey(well.plateId, well.sampleName, well.targetName);
    const stats = statsByGroup.get(groupKey);
    const reference = referenceCenterByPlateSample.get(traceKey(well.plateId, well.sampleName));
    const final = finalBySampleAssay.get(traceKey(well.sampleName, well.targetName));
    const calibrator = calibratorByAssay.get(well.targetName);
    const base = baseForAssay(settings, well.targetName);
    const wellDelta = inclusion.included && well.cq !== null && reference ? well.cq - reference.mean : null;
    return {
      schema_version: "2.0.0", source_file: well.rawRow.sourceFileName, source_sheet: well.rawRow.sourceSheet,
      source_row: well.rawRow.sourceRowNumber, raw_row_values_json: JSON.stringify(well.rawRow.rawValues),
      plate: well.plateId, well: well.well, record_id: well.id,
      sample: well.sampleName, assay: well.targetName, assay_type_role: well.taskType || "Unknown",
      is_reference_assay: settings.referenceTargets.includes(well.targetName) ? "yes" : "no", replicate: well.replicate,
      cq: well.cq, cq_status: well.cqStatus, instrument_omit: well.instrumentOmit ? "yes" : "no",
      user_excluded: well.userExcluded ? "yes" : "no", included_in_calculation: inclusion.included ? "yes" : "no",
      inclusion_reason: inclusion.reason,
      used_in_final_result: inclusion.included && (settings.referenceTargets.includes(well.targetName)
        ? targetOrder.some((target) => finalBySampleAssay.has(traceKey(well.sampleName, target)))
        : final !== undefined) ? "yes" : "no",
      reference_assays: settings.referenceTargets.join("; "),
      reference_center_mean_cq: reference?.mean ?? null, reference_center_propagated_sd: reference?.sd ?? null,
      reference_center_propagated_sem: reference?.sem ?? null,
      well_delta_cq_cq_minus_reference_center: wellDelta,
      well_normalized_quantity: wellDelta === null ? null : base ** -wellDelta,
      plate_assay_mean_cq: stats?.mean ?? null, plate_assay_technical_sd: stats?.sd ?? null,
      plate_assay_technical_sem: stats?.sem ?? null, sample_assay_delta_cq: final?.deltaCq ?? null,
      calibrator_delta_cq_same_assay: calibrator?.deltaCq ?? null,
      sample_assay_delta_delta_cq: final?.deltaDeltaCq ?? null,
      sample_assay_relative_expression: final?.relativeExpression ?? null,
      warnings: [...new Set([...well.qcFlags.map((flag) => flag.code), ...(final?.warningCodes ?? [])])].join("; "),
    };
  }).sort((a, b) => sampleOrder.indexOf(String(a.sample)) - sampleOrder.indexOf(String(b.sample))
    || String(a.plate).localeCompare(String(b.plate)) || String(a.well).localeCompare(String(b.well), undefined, { numeric: true }));

  return {
    completeRows: buildCompleteResultRows(results, sampleOrder, targetOrder, settings.calculationMode, contextWarnings),
    plateRows,
    wellRows,
    guide,
    dictionary: [
      ...fieldDictionary("Complete Results", COMPLETE_RESULTS_HEADERS),
      ...fieldDictionary("Plate Summaries", PLATE_SUMMARY_HEADERS),
      ...fieldDictionary("Well Calculations", WELL_CALCULATION_HEADERS),
    ],
  };
}
