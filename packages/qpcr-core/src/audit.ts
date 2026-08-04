import type { EditLog, ExclusionLog, WellRecord } from "../../schemas/src";

function logId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function updateWellFields(
  wells: WellRecord[],
  wellIds: string[],
  changes: Partial<Pick<WellRecord, "sampleName" | "targetName" | "taskType">>,
  timestamp = new Date().toISOString(),
): { wells: WellRecord[]; logs: EditLog[] } {
  const ids = new Set(wellIds);
  const logs: EditLog[] = [];
  const next = wells.map((well) => {
    if (!ids.has(well.id)) return well;
    let updated = well;
    for (const field of ["sampleName", "targetName", "taskType"] as const) {
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

