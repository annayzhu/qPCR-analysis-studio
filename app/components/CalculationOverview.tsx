"use client";

import { useMemo } from "react";
import type { AnalysisStart, ImportedSource } from "@/packages/schemas/src";
import {
  buildSuppliedCalculationOverview,
  type SuppliedCalculationResult,
} from "@/packages/qpcr-core/src";
import { useLanguage } from "../i18n";

function formatNumber(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? "NA" : value.toFixed(digits);
}

export default function CalculationOverview({
  results,
  analysisStart,
  sampleOrder,
  targetOrder,
  calibrator,
  sources,
  dataNotes,
  auditCount,
  onOpenResults,
}: {
  results: SuppliedCalculationResult[];
  analysisStart: Exclude<AnalysisStart, "cq">;
  sampleOrder: string[];
  targetOrder: string[];
  calibrator: string;
  sources: ImportedSource[];
  dataNotes: string[];
  auditCount: number;
  onOpenResults: () => void;
}) {
  const { l } = useLanguage();
  const overview = useMemo(
    () => buildSuppliedCalculationOverview(results, analysisStart, sampleOrder, targetOrder),
    [analysisStart, results, sampleOrder, targetOrder],
  );
  const resultByGroup = useMemo(
    () => new Map(results.map((row) => [`${row.sampleName}\u241f${row.targetName}`, row])),
    [results],
  );
  const valueLabel = analysisStart === "delta-cq" ? "ΔCq" : "ΔΔCq";
  const distributionText = overview.replicateCountDistribution.length
    ? overview.replicateCountDistribution.map((bucket) => `n=${bucket.replicateCount}: ${bucket.groupCount} ${l("组", "groups")}`).join(" · ")
    : l("没有有效复孔组", "No valid replicate groups");
  const readyForRelativeExpression = analysisStart === "delta-delta-cq" || Boolean(calibrator);

  return <div className="calculation-overview">
    <section className="calculation-summary-strip" aria-label={l("数据摘要", "Data summary")}>
      <div><span>{l("有效计算值", "Valid values")}</span><b>{overview.validValueCount}</b><small>{l("导入的复孔级数值", "imported replicate-level values")}</small></div>
      <div><span>{l("数据覆盖", "Data coverage")}</span><b>{overview.observedGroupCount} / {overview.possibleGroupCount}</b><small>{l("已观察 / 全部样本-靶标组合", "observed / all sample-target pairs")}</small></div>
      <div className={overview.singletonGroupCount ? "needs-attention" : ""}><span>{l("单值组合", "Singleton groups")}</span><b>{overview.singletonGroupCount}</b><small>{l("无法计算技术 SD 或 SEM", "technical SD or SEM unavailable")}</small></div>
      <div className={overview.unevenReplicateGroupCount ? "needs-attention" : ""}><span>{l("复孔数不一致", "Uneven replicate count")}</span><b>{overview.unevenReplicateGroupCount}</b><small>{l(`多数分组为 n=${overview.modalReplicateCount ?? "NA"}`, `most groups use n=${overview.modalReplicateCount ?? "NA"}`)}</small></div>
    </section>

    <div className="calculation-overview-grid">
      <article className="calculation-coverage-panel">
        <div className="calculation-panel-heading">
          <div><p className="eyebrow">DATA COVERAGE</p><h3>{l("样本与靶标覆盖", "Sample and target coverage")}</h3><p>{l("单元格显示可用于计算的复孔数；空白表示该组合未出现在导入数据中。", "Cells show valid replicate counts. A blank cell means the combination was not present in the imported data.")}</p></div>
          <div className="coverage-legend"><span><i className="coverage-complete" />{l("多数复孔数", "Modal n")}</span><span><i className="coverage-irregular" />{l("复孔数不同", "Different n")}</span><span><i className="coverage-missing" />{l("未覆盖", "Not covered")}</span></div>
        </div>
        <div className="coverage-matrix-wrap">
          <table className="coverage-matrix">
            <thead><tr><th>{l("样本", "Sample")}</th>{overview.targetOrder.map((target) => <th key={target} title={target}>{target}</th>)}</tr></thead>
            <tbody>{overview.sampleOrder.map((sample) => <tr key={sample}>
              <th title={sample}>{sample}</th>
              {overview.targetOrder.map((target) => {
                const row = resultByGroup.get(`${sample}\u241f${target}`);
                const count = row?.validReplicates ?? 0;
                const state = count === 0
                  ? "missing"
                  : count === overview.modalReplicateCount
                    ? "complete"
                    : "irregular";
                return <td key={target}><span className={`coverage-cell ${state}`} title={count
                  ? l(`${sample} / ${target}: ${count} 个有效复孔`, `${sample} / ${target}: ${count} valid replicate(s)`)
                  : l(`${sample} / ${target}: 未覆盖`, `${sample} / ${target}: not covered`)}>{count || ""}</span></td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <div className="replicate-profile"><span>{l("复孔分布", "Replicate profile")}</span><b>{distributionText}</b><small>{l(`${overview.missingGroupCount} 个样本-靶标组合未覆盖；未覆盖不自动判定为实验错误。`, `${overview.missingGroupCount} sample-target pair(s) are not covered; absence is not automatically classified as an experimental error.`)}</small></div>
      </article>

      <aside className="calculation-readiness-panel">
        <div><p className="eyebrow">ANALYSIS STATE</p><h3>{l("当前可分析到哪一步", "Current analysis readiness")}</h3></div>
        <div className="analysis-start-marker"><span>{l("计算起点", "Analysis start")}</span><b>{valueLabel}</b><small>{l("用户提供，系统不反推上游 Cq", "User supplied; upstream Cq is not reconstructed")}</small></div>
        <dl className="readiness-list">
          <div><dt>{l("物理孔板", "Physical plate")}</dt><dd>{l("不需要", "Not required")}</dd></div>
          <div><dt>{l("复孔统计", "Replicate statistics")}</dt><dd>{l("均值、SD、SEM", "Mean, SD, SEM")}</dd></div>
          <div><dt>{l("当前输出", "Current output")}</dt><dd>{analysisStart === "delta-cq" ? l("ΔCq 与 2^-ΔCq", "ΔCq and 2^-ΔCq") : l("ΔΔCq 与相对表达量", "ΔΔCq and relative expression")}</dd></div>
          {analysisStart === "delta-cq" && <div><dt>{l("校准样本", "Calibrator")}</dt><dd>{calibrator || l("尚未选择", "Not selected")}</dd></div>}
        </dl>
        <div className={readyForRelativeExpression ? "readiness-callout ready" : "readiness-callout"}>
          <b>{readyForRelativeExpression ? l("可以查看相对表达量", "Relative expression is available") : l("下一步：选择校准样本", "Next: select a calibrator")}</b>
          <p>{readyForRelativeExpression
            ? l("结果页已具备绘图和完整结果导出条件。", "The Results page is ready for plotting and complete-results export.")
            : l("在结果页选择校准样本后，系统将继续计算 ΔΔCq 与 2^-ΔΔCq。", "Select a calibrator on the Results page to continue to ΔΔCq and 2^-ΔΔCq.")}</p>
        </div>
        <button type="button" className="primary-button calculation-results-button" onClick={onOpenResults}>{l("进入结果与图表", "Open results and charts")}</button>
      </aside>
    </div>

    <section className="calculation-variability-panel">
      <div className="calculation-panel-heading">
        <div><p className="eyebrow">REPLICATE VARIABILITY</p><h3>{l("复孔离散度", "Replicate variability")}</h3><p>{l(`按用户提供的 ${valueLabel} 技术 SD 从高到低排列。用于优先复核，不自动排除任何数据。`, `Ranked by technical SD of the user-supplied ${valueLabel}. This prioritizes review and does not exclude data automatically.`)}</p></div>
        <span>{l(`显示前 ${Math.min(8, overview.variabilityGroups.length)} 组`, `Showing top ${Math.min(8, overview.variabilityGroups.length)} groups`)}</span>
      </div>
      {overview.variabilityGroups.length ? <div className="variability-table-wrap"><table className="variability-table">
        <thead><tr><th>{l("样本", "Sample")}</th><th>{l("靶标", "Target")}</th><th>n</th><th>{l(`Mean ${valueLabel}`, `Mean ${valueLabel}`)}</th><th>{l("技术 SD", "Technical SD")}</th><th>{l("技术 SEM", "Technical SEM")}</th></tr></thead>
        <tbody>{overview.variabilityGroups.slice(0, 8).map((row) => <tr key={`${row.sampleName}\u241f${row.targetName}`}><td>{row.sampleName}</td><td>{row.targetName}</td><td>{row.validReplicates}</td><td>{formatNumber(row.mean)}</td><td><b>{formatNumber(row.sd)}</b></td><td>{formatNumber(row.sem)}</td></tr>)}</tbody>
      </table></div> : <p className="calculation-empty-note">{l("当前没有至少两个有效复孔的组合，因此无法计算 SD 与 SEM。", "No group currently has at least two valid replicates, so SD and SEM cannot be calculated.")}</p>}
    </section>

    <section className="calculation-provenance-bar">
      <div><p className="eyebrow">PROVENANCE</p><h3>{l("来源与计算边界", "Sources and calculation boundary")}</h3></div>
      <div className="provenance-facts">
        <span><b>{sources.length}</b>{l("个来源文件", "source file(s)")}</span>
        <span><b>{dataNotes.length}</b>{l("条数据说明", "data note(s)")}</span>
        <span><b>{auditCount}</b>{l("项人工修改", "manual change(s)")}</span>
      </div>
      <details><summary>{l("查看文件与说明", "View files and notes")}</summary><div className="calculation-source-details">
        {sources.map((source) => <p key={source.id}><b>{source.fileName}</b><span>{source.tables.find((table) => table.id === source.selectedTableId)?.sourceSheet || l("数据工作表", "Data sheet")}</span></p>)}
        {dataNotes.map((note, index) => <p key={`${index}:${note}`}><span>{note}</span></p>)}
        {!auditCount && <p><span>{l("本次分析尚未记录人工修改。", "No manual changes have been recorded for this analysis.")}</span></p>}
      </div></details>
    </section>
  </div>;
}
