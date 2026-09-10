"use client";

import { useMemo, useState } from "react";
import XLSX from "xlsx-js-style";
import type { AnalysisSettings, ImportDecision, RelativeQuantificationResult, WellRecord } from "@/packages/schemas/src";
import {
  buildCalculationExportBundle,
  buildCalculationWorkbookBytes,
  buildImportDecisionRows,
  buildVisualizationBarRows,
  COMPLETE_RESULTS_HEADERS,
  IMPORT_DECISION_EXPORT_DICTIONARY,
  IMPORT_DECISION_HEADERS,
  PLATE_SUMMARY_HEADERS,
  VISUALIZATION_BAR_HEADERS,
  WELL_CALCULATION_HEADERS,
} from "@/packages/qpcr-core/src";
import { useLanguage } from "../i18n";
import VisualizationStudioLink from "./VisualizationStudioLink";
import ExpressionChart, { type ChartTheme, type AxisMode } from "./ExpressionChart";
import { downloadBlob } from "../download";

type SortKey = "sampleName" | "targetName" | "targetMeanCq" | "targetSdCq" | "deltaCq" | "normalizedQuantity" | "relativeExpression";

function formatNumber(value: number | null, digits = 3): string {
  return value === null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
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

interface ResultExplorerProps {
  results: RelativeQuantificationResult[];
  wells: WellRecord[];
  sampleOrder: string[];
  targetOrder: string[];
  settings: AnalysisSettings;
  provenanceWarnings?: string[];
  importDecisions?: ImportDecision[];
  exportFileStem: string;
}

export default function ResultExplorer({ results, wells, sampleOrder, targetOrder, settings, provenanceWarnings = [], importDecisions = [], exportFileStem }: ResultExplorerProps) {
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
  // Per-well traceability is an export workload, not a prerequisite for displaying charts.
  const hasExportRows = results.some(row => sampleOrder.includes(row.sampleName) && targetOrder.includes(row.targetName));
  function calculationExport() {
    return buildCalculationExportBundle(wells, results, sampleOrder, targetOrder, settings, provenanceWarnings);
  }
  function exportCompleteExcel() {
    const bytes = buildCalculationWorkbookBytes({ ...calculationExport(), importDecisions });
    downloadBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${exportFileStem}-complete-calculation.xlsx`);
  }

  function exportCompleteTsv() {
    const bundle = calculationExport();
    const importDecisionRows = buildImportDecisionRows(importDecisions);
    const escapeCell = (value: string | number | null) => String(value ?? "").replace(/[\t\r\n]+/g, " ");
    const downloadRows = (headers: readonly string[], rows: Array<Record<string, string | number | null>>, fileName: string) => {
      const lines = [headers.join("\t"), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join("\t"))];
      downloadBlob(new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/tab-separated-values;charset=utf-8" }), fileName);
    };
    downloadRows(COMPLETE_RESULTS_HEADERS, bundle.completeRows, `${exportFileStem}-complete-results.tsv`);
    downloadRows(WELL_CALCULATION_HEADERS, bundle.wellRows, `${exportFileStem}-well-calculations.tsv`);
    downloadRows(PLATE_SUMMARY_HEADERS, bundle.plateRows, `${exportFileStem}-plate-summaries.tsv`);
    if (importDecisionRows.length) downloadRows(IMPORT_DECISION_HEADERS, importDecisionRows, `${exportFileStem}-import-decisions.tsv`);
    const dictionaryLines = [
      "sheet\tfield\tlevel_zh\tdefinition_zh\tdefinition_en\tformula_or_source\tunit\tcaution_zh\tcaution_en",
      ...bundle.dictionary.map((item) => [item.sheet, item.field, item.levelZh, item.definitionZh, item.definitionEn, item.formula, item.unit, item.cautionZh, item.cautionEn]
        .map((value) => value.replace(/[\t\r\n]+/g, " ")).join("\t")),
      ...IMPORT_DECISION_EXPORT_DICTIONARY.map((item) => [item.sheet, item.field, "导入审计", item.definitionZh, item.definitionEn, "User import-review decision", "", "原始上传文件与原始行保持不变。", "The uploaded file and source row remain unchanged."]
        .map((value) => value.replace(/[\t\r\n]+/g, " ")).join("\t")),
    ];
    downloadBlob(new Blob(["\uFEFF", dictionaryLines.join("\r\n")], { type: "text/tab-separated-values;charset=utf-8" }), `${exportFileStem}-data-dictionary.tsv`);
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
      `${exportFileStem}-visualization-bar.xlsx`,
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
      `${exportFileStem}-visualization-bar.tsv`,
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
              <button type="button" disabled={!hasExportRows} onClick={exportCompleteExcel}>{l("Excel（5张表）", "Excel · 5 sheets")}</button>
              <button type="button" disabled={!hasExportRows} onClick={exportCompleteTsv}>{l("TSV（4个文件）", "TSV · 4 files")}</button>
            </div>
          </div>

          <div className="result-command-group result-export-group visualization-studio-export-group">
            <div className="command-group-label-row"><span className="command-group-label">Visualization Studio · {l("柱状图格式", "Bar-chart format")}</span><VisualizationStudioLink /></div>
            <div className="visualization-export-actions">
              <button type="button" disabled={!visualizationRows.length} onClick={exportVisualizationExcel}>{l("柱状图 Excel", "Bar Excel")}</button>
              <button type="button" disabled={!visualizationRows.length} onClick={exportVisualizationTsv}>{l("柱状图 TSV", "Bar TSV")}</button>
            </div>
            <small className="export-format-hint">category · value · sd · sem · group</small>
          </div>
        </div>

        <details className="result-method-details">
          <summary>{l("每个参数是什么意思？", "What does each parameter mean?")}</summary>
          <div className="calculation-explanation-grid">
            <p><b>Mean Cq</b>{l("：同板、同一样本、同一基因的有效技术复孔算术均值。", ": arithmetic mean of valid technical replicates within the same plate, sample, and assay.")}</p>
            <p><b>SD</b>{l("：技术复孔 Cq 的样本标准差，分母 n−1，描述孔间离散。n<2 时为空。", ": sample standard deviation of technical-replicate Cq values (n−1), describing well-to-well spread; blank when n<2.")}</p>
            <p><b>SEM</b>{l("：SD/√n，描述技术复孔 mean Cq 的精度；不是生物学重复误差或置信区间。", ": SD/√n, describing precision of the technical-replicate mean Cq; not biological variation or a confidence interval.")}</p>
            <p><b>{l("传播 SD", "Propagated SD")}</b>{l("：做减法时把上游技术 SD 按 √(SD₁²+SD₂²) 合并；指数变换后用 ln(base)×结果×SD。", ": combines upstream technical SD values by √(SD₁²+SD₂²) for subtraction, then uses ln(base)×result×SD after exponentiation.")}</p>
            <p><b>{l("传播 SEM", "Propagated SEM")}</b>{l("：使用同一传播公式，但起点是各步骤的 SEM（每个 SEM=SD/√n）。它不是 P 值，也不包含生物学重复。", ": uses the same propagation rules but starts from each step's SEM (SEM=SD/√n). It is not a P value and does not include biological replication.")}</p>
            <p><b>ΔCq / ΔΔCq</b>{l("：ΔCq=目标 mean Cq−内参中心；ΔΔCq=样本 ΔCq−校准样本 ΔCq。校准样本中心虽为 1，其技术误差仍可非零。", ": ΔCq=target mean Cq−reference center; ΔΔCq=sample ΔCq−calibrator ΔCq. Although the calibrator center is 1, its technical uncertainty may be nonzero.")}</p>
          </div>
          <p>{l(
            "完整 Excel 含 5 张表：最终结果、逐孔计算、板内汇总、计算步骤和数据字典。逐孔表也计算内参孔自身的 Cq−内参 mean，便于独立复核或用 ΔCq/ΔΔCq 自行绘图。Visualization Studio 柱状图文件固定为 category、value、sd、sem、group 五列。",
            "The complete Excel contains five sheets: final results, per-well calculations, plate summaries, calculation guide, and data dictionary. The well sheet also calculates reference wells against their own reference mean for independent checking or custom ΔCq/ΔΔCq plotting. Visualization Studio bar files retain exactly category, value, sd, sem, and group.",
          )}</p>
        </details>
      </section>

      <div className="result-subsection-heading">
        <div><h3>{l("相对表达图", "Relative-expression figures")}</h3><p>{l("紧凑预览用于快速检查；SVG 与 PNG 4× 保留完整矢量元素和长样本名。", "Compact previews support review; SVG and PNG 4× retain complete figure elements and long sample names.")}</p></div>
        <span>{chartTargets.length} {l("张图", "figures")}</span>
      </div>

      <div className="result-chart-stack">
        {chartTargets.map((target) => <ExpressionChart key={target} rows={filtered.filter(row => row.targetName === target).map(row => ({
          label: row.sampleName,
          rawValue: row.relativeExpression ?? row.normalizedQuantity,
          propagatedSd: row.relativeExpression !== null ? row.relativeExpressionSd : row.normalizedQuantitySd,
          targetValidReplicates: row.targetValidReplicates,
          referenceValidReplicates: row.referenceValidReplicates,
          warning: row.warningCodes.length > 0,
          calibrator: Boolean(row.calibratorValue && row.sampleName === row.calibratorValue),
        }))} metricLabel={filtered.some(row => row.targetName === target && row.relativeExpression !== null) ? "Relative expression · 2⁻ΔΔCq" : "Normalized quantity · 2⁻ΔCq"} target={target} sampleOrder={sampleOrder} showTechnicalSd={showTechnicalSd} theme={chartTheme} axisMode={axisMode} exportFileStem={exportFileStem} />)}
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
