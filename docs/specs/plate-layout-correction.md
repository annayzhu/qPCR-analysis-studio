# Pre-analysis plate-layout correction for pipetting-position mismatches

## Problem Statement

Users can import an instrument Cq/Ct/Cp result and a separate plate layout, but the actual pipetting position may differ from the planned layout because of a loading mistake. The import pipeline currently assumes that matching physical well names mean the imported Sample/Target annotations are already correct.

The existing single-plate fallback solves only the simpler case where the result lacks a plate name but both sources describe the same physical wells. It does not solve a physical position mismatch. In the reproduced case, result-bearing wells exist where the layout is blank, while at least one annotated well has no result. The software cannot safely infer biological identity from Cq magnitude. It must allow the user to correct the plate layout before calculation instead of silently treating the imported layout as truth.

## Solution

Introduce an explicit **plate-layout correction workflow before analysis**.

Instrument measurements remain an immutable raw layer keyed by physical plate and well. Sample Name, Target Name, reaction role, replicate identity, and other annotations form a separate editable layout layer. Users inspect result status and alignment diagnostics on the plate, edit or relocate annotations, preview collisions, apply the corrected layout, and only then recalculate QC and relative quantification.

If alignment is suspicious, the user can enter the Plate Workspace in correction mode, but Overview and Results remain locked until the corrected layout is applied. Layout edits never move, rewrite, or synthesize raw Cq/Ct/Cp values.

## User Stories

1. As a qPCR researcher, I want to enter layout-correction mode after importing mismatched files, so that a pipetting mistake does not block the project.
2. As a qPCR researcher, I want raw Cq/Ct/Cp to remain attached to the physical instrument well, so that correction never changes the original measurement.
3. As a qPCR researcher, I want Sample, Target, reaction role, and replicate metadata editable independently from the measurement, so that I can reconstruct the actual plate.
4. As a qPCR researcher, I want the import screen to distinguish files parsed from analysis ready, so that structural success is not mistaken for a valid biological join.
5. As a qPCR researcher, I want wells with results but no Sample/Target flagged, so that unexpected reactions are immediately visible.
6. As a qPCR researcher, I want annotated wells without results flagged, so that missing or shifted reactions are immediately visible.
7. As a qPCR researcher, I want mismatch counts and affected wells shown before calculation, so that I can decide whether correction is needed.
8. As a qPCR researcher, I want to select one or multiple wells and assign Sample, Target, role, and replicate metadata in bulk, so that correction is efficient.
9. As a qPCR researcher, I want to clear annotations from selected wells without deleting raw measurements, so that incorrect layout cells can be emptied safely.
10. As a qPCR researcher, I want to move a selected annotation block to another plate region, so that row, column, or multichannel loading offsets can be corrected without retyping every cell.
11. As a qPCR researcher, I want to copy a selected annotation block, so that repeated layouts can be reconstructed efficiently.
12. As a qPCR researcher, I want to swap two selected annotation regions, so that exchanged loading regions can be corrected atomically.
13. As a qPCR researcher, I want drag-and-drop or explicit destination selection for block moves, so that I can use the clearest interaction.
14. As a qPCR researcher, I want a collision preview before move, copy, paste, or swap, so that existing annotations are not overwritten unexpectedly.
15. As a qPCR researcher, I want destination wells and resulting labels previewed before applying, so that I can verify the correction.
16. As a qPCR researcher, I want every selected well to show its raw measurement status during correction, so that I can align annotations with physical results.
17. As a qPCR researcher, I want layout colors and raw-result status visually distinct, so that metadata is not confused with measurement quality.
18. As a qPCR researcher, I want to paste an Excel block with or without explicit Well values into the layout layer, so that externally corrected maps remain usable.
19. As a qPCR researcher, I want to undo the most recent correction, so that a mistaken edit is reversible.
20. As a qPCR researcher, I want to restore selected wells or the whole plate to the imported baseline, so that I can safely restart.
21. As a qPCR researcher, I want edits to remain a draft until Apply & Recalculate, so that all views use one synchronized state.
22. As a qPCR researcher, I want Overview and Results locked while edits are pending, so that stale calculations cannot be mistaken for current results.
23. As a qPCR researcher, I want Apply & Recalculate to rebuild QC, references, calibrators, tables, and charts from one corrected snapshot, so that all views remain consistent.
24. As a qPCR researcher, I want a blocking error if no detected result is attached to annotated Sample/Target wells after correction, so that analysis cannot fail silently.
25. As a qPCR researcher, I want remaining unannotated result-bearing wells shown as warnings rather than automatically deleted, so that I decide whether they are blanks, contamination, or omitted reactions.
26. As a qPCR researcher, I want instrument flags and user corrections shown together but with separate provenance, so that their sources remain clear.
27. As a qPCR researcher, I want an audit record for assignment, clear, move, copy, swap, paste, restore, and apply, so that reconstruction is traceable.
28. As a qPCR researcher, I want audit entries to include timestamp, source wells, destination wells, old values, new values, and reason, so that another researcher can reproduce the correction.
29. As a qPCR researcher, I want the corrected layout exportable separately from raw results, so that the true plate map can be archived without modifying source files.
30. As a bilingual user, I want all correction controls, diagnostics, warnings, and audit actions in Chinese and English, so that the workflow remains consistent.
31. As a researcher using 96- or 384-well plates, I want identical correction semantics on both formats, so that the workflow remains instrument-neutral.
32. As a researcher importing multiple plates, I want operations constrained to explicitly selected source and destination plates, so that same-named wells on different plates are not mixed.
33. As a researcher, I want correction suggestions clearly labelled as suggestions, so that inferred sample identity is never presented as fact.
34. As a researcher, I want empty, invalid, not-detected, and instrument-omitted states preserved separately, so that scientifically distinct states are not collapsed.

