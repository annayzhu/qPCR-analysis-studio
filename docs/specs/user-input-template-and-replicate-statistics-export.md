# Downloadable user input template and replicate-statistics export

## Problem Statement

qPCR Analysis Studio can import instrument exports and separately supplied plate layouts, but users who organize their data manually currently have no authoritative, downloadable table template. They must infer acceptable headers and row structure, which creates avoidable mapping ambiguity, missing fields, and silent loss of Cq/Ct/Cp values.

The analyzed-results export also does not present the complete technical-replicate statistics in one clear, reusable table. Researchers need the replicate mean, sample SD, and SEM for both target and reference measurements, plus correctly propagated uncertainty for normalized quantity and relative expression. The calibrator's relative-expression center is defined as 1, but its technical-replicate uncertainty must not be forced to zero.

## Solution

Add a bilingual, browser-generated XLSX input template that can be downloaded from the Data Import area, completed locally, and uploaded through the existing generic table importer. The workbook contains an empty data-entry sheet, a synthetic example sheet, and a field dictionary/instructions sheet. Required and optional fields are visibly distinguished, and the original file remains local to the browser.

Add a complete calculation-results export that preserves selected sample and target order and includes technical-replicate count, mean Cq/Ct/Cp, sample SD, SEM, normalization outputs, and their propagated SD/SEM. The calibrator remains centered at relative expression 1 while retaining uncertainty derived from valid replicate deviations around their means.

## User Stories

1. As a qPCR researcher, I want a visible “下载数据导入模板 / Download input template” action in Data Import, so that I do not need to guess the required table format.
2. As an offline user, I want the template generated in the browser, so that experimental data is not uploaded to a server.
3. As a bilingual user, I want Chinese and English field names and instructions, so that the template is understandable in either interface language.
4. As a researcher, I want a dedicated empty data-entry sheet, so that example rows are never mistaken for my experimental data.
5. As a researcher, I want a separate synthetic example sheet, so that I can see one valid target, reference, calibrator, NTC, and optional Tm example without exposing real experimental identifiers.
6. As a researcher, I want a field dictionary sheet, so that every column, allowed value, requirement, and unit is explicit.
7. As a researcher, I want required fields visually marked, so that incomplete rows are less likely.
8. As a researcher, I want the template to require Well, Sample, Assay, Assay Type, Replicate, and Cq/Ct/Cp, so that every measurement has a traceable physical and biological identity.
9. As a researcher, I want Plate optional for a single-plate file and required for a multi-plate file, so that repeated well names cannot be merged across plates.
10. As a researcher, I want Tm1 and Tm2 available as optional numeric columns, so that melt-temperature summaries can accompany Cq data without being mandatory for relative quantification.
11. As a researcher, I want common headers such as 样本, Sample, 基因, Assay, 类型, Assay Type, 复孔序号, Replicate, Ct, Cq, and Cp recognized, so that minor language differences do not block import.
12. As a researcher, I want the template's recommended headers to map deterministically to canonical fields, so that a template round trip never opens an avoidable mapping dialog.
13. As a researcher, I want Cq/Ct/Cp to represent a single physical well measurement, so that pre-averaged Ct Mean values are not misinterpreted as technical replicates.
14. As a researcher, I want Replicate to be a positive technical-replicate identifier within each Plate + Sample + Assay group, so that repeated wells can be audited and ordered.
15. As a researcher, I want Assay Type to preserve my supplied value while recognized roles can prefill Target, Reference, NTC, no-RT, Standard, or Unknown, so that import is helpful without silently overriding the later reference-gene selection.
16. As a researcher, I want blank required cells reported by sheet, row, and column, so that I can correct the source table quickly.
17. As a researcher, I want invalid well coordinates, nonnumeric Cq/Tm values, and invalid replicate identifiers reported clearly, so that malformed rows are never silently skipped.
18. As a researcher, I want duplicate Plate + Well records blocked, so that two measurements cannot occupy the same physical reaction.
19. As a researcher, I want duplicate replicate identifiers within the same Plate + Sample + Assay group flagged for review, so that replicate labels remain interpretable.
20. As a researcher, I want valid undetermined/no-amplification text preserved as a non-detected state rather than converted to zero, so that missing amplification is scientifically distinct from a numeric result.
21. As a researcher, I want the import summary to show total rows, valid detected values, non-detected values, warnings, and blocking errors, so that parsing success is not confused with analysis readiness.
22. As a researcher, I want the uploaded template to enter the same Plate Workspace, QC, and analysis workflow as instrument exports, so that there is only one calculation path.
23. As a researcher, I want the complete-results export to respect my selected sample order and selected assay order, so that the exported table is immediately reusable.
24. As a researcher, I want each result row to include Sample, Assay, Assay Type/role, reference assay set, calibrator, and calculation mode, so that the analysis context travels with the numbers.
25. As a researcher, I want target valid-replicate count, target mean Cq, target sample SD, and target SEM included, so that technical precision is explicit.
26. As a researcher, I want reference valid-replicate count, reference mean Cq, reference propagated SD, and reference propagated SEM included, so that normalization uncertainty is explicit.
27. As a researcher, I want delta Cq, normalized quantity, delta-delta Cq, and relative expression included with their available SD and SEM, so that downstream plotting does not require recomputation.
28. As a researcher, I want the calibrator relative-expression value to remain 1 while its SD/SEM reflects replicate dispersion, so that a defined center is not mistaken for zero measurement uncertainty.
29. As a researcher, I want non-calibrator relative-expression uncertainty to include both the sample's and calibrator's technical uncertainty, so that error propagation is symmetric and documented.
30. As a researcher, I want SD calculated from each valid well's deviation from its replicate-group mean using the sample denominator n−1, so that the reported statistic is reproducible.
31. As a researcher, I want SEM calculated as SD divided by the square root of the valid replicate count, so that SD and precision of the mean are not conflated.
32. As a researcher, I want SD and SEM left blank when fewer than two valid, detected, non-excluded technical replicates remain, so that missing uncertainty is not misreported as zero.
33. As a researcher, I want excluded, omitted, invalid, and non-detected wells retained in provenance but excluded from numeric replicate summaries, so that calculations and audit remain aligned.
34. As a researcher, I want the export to label these values as technical-replicate statistics, so that they are not mistaken for biological replicate variation, confidence intervals, or inferential statistics.
35. As a Visualization Studio user, I want the existing five-column bar export retained, so that the richer complete-results export does not break the established category/value/sd/sem/group workflow.
36. As a researcher, I want XLSX and tabular text exports to use stable column names and an accompanying data dictionary, so that scripts and collaborators can reuse them reproducibly.
37. As a researcher, I want all warnings and calculation notes exported alongside results, so that missing replicates, assumed efficiency, and plate-aware pairing remain traceable.
38. As a researcher, I want template version and export schema version recorded in the workbook, so that future software revisions can read older files safely.

