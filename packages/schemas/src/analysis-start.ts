import type { AnalysisStart, CanonicalField } from "./types";

export interface AnalysisStartPolicy {
  calculationOnly: boolean;
  authoritativeValueField: "cq" | "deltaCq" | "deltaDeltaCq";
  requiredFields: readonly CanonicalField[];
  usesPhysicalPlate: boolean;
}

export const ANALYSIS_START_POLICIES: Record<AnalysisStart, AnalysisStartPolicy> = {
  cq: {
    calculationOnly: false,
    authoritativeValueField: "cq",
    requiredFields: ["well", "sampleName", "targetName", "taskType", "replicate", "cq"],
    usesPhysicalPlate: true,
  },
  "delta-cq": {
    calculationOnly: true,
    authoritativeValueField: "deltaCq",
    requiredFields: ["sampleName", "targetName", "replicate", "deltaCq"],
    usesPhysicalPlate: false,
  },
  "delta-delta-cq": {
    calculationOnly: true,
    authoritativeValueField: "deltaDeltaCq",
    requiredFields: ["sampleName", "targetName", "replicate", "deltaDeltaCq"],
    usesPhysicalPlate: false,
  },
};

export function analysisStartPolicy(start: AnalysisStart): AnalysisStartPolicy {
  return ANALYSIS_START_POLICIES[start];
}
