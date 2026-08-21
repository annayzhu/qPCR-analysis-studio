"use client";

import { useMemo, useRef, useState } from "react";
import XLSX from "xlsx-js-style";
import type { AnalysisSettings, RelativeQuantificationResult } from "@/packages/schemas/src";
import {
  buildCompleteResultRows,
  buildLogRatioAxis,
  buildVisualizationBarRows,
  chartLabelVisualUnits,
  COMPLETE_RESULTS_DICTIONARY,
  COMPLETE_RESULTS_HEADERS,
  mapRatioToY,
  VISUALIZATION_BAR_HEADERS,
  wrapChartLabel,
} from "@/packages/qpcr-core/src";
import { useLanguage } from "../i18n";

type SortKey = "sampleName" | "targetName" | "targetMeanCq" | "targetSdCq" | "deltaCq" | "normalizedQuantity" | "relativeExpression";

function formatNumber(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

type ChartTheme = "dark" | "paper";
type AxisMode = "log-ratio" | "linear";

function axisTickLabel(value: number): string {
  if (value >= 1) return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return value >= 0.1 ? value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : value.toPrecision(2);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-") || "qpcr-expression";
}

function calculationWarningLabel(code: string, l: (zh: string, en: string) => string): string {
  const labels: Record<string, [string, string]> = {
    EFFICIENCY_ASSUMED_100_PERCENT: ["未输入扩增效率，按 100% 计算", "No efficiency entered; assumed 100%"],
    CALIBRATOR_MISSING: ["缺少校准样本", "Calibrator missing"],
    PLATE_AWARE_REFERENCE_PAIRING: ["跨板样本已按同板内参配对", "Split sample paired with same-plate reference"],
    MULTI_PLATE_TARGET_MERGED: ["同一目标跨板重复，已先按板计算再合并", "Repeated target merged after plate-level calculation"],
  };
  const label = labels[code];
  return label ? l(label[0], label[1]) : code;
}

function ExpressionChart({
  rows,
  target,
  sampleOrder,
  showTechnicalSd,
  theme,
  axisMode,
}: {
  rows: RelativeQuantificationResult[];
  target: string;
  sampleOrder: string[];
  showTechnicalSd: boolean;
  theme: ChartTheme;
  axisMode: AxisMode;
}) {
  const { l } = useLanguage();
  const svgRef = useRef<SVGSVGElement>(null);
  const chartRows = rows
    .filter((row) => row.targetName === target)
    .map((row) => ({
      label: row.sampleName,
      rawValue: row.relativeExpression ?? row.normalizedQuantity,
      propagatedSd: row.relativeExpression !== null ? row.relativeExpressionSd : row.normalizedQuantitySd,
      targetValidReplicates: row.targetValidReplicates,
      referenceValidReplicates: row.referenceValidReplicates,
      warning: row.warningCodes.length > 0,
      calibrator: Boolean(row.calibratorValue && row.sampleName === row.calibratorValue),
    }))
    .filter((row) => Number.isFinite(row.rawValue) && row.rawValue > 0)
    .sort((a, b) => sampleOrder.indexOf(a.label) - sampleOrder.indexOf(b.label))
    .slice(0, 40);

  if (!chartRows.length) return <div className="empty-chart">{l("当前筛选下没有可绘制的数据。", "No plottable data are available for the current selection.")}</div>;

  const values = chartRows.flatMap((row) => {
    if (!showTechnicalSd || row.propagatedSd === null) return [row.rawValue];
    const lower = row.rawValue - row.propagatedSd;
    return lower > 0
      ? [lower, row.rawValue, row.rawValue + row.propagatedSd]
      : [row.rawValue, row.rawValue + row.propagatedSd];
  });
  const left = 58;
  const right = 22;
  const top = 42;
  const bottom = 198;
  const maxLabelUnitsPerLine = chartRows.length > 16 ? 7 : chartRows.length > 8 ? 9 : 12;
  const wrappedSampleLabels = chartRows.map((row) => wrapChartLabel(row.label, maxLabelUnitsPerLine));
  const longestLabelLine = Math.max(...wrappedSampleLabels.flat().map(chartLabelVisualUnits));
  const maxLabelLines = Math.max(...wrappedSampleLabels.map((lines) => lines.length));
  const labelLineHeight = 10.5;
  const labelTop = bottom + 15;
  const axisTitleY = labelTop + (maxLabelLines - 1) * labelLineHeight + 21;
  const height = Math.max(270, axisTitleY + 17);
  const minimumSlotWidth = chartRows.length > 16 ? 36 : chartRows.length > 8 ? 46 : Math.max(54, longestLabelLine * 4.2 + 8);
  const width = Math.max(500, left + right + chartRows.length * minimumSlotWidth);
  const fitsCompactCard = chartRows.length <= 6;
  const plotWidth = width - left - right;
  const slotWidth = plotWidth / chartRows.length;
  const barWidth = Math.min(30, slotWidth * .54);
  const ratioAxis = buildLogRatioAxis(values);
  const linearMax = Math.max(1.2, Math.max(...values) * 1.14);
  const linearTicks = Array.from({ length: 6 }, (_, index) => (linearMax / 5) * index);
  const ticks = axisMode === "log-ratio" ? ratioAxis.tickValues : linearTicks;
  const y = (value: number) => axisMode === "log-ratio"
    ? mapRatioToY(value, ratioAxis, top, bottom)
    : bottom - (Math.min(linearMax, Math.max(0, value)) / linearMax) * (bottom - top);
  const referenceY = y(1);
  const colors = theme === "dark" ? {
    background: "#183330", border: "#55736e", text: "#f2f5f3", muted: "#c0cfcb",
    axis: "#d2dcda", grid: "#42605b", bar: "#70aaa2", calibrator: "#c8b9a7", calibratorStroke: "#eadfd2",
    warning: "#e2ad65", reference: "#e2ad65",
  } : {
    background: "#ffffff", border: "#ded8d0", text: "#292d2e", muted: "#60686a",
    axis: "#343a3b", grid: "#e7ded4", bar: "#4f827c", calibrator: "#d7cdc0", calibratorStroke: "#746c64",
    warning: "#b36b45", reference: "#a66a3f",
  };
  const usesCalibrator = chartRows.some((row) => row.calibrator);
  const metricLabel = rows.some((row) => row.relativeExpression !== null) ? "Relative expression · 2⁻ΔΔCq" : "Normalized quantity · 2⁻ΔCq";
  const replicateSummary = chartRows.map((row) => {
    const referenceCounts = Object.entries(row.referenceValidReplicates)
      .map(([reference, count]) => `${reference} n=${count}`)
      .join(", ");
    return `${row.label}: ${target} n=${row.targetValidReplicates}${referenceCounts ? `; ${referenceCounts}` : ""}`;
  }).join(" · ");

  function serializedSvg(): string | null {
    if (!svgRef.current) return null;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    return new XMLSerializer().serializeToString(clone);
  }

  function exportSvg() {
    const markup = serializedSvg();
    if (!markup) return;
    downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), `${safeFileName(target)}-relative-expression.svg`);
  }

  async function exportPng() {
    const markup = serializedSvg();
    if (!markup) return;
    const sourceUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.src = sourceUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(l("图表渲染失败", "Chart rendering failed")));
    });
    const scale = 4;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.fillStyle = colors.background;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(sourceUrl);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
    if (blob) downloadBlob(blob, `${safeFileName(target)}-relative-expression-4x.png`);
  }

  return (
    <div className={`chart-card publication-chart-card chart-theme-${theme}`}>
      <div className="chart-heading publication-chart-heading">
        <div><h3>{target}</h3><p>{metricLabel}</p></div>
        <div className="chart-export-actions compact-chart-export-actions">
          <button type="button" onClick={exportSvg}>SVG</button>
          <button type="button" onClick={() => void exportPng()}>PNG 4×</button>
        </div>
      </div>
      <div className="chart-scroll">
        <svg
          ref={svgRef}
          className="expression-chart publication-expression-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={l(`${target} 相对表达量图`, `${target} relative-expression chart`)}
          style={{ width: fitsCompactCard ? "100%" : `${width}px`, minWidth: fitsCompactCard ? undefined : "100%", fontFamily: "Arial, Helvetica, 'PingFang SC', sans-serif", background: colors.background }}
        >
          <rect x="0" y="0" width={width} height={height} fill={colors.background} />
          {theme === "dark" && <rect x="1" y="1" width={width - 2} height={height - 2} fill="none" stroke={colors.border} strokeWidth="1" />}
          <g transform={`translate(${left}, 22)`}>
            <line x1="0" x2="16" y1="-1" y2="-1" stroke={colors.reference} strokeDasharray="4 3" />
            <text x="22" y="2" fill={colors.muted} fontSize="9">Reference = 1</text>
            {usesCalibrator && <g transform="translate(116, 0)"><rect x="0" y="-7" width="10" height="10" fill={colors.calibrator} stroke={colors.calibratorStroke} strokeWidth=".8" /><text x="15" y="2" fill={colors.muted} fontSize="9">{l("校准样本", "Calibrator")}</text></g>}
            {showTechnicalSd && <g transform={`translate(${usesCalibrator ? 218 : 112}, 0)`}>
              <line x1="5" x2="5" y1="-7" y2="5" stroke={colors.axis} strokeWidth="1" />
              <line x1="1" x2="9" y1="-7" y2="-7" stroke={colors.axis} strokeWidth="1" />
              <line x1="1" x2="9" y1="5" y2="5" stroke={colors.axis} strokeWidth="1" />
              <text x="15" y="2" fill={colors.muted} fontSize="9">{l("技术 SD", "Technical SD")}</text>
            </g>}
          </g>

          {ticks.map((tick) => {
            const tickY = y(tick);
            return (
              <g key={tick}>
                <line x1={left} x2={width - right} y1={tickY} y2={tickY} stroke={colors.grid} strokeWidth=".8" />
                <line x1={left - 5} x2={left} y1={tickY} y2={tickY} stroke={colors.axis} strokeWidth="1" />
                <text x={left - 10} y={tickY + 3} textAnchor="end" fill={colors.muted} fontSize="10">{axisTickLabel(tick)}</text>
              </g>
            );
          })}
          <line x1={left} x2={left} y1={top} y2={bottom} stroke={colors.axis} strokeWidth="1" />
          <line x1={left} x2={width - right} y1={bottom} y2={bottom} stroke={colors.axis} strokeWidth="1" />
          {referenceY >= top && referenceY <= bottom && (
            <line x1={left} x2={width - right} y1={referenceY} y2={referenceY} stroke={colors.reference} strokeWidth="1.2" strokeDasharray="5 4" />
          )}
          {chartRows.map((row, index) => {
            const centerX = left + slotWidth * (index + .5);
            const barTop = y(row.rawValue);
            const barHeight = Math.max(1, bottom - barTop);
            const labelLines = wrappedSampleLabels[index];
            const lowerError = row.propagatedSd === null ? null : Math.max(0, row.rawValue - row.propagatedSd);
            const upperError = row.propagatedSd === null ? null : row.rawValue + row.propagatedSd;
            const errorTop = upperError === null ? null : y(upperError);
            const errorBottom = lowerError === null ? null : axisMode === "log-ratio" && lowerError === 0 ? bottom : y(lowerError);
            const replicateTitle = Object.entries(row.referenceValidReplicates)
              .map(([reference, count]) => `${reference} n=${count}`)
              .join(", ");
            return (
              <g key={`${row.label}-${index}`}>
                <title>{row.label}: {row.rawValue.toFixed(4)}{showTechnicalSd && row.propagatedSd !== null ? ` ± ${row.propagatedSd.toFixed(4)} ${l("技术复孔传播 SD", "propagated technical SD")}` : ""} · {target} n={row.targetValidReplicates}{replicateTitle ? `; ${replicateTitle}` : ""}{row.warning ? l(" · QC 提示", " · QC warning") : ""}</title>
                <rect x={centerX - barWidth / 2} y={barTop} width={barWidth} height={barHeight} fill={row.calibrator ? colors.calibrator : colors.bar} fillOpacity=".9" stroke={row.warning ? colors.warning : row.calibrator ? colors.calibratorStroke : colors.axis} strokeWidth={row.warning ? 1.35 : .7} />
                {showTechnicalSd && errorTop !== null && errorBottom !== null && <g aria-label={l(`${row.label} 技术复孔传播 SD`, `${row.label} propagated technical-replicate SD`)}>
                  <line x1={centerX} x2={centerX} y1={errorTop} y2={errorBottom} stroke={colors.axis} strokeWidth="1.15" />
                  <line x1={centerX - 5} x2={centerX + 5} y1={errorTop} y2={errorTop} stroke={colors.axis} strokeWidth="1.15" />
                  <line x1={centerX - 5} x2={centerX + 5} y1={errorBottom} y2={errorBottom} stroke={colors.axis} strokeWidth="1.15" />
                </g>}
                {row.warning && <circle cx={centerX} cy={Math.max(top + 4, (errorTop ?? barTop) - 7)} r="3" fill={colors.background} stroke={colors.warning} strokeWidth="1.2" />}
                <text
                  x={centerX}
                  y={labelTop}
                  textAnchor="middle"
                  fill={colors.muted}
                  fontSize="10"
                  aria-label={row.label}
                >{labelLines.map((line, lineIndex) => <tspan key={`${line}-${lineIndex}`} x={centerX} dy={lineIndex === 0 ? 0 : labelLineHeight}>{line}</tspan>)}</text>
              </g>
            );
          })}
          <text x={(left + width - right) / 2} y={axisTitleY} textAnchor="middle" fill={colors.text} fontSize="11">{l("生物学样本", "Biological sample")}</text>
          <text x="21" y={(top + bottom) / 2} textAnchor="middle" transform={`rotate(-90 21 ${(top + bottom) / 2})`} fill={colors.text} fontSize="11">
            {axisMode === "log-ratio" ? "Relative expression (log₂ ratio axis)" : "Relative expression"}
          </text>
        </svg>
      </div>
      <details className="chart-replicate-details"><summary>{l("有效技术复孔 n", "Valid technical-replicate n")}</summary><p>{replicateSummary}</p></details>
    </div>
  );
}

