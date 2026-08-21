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
  const logs: EditLog[] = [];
  const next = wells.map((well) => {
    if (!ids.has(well.id)) return well;
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
      updated = { ...updated, [field]: newValue };
    }
    return updated;
  });
  return { wells: next, logs };
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
  return { wells: next, logs };
}

export function restoreWellsToBaseline(
  wells: WellRecord[],
  baselineWells: WellRecord[],
  wellIds: string[],
  reason: string,
  timestamp = new Date().toISOString(),
): { wells: WellRecord[]; editLogs: EditLog[]; exclusionLogs: ExclusionLog[] } {
  const baselineById = new Map(baselineWells.map((well) => [well.id, well]));
  let nextWells = wells;
  const editLogs: EditLog[] = [];
  const exclusionLogs: ExclusionLog[] = [];

  for (const wellId of wellIds) {
    const baseline = baselineById.get(wellId);
    if (!baseline) continue;
    const fieldRestore = updateWellFields(nextWells, [wellId], {
      sampleName: baseline.sampleName,
      targetName: baseline.targetName,
      taskType: baseline.taskType,
      replicate: baseline.replicate,
    }, timestamp);
    nextWells = fieldRestore.wells;
    editLogs.push(...fieldRestore.logs);

    const current = nextWells.find((well) => well.id === wellId);
    if (current && current.userExcluded !== baseline.userExcluded) {
      const exclusionRestore = setWellExclusion(
        nextWells,
        [wellId],
        baseline.userExcluded,
        reason,
        timestamp,
      );
      nextWells = exclusionRestore.wells;
      exclusionLogs.push(...exclusionRestore.logs);
    }
  }

  return { wells: nextWells, editLogs, exclusionLogs };
}
