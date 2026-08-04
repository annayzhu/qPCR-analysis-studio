import { describe, expect, it } from "vitest";
import { buildCanonicalDataset } from "./canonicalize";
import { inferFieldMappings } from "./field-mapping";
import { parseDelimitedText } from "./workbook";

describe("field mapping", () => {
  it("maps English and Chinese synonyms while keeping mean Cq separate", () => {
    const mappings = inferFieldMappings(
      ["样本编号", "Assay", "Well Position", "Ct", "CT Mean"],
      [["S01", "GAPDH", "A01", 22.4, 22.5]],
    );
    expect(mappings.map((mapping) => mapping.canonicalField)).toEqual([
      "sampleName", "targetName", "well", "cq", "cqMean",
    ]);
  });
});

describe("Roche LightCycler 480 adapter", () => {
  it("recognizes Cp export and treats Roche Cp=0 as non-detected", () => {
    const source = parseDelimitedText(
      "Experiment: Demo  Selected Filter: 465-510\r\nInclude\tColor\tPos\tName\tCp\tConcentration\tStandard\tStatus\r\n1\t\tA1\tSample 1\t22.5\t0\t0\tPassed\r\n1\t\tA2\tSample 2\t0\t0\t0\tPassed\r\n",
      "demo.txt",
    );
    expect(source.adapterId).toBe("roche-lightcycler-480:cq-results");
    const dataset = buildCanonicalDataset([source]);
    expect(dataset.wells[0].cq).toBe(22.5);
    expect(dataset.wells[1].cq).toBeNull();
    expect(dataset.wells[1].cqStatus).toBe("not-detected");
    expect(dataset.plate.plateFormat).toBe(96);
    expect(dataset.plate.requiresConfirmation).toBe(true);
  });

  it("detects complete 384-well boundaries", () => {
    const source = parseDelimitedText("Well\tSample\tTarget\tCq\nA1\tS1\tG1\t20\nP24\tS2\tG1\t21\n", "plate.tsv");
    const dataset = buildCanonicalDataset([source]);
    expect(dataset.plate.plateFormat).toBe(384);
    expect(dataset.plate.requiresConfirmation).toBe(false);
  });
});

