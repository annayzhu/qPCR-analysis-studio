import type { EditLog, WellRecord } from "../../schemas/src";
import { updateWellFields } from "./audit";

export type LayoutTransferMode = "move" | "copy" | "swap";

export interface LayoutTransferRequest {
  mode: LayoutTransferMode;
  sourceWellIds: string[];
  destinationAnchorWellId: string;
  timestamp?: string;
}

export interface LayoutTransferMapping {
  sourceWellId: string;
  destinationWellId: string;
  sourceWell: string;
  destinationWell: string;
}

export interface LayoutTransferResult {
  ok: boolean;
  wells: WellRecord[];
  logs: EditLog[];
  mappings: LayoutTransferMapping[];
  collisionWellIds: string[];
  error: "empty-selection" | "mixed-source-plates" | "out-of-bounds" | "collision" | "overlapping-copy" | "overlapping-swap" | null;
}

type LayoutAnnotation = Pick<WellRecord, "sampleName" | "targetName" | "taskType" | "replicate">;

function annotation(well: WellRecord): LayoutAnnotation {
  return {
    sampleName: well.sampleName,
    targetName: well.targetName,
    taskType: well.taskType,
    replicate: well.replicate,
  };
}

function hasAnnotation(well: WellRecord): boolean {
  return Boolean(well.sampleName || well.targetName || (well.taskType && well.taskType !== "Unknown") || well.replicate !== null);
}

function failed(
  wells: WellRecord[],
  error: LayoutTransferResult["error"],
  mappings: LayoutTransferMapping[] = [],
  collisionWellIds: string[] = [],
): LayoutTransferResult {
  return { ok: false, wells, logs: [], mappings, collisionWellIds, error };
}

export function previewLayoutTransfer(
  wells: WellRecord[],
  request: LayoutTransferRequest,
): LayoutTransferResult {
  const sourceIds = new Set(request.sourceWellIds);
  const sources = wells.filter((well) => sourceIds.has(well.id));
  if (!sources.length) return failed(wells, "empty-selection");
  if (new Set(sources.map((well) => well.plateId)).size !== 1) return failed(wells, "mixed-source-plates");

  const destinationAnchor = wells.find((well) => well.id === request.destinationAnchorWellId);
  if (!destinationAnchor) return failed(wells, "out-of-bounds");
  const sourceAnchor = sources.reduce((anchor, well) =>
    well.row.localeCompare(anchor.row) < 0 || (well.row === anchor.row && well.column < anchor.column) ? well : anchor,
  );
  const wellByPosition = new Map(wells.map((well) => [`${well.plateId}\u241f${well.row}\u241f${well.column}`, well]));
  const mappings: LayoutTransferMapping[] = [];

  for (const source of sources) {
    const rowOffset = source.row.charCodeAt(0) - sourceAnchor.row.charCodeAt(0);
    const columnOffset = source.column - sourceAnchor.column;
    const destinationRow = String.fromCharCode(destinationAnchor.row.charCodeAt(0) + rowOffset);
    const destinationColumn = destinationAnchor.column + columnOffset;
    const destination = wellByPosition.get(`${destinationAnchor.plateId}\u241f${destinationRow}\u241f${destinationColumn}`);
    if (!destination) return failed(wells, "out-of-bounds", mappings);
    mappings.push({
      sourceWellId: source.id,
      destinationWellId: destination.id,
      sourceWell: source.well,
      destinationWell: destination.well,
    });
  }

  const destinationIds = new Set(mappings.map((mapping) => mapping.destinationWellId));
  if (destinationIds.size !== mappings.length) return failed(wells, "out-of-bounds", mappings);
  if (request.mode === "swap" && mappings.some((mapping) => sourceIds.has(mapping.destinationWellId))) {
    return failed(wells, "overlapping-swap", mappings);
  }
  if (request.mode === "copy" && mappings.some((mapping) => sourceIds.has(mapping.destinationWellId))) {
    return failed(wells, "overlapping-copy", mappings);
  }
  const collisionWellIds = request.mode === "swap" ? [] : mappings
    .map((mapping) => wells.find((well) => well.id === mapping.destinationWellId))
    .filter((well): well is WellRecord => Boolean(well))
    .filter((well) => !sourceIds.has(well.id) && hasAnnotation(well))
    .map((well) => well.id);
  if (collisionWellIds.length) return failed(wells, "collision", mappings, collisionWellIds);

  return { ok: true, wells, logs: [], mappings, collisionWellIds: [], error: null };
}

export function transferLayoutAnnotations(
  wells: WellRecord[],
  request: LayoutTransferRequest,
): LayoutTransferResult {
  const preview = previewLayoutTransfer(wells, request);
  if (!preview.ok) return preview;
  const timestamp = request.timestamp ?? new Date().toISOString();
  const wellById = new Map(wells.map((well) => [well.id, well]));
  const sourceAnnotations = new Map(preview.mappings.map((mapping) => [
    mapping.sourceWellId,
    annotation(wellById.get(mapping.sourceWellId)!),
  ]));
  const destinationAnnotations = new Map(preview.mappings.map((mapping) => [
    mapping.destinationWellId,
    annotation(wellById.get(mapping.destinationWellId)!),
  ]));
  let nextWells = wells;
  const logs: EditLog[] = [];

  const apply = (wellId: string, changes: LayoutAnnotation) => {
    const updated = updateWellFields(nextWells, [wellId], changes, timestamp);
    nextWells = updated.wells;
    logs.push(...updated.logs);
  };

  if (request.mode === "move") {
    for (const sourceWellId of request.sourceWellIds) {
      apply(sourceWellId, { sampleName: "", targetName: "", taskType: "Unknown", replicate: null });
    }
  }

  for (const mapping of preview.mappings) {
    apply(mapping.destinationWellId, sourceAnnotations.get(mapping.sourceWellId)!);
    if (request.mode === "swap") {
      apply(mapping.sourceWellId, destinationAnnotations.get(mapping.destinationWellId)!);
    }
  }

  return { ...preview, wells: nextWells, logs };
}