## Implementation Decisions

- Place the bilingual template-download action beside the generic table upload controls rather than under a specific instrument adapter.
- Generate one XLSX workbook locally with three sheets: Data, Example, and Field Dictionary. The Example sheet uses synthetic, de-identified identifiers only.
- Use one recommended header per canonical field while documenting accepted Chinese and English synonyms. Template-generated headers must map with exact high confidence.
- Required data columns are Well, Sample, Assay, Assay Type, Replicate, and Cq/Ct/Cp. Plate is required when more than one plate appears. Tm1 and Tm2 are optional.
- Treat each data row as one physical well. Do not accept Ct Mean/Cq Mean as a substitute for single-well Cq/Ct/Cp in this template workflow.
- Normalize well coordinates such as A01 to A1, but reject coordinates outside the inferred or selected 96/384-well format.
- Treat Replicate as a positive integer-like technical-replicate label. Its biological meaning remains technical only and it never defines biological sample size.
- Preserve the submitted Assay Type text. Recognized role vocabulary may prefill workflow roles, but reference genes and calibrator remain explicit user selections before analysis.
- Report row-level validation errors with source sheet, 1-based row number, column, supplied value, and correction guidance. Blocking errors prevent analysis; warnings remain reviewable.
- Block duplicate physical identities. Never resolve duplicate Plate + Well rows by last-write-wins behavior.
- Preserve original uploaded values and mapping provenance; canonicalization must not overwrite the source representation.
- Define replicate mean as the arithmetic mean of valid detected, non-omitted, non-excluded single-well Cq/Ct/Cp values.
- Define replicate SD as the sample standard deviation: square root of the sum of squared deviations from the group mean divided by n−1.
- Define replicate SEM as SD divided by the square root of n.
- Return null/blank SD and SEM for n < 2. Never coerce unavailable uncertainty to zero.
- For multiple reference genes, propagate reference SD and SEM through the mean reference Cq using quadrature divided by the number of references.
- Propagate target and reference uncertainty through delta Cq, normalized quantity, delta-delta Cq, and relative expression using the documented first-order transformation.
- Keep the calibrator's relative-expression center at 1, but retain its own target/reference technical-replicate dispersion around the corresponding means. Other samples additionally include calibrator uncertainty in quadrature.
- Make “technical-replicate SD/SEM” explicit in UI labels, workbook headers, data dictionary, and chart/export notes.
- Extend the complete-results export without changing the established Visualization Studio five-column bar schema.
- Preserve selected sample and assay order in every user-facing export.
- Add a template schema version and calculation/export schema version to workbook metadata or a visible instructions area.
- Reconcile calculation documentation so it no longer states that calibrator uncertainty is always zero.

