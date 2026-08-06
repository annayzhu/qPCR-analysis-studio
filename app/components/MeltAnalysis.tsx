"use client";

import { useMemo, useState } from "react";
import type { WellRecord } from "@/packages/schemas/src";
import { summarizeMeltWells, type MeltWarningCode } from "@/packages/qpcr-core/src";
import { useLanguage } from "../i18n";

const ALL_TARGETS = "__all_targets__";

function formatNumber(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export default function MeltAnalysis({ wells }: { wells: WellRecord[] }) {
  const { l } = useLanguage();
  const [search, setSearch] = useState("");
  const [targetFilter, setTargetFilter] = useState(ALL_TARGETS);
  const [warningOnly, setWarningOnly] = useState(false);
  const summary = useMemo(() => summarizeMeltWells(wells), [wells]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return summary.wells.filter((row) =>
      (targetFilter === ALL_TARGETS || row.targetName === targetFilter)
      && (!warningOnly || row.warningCodes.length > 0)
      && (!query || `${row.well} ${row.sampleName} ${row.targetName} ${row.meltGroup}`.toLocaleLowerCase().includes(query)),
    );
  }, [search, summary.wells, targetFilter, warningOnly]);

  const plotTargets = summary.targets.filter((target) => targetFilter === ALL_TARGETS || target.targetName === targetFilter);
  const plotRows = summary.wells.filter((row) =>
    plotTargets.some((target) => target.targetName === row.targetName) && !row.warningCodes.includes("EXCLUDED"),
  );
  const tmValues = plotRows.flatMap((row) => [row.tm1, row.tm2]).filter((value): value is number => value !== null);
  const rawMin = tmValues.length ? Math.min(...tmValues) : 60;
  const rawMax = tmValues.length ? Math.max(...tmValues) : 95;
  const domainMin = Math.floor(rawMin - 1);
  const domainMax = Math.ceil(rawMax + 1);
  const plotWidth = 820;
  const labelWidth = 132;
  const rightPad = 28;
  const plotHeight = Math.max(150, 48 + plotTargets.length * 30);
  const x = (value: number) => labelWidth + ((value - domainMin) / Math.max(1, domainMax - domainMin)) * (plotWidth - labelWidth - rightPad);
  const ticks = Array.from({ length: 6 }, (_, index) => domainMin + ((domainMax - domainMin) * index) / 5);

  const groupCounts = visibleRows.reduce<Record<string, number>>((counts, row) => {
    const group = row.meltGroup || l("未提供分组", "Group not provided");
    counts[group] = (counts[group] ?? 0) + 1;
    return counts;
  }, {});

  const warningLabel = (code: MeltWarningCode) => ({
    SECONDARY_MELT_PEAK: l("第二峰", "Secondary peak"),
    UNKNOWN_MELT_GROUP: l("分组待复核", "Group requires review"),
    TM_SHIFT_FROM_TARGET_MEDIAN: l("Tm 偏移", "Tm shift"),
    EXCLUDED: l("已排除", "Excluded"),
  })[code];
  const targetLabel = (name: string) => name === "未命名靶标" ? l("未命名靶标", "Unnamed target") : name;
  const sampleLabel = (name: string) => name === "未命名样本" ? l("未命名样本", "Unnamed sample") : name;

  function exportCsv() {
    const headers = ["Well", "Sample", "Target", "Tm1", "Tm2", "Peak count", "Melt group", "Score", "Resolution", "Delta from target median", "QC flags"];
    const rows = visibleRows.map((row) => [
      row.well,
      row.sampleName,
      row.targetName,
      row.tm1,
      row.tm2,
      row.tm2 === null ? (row.tm1 === null ? 0 : 1) : 2,
      row.meltGroup,
      row.meltScore,
      row.meltResolution,
      row.deltaFromTargetMedian,
      row.warningCodes.map(warningLabel).join("; "),
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "qpcr_melt_summary.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!summary.wells.length) {
    return <div className="empty-table">{l("当前数据没有可识别的 Tm 或熔解分组字段。", "No recognizable Tm or melt-group fields are present in the current data.")}</div>;
  }

  return (
    <div className="melt-analysis">
      <div className="melt-method-note">
        <span aria-hidden="true">i</span>
        <p><b>{l("当前文件属于逐孔 Tm / 分组摘要。", "The current files contain well-level Tm/group summaries.")}</b> {l("可复核主峰、第二峰、靶标内 Tm 偏移和 Roche 分组；标准化熔解曲线与 -dF/dT 导数曲线需要另行导入“温度–荧光值”原始序列，本页不会用摘要值伪造曲线。", "Review primary peaks, secondary peaks, within-target Tm shifts, and Roche groups. Normalized melt curves and -dF/dT derivative curves require raw temperature-fluorescence series; this page does not fabricate curves from summaries.")}</p>
      </div>

      <div className="melt-filterbar">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={l("筛选孔位、样本、靶标或分组", "Filter well, sample, target, or group")} />
        <div className="filter-chips" aria-label={l("按靶标筛选", "Filter by target")}>
          {[ALL_TARGETS, ...summary.targets.map((target) => target.targetName)].map((target) => (
            <button key={target} type="button" className={targetFilter === target ? "filter-chip active" : "filter-chip"} onClick={() => setTargetFilter(target)}>{target === ALL_TARGETS ? l("全部", "All") : targetLabel(target)}</button>
          ))}
        </div>
        <button type="button" className={warningOnly ? "filter-chip warning-filter active" : "filter-chip"} onClick={() => setWarningOnly((current) => !current)}>{l("仅看需复核", "Review only")}</button>
        <button type="button" className="quiet-button bordered" onClick={exportCsv}>{l("导出当前表", "Export current table")}</button>
      </div>

      <div className="melt-visual-grid">
        <article className="melt-plot-card">
          <div className="card-heading">
            <div><p className="eyebrow">TM DISTRIBUTION</p><h3>{l("靶标内熔解温度分布", "Within-target melting-temperature distribution")}</h3></div>
            <div className="melt-legend"><span><i className="tm-primary-dot" />Tm1</span><span><i className="tm-secondary-dot" />Tm2</span><span><i className="tm-median-dot" />{l("中位数", "Median")}</span></div>
          </div>
          <div className="melt-plot-scroll">
            <svg className="melt-dotplot" viewBox={`0 0 ${plotWidth} ${plotHeight}`} role="img" aria-label={l("按靶标显示的 Tm1、Tm2 与中位数", "Tm1, Tm2, and median by target")}>
              {ticks.map((tick) => <g key={tick}><line x1={x(tick)} y1={24} x2={x(tick)} y2={plotHeight - 24} className="melt-gridline" /><text x={x(tick)} y={plotHeight - 7} textAnchor="middle" className="melt-axis-label">{tick.toFixed(1)} °C</text></g>)}
              {plotTargets.map((target, index) => {
                const y = 34 + index * 30;
                const rows = plotRows.filter((row) => row.targetName === target.targetName);
                return <g key={target.targetName}>
                  <text x={labelWidth - 12} y={y + 3} textAnchor="end" className="melt-target-label">{targetLabel(target.targetName)}</text>
                  {target.minTm1 !== null && target.maxTm1 !== null && <line x1={x(target.minTm1)} y1={y} x2={x(target.maxTm1)} y2={y} className="melt-range-line" />}
                  {rows.map((row) => <g key={row.wellId}>
                    {row.tm1 !== null && <circle cx={x(row.tm1)} cy={y} r="4.4" className={row.warningCodes.length ? "melt-primary-point warning" : "melt-primary-point"}><title>{row.well} · {sampleLabel(row.sampleName)} · Tm1 {row.tm1.toFixed(2)} °C</title></circle>}
                    {row.tm2 !== null && <path d={`M ${x(row.tm2)} ${y - 5} l 5 9 h -10 Z`} className="melt-secondary-point"><title>{row.well} · {sampleLabel(row.sampleName)} · Tm2 {row.tm2.toFixed(2)} °C</title></path>}
                  </g>)}
                  {target.medianTm1 !== null && <rect x={x(target.medianTm1) - 3.5} y={y - 3.5} width="7" height="7" transform={`rotate(45 ${x(target.medianTm1)} ${y})`} className="melt-median-point"><title>{l("靶标中位 Tm1", "Target median Tm1")} {target.medianTm1.toFixed(2)} °C</title></rect>}
                </g>;
              })}
            </svg>
          </div>
          <p className="plot-caption">{l("圆点为逐孔主峰，金色三角为第二峰；靶标中位数偏移 >0.5 °C 仅作复核提示，不自动排除。", "Circles show well-level primary peaks and gold triangles show secondary peaks. A >0.5 °C shift from the target median is a review warning only and does not automatically exclude a well.")}</p>
        </article>

        <aside className="melt-group-card">
          <div className="card-heading"><div><p className="eyebrow">MELT GROUPS</p><h3>{l("熔解分组摘要", "Melt-group summary")}</h3></div><span>{visibleRows.length} wells</span></div>
          <div className="melt-group-list">
            {Object.entries(groupCounts).sort((a, b) => b[1] - a[1]).map(([group, count]) => (
              <div key={group}><span><i className={/^unknown$/i.test(group) ? "unknown" : ""} />{group}</span><b>{count}</b></div>
            ))}
          </div>
          <div className="melt-review-summary">
            <p><b>{visibleRows.filter((row) => row.tm2 !== null).length}</b><span>{l("第二峰", "Second peaks")}</span></p>
            <p><b>{visibleRows.filter((row) => row.warningCodes.includes("TM_SHIFT_FROM_TARGET_MEDIAN")).length}</b><span>{l("Tm 偏移", "Tm shifts")}</span></p>
            <p><b>{visibleRows.filter((row) => row.warningCodes.includes("UNKNOWN_MELT_GROUP")).length}</b><span>{l("未知分组", "Unknown groups")}</span></p>
          </div>
        </aside>
      </div>

      <div className="table-section-heading"><div><p className="eyebrow">WELL TABLE</p><h3>{l("逐孔 Tm 与分组", "Well-level Tm & groups")}</h3></div><p>{visibleRows.length} / {summary.wells.length} {l("孔", "wells")}</p></div>
      <div className="table-wrap melt-table-wrap">
        <table>
          <thead><tr><th>{l("孔位", "Well")}</th><th>{l("样本", "Sample")}</th><th>{l("靶标", "Target")}</th><th>Tm1 °C</th><th>Tm2 °C</th><th>{l("峰数", "Peak count")}</th><th>{l("分组", "Group")}</th><th>Score</th><th>Resolution</th><th>{l("相对靶标中位数", "From target median")}</th><th>QC</th></tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row.wellId} className={row.warningCodes.length ? "flagged-row" : ""}>
            <td><b>{row.well}</b></td><td>{sampleLabel(row.sampleName)}</td><td>{targetLabel(row.targetName)}</td><td>{formatNumber(row.tm1)}</td><td>{formatNumber(row.tm2)}</td><td>{row.tm2 !== null ? 2 : row.tm1 !== null ? 1 : "—"}</td><td>{row.meltGroup || "—"}</td><td>{formatNumber(row.meltScore, 3)}</td><td>{formatNumber(row.meltResolution, 3)}</td><td>{row.deltaFromTargetMedian === null ? "—" : `${row.deltaFromTargetMedian > 0 ? "+" : ""}${row.deltaFromTargetMedian.toFixed(2)} °C`}</td><td>{row.warningCodes.length ? <span className="status warning-status">{row.warningCodes.map(warningLabel).join(" · ")}</span> : <span className="status pass-status">{l("无提示", "No warning")}</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
