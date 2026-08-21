import type { AnalysisSettings, RelativeQuantificationResult } from "../../schemas/src";

export const COMPLETE_RESULTS_SCHEMA_VERSION = "1.0.0";

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
      assay_type_role: "Target",
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
      warnings: row.warningCodes.join("; "),
      notes,
    };
  });
}
