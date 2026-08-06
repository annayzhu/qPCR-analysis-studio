"use client";

import { useMemo, useRef, useState } from "react";
import type { RelativeQuantificationResult } from "@/packages/schemas/src";
import { buildLogRatioAxis, mapRatioToY } from "@/packages/qpcr-core/src";
import { useLanguage } from "../i18n";

type SortKey = "sampleName" | "targetName" | "targetMeanCq" | "targetSdCq" | "deltaCq" | "normalizedQuantity" | "relativeExpression";

function formatNumber(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
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

function ExpressionChart({
  rows,
  target,
  sampleOrder,
  showTechnicalSd,
}: {
  rows: RelativeQuantificationResult[];
  target: string;
  sampleOrder: string[];
  showTechnicalSd: boolean;
}) {
  const { l } = useLanguage();
  const svgRef = useRef<SVGSVGElement>(null);
  const [theme, setTheme] = useState<ChartTheme>("paper");
  const [axisMode, setAxisMode] = useState<AxisMode>("log-ratio");
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
  const left = 92;
  const right = 40;
  const top = 88;
  const bottom = 350;
  const height = 440;
  const width = Math.max(860, left + right + chartRows.length * 72);
  const plotWidth = width - left - right;
  const slotWidth = plotWidth / chartRows.length;
  const barWidth = Math.min(42, slotWidth * .56);
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
        <div><p className="eyebrow">PUBLICATION FIGURE</p><h3>{l("相对表达量", "Relative expression")}</h3><p>{l("论文白底 · 扁平配色 · 可编辑矢量导出", "Paper white · flat colors · editable vector export")}</p></div>
        <div className="chart-control-stack">
          <div className="segmented-control" aria-label={l("图表主题", "Chart theme")}>
            <button type="button" className={theme === "paper" ? "active" : ""} onClick={() => setTheme("paper")}>{l("论文白底", "Paper")}</button>
            <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>{l("屏幕深色", "Dark")}</button>
          </div>
          <div className="segmented-control" aria-label={l("纵轴模式", "Y-axis mode")}>
            <button type="button" className={axisMode === "log-ratio" ? "active" : ""} onClick={() => setAxisMode("log-ratio")}>{l("2 的幂次轴", "Power-of-2 axis")}</button>
            <button type="button" className={axisMode === "linear" ? "active" : ""} onClick={() => setAxisMode("linear")}>{l("线性轴", "Linear axis")}</button>
          </div>
          <div className="chart-export-actions">
            <button type="button" onClick={exportSvg}>{l("导出 SVG", "Export SVG")}</button>
            <button type="button" onClick={() => void exportPng()}>{l("导出 PNG 4×", "Export PNG 4×")}</button>
          </div>
        </div>
      </div>
      <div className="chart-scroll">
        <svg
          ref={svgRef}
          className="expression-chart publication-expression-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={l(`${target} 相对表达量图`, `${target} relative-expression chart`)}
          style={{ width: `${width}px`, minWidth: "100%", fontFamily: "Arial, Helvetica, 'PingFang SC', sans-serif", background: colors.background }}
        >
          <rect x="0" y="0" width={width} height={height} fill={colors.background} />
          {theme === "dark" && <rect x="1" y="1" width={width - 2} height={height - 2} fill="none" stroke={colors.border} strokeWidth="1" />}
          <text x={left} y="32" fill={colors.text} fontSize="17" fontWeight="400" fontStyle="italic">{target || "Target"}</text>
          <text x={left} y="50" fill={colors.muted} fontSize="9">{metricLabel}</text>
          <g transform={`translate(${Math.max(left + 180, width - (showTechnicalSd ? (usesCalibrator ? 540 : 455) : usesCalibrator ? 410 : 330))}, 29)`}>
            <rect x="0" y="-7" width="11" height="11" fill={colors.bar} stroke={colors.axis} strokeWidth=".6" />
            <text x="18" y="2" fill={colors.muted} fontSize="8.5">{l("生物学样本", "Biological sample")}</text>
            {usesCalibrator && <><rect x="121" y="-7" width="11" height="11" fill={colors.calibrator} stroke={colors.calibratorStroke} strokeWidth=".8" /><text x="139" y="2" fill={colors.muted} fontSize="8.5">{l("校准样本", "Calibrator")}</text></>}
            <line x1={usesCalibrator ? 210 : 132} x2={usesCalibrator ? 225 : 147} y1="-1" y2="-1" stroke={colors.reference} strokeDasharray="4 3" />
            <text x={usesCalibrator ? 232 : 154} y="2" fill={colors.muted} fontSize="8.5">Reference = 1</text>
            {showTechnicalSd && <>
              <line x1={usesCalibrator ? 330 : 250} x2={usesCalibrator ? 330 : 250} y1="-7" y2="5" stroke={colors.axis} strokeWidth="1" />
              <line x1={usesCalibrator ? 325 : 245} x2={usesCalibrator ? 335 : 255} y1="-7" y2="-7" stroke={colors.axis} strokeWidth="1" />
              <line x1={usesCalibrator ? 325 : 245} x2={usesCalibrator ? 335 : 255} y1="5" y2="5" stroke={colors.axis} strokeWidth="1" />
              <text x={usesCalibrator ? 342 : 262} y="2" fill={colors.muted} fontSize="8.5">{l("技术复孔传播 SD", "Propagated technical SD")}</text>
            </>}
          </g>

          {ticks.map((tick) => {
            const tickY = y(tick);
            return (
              <g key={tick}>
                <line x1={left} x2={width - right} y1={tickY} y2={tickY} stroke={colors.grid} strokeWidth=".8" />
                <line x1={left - 5} x2={left} y1={tickY} y2={tickY} stroke={colors.axis} strokeWidth="1" />
                <text x={left - 10} y={tickY + 3} textAnchor="end" fill={colors.muted} fontSize="9">{axisTickLabel(tick)}</text>
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
            const label = row.label.length > 13 ? `${row.label.slice(0, 12)}…` : row.label;
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
                  y={bottom + 20}
                  textAnchor={chartRows.length > 10 ? "end" : "middle"}
                  transform={chartRows.length > 10 ? `rotate(-35 ${centerX} ${bottom + 20})` : undefined}
                  fill={colors.muted}
                  fontSize="9"
                >{label}</text>
              </g>
            );
          })}
          <text x={(left + width - right) / 2} y={height - 20} textAnchor="middle" fill={colors.text} fontSize="10">{l("生物学样本", "Biological sample")}</text>
          <text x="24" y={(top + bottom) / 2} textAnchor="middle" transform={`rotate(-90 24 ${(top + bottom) / 2})`} fill={colors.text} fontSize="10">
            {axisMode === "log-ratio" ? "Relative expression (log₂ ratio axis)" : "Relative expression"}
          </text>
        </svg>
      </div>
      <div className="publication-note">
        <i>i</i>
        <p>
          <b>{showTechnicalSd ? l("误差线：技术复孔传播 SD。", "Error bars: propagated technical-replicate SD.") : l("误差线默认关闭。", "Error bars are off by default.")}</b>
          {showTechnicalSd
            ? l("使用 delta method 将 Cq 样本 SD 传播至 2⁻ΔCq 或 2⁻ΔΔCq；仅当目标和全部内参各有至少 2 个有效复孔时显示。校准样本作为 1 的锚点，不显示自身误差。该误差仅描述技术重复性，不代表生物学重复、SEM、95% CI 或统计显著性。", "The delta method propagates the sample SD of technical-replicate Cq values to 2⁻ΔCq or 2⁻ΔΔCq. Bars are shown only when the target and every reference have at least two valid replicates. The calibrator is anchored at 1 and has no self-error bar. This error describes technical repeatability only; it is not biological replication, SEM, a 95% CI, or statistical significance.")
            : l("可使用上方“技术复孔传播 SD”开关显示；这类误差仅描述技术重复性，不用于替代生物学重复。", "Use the “Propagated technical SD” control above to display them. This error describes technical repeatability and does not replace biological replication.")}
          <span className="replicate-caption"><b>{l("有效技术复孔 n：", "Valid technical-replicate n: ")}</b>{replicateSummary}</span>
        </p>
      </div>
    </div>
  );
}

