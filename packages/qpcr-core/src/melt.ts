import type { WellRecord } from "../../schemas/src";

export type MeltWarningCode =
  | "SECONDARY_MELT_PEAK"
  | "UNKNOWN_MELT_GROUP"
  | "TM_SHIFT_FROM_TARGET_MEDIAN"
  | "EXCLUDED";

export interface MeltWellAssessment {
  wellId: string;
  well: string;
  sampleName: string;
  targetName: string;
  tm1: number | null;
  tm2: number | null;
  meltGroup: string;
  meltScore: number | null;
  meltResolution: number | null;
  deltaFromTargetMedian: number | null;
  warningCodes: MeltWarningCode[];
}

export interface MeltTargetSummary {
  targetName: string;
  wellCount: number;
  medianTm1: number | null;
  minTm1: number | null;
  maxTm1: number | null;
  tm1Range: number | null;
  secondaryPeakCount: number;
  groupCounts: Record<string, number>;
}

export interface MeltAnalysisSummary {
  wells: MeltWellAssessment[];
  targets: MeltTargetSummary[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Summarizes imported Tm and melt-cluster output without inventing raw melt curves.
 * The median-shift flag is an exploratory review aid only; it never excludes a well.
 */
export function summarizeMeltWells(wells: WellRecord[], tmShiftThreshold = 0.5): MeltAnalysisSummary {
  const eligible = wells.filter((well) =>
    well.tm1 !== null || well.tm2 !== null || Boolean(well.meltGroup) || well.meltScore !== null || well.meltResolution !== null,
  );
  const targetMedians = new Map<string, number | null>();
  const targetNames = [...new Set(eligible.map((well) => well.targetName || "未命名靶标"))];

  for (const targetName of targetNames) {
    const values = eligible
      .filter((well) => (well.targetName || "未命名靶标") === targetName && !well.instrumentOmit && !well.userExcluded)
      .map((well) => well.tm1)
      .filter((value): value is number => value !== null);
    targetMedians.set(targetName, median(values));
  }

  const assessed = eligible.map((well): MeltWellAssessment => {
    const targetName = well.targetName || "未命名靶标";
    const targetMedian = targetMedians.get(targetName) ?? null;
    const delta = well.tm1 !== null && targetMedian !== null ? well.tm1 - targetMedian : null;
    const warningCodes: MeltWarningCode[] = [];
    if (well.tm2 !== null) warningCodes.push("SECONDARY_MELT_PEAK");
    if (/^unknown$/i.test(well.meltGroup.trim())) warningCodes.push("UNKNOWN_MELT_GROUP");
    if (delta !== null && Math.abs(delta) > tmShiftThreshold) warningCodes.push("TM_SHIFT_FROM_TARGET_MEDIAN");
    if (well.instrumentOmit || well.userExcluded) warningCodes.push("EXCLUDED");
    return {
      wellId: well.id,
      well: well.well,
      sampleName: well.sampleName || "未命名样本",
      targetName,
      tm1: well.tm1,
      tm2: well.tm2,
      meltGroup: well.meltGroup,
      meltScore: well.meltScore,
      meltResolution: well.meltResolution,
      deltaFromTargetMedian: delta,
      warningCodes,
    };
  });

  const targets = targetNames.map((targetName): MeltTargetSummary => {
    const rows = assessed.filter((row) => row.targetName === targetName);
    const analysisRows = rows.filter((row) => !row.warningCodes.includes("EXCLUDED"));
    const tm1s = analysisRows.map((row) => row.tm1).filter((value): value is number => value !== null);
    const groupCounts: Record<string, number> = {};
    for (const row of analysisRows) {
      if (row.meltGroup) groupCounts[row.meltGroup] = (groupCounts[row.meltGroup] ?? 0) + 1;
    }
    return {
      targetName,
      wellCount: analysisRows.length,
      medianTm1: median(tm1s),
      minTm1: tm1s.length ? Math.min(...tm1s) : null,
      maxTm1: tm1s.length ? Math.max(...tm1s) : null,
      tm1Range: tm1s.length >= 2 ? Math.max(...tm1s) - Math.min(...tm1s) : null,
      secondaryPeakCount: analysisRows.filter((row) => row.tm2 !== null).length,
      groupCounts,
    };
  }).sort((a, b) => a.targetName.localeCompare(b.targetName));

  return { wells: assessed, targets };
}