## Implementation Decisions

- Maintain two explicit layers:
  - immutable instrument-result layer keyed by physical `plateId + well`, containing Cq/Ct/Cp, status, reporter, flags, Tm, and melt data;
  - editable plate-layout draft layer keyed by the same physical identity, containing Sample, Target, reaction role, replicate, group, and annotations.
- A layout edit changes annotations only. It never moves or modifies instrument measurements, raw rows, or flags.
- Add an import/alignment state model: `parsed -> alignment-review -> layout-draft -> ready-to-calculate -> analyzed`.
- Separate structural readiness from value-level readiness. Parsing both file roles is insufficient for calculation readiness.
- Alignment diagnostics include result-bearing wells without Sample/Target, annotated wells without results, conflicting plate identity, duplicate destinations, and incomplete technical-replicate groups.
- Diagnostics do not automatically infer or apply biological identity.
- Allow Plate Workspace access from alignment review even when quantification is blocked.
- Reuse existing multi-selection, batch edit, Excel paste, restore, draft/recalculate synchronization, and audit concepts.
- Extend layout operations with clear, move, copy, swap, undo, and whole-plate restore.
- Block moves preserve relative geometry; out-of-bounds operations are rejected before mutation.
- Collision behavior is explicit and previewed; silent overwrite is prohibited.
- Move clears source annotations only after the destination transaction succeeds. Copy retains the source. Swap is atomic.
- Pending corrections lock Overview and Results until Apply & Recalculate.
- Apply & Recalculate creates a corrected-layout snapshot and rebuilds all downstream outputs from it.
- Keep the imported layout baseline and correction snapshots separate from immutable raw measurements.
- Add bilingual messages for correction mode, diagnostics, collision preview, blocked calculation, and audit actions.
- Export the corrected layout as a distinct artifact with source provenance and correction timestamp.
- Do not automatically exclude a layout-empty result-bearing well; require user disposition.
- Keep plate geometry generic; no instrument-specific layout-edit behavior is allowed.

## Testing Decisions

- Use one highest-level behavioral seam: import a result plus mismatched layout, enter correction mode, correct the layout, apply, and observe synchronized measurements, QC, and results.
- Tests verify public user-observable behavior, not private helper implementation.
- The primary regression fixture reproduces the shape of the reported case using synthetic identifiers: detected results in layout-empty wells plus an annotated well without a result.
- Assert that correction mode opens even when calculation is not ready.
- Assert that raw measurements remain unchanged after every layout operation.
- Assert that moving annotations attaches the intended Sample/Target to destination physical measurements without moving those measurements.
- Assert deterministic clear, copy, swap, paste, undo, selected restore, and whole-plate restore behavior.
- Assert that out-of-bounds moves and collisions are rejected before any mutation.
- Assert that pending edits lock Overview and Results.
- Assert that Apply & Recalculate synchronizes Overview, QC, Plate Workspace, tables, and charts to one snapshot.
- Assert a bilingual blocking error when zero detected results attach to annotated wells.
- Assert that unannotated result-bearing wells remain warnings rather than automatic exclusions.
- Assert complete audit records for all correction operations.
- Assert that same-named wells on multiple plates remain isolated by plate identity.
- Reuse prior tests for instrument result mapping, separate-layout readiness, single named plate fallback, multi-plate identity, batch edits, restore, and recalculation synchronization.

## Out of Scope

- Automatically guessing Sample/Target from measurement magnitude.
- Automatically repairing a pipetting error without user confirmation.
- Modifying or overwriting imported source files.
- Moving or editing raw measurements or instrument flags.
- Statistical significance testing or biological interpretation.
- Treating technical replicates as biological replicates.
- Inferring perturbation efficiency or sample identity from expression patterns.
- Rebuilding the separate plate-layout-planner product.
- Cloud upload or server-side storage of experiment data.

## Further Notes

- The previous plate-name fallback remains valid for the simpler same-wells/single-unnamed-plate case.
- This feature addresses a different case: the actual pipetting layout does not correspond to the planned imported layout.
- The current Plate Workspace already supports multi-select annotation edits, Excel paste, selected restore, audit logs, and Apply & Recalculate. The missing capability is a pre-analysis correction stage, safe geometric relocation, and alignment diagnostics.
- The repository currently lacks `docs/agents/issue-tracker.md`; run `/setup-matt-pocock-skills` to install the project-local tracker workflow for future automation.
