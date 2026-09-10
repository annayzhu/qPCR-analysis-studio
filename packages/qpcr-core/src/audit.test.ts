import { describe, expect, it } from "vitest";
import { buildCanonicalDataset, parseDelimitedText } from "../../importers/src";
import { assignWellAnnotations, restoreWellsToBaseline, setWellExclusion } from "./audit";

function fixture() {
  return buildCanonicalDataset([parseDelimitedText("Well\tSample\tTarget\tReplicate\tCq\nA1\tS1\tREF\t1\t20\nA2\tS1\tGENE\t1\t24", "synthetic.tsv")]).wells;
}

describe("ordered bulk annotations", () => {
  it("preserves sequential audit values, untouched identities and physical measurements", () => {
    const wells = fixture();
    const before = structuredClone(wells);
    const changed = assignWellAnnotations(wells, [
      { wellId: wells[0].id, changes: { sampleName: "First", replicate: 2 } },
      { wellId: wells[0].id, changes: { sampleName: "Second", replicate: null } },
      { wellId: "absent", changes: { sampleName: "Ignored" } },
    ], "2026-09-10T00:00:00Z");
    expect(changed.logs.map(({ field, previousValue, newValue }) => ({ field, previousValue, newValue }))).toEqual([
      { field: "sampleName", previousValue: "S1", newValue: "First" },
      { field: "replicate", previousValue: 1, newValue: 2 },
      { field: "sampleName", previousValue: "First", newValue: "Second" },
      { field: "replicate", previousValue: 2, newValue: null },
    ]);
    expect(wells).toEqual(before);
    expect(changed.wells[0]).toEqual({ ...before[0], sampleName: "Second", replicate: null });
    expect(changed.wells[1]).toBe(wells[1]);
  });

  it("retains array identity on no-op, unknown IDs and already-restored selections", () => {
    const wells = fixture();
    expect(assignWellAnnotations(wells, [{ wellId: wells[0].id, changes: { sampleName: "S1" } }]).wells).toBe(wells);
    expect(assignWellAnnotations(wells, [{ wellId: "absent", changes: { sampleName: "S2" } }]).wells).toBe(wells);
    expect(restoreWellsToBaseline(wells, wells, wells.map(w => w.id), "Restore").wells).toBe(wells);
  });

  it("restores annotations and exclusions together without mutating the draft or imported baseline", () => {
    const baseline = fixture();
    const ids = baseline.slice(0, 2).map(w => w.id);
    const edited = assignWellAnnotations(baseline, ids.map(wellId => ({ wellId, changes: { sampleName: "Other" } })));
    const excluded = setWellExclusion(edited.wells, ids, true, "Review");
    const draftCopy = structuredClone(excluded.wells);
    const restored = restoreWellsToBaseline(excluded.wells, baseline, [...ids, ids[0]], "Restore");
    expect(restored.wells).toEqual(baseline);
    expect(restored.editLogs).toHaveLength(2);
    expect(restored.exclusionLogs).toHaveLength(2);
    expect(excluded.wells).toEqual(draftCopy);
  });
});
