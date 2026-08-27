import type { AnalysisStart, SuppliedCalculationRecord } from "../../schemas/src";

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
  "analysis_start", "value_provenance", "sample", "target", "valid_replicates",
  "delta_cq", "delta_cq_technical_sd", "delta_cq_technical_sem",
  "normalized_quantity_2^-delta_cq", "normalized_quantity_technical_sd", "normalized_quantity_technical_sem",
  "delta_delta_cq", "delta_delta_cq_technical_sd", "delta_delta_cq_technical_sem",
  "relative_expression_2^-delta_delta_cq", "relative_expression_technical_sd", "relative_expression_technical_sem",
  "calibrator", "warnings",
] as const;

export type SuppliedCompleteRow = Record<(typeof SUPPLIED_COMPLETE_HEADERS)[number], string | number | null>;

export const SUPPLIED_TRACEABILITY_HEADERS = [
  "analysis_start", "value_provenance", "plate", "well", "sample", "target",
  "replicate", "supplied_value", "cycle_type", "source_sheet", "source_row",
] as const;

export type SuppliedTraceabilityRow = Record<(typeof SUPPLIED_TRACEABILITY_HEADERS)[number], string | number | null>;

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
): SuppliedCompleteRow[] {
  return orderResults(results, sampleOrder, targetOrder).map((row) => ({
    analysis_start: row.analysisStart,
    value_provenance: row.valueProvenance,
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
    calibrator: row.calibratorValue,
    warnings: row.warningCodes.join("; "),
  }));
}

export function buildSuppliedTraceabilityRows(
  records: SuppliedCalculationRecord[],
): SuppliedTraceabilityRow[] {
  return records.map((record) => ({
    analysis_start: record.analysisStart ?? null,
    value_provenance: "user-supplied",
    plate: record.plateName ?? null,
    well: record.well ?? null,
    sample: record.sampleName,
    target: record.targetName,
    replicate: record.replicate,
    supplied_value: record.value,
    cycle_type: record.cycleType || null,
    source_sheet: record.sourceSheet ?? null,
    source_row: record.sourceRowNumber ?? null,
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
