import { physicalWellIdOf, type PhysicalWellId, type ReplicateQc, type WellRecord } from "../../schemas/src";

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

export interface QcWorkspaceState {
  replicateQc: ReplicateQc[];
  groupWarnings: Map<PhysicalWellId, Set<string>>;
  specificWarnings: Map<PhysicalWellId, Set<string>>;
}

function isQcRelevantWell(well: WellRecord): boolean {
  return Boolean(
    well.sampleName ||
    well.targetName ||
    well.cq !== null ||
    well.cqStatus === "invalid" ||
    well.tm1 !== null ||
    well.tm2 !== null ||
    well.meltGroup ||
    well.meltScore !== null ||
    well.meltResolution !== null ||
    well.instrumentOmit ||
    well.userExcluded ||
    well.qcFlags.some((flag) => flag.severity !== "info")
  );
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
    const active = group.filter((well) => !well.instrumentOmit && !well.userExcluded);
    const valid = active.filter(
      (well) => !well.instrumentOmit && !well.userExcluded && well.cqStatus === "detected" && well.cq !== null,
    );
    const cqs = valid.map((well) => well.cq as number);
    const cqRange = range(cqs);
    const tm1s = active.map((well) => well.tm1).filter((value): value is number => value !== null);
    const tm1Range = range(tm1s);
    const warnings = new Set<string>();
    const replicateIds = group.map((well) => well.replicate).filter((value): value is number => value !== null);
    if (replicateIds.length > 0) {
      const uniqueReplicates = [...new Set(replicateIds)].sort((a, b) => a - b);
      const expectedReplicates = Array.from({ length: uniqueReplicates.at(-1) ?? 0 }, (_, index) => index + 1);
      if (replicateIds.length !== group.length || replicateIds.length !== uniqueReplicates.length || uniqueReplicates.some((value, index) => value !== expectedReplicates[index])) {
        warnings.add("REPLICATE_ID_INCOMPLETE");
      }
    }
    const hasQuantificationData = group.some((well) => well.cq !== null || well.cqStatus === "not-detected");
    if (active.length < group.length || (hasQuantificationData && valid.length < active.length)) warnings.add("EXCLUDED_OR_NON_DETECTED");
    if (cqRange !== null && cqRange > cqRangeWarning) warnings.add("CQ_RANGE_HIGH");
    if (tm1Range !== null && tm1Range > tmRangeWarning) warnings.add("TM_RANGE_HIGH");
    if (group.some((well) => well.tm2 !== null)) warnings.add("SECONDARY_MELT_PEAK");
    for (const flag of group.flatMap((well) => well.qcFlags)) {
      if (flag.severity !== "info") warnings.add(flag.code);
    }
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
      warningCodes: [...warnings],
      suspectWell,
    };
  });
}

/**
 * Builds the shared QC state used by both the overview and plate workspace.
 * Group outlines and well-level dots are intentionally separate, but every
 * dot is backed by a warning code that can be explained in the selection panel.
 */
export function buildQcWorkspaceState(
  wells: WellRecord[],
  options: ReplicateQcOptions = {},
): QcWorkspaceState {
  const replicateQc = calculateReplicateQc(wells, options);
  const groupLevelWarnings = new Set([
    "CQ_RANGE_HIGH",
    "TM_RANGE_HIGH",
    "SECONDARY_MELT_PEAK",
    "EXCLUDED_OR_NON_DETECTED",
    "REPLICATE_ID_INCOMPLETE",
  ]);
  const groupWarnings = new Map<PhysicalWellId, Set<string>>();
  const specificWarnings = new Map<PhysicalWellId, Set<string>>();
  const wellByIdentity = new Map(wells.map((well) => [physicalWellIdOf(well), well]));
  const addWarning = (map: Map<PhysicalWellId, Set<string>>, physicalWellId: PhysicalWellId, warning: string) => {
    const warnings = map.get(physicalWellId) ?? new Set<string>();
    warnings.add(warning);
    map.set(physicalWellId, warnings);
  };

  for (const row of replicateQc.filter((item) => item.warningCodes.length > 0)) {
    for (const wellName of row.wells) {
      const physicalWellId = createQcPhysicalWellId(row.plateId, wellName);
      for (const warning of row.warningCodes) {
        if (groupLevelWarnings.has(warning)) {
          addWarning(groupWarnings, physicalWellId, warning);
        }
      }
    }
    if (row.suspectWell && row.warningCodes.includes("CQ_RANGE_HIGH")) {
      addWarning(specificWarnings, createQcPhysicalWellId(row.plateId, row.suspectWell), "CQ_RANGE_HIGH");
    }
    if (row.warningCodes.includes("SECONDARY_MELT_PEAK")) {
      for (const wellName of row.wells) {
        const physicalWellId = createQcPhysicalWellId(row.plateId, wellName);
        if (wellByIdentity.get(physicalWellId)?.tm2 !== null) addWarning(specificWarnings, physicalWellId, "SECONDARY_MELT_PEAK");
      }
    }
    if (row.warningCodes.includes("EXCLUDED_OR_NON_DETECTED")) {
      for (const wellName of row.wells) {
        const physicalWellId = createQcPhysicalWellId(row.plateId, wellName);
        const well = wellByIdentity.get(physicalWellId);
        if (well && (well.instrumentOmit || well.userExcluded || well.cqStatus === "not-detected")) {
          addWarning(specificWarnings, physicalWellId, "EXCLUDED_OR_NON_DETECTED");
        }
      }
    }
  }

  for (const well of wells.filter(isQcRelevantWell)) {
    const physicalWellId = physicalWellIdOf(well);
    for (const flag of well.qcFlags) {
      if (flag.severity !== "info") addWarning(specificWarnings, physicalWellId, flag.code);
    }
    if (well.tm2 !== null) addWarning(specificWarnings, physicalWellId, "SECONDARY_MELT_PEAK");
    if (well.instrumentOmit || well.userExcluded || well.cqStatus === "not-detected") {
      addWarning(specificWarnings, physicalWellId, "EXCLUDED_OR_NON_DETECTED");
    }
  }

  return { replicateQc, groupWarnings, specificWarnings };
}

function createQcPhysicalWellId(plateId: string, well: string): PhysicalWellId {
  return physicalWellIdOf({ plateId, well });
}