interface ResultExplorerProps {
  results: RelativeQuantificationResult[];
  sampleOrder: string[];
  targetOrder: string[];
  calculationMode: AnalysisSettings["calculationMode"];
}

export default function ResultExplorer({ results, sampleOrder, targetOrder, calculationMode }: ResultExplorerProps) {
  const { language, l } = useLanguage();
  const [warningOnly, setWarningOnly] = useState(false);
  const [showTechnicalSd, setShowTechnicalSd] = useState(false);
  const [chartTheme, setChartTheme] = useState<ChartTheme>("paper");
  const [axisMode, setAxisMode] = useState<AxisMode>("log-ratio");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    return results
      .filter((row) => sampleOrder.includes(row.sampleName) && targetOrder.includes(row.targetName))
      .filter((row) => !warningOnly || row.warningCodes.length > 0)
      .sort((a, b) => {
        if (sortKey === null) {
          const targetComparison = targetOrder.indexOf(a.targetName) - targetOrder.indexOf(b.targetName);
          return targetComparison || sampleOrder.indexOf(a.sampleName) - sampleOrder.indexOf(b.sampleName);
        }
        const av = a[sortKey] ?? Number.NEGATIVE_INFINITY;
        const bv = b[sortKey] ?? Number.NEGATIVE_INFINITY;
        const comparison = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, language === "zh" ? "zh-CN" : "en") : Number(av) - Number(bv);
        return sortDirection === "asc" ? comparison : -comparison;
      });
  }, [language, results, sampleOrder, sortDirection, sortKey, targetOrder, warningOnly]);
  const chartTargets = useMemo(
    () => targetOrder.filter((target) => filtered.some((row) => row.targetName === target)),
    [filtered, targetOrder],
  );
  const visualizationRows = useMemo(
    () => buildVisualizationBarRows(results, sampleOrder, targetOrder),
    [results, sampleOrder, targetOrder],
  );
  const completeRows = useMemo(
    () => buildCompleteResultRows(results, sampleOrder, targetOrder, calculationMode),
    [calculationMode, results, sampleOrder, targetOrder],
  );

  function exportCompleteExcel() {
    const resultValues = completeRows.map((row) => COMPLETE_RESULTS_HEADERS.map((header) => row[header] ?? ""));
    const worksheet = XLSX.utils.aoa_to_sheet([[...COMPLETE_RESULTS_HEADERS], ...resultValues]);
    worksheet["!cols"] = COMPLETE_RESULTS_HEADERS.map((header) => ({ wch: Math.min(46, Math.max(14, header.length + 2)) }));
    worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(COMPLETE_RESULTS_HEADERS.length - 1)}${resultValues.length + 1}` };
    COMPLETE_RESULTS_HEADERS.forEach((_, index) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: 0, c: index })];
      if (cell) cell.s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { patternType: "solid", fgColor: { rgb: "315F5B" } }, alignment: { horizontal: "center", wrapText: true } };
    });
    const dictionary = XLSX.utils.json_to_sheet(COMPLETE_RESULTS_DICTIONARY.map((item) => ({
      field: item.field,
      "中文定义": item.definitionZh,
      "English definition": item.definitionEn,
    })));
    dictionary["!cols"] = [{ wch: 44 }, { wch: 54 }, { wch: 64 }];
    const workbook = XLSX.utils.book_new();
    workbook.Props = { Title: "qPCR complete calculation results", Subject: "Technical-replicate statistics and propagated uncertainty", Author: "qPCR Analysis Studio" };
    XLSX.utils.book_append_sheet(workbook, worksheet, "Complete Results");
    XLSX.utils.book_append_sheet(workbook, dictionary, "Data Dictionary");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
    downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "qpcr-complete-calculation-results.xlsx");
  }

  function exportCompleteTsv() {
    const escapeCell = (value: string | number | null) => String(value ?? "").replace(/[\t\r\n]+/g, " ");
    const lines = [
      COMPLETE_RESULTS_HEADERS.join("\t"),
      ...completeRows.map((row) => COMPLETE_RESULTS_HEADERS.map((header) => escapeCell(row[header])).join("\t")),
    ];
    downloadBlob(new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/tab-separated-values;charset=utf-8" }), "qpcr-complete-calculation-results.tsv");
  }

  function exportVisualizationExcel() {
    const sheetRows = visualizationRows.map((row) => [
      row.category,
      row.value,
      row.sd ?? "",
      row.sem ?? "",
      row.group,
    ]);
    const worksheet = XLSX.utils.aoa_to_sheet([[...VISUALIZATION_BAR_HEADERS], ...sheetRows]);
    worksheet["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 }];
    worksheet["!autofilter"] = { ref: `A1:E${sheetRows.length + 1}` };
    for (const cell of ["A1", "B1", "C1", "D1", "E1"]) {
      if (!worksheet[cell]) continue;
      worksheet[cell].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "4F827C" } },
        alignment: { horizontal: "center" },
      };
    }
    for (let rowIndex = 2; rowIndex <= sheetRows.length + 1; rowIndex += 1) {
      for (const column of ["B", "C", "D"]) {
        const cell = worksheet[`${column}${rowIndex}`];
        if (cell) cell.z = "0.000000";
      }
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "bar");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
    downloadBlob(
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      "qpcr-visualization-bar.xlsx",
    );
  }

  function exportVisualizationTsv() {
    const escapeCell = (value: string | number | null) => String(value ?? "").replace(/[\t\r\n]+/g, " ");
    const lines = [
      VISUALIZATION_BAR_HEADERS.join("\t"),
      ...visualizationRows.map((row) => [row.category, row.value, row.sd, row.sem, row.group].map(escapeCell).join("\t")),
    ];
    downloadBlob(
      new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/tab-separated-values;charset=utf-8" }),
      "qpcr-visualization-bar.tsv",
    );
  }

  function sortBy(key: SortKey) {
    if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  const sortMark = (key: SortKey) => sortKey === key ? (sortDirection === "asc" ? " ↑" : " ↓") : "";

  if (!sampleOrder.length || !targetOrder.length) {
    return <div className="empty-table">{l("请在第 2 区点选需要展示的基因和样本；点选样本的编号就是图中从左到右的顺序。", "Select the targets and samples to display in section 2. Sample numbers define their left-to-right chart order.")}</div>;
  }

  return (
    <div className="result-explorer">
      <section className="result-commandbar" aria-label={l("结果显示与导出设置", "Result display and export settings")}>
        <div className="result-commandbar-summary">
          <div>
            <h3>{l("结果预览", "Result preview")}</h3>
            <p>{l(`已选择 ${sampleOrder.length} 个样本、${chartTargets.length} 个目标基因；图表和表格使用同一顺序。`, `${sampleOrder.length} sample(s) and ${chartTargets.length} target(s) selected; charts and table use the same order.`)}</p>
          </div>
          <div className="visible-count"><b>{filtered.length}</b><span>{l("条结果", "results")}</span></div>
        </div>

        <div className="result-commandbar-grid">
          <div className="result-command-group result-display-group">
            <span className="command-group-label">{l("显示", "Display")}</span>
            <div className="command-group-controls">
              <button type="button" aria-pressed={showTechnicalSd} className={showTechnicalSd ? "filter-chip sd-filter active" : "filter-chip sd-filter"} onClick={() => setShowTechnicalSd((current) => !current)}>{l("技术复孔传播 SD", "Propagated technical SD")}</button>
              <button type="button" aria-pressed={warningOnly} className={warningOnly ? "filter-chip warning-filter active" : "filter-chip warning-filter"} onClick={() => setWarningOnly((current) => !current)}>{l("仅看 QC 提示", "QC warnings only")}</button>
            </div>
          </div>

          <div className="result-command-group result-figure-controls">
            <span className="command-group-label">{l("图表", "Figure")}</span>
            <div className="figure-control-row">
              <div className="segmented-control" aria-label={l("图表主题", "Chart theme")}><button type="button" className={chartTheme === "paper" ? "active" : ""} onClick={() => setChartTheme("paper")}>{l("论文白底", "Paper")}</button><button type="button" className={chartTheme === "dark" ? "active" : ""} onClick={() => setChartTheme("dark")}>{l("深色预览", "Dark")}</button></div>
              <div className="segmented-control" aria-label={l("纵轴模式", "Y-axis mode")}><button type="button" className={axisMode === "log-ratio" ? "active" : ""} onClick={() => setAxisMode("log-ratio")}>{l("2 的幂次", "Power of 2")}</button><button type="button" className={axisMode === "linear" ? "active" : ""} onClick={() => setAxisMode("linear")}>{l("线性", "Linear")}</button></div>
            </div>
          </div>

          <div className="result-command-group result-export-group">
            <span className="command-group-label">{l("完整计算结果", "Complete results")}</span>
            <div className="visualization-export-actions">
              <button type="button" disabled={!completeRows.length} onClick={exportCompleteExcel}>{l("Excel（含字典）", "Excel + dictionary")}</button>
              <button type="button" disabled={!completeRows.length} onClick={exportCompleteTsv}>TSV</button>
            </div>
          </div>

          <div className="result-command-group result-export-group visualization-studio-export-group">
            <span className="command-group-label">Visualization Studio</span>
            <div className="visualization-export-actions">
              <button type="button" disabled={!visualizationRows.length} onClick={exportVisualizationExcel}>{l("导出 Excel", "Export Excel")}</button>
              <button type="button" disabled={!visualizationRows.length} onClick={exportVisualizationTsv}>{l("导出 TSV", "Export TSV")}</button>
            </div>
          </div>
        </div>

        <details className="result-method-details">
          <summary>{l("统计与导出说明", "Statistics and export notes")}</summary>
          <p>{l(
            "误差线默认关闭。启用后显示技术复孔传播 SD，仅描述技术重复性。完整结果导出包含目标与内参的 mean、样本 SD、SEM 及各级传播误差；Visualization Studio 仍严格使用 category、value、sd、sem、group 五列。",
            "Error bars are off by default. When enabled, propagated technical SD describes technical repeatability only. Complete-results exports include target/reference means, sample SD, SEM, and propagated uncertainty; Visualization Studio retains exactly category, value, sd, sem, and group.",
          )}</p>
        </details>
      </section>

      <div className="result-subsection-heading">
        <div><h3>{l("相对表达图", "Relative-expression figures")}</h3><p>{l("紧凑预览用于快速检查；SVG 与 PNG 4× 保留完整矢量元素和长样本名。", "Compact previews support review; SVG and PNG 4× retain complete figure elements and long sample names.")}</p></div>
        <span>{chartTargets.length} {l("张图", "figures")}</span>
      </div>

      <div className="result-chart-stack">
        {chartTargets.map((target) => <ExpressionChart key={target} rows={filtered} target={target} sampleOrder={sampleOrder} showTechnicalSd={showTechnicalSd} theme={chartTheme} axisMode={axisMode} />)}
        {chartTargets.length === 0 && <div className="empty-chart">{l("当前展示选择下没有可绘制的数据。", "No plottable data are available for the current display selection.")}</div>}
      </div>

      <div className="table-section-heading">
        <h3>{l("完整计算结果", "Complete calculation results")}</h3>
        <p>{l("默认遵循已选基因与样本顺序；点击列名可临时排序，横向滚动可查看全部计算字段。", "The default order follows the selected targets and samples. Select a column heading to sort; scroll horizontally to review all calculation fields.")}</p>
      </div>
      <div className="table-wrap result-table-wrap">
        <table>
          <thead><tr>
            <th><button type="button" onClick={() => sortBy("sampleName")}>{l("样本", "Sample")}{sortMark("sampleName")}</button></th>
            <th><button type="button" onClick={() => sortBy("targetName")}>{l("目标基因", "Target")}{sortMark("targetName")}</button></th>
            <th>{l("目标有效复孔 n", "Target valid n")}</th>
            <th><button type="button" onClick={() => sortBy("targetMeanCq")}>Target Mean Cq{sortMark("targetMeanCq")}</button></th>
            <th><button type="button" onClick={() => sortBy("targetSdCq")}>{l("目标技术 SD", "Target technical SD")}{sortMark("targetSdCq")}</button></th>
            <th>{l("目标技术 SEM", "Target technical SEM")}</th>
            <th>{l("内参有效复孔 n", "Reference valid n")}</th>
            <th>Reference Mean Cq</th>
            <th>{l("内参传播 SD", "Reference propagated SD")}</th>
            <th>{l("内参传播 SEM", "Reference propagated SEM")}</th>
            <th><button type="button" onClick={() => sortBy("deltaCq")}>ΔCq{sortMark("deltaCq")}</button></th>
            <th><button type="button" onClick={() => sortBy("normalizedQuantity")}>2^-ΔCq{sortMark("normalizedQuantity")}</button></th>
            <th>ΔΔCq</th>
            <th><button type="button" onClick={() => sortBy("relativeExpression")}>{l("相对表达量", "Relative expression")}{sortMark("relativeExpression")}</button></th>
            <th>{l("传播 SD", "Propagated SD")}</th>
            <th>{l("传播 SEM", "Propagated SEM")}</th>
            <th>{l("提示", "Warnings")}</th>
          </tr></thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={`${row.sampleName}-${row.targetName}`} className={row.warningCodes.length ? "flagged-row" : ""}>
                <td><b>{row.sampleName}</b></td><td>{row.targetName}</td><td>{row.targetValidReplicates}</td><td>{formatNumber(row.targetMeanCq)}</td><td>{formatNumber(row.targetSdCq)}</td><td>{formatNumber(row.targetSemCq)}</td><td>{Object.values(row.referenceValidReplicates).reduce((sum, count) => sum + count, 0)}</td><td>{formatNumber(row.referenceMeanCq)}</td><td>{formatNumber(row.referenceSdCq)}</td><td>{formatNumber(row.referenceSemCq)}</td><td>{formatNumber(row.deltaCq)}</td><td>{formatNumber(row.normalizedQuantity, 4)}</td><td>{formatNumber(row.deltaDeltaCq)}</td><td><strong className="expression-value">{formatNumber(row.relativeExpression, 4)}</strong></td><td>{formatNumber(row.relativeExpressionSd ?? row.normalizedQuantitySd, 4)}</td><td>{formatNumber(row.relativeExpressionSem ?? row.normalizedQuantitySem, 4)}</td><td>{row.warningCodes.map((code) => calculationWarningLabel(code, l)).join("; ") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty-table embedded">{l("当前筛选条件下没有结果。", "No results match the current selection.")}</div>}
      </div>
    </div>
  );
}
