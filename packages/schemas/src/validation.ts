import { z } from "zod";

export const wellSchema = z.string().regex(/^[A-P](?:[1-9]|1\d|2[0-4])$/);

export const plateFormatSchema = z.union([z.literal(96), z.literal(384)]);

export const analysisSettingsSchema = z.object({
  referenceTargets: z.array(z.string()).default([]),
  calibratorType: z.enum(["sample", "group"]).default("sample"),
  calibratorValue: z.string().default(""),
  replicateWarningThreshold: z.number().positive().default(0.5),
  tmWarningThreshold: z.number().positive().default(0.5),
  efficiencyByTarget: z.record(z.string(), z.number().positive()).default({}),
  calculationMode: z
    .enum(["delta-cq", "delta-delta-cq", "efficiency-corrected"])
    .default("delta-delta-cq"),
});

export function normalizeWell(value: unknown): string | null {
  const match = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .match(/^([A-P])0*([1-9]|1\d|2[0-4])$/);
  if (!match) return null;
  const well = `${match[1]}${Number(match[2])}`;
  return wellSchema.safeParse(well).success ? well : null;
}
