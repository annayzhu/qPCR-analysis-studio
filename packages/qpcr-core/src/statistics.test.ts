import { describe, expect, it } from "vitest";
import { mean, sampleSd, standardError, exponentialUncertainty } from "./statistics";
import { calculateReplicateQc } from "./qc";
import { buildCanonicalDataset, parseDelimitedText } from "../../importers/src";

describe("shared technical statistics", () => {
  it("retains missing SD/SEM for fewer than two observations, including a valid zero", () => {
    expect(mean([])).toBeNull();
    expect(mean([0])).toBe(0);
    expect(sampleSd([])).toBeNull();
    expect(sampleSd([0])).toBeNull();
    expect(standardError(null, 1)).toBeNull();
    expect(exponentialUncertainty(1, null)).toBeNull();
  });
  it("uses n−1 sample SD and propagates the chosen SD/SEM without changing formula", () => {
    expect(mean([10, 12, 14])).toBe(12);
    expect(sampleSd([10, 12, 14])).toBe(2);
    expect(standardError(2, 3)).toBeCloseTo(2 / Math.sqrt(3), 14);
    expect(exponentialUncertainty(4, 2, 1.9)).toBe(Math.log(1.9) * 4 * 2);
    expect(exponentialUncertainty(1, 0)).toBe(0);
  });
  it("checks replicate sequence without allocating an array sized by an imported identifier", () => {
    const data = buildCanonicalDataset([parseDelimitedText(
      "Well\tSample\tAssay\tReplicate\tCq\nA1\tS\tGENE\t1\t20\nA2\tS\tGENE\t1000000000\t20.2\n", "large-identifier.tsv",
    )]);
    const [qc] = calculateReplicateQc(data.wells);
    expect(qc.warningCodes).toContain("REPLICATE_ID_INCOMPLETE");
    expect(qc.meanCq).toBe(20.1);
  });
});
