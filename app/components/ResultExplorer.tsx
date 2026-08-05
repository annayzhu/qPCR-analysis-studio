"use client";

import { useMemo, useState } from "react";
import type { RelativeQuantificationResult } from "@/packages/schemas/src";

type SortKey = "sampleName" | "targetName" | "targetMeanCq" | "deltaCq" | "normalizedQuantity" | "relativeExpression";

function formatNumber(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function ExpressionChart({ rows, target }: { rows: RelativeQuantificationResult[]; target: string }) {
  const [logScale, setLogScale] = useState(false);
  const chartRows = rows
    .filter((row) => row.targetName === target)
    .map((row) => ({
      label: row.sampleName,
      rawValue: row.relativeExpression ?? row.normalizedQuantity,
      value: logScale ? Math.log2(Math.max(row.relativeExpression ?? row.normalizedQuantity, Number.EPSILON)) : row.relativeExpression ?? row.normalizedQuantity,
      warning: row.warningCodes.length > 0,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 30);

  if (!chartRows.length) return <div className="empty-chart">当前筛选下没有可绘制的数据。</div>;

  const width = 920;
  const labelWidth = 150;
  const rightPad = 58;
  const plotWidth = width - labelWidth - rightPad;
  const rowHeight = 34;
  const height = Math.max(240, chartRows.length * rowHeight + 62);
  const values = chartRows.map((row) => row.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const x = (value: number) => labelWidth + ((value - min) / range) * plotWidth;
  const zeroX = x(0);

  return (
    <div className="chart-card">
      <div className="chart-heading">
        <div><p className="eyebrow">EXPRESSION PROFILE</p><h3>{target || "目标基因"}</h3></div>
        <button type="button" className={logScale ? "scale-toggle active" : "scale-toggle"} onClick={() => setLogScale((current) => !current)}>
          {logScale ? "log₂ 显示" : "线性显示"}
        </button>
      </div>
      <div className="chart-scroll">
        <svg className="expression-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${target} 相对表达量图`}>
          <line x1={zeroX} x2={zeroX} y1={28} y2={height - 26} className="zero-line" />
          {chartRows.map((row, index) => {
            const y = 38 + index * rowHeight;
            const endX = x(row.value);
            const barX = Math.min(zeroX, endX);
            const barWidth = Math.max(2, Math.abs(endX - zeroX));
            return (
              <g key={`${row.label}-${index}`}>
                <text x={labelWidth - 12} y={y + 13} textAnchor="end" className="chart-label">{row.label}</text>
                <line x1={labelWidth} x2={width - rightPad} y1={y + 18} y2={y + 18} className="grid-line" />
                <rect x={barX} y={y} width={barWidth} height={22} rx={5} className={row.warning ? "bar warning" : "bar"} />
                <text x={row.value >= 0 ? endX + 8 : endX - 8} y={y + 15} textAnchor={row.value >= 0 ? "start" : "end"} className="chart-value">
                  {logScale ? row.value.toFixed(2) : row.rawValue.toFixed(3)}
                </text>
              </g>
            );
          })}
          <text x={labelWidth} y={height - 6} className="axis-title">{logScale ? "log₂(relative expression)" : "relative expression / normalized quantity"}</text>
        </svg>
      </div>
      <p className="chart-note">每条柱代表一个生物学样本；橙色表示该结果带有 QC 提示。当前最多显示 30 个样本。</p>
    </div>
  );
}

export default function ResultExplorer({ results }: { results: RelativeQuantificationResult[] }) {
  const [search, setSearch] = useState("");
  const [targetFilter, setTargetFilter] = useState("全部");
  const [warningOnly, setWarningOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("sampleName");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const targets = useMemo(() => [...new Set(results.map((row) => row.targetName))].sort(), [results]);
  const chartTarget = targetFilter === "全部" ? targets[0] ?? "" : targetFilter;

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return results
      .filter((row) => targetFilter === "全部" || row.targetName === targetFilter)
      .filter((row) => !warningOnly || row.warningCodes.length > 0)
      .filter((row) => !query || `${row.sampleName} ${row.targetName}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => {
        const av = a[sortKey] ?? Number.NEGATIVE_INFINITY;
        const bv = b[sortKey] ?? Number.NEGATIVE_INFINITY;
        const comparison = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "zh-CN") : Number(av) - Number(bv);
        return sortDirection === "asc" ? comparison : -comparison;
      });
  }, [results, search, sortDirection, sortKey, targetFilter, warningOnly]);

  function sortBy(key: SortKey) {
    if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  const sortMark = (key: SortKey) => sortKey === key ? (sortDirection === "asc" ? " ↑" : " ↓") : "";

  return (
    <div className="result-explorer">
      <div className="result-filterbar">
        <label className="search-field"><span>搜索结果</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="样本或基因名称" /></label>
        <div className="filter-group">
          <span>基因</span>
          <div className="filter-chips">
            {["全部", ...targets].map((target) => (
              <button type="button" key={target} onClick={() => setTargetFilter(target)} className={targetFilter === target ? "filter-chip active" : "filter-chip"}>{target}</button>
            ))}
          </div>
        </div>
        <button type="button" className={warningOnly ? "filter-chip warning-filter active" : "filter-chip warning-filter"} onClick={() => setWarningOnly((current) => !current)}>仅看 QC 提示</button>
        <div className="visible-count"><b>{filtered.length}</b><span>条结果</span></div>
      </div>

      <ExpressionChart rows={filtered} target={chartTarget} />

      <div className="table-section-heading">
        <div><p className="eyebrow">FILTERABLE TABLE</p><h3>完整计算结果</h3></div>
        <p>点击列名可排序；筛选同时作用于图表和表格。</p>
      </div>
      <div className="table-wrap result-table-wrap">
        <table>
          <thead><tr>
            <th><button type="button" onClick={() => sortBy("sampleName")}>样本{sortMark("sampleName")}</button></th>
            <th><button type="button" onClick={() => sortBy("targetName")}>目标基因{sortMark("targetName")}</button></th>
            <th><button type="button" onClick={() => sortBy("targetMeanCq")}>Target Mean Cq{sortMark("targetMeanCq")}</button></th>
            <th>Reference Mean Cq</th>
            <th><button type="button" onClick={() => sortBy("deltaCq")}>ΔCq{sortMark("deltaCq")}</button></th>
            <th><button type="button" onClick={() => sortBy("normalizedQuantity")}>2^-ΔCq{sortMark("normalizedQuantity")}</button></th>
            <th>ΔΔCq</th>
            <th><button type="button" onClick={() => sortBy("relativeExpression")}>相对表达量{sortMark("relativeExpression")}</button></th>
            <th>提示</th>
          </tr></thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={`${row.sampleName}-${row.targetName}`} className={row.warningCodes.length ? "flagged-row" : ""}>
                <td><b>{row.sampleName}</b></td><td>{row.targetName}</td><td>{formatNumber(row.targetMeanCq)}</td><td>{formatNumber(row.referenceMeanCq)}</td><td>{formatNumber(row.deltaCq)}</td><td>{formatNumber(row.normalizedQuantity, 4)}</td><td>{formatNumber(row.deltaDeltaCq)}</td><td><strong className="expression-value">{formatNumber(row.relativeExpression, 4)}</strong></td><td>{row.warningCodes.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty-table embedded">当前筛选条件下没有结果。</div>}
      </div>
    </div>
  );
}
