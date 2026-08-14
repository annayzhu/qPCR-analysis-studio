import type { RelativeQuantificationResult } from "../../schemas/src";

export const VISUALIZATION_BAR_HEADERS = ["category", "value", "sd", "sem", "group"] as const;

export interface VisualizationBarRow {
  category: string;
  value: number;
  sd: number | null;
  sem: number | null;
  group: string;
}

/**
 * Builds the five-column bar-chart dataset consumed by Visualization Studio.
 *
 * The row order is deliberately controlled by the user's target and sample
 * selections. SD and SEM both describe technical-replicate dispersion and the
 * precision of the technical-replicate mean; neither is biological variation.
 */
export function buildVisualizationBarRows(
  results: RelativeQuantificationResult[],
  sampleOrder: string[],
  targetOrder: string[],
): VisualizationBarRow[] {
  const sampleRanks = new Map(sampleOrder.map((sample, index) => [sample, index]));
  const targetRanks = new Map(targetOrder.map((target, index) => [target, index]));

  return results
    .filter((row) => sampleRanks.has(row.sampleName) && targetRanks.has(row.targetName))
    .map((row) => {
      const usesRelativeExpression = row.relativeExpression !== null;
      return {
        category: row.sampleName,
        value: usesRelativeExpression ? row.relativeExpression! : row.normalizedQuantity,
        sd: usesRelativeExpression ? row.relativeExpressionSd : row.normalizedQuantitySd,
        sem: usesRelativeExpression ? row.relativeExpressionSem : row.normalizedQuantitySem,
        group: row.targetName,
      };
    })
    .filter((row) => Number.isFinite(row.value))
    .sort((a, b) => {
      const targetComparison = targetRanks.get(a.group)! - targetRanks.get(b.group)!;
      return targetComparison || sampleRanks.get(a.category)! - sampleRanks.get(b.category)!;
    });
}
