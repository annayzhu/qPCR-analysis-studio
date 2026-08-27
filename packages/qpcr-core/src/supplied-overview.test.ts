import { describe, expect, it } from "vitest";
import type { SuppliedCalculationResult } from "./supplied-calculations";
import { buildSuppliedCalculationOverview } from "./supplied-overview";

function result(sampleName: string, targetName: string, values: {
  n: number;
  mean: number;
  sd: number | null;
  sem: number | null;
}): SuppliedCalculationResult {
  return {
    sampleName,
    targetName,
    analysisStart: "delta-cq",
    valueProvenance: "user-supplied",
    validReplicates: values.n,
    deltaCq: values.mean,
    deltaCqSd: values.sd,
    deltaCqSem: values.sem,
    normalizedQuantity: 2 ** -values.mean,
    normalizedQuantitySd: null,
    normalizedQuantitySem: null,
    deltaDeltaCq: null,
    deltaDeltaCqSd: null,
    deltaDeltaCqSem: null,
    relativeExpression: null,
    relativeExpressionSd: null,
    relativeExpressionSem: null,
    calibratorValue: "",
    warningCodes: values.n < 2 ? ["SUPPLIED_CALCULATION_SINGLETON"] : [],
  };
}

describe("supplied calculation overview", () => {
  it("summarizes coverage, replicate structure, and variability without plate assumptions", () => {
    const overview = buildSuppliedCalculationOverview([
      result("Control", "GENE1", { n: 3, mean: 1.1, sd: 0.1, sem: 0.058 }),
      result("Treat", "GENE1", { n: 3, mean: 0.7, sd: 0.4, sem: 0.231 }),
      result("Control", "GENE2", { n: 1, mean: 2.0, sd: null, sem: null }),
    ], "delta-cq", ["Treat", "Control"], ["GENE1", "GENE2"]);

    expect(overview).toMatchObject({
      sampleOrder: ["Treat", "Control"],
      targetOrder: ["GENE1", "GENE2"],
      validValueCount: 7,
      observedGroupCount: 3,
      possibleGroupCount: 4,
      missingGroupCount: 1,
      singletonGroupCount: 1,
      modalReplicateCount: 3,
      unevenReplicateGroupCount: 1,
      replicateCountDistribution: [
        { replicateCount: 1, groupCount: 1 },
        { replicateCount: 3, groupCount: 2 },
      ],
    });
    expect(overview.variabilityGroups.map((row) => `${row.sampleName}:${row.targetName}`)).toEqual([
      "Treat:GENE1",
      "Control:GENE1",
    ]);
  });

  it("uses supplied Delta Delta Cq statistics when that is the authoritative start", () => {
    const deltaDeltaResult = {
      ...result("Treat", "GENE1", { n: 2, mean: 0, sd: null, sem: null }),
      analysisStart: "delta-delta-cq" as const,
      deltaCq: null,
      deltaCqSd: null,
      deltaCqSem: null,
      normalizedQuantity: null,
      deltaDeltaCq: 0.25,
      deltaDeltaCqSd: 0.2,
      deltaDeltaCqSem: 0.141,
      relativeExpression: 2 ** -0.25,
    };
    const overview = buildSuppliedCalculationOverview([deltaDeltaResult], "delta-delta-cq");

    expect(overview.variabilityGroups[0]).toMatchObject({ mean: 0.25, sd: 0.2, sem: 0.141 });
  });
});
