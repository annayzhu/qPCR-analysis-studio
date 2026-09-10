"use client";

import { useMemo, useState } from "react";
import XLSX from "xlsx-js-style";
import type { AnalysisStart, ImportDecision, SuppliedCalculationProvenance, SuppliedCalculationRecord } from "@/packages/schemas/src";
import {
  buildSuppliedCompleteRows,
  buildSuppliedTraceabilityRows,
  buildSuppliedVisualizationBarRows,
  buildImportDecisionRows,
  IMPORT_DECISION_EXPORT_DICTIONARY,
  IMPORT_DECISION_HEADERS,
  SUPPLIED_COMPLETE_HEADERS,
  SUPPLIED_EXPORT_DICTIONARY,
  SUPPLIED_RESULTS_EXPORT_SCHEMA_VERSION,
  SUPPLIED_TRACEABILITY_HEADERS,
  type SuppliedCalculationResult,
  VISUALIZATION_BAR_HEADERS,
} from "@/packages/qpcr-core/src";
import { useLanguage } from "../i18n";
import VisualizationStudioLink from "./VisualizationStudioLink";
import ExpressionChart from "./ExpressionChart";
import { downloadBlob } from "../download";

function formatNumber(value: number | null, digits = 4): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export default function SuppliedResultExplorer({ results, records, analysisStart, sampleOrder, targetOrder, provenance, importDecisions, exportFileStem }: {
  results: SuppliedCalculationResult[];
  records: SuppliedCalculationRecord[];
  analysisStart: Exclude<AnalysisStart, "cq">;
  sampleOrder: string[];
  targetOrder: string[];
  provenance: SuppliedCalculationProvenance | null;
  importDecisions: ImportDecision[];
  exportFileStem: string;
}) {
  const { l } = useLanguage();
  const [showSd, setShowSd] = useState(false);
  const filtered = useMemo(() => results.filter((row) => sampleOrder.includes(row.sampleName) && targetOrder.includes(row.targetName)), [results, sampleOrder, targetOrder]);
  const barRows = useMemo(() => buildSuppliedVisualizationBarRows(results, sampleOrder, targetOrder), [results, sampleOrder, targetOrder]);
  const chartTargets = targetOrder.filter((target) => filtered.some((row) => row.targetName === target));
  const referenceTargets = provenance?.referenceTargets ?? [];
  const displayedCalibrator = provenance?.calibratorValue ?? "";
  const exportTable = (headers: readonly string[], rows: Array<Record<string, string | number | null>>, fileName: string) => {
    const sheet = XLSX.utils.json_to_sheet(rows, { header: [...headers] });
    sheet["!autofilter"] = { ref: sheet["!ref"] ?? "A1:A1" };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Results");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
    downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName);
  };
  const exportTsv = (headers: readonly string[], rows: Array<Record<string, string | number | null>>, fileName: string) => {
    const clean = (value: unknown) => String(value ?? "").replace(/[\t\r\n]+/g, " ");
    const lines = [headers.join("\t"), ...rows.map((row) => headers.map((header) => clean(row[header])).join("\t"))];
    downloadBlob(new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/tab-separated-values;charset=utf-8" }), fileName);
  };
  const exportSuppliedTsvBundle = () => {
    const completeRows = buildSuppliedCompleteRows(results, sampleOrder, targetOrder, provenance);
    const traceabilityRows = buildSuppliedTraceabilityRows(records, provenance);
    const importDecisionRows = buildImportDecisionRows(importDecisions);
    exportTsv(SUPPLIED_COMPLETE_HEADERS, completeRows, `${exportFileStem}-supplied-calculation-results.tsv`);
    exportTsv(SUPPLIED_TRACEABILITY_HEADERS, traceabilityRows, `${exportFileStem}-supplied-values-traceability.tsv`);
    if (importDecisionRows.length) exportTsv(IMPORT_DECISION_HEADERS, importDecisionRows, `${exportFileStem}-import-decisions.tsv`);
    const dictionaryRows = [...SUPPLIED_EXPORT_DICTIONARY, ...IMPORT_DECISION_EXPORT_DICTIONARY].map((entry) => ({
      schema_version: SUPPLIED_RESULTS_EXPORT_SCHEMA_VERSION,
      sheet: entry.sheet,
      field: entry.field,
      definition_zh: entry.definitionZh,
      definition_en: entry.definitionEn,
    }));
    exportTsv(["schema_version", "sheet", "field", "definition_zh", "definition_en"], dictionaryRows, `${exportFileStem}-supplied-data-dictionary.tsv`);
  };
  const exportCompleteWorkbook = () => {
    const completeRows = buildSuppliedCompleteRows(results, sampleOrder, targetOrder, provenance);
    const traceabilityRows = buildSuppliedTraceabilityRows(records, provenance);
    const importDecisionRows = buildImportDecisionRows(importDecisions);
    const workbook = XLSX.utils.book_new();
    const resultSheet = XLSX.utils.json_to_sheet(completeRows, { header: [...SUPPLIED_COMPLETE_HEADERS] });
    resultSheet["!autofilter"] = { ref: resultSheet["!ref"] ?? "A1:A1" };
    const traceabilitySheet = XLSX.utils.json_to_sheet(traceabilityRows, { header: [...SUPPLIED_TRACEABILITY_HEADERS] });
    traceabilitySheet["!autofilter"] = { ref: traceabilitySheet["!ref"] ?? "A1:A1" };
    const metadataSheet = XLSX.utils.aoa_to_sheet([
      ["Export Schema Version", SUPPLIED_RESULTS_EXPORT_SCHEMA_VERSION],
      ["Analysis Start", analysisStart],
      ["Value Provenance", "user-supplied"],
      ["Reference Target(s)", referenceTargets.join("; ")],
      ["Reference Method", provenance?.referenceMethod ?? ""],
      ["Source Calibrator", displayedCalibrator],
    ]);
    const dictionarySheet = XLSX.utils.json_to_sheet([...SUPPLIED_EXPORT_DICTIONARY, ...IMPORT_DECISION_EXPORT_DICTIONARY].map((entry) => ({
      schema_version: SUPPLIED_RESULTS_EXPORT_SCHEMA_VERSION,
      sheet: entry.sheet,
      field: entry.field,
      definition_zh: entry.definitionZh,
      definition_en: entry.definitionEn,
    })));
    XLSX.utils.book_append_sheet(workbook, resultSheet, "Complete Results");
    XLSX.utils.book_append_sheet(workbook, traceabilitySheet, "Supplied Values");
    if (importDecisionRows.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(importDecisionRows, { header: [...IMPORT_DECISION_HEADERS] }), "Import Decisions");
    XLSX.utils.book_append_sheet(workbook, metadataSheet, "Export Metadata");
    XLSX.utils.book_append_sheet(workbook, dictionarySheet, "Data Dictionary");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
    downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${exportFileStem}-supplied-calculation.xlsx`);
  };
  const barRecords = barRows as unknown as Array<Record<string, string | number | null>>;
  return <div className="result-explorer supplied-result-explorer">
    <div className="supplied-provenance-notice"><b>{analysisStart === "delta-cq" ? l("从用户提供的 ΔCq 开始", "Starting from user-supplied ΔCq") : l("从用户提供的 ΔΔCq 开始", "Starting from user-supplied ΔΔCq")}</b><span>{l("系统不会重建上游 Cq 或孔级扩增 QC；所有输出均标注计算起点与数值来源。", "Upstream Cq and well-level amplification QC are not reconstructed; every output identifies its start and provenance.")}</span></div>
    <section className={referenceTargets.length ? "supplied-calculation-basis" : "supplied-calculation-basis incomplete"}>
      <div className="calculation-basis-heading"><p className="eyebrow">CALCULATION BASIS</p><h3>{l("用户计算依据", "User-supplied calculation basis")}</h3><small>{l("仅用于方法溯源，不会再次归一化", "Provenance only; values are not normalized again")}</small></div>
      <dl>
        <div><dt>{l("分析起点", "Analysis start")}</dt><dd>{analysisStart === "delta-cq" ? "ΔCq" : "ΔΔCq"}</dd></div>
        <div><dt>{l("内参基因", "Reference target(s)")}</dt><dd>{referenceTargets.join("; ") || l("未提供", "Not provided")}</dd></div>
        <div><dt>{l("内参处理方法", "Reference method")}</dt><dd>{provenance?.referenceMethod || l("未提供", "Not provided")}</dd></div>
        <div><dt>{l("来源校准样本", "Source calibrator")}</dt><dd>{displayedCalibrator || l("未提供", "Not provided")}</dd></div>
      </dl>
      {!referenceTargets.length && <p className="calculation-basis-warning"><b>{l("内参基因未提供", "Reference target not provided")}</b><span>{l("结果仍可查看，但计算依据不完整；系统不会根据基因名称或数值自动猜测。", "Results remain viewable, but the calculation basis is incomplete. The system will not infer a reference target from names or values.")}</span></p>}
    </section>
    <section className="result-commandbar"><div className="result-commandbar-summary"><div><h3>{l("结果预览", "Result preview")}</h3><p>{l(`${filtered.length} 条用户计算结果`, `${filtered.length} user-supplied result(s)`)}</p></div></div>
      <div className="result-commandbar-grid supplied-commandbar-grid">
        <div className="result-command-group"><span className="command-group-label">{l("显示", "Display")}</span><button type="button" className={showSd ? "filter-chip active" : "filter-chip"} onClick={() => setShowSd((value) => !value)}>{l("技术复孔 SD", "Technical-replicate SD")}</button></div>
        <div className="result-command-group result-export-group"><span className="command-group-label">{l("完整计算结果", "Complete results")}</span><div className="visualization-export-actions"><button type="button" onClick={exportCompleteWorkbook}>Excel</button><button type="button" onClick={exportSuppliedTsvBundle}>TSV</button></div><small className="export-format-hint">{l("Excel 含溯源、版本与数据字典；TSV 同时下载字典", "Excel includes provenance, version, and dictionary sheets; TSV also downloads its dictionary")}</small></div>
        <div className="result-command-group result-export-group visualization-studio-export-group"><div className="command-group-label-row"><span className="command-group-label">Visualization Studio · {l("柱状图格式", "Bar-chart format")}</span><VisualizationStudioLink /></div><div className="visualization-export-actions"><button type="button" onClick={() => exportTable(VISUALIZATION_BAR_HEADERS, barRecords, `${exportFileStem}-visualization-bar.xlsx`)}>{l("柱状图 Excel", "Bar Excel")}</button><button type="button" onClick={() => exportTsv(VISUALIZATION_BAR_HEADERS, barRecords, `${exportFileStem}-visualization-bar.tsv`)}>{l("柱状图 TSV", "Bar TSV")}</button></div><small className="export-format-hint">category · value · sd · sem · group</small></div>
      </div>
    </section>
    <div className="result-chart-stack">{chartTargets.map((target) => <ExpressionChart key={target} rows={filtered.filter(row => row.targetName === target).map(row => ({
      label: row.sampleName,
      rawValue: row.relativeExpression ?? row.normalizedQuantity,
      propagatedSd: row.relativeExpression !== null ? row.relativeExpressionSd : row.normalizedQuantitySd,
      targetValidReplicates: row.validReplicates,
      referenceValidReplicates: {},
      warning: false,
      calibrator: false,
    }))} metricLabel={l("用户提供计算值 · 2 的负指数转换", "User-supplied calculation · negative power-of-two transform")} target={target} sampleOrder={sampleOrder} showTechnicalSd={showSd} theme="paper" axisMode="log-ratio" exportFileStem={exportFileStem} />)}</div>
    <div className="table-section-heading"><h3>{l("完整计算结果", "Complete calculation results")}</h3><p>{l("Δ值来自用户；均值、SD、SEM和指数转换由系统计算。", "Delta values are user supplied; means, SD, SEM, and exponential transforms are calculated by the system.")}</p></div>
    <div className="table-wrap result-table-wrap"><table><thead><tr><th>{l("样本", "Sample")}</th><th>{l("目标基因", "Target")}</th><th>{l("有效复孔 n", "Valid n")}</th><th>ΔCq</th><th>{l("ΔCq 技术 SD", "ΔCq technical SD")}</th><th>{l("ΔCq 技术 SEM", "ΔCq technical SEM")}</th><th>2^-ΔCq</th><th>ΔΔCq</th><th>2^-ΔΔCq</th><th>{l("传播 SD", "Propagated SD")}</th><th>{l("传播 SEM", "Propagated SEM")}</th><th>{l("来源", "Provenance")}</th></tr></thead>
      <tbody>{filtered.map((row) => <tr key={`${row.sampleName}-${row.targetName}`}><td><b>{row.sampleName}</b></td><td>{row.targetName}</td><td>{row.validReplicates}</td><td>{formatNumber(row.deltaCq)}</td><td>{formatNumber(row.deltaCqSd)}</td><td>{formatNumber(row.deltaCqSem)}</td><td>{formatNumber(row.normalizedQuantity)}</td><td>{formatNumber(row.deltaDeltaCq)}</td><td><strong className="expression-value">{formatNumber(row.relativeExpression)}</strong></td><td>{formatNumber(row.relativeExpressionSd ?? row.normalizedQuantitySd)}</td><td>{formatNumber(row.relativeExpressionSem ?? row.normalizedQuantitySem)}</td><td>{l("用户提供的计算值", "User-supplied calculation")}</td></tr>)}</tbody></table></div>
  </div>;
}
