import type { EditLog, ExclusionLog, WellRecord } from "../../schemas/src";

function logId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function updateWellFields(
  wells: WellRecord[],
  wellIds: string[],
  changes: Partial<Pick<WellRecord, "sampleName" | "targetName" | "taskType" | "replicate">>,
  timestamp = new Date().toISOString(),
): { wells: WellRecord[]; logs: EditLog[] } {
  const ids = new Set(wellIds);
  return assignWellAnnotations(wells, wells.filter(well => ids.has(well.id)).map(well => ({ wellId: well.id, changes })), timestamp);
}

export interface WellAnnotationAssignment {
  wellId: string;
  changes: Partial<Pick<WellRecord, "sampleName" | "targetName" | "taskType" | "replicate">>;
}

/** Apply an ordered batch with one index and one copy, never touching physical measurements.
 * Repeated assignments intentionally see earlier changes (e.g. overlapping moves),
 * so audit values retain the same operation order as individual edits.
 */
export function assignWellAnnotations(
  wells: WellRecord[],
  assignments: WellAnnotationAssignment[],
  timestamp = new Date().toISOString(),
): { wells: WellRecord[]; logs: EditLog[] } {
  const indexById = new Map(wells.map((well, index) => [well.id, index]));
  const logs: EditLog[] = [];
  let next = wells;
  for (const { wellId, changes } of assignments) {
    const index = indexById.get(wellId);
    if (index === undefined) continue;
    const well = next[index];
    let updated = well;
    for (const field of ["sampleName", "targetName", "taskType", "replicate"] as const) {
      const newValue = changes[field];
      if (newValue === undefined || newValue === updated[field]) continue;
      logs.push({
        id: logId("edit"),
        wellRecordId: well.id,
        field,
        previousValue: updated[field],
        newValue,
        timestamp,
      });
      if (updated === well) updated = { ...well };
      Object.assign(updated, { [field]: newValue });
    }
    if (updated !== well) {
      if (next === wells) next = wells.slice();
      next[index] = updated;
    }
  }
  return { wells: logs.length ? next : wells, logs };
}

export function setWellExclusion(
  wells: WellRecord[],
  wellIds: string[],
  excluded: boolean,
  reason: string,
  timestamp = new Date().toISOString(),
): { wells: WellRecord[]; logs: ExclusionLog[] } {
  const ids = new Set(wellIds);
  const logs: ExclusionLog[] = [];
  const next = wells.map((well) => {
    if (!ids.has(well.id) || well.userExcluded === excluded) return well;
    logs.push({
      id: logId("exclude"),
      wellRecordId: well.id,
      action: excluded ? "exclude" : "restore",
      reason,
      timestamp,
      previousState: well.userExcluded,
      newState: excluded,
    });
    return { ...well, userExcluded: excluded, exclusionReason: excluded ? reason : "" };
  });
  return { wells: logs.length ? next : wells, logs };
}

export function restoreWellsToBaseline(
  wells: WellRecord[],
  baselineWells: WellRecord[],
  wellIds: string[],
  reason: string,
  timestamp = new Date().toISOString(),
): { wells: WellRecord[]; editLogs: EditLog[]; exclusionLogs: ExclusionLog[] } {
  const baselineById = new Map(baselineWells.map((well) => [well.id, well]));
  const assignments = wellIds.flatMap((wellId): WellAnnotationAssignment[] => {
    const baseline = baselineById.get(wellId);
    return baseline ? [{ wellId, changes: {
      sampleName: baseline.sampleName, targetName: baseline.targetName,
      taskType: baseline.taskType, replicate: baseline.replicate,
    } }] : [];
  });
  const restored = assignWellAnnotations(wells, assignments, timestamp);
  const indexById = new Map(wells.map((well, index) => [well.id, index]));
  let nextWells = restored.wells;
  const exclusionLogs: ExclusionLog[] = [];
  // Restore exclusions in request order, preserving audit semantics for repeated IDs.
  for (const wellId of wellIds) {
    const baseline = baselineById.get(wellId);
    const index = indexById.get(wellId);
    if (!baseline || index === undefined) continue;
    const current = nextWells[index];
    if (current.userExcluded === baseline.userExcluded) continue;
    exclusionLogs.push({
      id: logId("exclude"), wellRecordId: wellId,
      action: baseline.userExcluded ? "exclude" : "restore", reason, timestamp,
      previousState: current.userExcluded, newState: baseline.userExcluded,
    });
    if (nextWells === wells) nextWells = wells.slice();
    nextWells[index] = { ...current, userExcluded: baseline.userExcluded, exclusionReason: baseline.userExcluded ? reason : "" };
  }
  return { wells: nextWells, editLogs: restored.logs, exclusionLogs };
}
