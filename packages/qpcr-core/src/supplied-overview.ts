import type { AnalysisStart } from "../../schemas/src";
import type { SuppliedCalculationResult } from "./supplied-calculations";

export interface SuppliedReplicateCountBucket {
  replicateCount: number;
  groupCount: number;
}

export interface SuppliedVariabilityGroup {
  sampleName: string;
  targetName: string;
  validReplicates: number;
  mean: number;
  sd: number;
  sem: number | null;
}

export interface SuppliedCalculationOverview {
  sampleOrder: string[];
  targetOrder: string[];
  validValueCount: number;
  observedGroupCount: number;
  possibleGroupCount: number;
  missingGroupCount: number;
  singletonGroupCount: number;
  modalReplicateCount: number | null;
  unevenReplicateGroupCount: number;
  replicateCountDistribution: SuppliedReplicateCountBucket[];
  variabilityGroups: SuppliedVariabilityGroup[];
}

function orderedUnique(preferred: string[], observed: string[]): string[] {
  return [...new Set([...preferred.filter(Boolean), ...observed.filter(Boolean)])];
}

function cycleStatistics(row: SuppliedCalculationResult): { mean: number | null; sd: number | null; sem: number | null } {
  return row.analysisStart === "delta-cq"
    ? { mean: row.deltaCq, sd: row.deltaCqSd, sem: row.deltaCqSem }
    : { mean: row.deltaDeltaCq, sd: row.deltaDeltaCqSd, sem: row.deltaDeltaCqSem };
}

export function buildSuppliedCalculationOverview(
  results: SuppliedCalculationResult[],
  analysisStart: Exclude<AnalysisStart, "cq">,
  preferredSamples: string[] = [],
  preferredTargets: string[] = [],
): SuppliedCalculationOverview {
  const relevant = results.filter((row) => row.analysisStart === analysisStart);
  const sampleOrder = orderedUnique(preferredSamples, relevant.map((row) => row.sampleName));
  const targetOrder = orderedUnique(preferredTargets, relevant.map((row) => row.targetName));
  const distributionMap = new Map<number, number>();

  for (const row of relevant) {
    distributionMap.set(row.validReplicates, (distributionMap.get(row.validReplicates) ?? 0) + 1);
  }

  const replicateCountDistribution = [...distributionMap.entries()]
    .map(([replicateCount, groupCount]) => ({ replicateCount, groupCount }))
    .sort((left, right) => left.replicateCount - right.replicateCount);
  const modalReplicateCount = replicateCountDistribution.length
    ? [...replicateCountDistribution].sort((left, right) => right.groupCount - left.groupCount || right.replicateCount - left.replicateCount)[0].replicateCount
    : null;
  const possibleGroupCount = sampleOrder.length * targetOrder.length;
  const observedGroupCount = relevant.length;

  return {
    sampleOrder,
    targetOrder,
    validValueCount: relevant.reduce((sum, row) => sum + row.validReplicates, 0),
    observedGroupCount,
    possibleGroupCount,
    missingGroupCount: Math.max(0, possibleGroupCount - observedGroupCount),
    singletonGroupCount: relevant.filter((row) => row.validReplicates < 2).length,
    modalReplicateCount,
    unevenReplicateGroupCount: modalReplicateCount === null
      ? 0
      : relevant.filter((row) => row.validReplicates !== modalReplicateCount).length,
    replicateCountDistribution,
    variabilityGroups: relevant.flatMap((row): SuppliedVariabilityGroup[] => {
      const statistics = cycleStatistics(row);
      return statistics.mean === null || statistics.sd === null
        ? []
        : [{
          sampleName: row.sampleName,
          targetName: row.targetName,
          validReplicates: row.validReplicates,
          mean: statistics.mean,
          sd: statistics.sd,
          sem: statistics.sem,
        }];
    }).sort((left, right) => right.sd - left.sd || left.sampleName.localeCompare(right.sampleName) || left.targetName.localeCompare(right.targetName)),
  };
}
