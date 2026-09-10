"use client";

import { useRef, useState } from "react";
import { buildLogRatioAxis, mapRatioToY, chartLabelVisualUnits, wrapChartLabel } from "@/packages/qpcr-core/src";
import { useLanguage } from "../i18n";
import { downloadBlob } from "../download";
export type ChartTheme = "dark" | "paper";
export type AxisMode = "log-ratio" | "linear";

/** Presentation data only. Upstream Cq and supplied delta values keep separate calculators. */
export interface ExpressionChartRow {
  label: string;
  rawValue: number | null;
  propagatedSd: number | null;
  targetValidReplicates: number;
  referenceValidReplicates: Record<string, number>;
  warning: boolean;
  calibrator: boolean;
}

function axisTickLabel(value: number): string {
  if (value >= 1) return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return value >= 0.1 ? value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : value.toPrecision(2);
}

function safeFileName(value: string): string {
  return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-") || "qpcr-expression";
}

export default function ExpressionChart({
  rows,
  metricLabel,
  target,
  sampleOrder,
  showTechnicalSd,
  theme,
  axisMode,
  exportFileStem,
}: {
  rows: ExpressionChartRow[];
  metricLabel: string;
  target: string;
  sampleOrder: string[];
  showTechnicalSd: boolean;
  theme: ChartTheme;
  axisMode: AxisMode;
  exportFileStem: string;
}) {
  const { l } = useLanguage();
  const svgRef = useRef<SVGSVGElement>(null);
  const [exportError, setExportError] = useState("");
  const chartRows = rows
    .filter((row): row is ExpressionChartRow & { rawValue: number } => row.rawValue !== null && Number.isFinite(row.rawValue) && row.rawValue > 0)
    .sort((a, b) => sampleOrder.indexOf(a.label) - sampleOrder.indexOf(b.label));

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
  const labelLineHeight = 11.5;
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
    downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), `${exportFileStem}-${safeFileName(target)}-relative-expression.svg`);
  }

  async function exportPng() {
    const markup = serializedSvg();
    if (!markup) return;
    const sourceUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    setExportError("");
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(l("图表渲染失败", "Chart rendering failed")));
        image.src = sourceUrl;
      });
      const scale = 4;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(l("浏览器无法创建图像画布", "The browser could not create an image canvas"));
      context.scale(scale, scale);
      context.fillStyle = colors.background;
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
      if (!blob) throw new Error(l("浏览器无法导出 PNG，请使用 SVG", "PNG export failed; please use SVG"));
      downloadBlob(blob, `${exportFileStem}-${safeFileName(target)}-relative-expression-4x.png`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
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
      {exportError && <p role="alert">{exportError}</p>}
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
            <text x="22" y="2" fill={colors.muted} fontSize="10">Reference = 1</text>
            {usesCalibrator && <g transform="translate(122, 0)"><rect x="0" y="-7" width="10" height="10" fill={colors.calibrator} stroke={colors.calibratorStroke} strokeWidth=".8" /><text x="15" y="2" fill={colors.muted} fontSize="10">{l("校准样本", "Calibrator")}</text></g>}
            {showTechnicalSd && <g transform={`translate(${usesCalibrator ? 218 : 112}, 0)`}>
              <line x1="5" x2="5" y1="-7" y2="5" stroke={colors.axis} strokeWidth="1" />
              <line x1="1" x2="9" y1="-7" y2="-7" stroke={colors.axis} strokeWidth="1" />
              <line x1="1" x2="9" y1="5" y2="5" stroke={colors.axis} strokeWidth="1" />
              <text x="15" y="2" fill={colors.muted} fontSize="10">{l("技术 SD", "Technical SD")}</text>
            </g>}
          </g>

          {ticks.map((tick) => {
            const tickY = y(tick);
            return (
              <g key={tick}>
                <line x1={left} x2={width - right} y1={tickY} y2={tickY} stroke={colors.grid} strokeWidth=".8" />
                <line x1={left - 5} x2={left} y1={tickY} y2={tickY} stroke={colors.axis} strokeWidth="1" />
                <text x={left - 10} y={tickY + 3.5} textAnchor="end" fill={colors.muted} fontSize="11">{axisTickLabel(tick)}</text>
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
                  fontSize="11"
                  aria-label={row.label}
                >{labelLines.map((line, lineIndex) => <tspan key={`${line}-${lineIndex}`} x={centerX} dy={lineIndex === 0 ? 0 : labelLineHeight}>{line}</tspan>)}</text>
              </g>
            );
          })}
          <text x={(left + width - right) / 2} y={axisTitleY} textAnchor="middle" fill={colors.text} fontSize="12">{l("样本", "Sample")}</text>
          <text x="20" y={(top + bottom) / 2} textAnchor="middle" transform={`rotate(-90 20 ${(top + bottom) / 2})`} fill={colors.text} fontSize="12">
            {axisMode === "log-ratio" ? "Relative expression (log₂ ratio axis)" : "Relative expression"}
          </text>
        </svg>
      </div>
      <details className="chart-replicate-details"><summary>{l("有效技术复孔 n", "Valid technical-replicate n")}</summary><p>{replicateSummary}</p></details>
    </div>
  );
}
