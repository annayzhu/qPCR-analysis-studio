"use client";

import { useMemo, useRef, useState } from "react";
import XLSX from "xlsx-js-style";
import type { AnalysisStart, SuppliedCalculationRecord } from "@/packages/schemas/src";
import {
  buildLogRatioAxis,
  buildSuppliedCompleteRows,
  buildSuppliedTraceabilityRows,
  buildSuppliedVisualizationBarRows,
  mapRatioToY,
  SUPPLIED_COMPLETE_HEADERS,
  SUPPLIED_TRACEABILITY_HEADERS,
  type SuppliedCalculationResult,
  VISUALIZATION_BAR_HEADERS,
} from "@/packages/qpcr-core/src";
import { useLanguage } from "../i18n";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatNumber(value: number | null, digits = 4): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function safeFileName(value: string): string {
  return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-") || "qpcr-expression";
}

function SuppliedChart({ rows, target, sampleOrder, showSd }: {
  rows: SuppliedCalculationResult[];
  target: string;
  sampleOrder: string[];
  showSd: boolean;
}) {
  const { l } = useLanguage();
  const svgRef = useRef<SVGSVGElement>(null);
  const plotted = rows.filter((row) => row.targetName === target).map((row) => ({
    label: row.sampleName,
    value: row.relativeExpression ?? row.normalizedQuantity,
    sd: row.relativeExpression !== null ? row.relativeExpressionSd : row.normalizedQuantitySd,
  })).filter((row): row is { label: string; value: number; sd: number | null } => row.value !== null && row.value > 0)
    .sort((a, b) => sampleOrder.indexOf(a.label) - sampleOrder.indexOf(b.label));
  if (!plotted.length) return <div className="empty-chart">{l("没有可绘制的数据。", "No plottable data.")}</div>;
  const width = Math.max(520, 90 + plotted.length * 72);
  const height = 286;
  const left = 58;
  const right = 24;
  const top = 32;
  const bottom = 210;
  const axis = buildLogRatioAxis(plotted.flatMap((row) => row.sd === null || !showSd
    ? [row.value]
    : [Math.max(Number.EPSILON, row.value - row.sd), row.value + row.sd]));
  const y = (value: number) => mapRatioToY(value, axis, top, bottom);
  const slot = (width - left - right) / plotted.length;
  const barWidth = Math.min(32, slot * .5);
  const markup = () => {
    if (!svgRef.current) return null;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return new XMLSerializer().serializeToString(clone);
  };
  return <div className="chart-card publication-chart-card chart-theme-paper supplied-chart-card">
    <div className="chart-heading publication-chart-heading"><div><h3>{target}</h3><p>{l("用户提供计算值 · 2 的负指数转换", "User-supplied calculation · negative power-of-two transform")}</p></div><button type="button" onClick={() => {
      const svg = markup();
      if (svg) downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeFileName(target)}-supplied-expression.svg`);
    }}>SVG</button></div>
    <div className="chart-scroll"><svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${target} expression`} style={{ minWidth: `${width}px`, background: "#fff", fontFamily: "Arial, Helvetica, sans-serif" }}>
      <rect width={width} height={height} fill="#fff" />
      {axis.tickValues.map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="#e7ded4" strokeWidth=".8" /><text x={left - 8} y={y(tick) + 3} textAnchor="end" fill="#687071" fontSize="9">{tick >= 1 ? tick.toFixed(tick % 1 ? 1 : 0) : tick.toPrecision(2)}</text></g>)}
      <line x1={left} x2={width - right} y1={y(1)} y2={y(1)} stroke="#a66a3f" strokeDasharray="4 3" />
      {plotted.map((row, index) => {
        const center = left + slot * (index + .5);
        const baseY = y(2 ** axis.minExponent);
        const topY = y(row.value);
        const errorTop = row.sd === null ? null : y(row.value + row.sd);
        const errorBottom = row.sd === null ? null : y(Math.max(Number.EPSILON, row.value - row.sd));
        return <g key={row.label}><rect x={center - barWidth / 2} y={Math.min(baseY, topY)} width={barWidth} height={Math.max(1, Math.abs(baseY - topY))} rx="1.5" fill="#4f827c" />
          {showSd && errorTop !== null && errorBottom !== null && <g stroke="#343a3b" strokeWidth="1"><line x1={center} x2={center} y1={errorTop} y2={errorBottom} /><line x1={center - 5} x2={center + 5} y1={errorTop} y2={errorTop} /><line x1={center - 5} x2={center + 5} y1={errorBottom} y2={errorBottom} /></g>}
          <text x={center} y={bottom + 19} textAnchor="middle" fill="#4f5658" fontSize="9">{row.label.length > 14 ? `${row.label.slice(0, 13)}…` : row.label}</text></g>;
      })}
      <text x={(left + width - right) / 2} y={height - 18} textAnchor="middle" fill="#303536" fontSize="10">{l("样本", "Sample")}</text>
      <text x="17" y={(top + bottom) / 2} textAnchor="middle" transform={`rotate(-90 17 ${(top + bottom) / 2})`} fill="#303536" fontSize="10">Relative expression (log₂ ratio axis)</text>
    </svg></div>
  </div>;
}

