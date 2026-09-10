# Separate state transitions from derived views

An Analysis Session transition now returns only the next immutable state or a structured failure. It does not compute a read model. Previously the caller discarded that read model and calculated it again during rendering; even rejected commands triggered full QC and quantification.

The session module still owns the derived view, as required by ADR 002. `projection.ts` provides a stateless reference projection and one bounded projector per mounted workspace. The latter reuses results according to immutable input identities:

- Draft changes invalidate draft alignment and draft QC, not Applied Snapshot results.
- Applied Snapshot or scientific settings changes invalidate relative quantification.
- Supplied Calculation results depend on supplied records, Analysis Start and downstream calibrator, not upstream-reference provenance labels.
- Identical draft/applied wells share the same QC object.
- Dropping the cache cannot change any scientific value. It retains at most one previous projection, not a global cache of historical experiments.

`apply` performs alignment validation only, before atomically advancing the Applied Snapshot. The generic session-preview wrapper was removed: it only wrapped one existing layout-preview function and returned `none` for other commands. Callers use `previewLayoutTransfer` directly.

Both quantification paths now use one presentation-only `ExpressionChart`. They retain separate calculators and provenance. Full export bundles are generated only on an explicit export action. Shared scalar statistics are used by QC, calculation and export, without merging the distinct analysis policies.

Rejected alternatives: a subscription store, event bus, generic command-handler registry, global memoization framework, and an unconditional Web Worker migration. None addresses the observed duplicate work more directly than removing it. A worker remains an option if browser measurements of realistic, larger inputs still show blocking after these changes.

Compatibility: session command consumers must read `transition.state` and call the projector when they need a view; `transition.readModel` and `previewAnalysisSessionChange` are removed. Workbook column/schema versions and scientific calculation semantics are unchanged. This is an internal source API change, not a saved-project or workbook migration.
