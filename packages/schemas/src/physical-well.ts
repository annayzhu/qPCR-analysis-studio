import type { WellRecord } from "./types";
import { normalizeWell } from "./validation";

declare const physicalWellIdBrand: unique symbol;

export type PhysicalWellId = string & { readonly [physicalWellIdBrand]: "PhysicalWellId" };

const PHYSICAL_WELL_SEPARATOR = "\u241f";

export function createPhysicalWellId(plateId: string, well: string): PhysicalWellId {
  const normalizedPlateId = plateId.normalize("NFKC").trim();
  const normalizedWell = normalizeWell(well);
  if (!normalizedPlateId) throw new Error("Physical well requires a plate identifier.");
  if (!normalizedWell) throw new Error(`Invalid physical well position: ${well}`);
  return `${normalizedPlateId}${PHYSICAL_WELL_SEPARATOR}${normalizedWell}` as PhysicalWellId;
}

export function physicalWellIdOf(well: Pick<WellRecord, "plateId" | "well">): PhysicalWellId {
  return createPhysicalWellId(well.plateId, well.well);
}

export function physicalWellLabel(well: Pick<WellRecord, "plateId" | "well">): string {
  return `${well.plateId} ${normalizeWell(well.well) ?? well.well}`;
}
