import type { ReplicateQc, WellRecord } from "../../schemas/src";

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function range(values: number[]): number | null {
  return values.length >= 2 ? Math.max(...values) - Math.min(...values) : null;
}

function cvPercent(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  if (average === 0) return null;
  return (sampleSd(values)! / average) * 100;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export interface ReplicateQcOptions {
  cqRangeWarning?: number;
  tmRangeWarning?: number;
}

export function calculateReplicateQc(
  wells: WellRecord[],
  options: ReplicateQcOptions = {},
): ReplicateQc[] {
  const cqRangeWarning = options.cqRangeWarning ?? 0.5;
  const tmRangeWarning = options.tmRangeWarning ?? 0.5;
  const groups = new Map<string, WellRecord[]>();

  for (const well of wells) {
    if (!well.sampleName || !well.targetName) continue;
    const key = [well.plateId, well.sampleName, well.targetName, well.reporter].join("\u241f");
    groups.set(key, [...(groups.get(key) ?? []), well]);
  }

  return [...groups.entries()].map(([key, group]) => {
    const valid = group.filter(
      (well) => !well.instrumentOmit && !well.userExcluded && well.cqStatus === "detected" && well.cq !== null,
    );
    const cqs = valid.map((well) => well.cq as number);
    const cqRange = range(cqs);
    const tm1s = valid.map((well) => well.tm1).filter((value): value is number => value !== null);
    const tm1Range = range(tm1s);
    const warnings: string[] = [];
    if (valid.length < group.length) warnings.push("EXCLUDED_OR_NON_DETECTED");
    if (cqRange !== null && cqRange > cqRangeWarning) warnings.push("CQ_RANGE_HIGH");
    if (tm1Range !== null && tm1Range > tmRangeWarning) warnings.push("TM_RANGE_HIGH");
    if (group.some((well) => well.tm2 !== null)) warnings.push("SECONDARY_MELT_PEAK");
    const cqMedian = cqs.length ? median(cqs) : null;
    const suspectWell =
      cqs.length >= 3 && cqMedian !== null
        ? valid.reduce((suspect, well) =>
            Math.abs((well.cq as number) - cqMedian) > Math.abs((suspect.cq as number) - cqMedian)
              ? well
              : suspect,
          ).well
        : null;
    const [plateId, sampleName, targetName, reporter] = key.split("\u241f");
    return {
      id: `qc:${key}`,
      plateId,
      sampleName,
      targetName,
      reporter,
      wells: group.map((well) => well.well),
      totalReplicates: group.length,
      validReplicates: valid.length,
      meanCq: mean(cqs),
      sdCq: sampleSd(cqs),
      cqRange,
      linearQuantityCvPercent: cvPercent(cqs.map((cq) => 2 ** -cq)),
      meanTm1: mean(tm1s),
      tm1Range,
      secondaryPeakCount: group.filter((well) => well.tm2 !== null).length,
      meltGroups: [...new Set(group.map((well) => well.meltGroup).filter(Boolean))],
      warningCodes: warnings,
      suspectWell,
    };
  });
}