## Testing Decisions

- Use one highest-level behavioral seam: download the XLSX template, fill its Data sheet with synthetic target/reference/calibrator technical replicates, re-import it, select reference and calibrator, analyze, and export complete results.
- Assert that the downloaded workbook contains Data, Example, and Field Dictionary sheets; required/optional fields, template version, and bilingual guidance are present.
- Assert that the template's recommended headers map deterministically without manual remapping.
- Assert that imported Cq/Ct/Cp and optional Tm1/Tm2 remain attached to their original Plate + Well identities.
- Assert that the workflow produces the same canonical records, QC, and calculation outputs as an equivalent generic input file.
- Assert the exported target and reference replicate counts, means, sample SD, and SEM against hand-calculated synthetic values.
- Assert that SD uses squared deviations from the replicate mean with denominator n−1 and SEM uses SD divided by square root n.
- Assert that the calibrator relative expression equals 1 while its propagated SD/SEM is nonzero when valid replicates vary.
- Assert that a non-calibrator's relative-expression SD/SEM includes both its own and calibrator uncertainty.
- Assert that n = 1 produces blank SD/SEM rather than zero and emits an interpretable note.
- Assert that excluded, omitted, invalid, and non-detected wells remain auditable but do not enter numeric summaries.
- Assert that duplicate Plate + Well, missing required cells, invalid Replicate, invalid Well, and nonnumeric Cq/Tm block analysis with row-specific bilingual messages.
- Assert that a multi-plate file without Plate is blocked, while a single-plate file may receive an explicit default plate identity.
- Assert that selected sample and assay order is preserved in the complete-results workbook.
- Assert that the existing Visualization Studio export still has exactly category, value, sd, sem, and group columns.
- Prefer the end-to-end workflow test as the primary regression boundary; add focused calculation cases only where a formula edge condition cannot be isolated through that workflow.

## Out of Scope

- Automatically identifying biological sample groups from sample names.
- Automatically selecting reference genes or calibrators from Assay Type.
- Treating technical replicates as biological replicates or inferential sample size.
- P values, confidence intervals, hypothesis tests, or automatic group-comparison statistics.
- Automatic replacement of undetermined values with a cycle-limit value.
- Importing pre-averaged Ct Mean as if it were a single physical well.
- Automatically repairing pipetting-position mismatches.
- Server-side upload, cloud storage, or retention of experimental files.
- Changing the Visualization Studio five-column import contract.
- Inferring missing Replicate identifiers from row order without explicit user review.

## Further Notes

- The requested minimum biological fields are preserved, with Well added as a structural requirement because a well-level qPCR record cannot remain traceable or participate in plate/QC linkage without a physical position.
- Plate is conditionally required: optional for a confirmed single-plate template and mandatory for multiple plates.
- Tm1 and Tm2 are optional measurement layers joined to the same physical well; they do not gate relative-quantification analysis.
- The current calculation model already contains target/reference mean, SD, SEM, and propagated result fields. Delivery should expose and document them consistently rather than creating a second calculation path.
- The current calculation documentation contains an older statement that fixes calibrator propagated SD at zero. This conflicts with the agreed product behavior and must be updated together with the export.
- All examples and automated fixtures must use synthetic, de-identified identifiers and must not include real instrument files in public source or issue content.