export default function SuppliedResultExplorer({ results, records, analysisStart, sampleOrder, targetOrder }: {
  results: SuppliedCalculationResult[];
  records: SuppliedCalculationRecord[];
  analysisStart: Exclude<AnalysisStart, "cq">;
  sampleOrder: string[];
  targetOrder: string[];
}) {
  const { l } = useLanguage();
  const [showSd, setShowSd] = useState(false);
  const filtered = useMemo(() => results.filter((row) => sampleOrder.includes(row.sampleName) && targetOrder.includes(row.targetName)), [results, sampleOrder, targetOrder]);
  const completeRows = useMemo(() => buildSuppliedCompleteRows(results, sampleOrder, targetOrder), [results, sampleOrder, targetOrder]);
  const traceabilityRows = useMemo(() => buildSuppliedTraceabilityRows(records), [records]);
  const barRows = useMemo(() => buildSuppliedVisualizationBarRows(results, sampleOrder, targetOrder), [results, sampleOrder, targetOrder]);
  const chartTargets = targetOrder.filter((target) => filtered.some((row) => row.targetName === target));
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
  const exportCompleteWorkbook = () => {
    const workbook = XLSX.utils.book_new();
    const resultSheet = XLSX.utils.json_to_sheet(completeRows, { header: [...SUPPLIED_COMPLETE_HEADERS] });
    resultSheet["!autofilter"] = { ref: resultSheet["!ref"] ?? "A1:A1" };
    const traceabilitySheet = XLSX.utils.json_to_sheet(traceabilityRows, { header: [...SUPPLIED_TRACEABILITY_HEADERS] });
    traceabilitySheet["!autofilter"] = { ref: traceabilitySheet["!ref"] ?? "A1:A1" };
    XLSX.utils.book_append_sheet(workbook, resultSheet, "Complete Results");
    XLSX.utils.book_append_sheet(workbook, traceabilitySheet, "Supplied Values");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
    downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "qpcr-supplied-calculation-results.xlsx");
  };
  const barRecords = barRows as unknown as Array<Record<string, string | number | null>>;
  return <div className="result-explorer supplied-result-explorer">
    <div className="supplied-provenance-notice"><b>{analysisStart === "delta-cq" ? l("从用户提供的 ΔCq 开始", "Starting from user-supplied ΔCq") : l("从用户提供的 ΔΔCq 开始", "Starting from user-supplied ΔΔCq")}</b><span>{l("系统不会重建上游 Cq 或孔级扩增 QC；所有输出均标注计算起点与数值来源。", "Upstream Cq and well-level amplification QC are not reconstructed; every output identifies its start and provenance.")}</span></div>
    <section className="result-commandbar"><div className="result-commandbar-summary"><div><h3>{l("结果预览", "Result preview")}</h3><p>{l(`${filtered.length} 条用户计算结果`, `${filtered.length} user-supplied result(s)`)}</p></div></div>
      <div className="result-commandbar-grid supplied-commandbar-grid">
        <div className="result-command-group"><span className="command-group-label">{l("显示", "Display")}</span><button type="button" className={showSd ? "filter-chip active" : "filter-chip"} onClick={() => setShowSd((value) => !value)}>{l("技术复孔 SD", "Technical-replicate SD")}</button></div>
        <div className="result-command-group result-export-group"><span className="command-group-label">{l("完整计算结果", "Complete results")}</span><div className="visualization-export-actions"><button type="button" onClick={exportCompleteWorkbook}>Excel</button><button type="button" onClick={() => exportTsv(SUPPLIED_COMPLETE_HEADERS, completeRows, "qpcr-supplied-calculation-results.tsv")}>TSV</button></div><small className="export-format-hint">{l("Excel 含 Supplied Values 原始行溯源表", "Excel includes a Supplied Values traceability sheet")}</small></div>
        <div className="result-command-group result-export-group visualization-studio-export-group"><span className="command-group-label">Visualization Studio · {l("柱状图格式", "Bar-chart format")}</span><div className="visualization-export-actions"><button type="button" onClick={() => exportTable(VISUALIZATION_BAR_HEADERS, barRecords, "qpcr-visualization-bar.xlsx")}>{l("柱状图 Excel", "Bar Excel")}</button><button type="button" onClick={() => exportTsv(VISUALIZATION_BAR_HEADERS, barRecords, "qpcr-visualization-bar.tsv")}>{l("柱状图 TSV", "Bar TSV")}</button></div><small className="export-format-hint">category · value · sd · sem · group</small></div>
      </div>
    </section>
    <div className="result-chart-stack">{chartTargets.map((target) => <SuppliedChart key={target} rows={filtered} target={target} sampleOrder={sampleOrder} showSd={showSd} />)}</div>
    <div className="table-section-heading"><h3>{l("完整计算结果", "Complete calculation results")}</h3><p>{l("Δ值来自用户；均值、SD、SEM和指数转换由系统计算。", "Delta values are user supplied; means, SD, SEM, and exponential transforms are calculated by the system.")}</p></div>
    <div className="table-wrap result-table-wrap"><table><thead><tr><th>{l("样本", "Sample")}</th><th>{l("目标基因", "Target")}</th><th>{l("有效复孔 n", "Valid n")}</th><th>ΔCq</th><th>{l("ΔCq 技术 SD", "ΔCq technical SD")}</th><th>{l("ΔCq 技术 SEM", "ΔCq technical SEM")}</th><th>2^-ΔCq</th><th>ΔΔCq</th><th>2^-ΔΔCq</th><th>{l("传播 SD", "Propagated SD")}</th><th>{l("传播 SEM", "Propagated SEM")}</th><th>{l("来源", "Provenance")}</th></tr></thead>
      <tbody>{filtered.map((row) => <tr key={`${row.sampleName}-${row.targetName}`}><td><b>{row.sampleName}</b></td><td>{row.targetName}</td><td>{row.validReplicates}</td><td>{formatNumber(row.deltaCq)}</td><td>{formatNumber(row.deltaCqSd)}</td><td>{formatNumber(row.deltaCqSem)}</td><td>{formatNumber(row.normalizedQuantity)}</td><td>{formatNumber(row.deltaDeltaCq)}</td><td><strong className="expression-value">{formatNumber(row.relativeExpression)}</strong></td><td>{formatNumber(row.relativeExpressionSd ?? row.normalizedQuantitySd)}</td><td>{formatNumber(row.relativeExpressionSem ?? row.normalizedQuantitySem)}</td><td>{l("用户提供的计算值", "User-supplied calculation")}</td></tr>)}</tbody></table></div>
  </div>;
}