interface ResultExplorerProps {
  results: RelativeQuantificationResult[];
  sampleOrder: string[];
  targetOrder: string[];
}

export default function ResultExplorer({ results, sampleOrder, targetOrder }: ResultExplorerProps) {
  const { language, l } = useLanguage();
  const [warningOnly, setWarningOnly] = useState(false);
  const [showTechnicalSd, setShowTechnicalSd] = useState(false);
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
      <div className="result-filterbar compact-result-filterbar">
        <p>{l(`当前展示 ${sampleOrder.length} 个样本、${chartTargets.length} 个目标基因；图表和表格使用同一选择。`, `Displaying ${sampleOrder.length} sample(s) and ${chartTargets.length} target(s); charts and the table share the same selection.`)}</p>
        <button type="button" aria-pressed={showTechnicalSd} className={showTechnicalSd ? "filter-chip sd-filter active" : "filter-chip sd-filter"} onClick={() => setShowTechnicalSd((current) => !current)}>{l("技术复孔传播 SD", "Propagated technical SD")}</button>
        <button type="button" className={warningOnly ? "filter-chip warning-filter active" : "filter-chip warning-filter"} onClick={() => setWarningOnly((current) => !current)}>{l("仅看 QC 提示", "QC warnings only")}</button>
        <div className="visible-count"><b>{filtered.length}</b><span>{l("条结果", "results")}</span></div>
      </div>

      <div className="result-chart-stack">
        {chartTargets.map((target) => <ExpressionChart key={target} rows={filtered} target={target} sampleOrder={sampleOrder} showTechnicalSd={showTechnicalSd} />)}
        {chartTargets.length === 0 && <div className="empty-chart">{l("当前展示选择下没有可绘制的数据。", "No plottable data are available for the current display selection.")}</div>}
      </div>

      <div className="table-section-heading">
        <div><p className="eyebrow">FILTERABLE TABLE</p><h3>{l("完整计算结果", "Complete calculation results")}</h3></div>
        <p>{l("默认遵循上方基因与样本的点选顺序；点击列名可临时排序。", "The default order follows the target and sample selection above. Select a column heading to sort temporarily.")}</p>
      </div>
      <div className="table-wrap result-table-wrap">
        <table>
          <thead><tr>
            <th><button type="button" onClick={() => sortBy("sampleName")}>{l("样本", "Sample")}{sortMark("sampleName")}</button></th>
            <th><button type="button" onClick={() => sortBy("targetName")}>{l("目标基因", "Target")}{sortMark("targetName")}</button></th>
            <th><button type="button" onClick={() => sortBy("targetMeanCq")}>Target Mean Cq{sortMark("targetMeanCq")}</button></th>
            <th><button type="button" onClick={() => sortBy("targetSdCq")}>Cq SD{sortMark("targetSdCq")}</button></th>
            <th>Reference Mean Cq</th>
            <th><button type="button" onClick={() => sortBy("deltaCq")}>ΔCq{sortMark("deltaCq")}</button></th>
            <th><button type="button" onClick={() => sortBy("normalizedQuantity")}>2^-ΔCq{sortMark("normalizedQuantity")}</button></th>
            <th>ΔΔCq</th>
            <th><button type="button" onClick={() => sortBy("relativeExpression")}>{l("相对表达量", "Relative expression")}{sortMark("relativeExpression")}</button></th>
            <th>{l("传播 SD", "Propagated SD")}</th>
            <th>{l("提示", "Warnings")}</th>
          </tr></thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={`${row.sampleName}-${row.targetName}`} className={row.warningCodes.length ? "flagged-row" : ""}>
                <td><b>{row.sampleName}</b></td><td>{row.targetName}</td><td>{formatNumber(row.targetMeanCq)}</td><td>{formatNumber(row.targetSdCq)}</td><td>{formatNumber(row.referenceMeanCq)}</td><td>{formatNumber(row.deltaCq)}</td><td>{formatNumber(row.normalizedQuantity, 4)}</td><td>{formatNumber(row.deltaDeltaCq)}</td><td><strong className="expression-value">{formatNumber(row.relativeExpression, 4)}</strong></td><td>{formatNumber(row.relativeExpressionSd ?? row.normalizedQuantitySd, 4)}</td><td>{row.warningCodes.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty-table embedded">{l("当前筛选条件下没有结果。", "No results match the current selection.")}</div>}
      </div>
    </div>
  );
}
