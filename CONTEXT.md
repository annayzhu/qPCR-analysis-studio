# qPCR Analysis Context

This context describes how instrument measurements, corrected plate layouts, quality review, and relative-quantification results relate inside qPCR Analysis Studio.

## Plate and measurement language

**Physical Well**:
A unique reaction location identified by one plate and one normalized well position.
_Avoid_: Well name, position alone

**Raw Measurement**:
An instrument-derived Cq/Cp/Ct, Tm, melt value, or instrument flag bound to a Physical Well and its source provenance.
_Avoid_: Editable result, corrected measurement

**Layout Annotation**:
The sample, target, assay role, and replicate identity assigned to a Physical Well according to the actual pipetting layout.
_Avoid_: Measurement, raw result

**Imported Baseline**:
The first combined view of Raw Measurements and Layout Annotations produced by one accepted import set.
_Avoid_: Original plate when referring only to the instrument result

## Review and application language

**Draft Snapshot**:
The current reviewed but not yet applied Layout Annotations, exclusions, and Alignment Dispositions.
_Avoid_: Temporary result, live result

**Applied Snapshot**:
The last accepted plate interpretation from which QC and scientific results are calculated.
_Avoid_: Draft, current form state

**Alignment Issue**:
A mismatch where a Physical Well has a result without a complete Layout Annotation, or an annotation without a corresponding result.
_Avoid_: Import failure when human review can resolve it

**Alignment Disposition**:
A recorded human decision that an Alignment Issue is intentionally retained for the current Draft Snapshot.
_Avoid_: Ignore flag, silent acceptance

## Analysis language

**Technical Replicate**:
Repeated reactions for the same biological material and assay used to estimate technical dispersion, not biological variation.
_Avoid_: Biological replicate, sample size

**Biological Sample**:
The independent experimental material that defines the statistical unit for biological comparison.
_Avoid_: Well, technical replicate

**Reference Target**:
An assay measured on the same Biological Sample and plate segment to normalize a target assay.
_Avoid_: Calibrator, control sample

**Calibrator**:
The Biological Sample whose normalized quantity defines the relative-expression reference for delta-delta Cq.
_Avoid_: Reference Target

**Analysis Snapshot**:
The QC, melt review, relative-quantification results, warnings, and calculation settings derived from one Applied Snapshot.
_Avoid_: Draft result, chart data

**Analysis Start**:
The user-confirmed calculation boundary: raw Cq/Ct/Cp, supplied delta Cq, or supplied delta-delta Cq. Required fields, available QC, and downstream calculations are determined by this one workbook-level choice.
_Avoid_: Auto-detected formula stage, per-row start

**Supplied Calculation**:
A user-provided delta Cq or delta-delta Cq value retained independently from Raw Measurements, together with source row, selected Analysis Start, and verification status.
_Avoid_: Raw measurement, silently recomputed value

**Publication Artifact**:
A table, chart, workbook, TSV, SVG, or PNG projected from one Analysis Snapshot without recalculating its scientific values.
_Avoid_: Independent analysis, recomputed export
