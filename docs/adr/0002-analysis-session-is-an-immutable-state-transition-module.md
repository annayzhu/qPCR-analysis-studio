# Model the analysis session as immutable state transitions

The Analysis Session Module owns Draft, Applied, audit, alignment, QC, and analysis synchronization behind one in-process Seam; React owns only presentation state and acts as an Adapter. An immutable transition model was chosen over a mutable subscription store or a general plan-and-commit framework because it keeps tests and callers on the same Interface without adding persistence or plugin complexity that the current product does not need.
