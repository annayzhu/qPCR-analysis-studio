"use client";

import { useMemo, useRef, useState } from "react";
import type {
  AnalysisSettings,
  CanonicalDataset,
  CanonicalField,
  EditLog,
  ExclusionLog,
  ImportedSource,
  WellRecord,
} from "@/packages/schemas/src";
import { normalizeWell } from "@/packages/schemas/src";
import {
  assessImportReadiness,
  buildCanonicalDataset,
  parseBrowserFile,
} from "@/packages/importers/src";
import {
  calculateRelativeQuantification,
  calculateReplicateQc,
  setWellExclusion,
  updateWellFields,
} from "@/packages/qpcr-core/src";
import ImportManager from "./components/ImportManager";
import MeltAnalysis from "./components/MeltAnalysis";
import ResultExplorer from "./components/ResultExplorer";

type WorkspaceView = "overview" | "plate" | "results";
type ResultSection = "quantification" | "melt";

const VIEW_ITEMS: [WorkspaceView, string, string][] = [
  ["overview", "概览与 QC", "Overview + QC"],
  ["plate", "板工作区", "Plate"],
  ["results", "结果与图表", "Results"],
];

function formatNumber(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function targetColor(target: string): string {
  const palette = ["#198a80", "#b97235", "#516ca8", "#8b659d", "#b55566", "#397d9a", "#6b8751"];
  let hash = 0;
  for (const char of target) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return target ? palette[Math.abs(hash) % palette.length] : "#cbd1ce";
}

function commonValue(wells: WellRecord[], field: "sampleName" | "targetName" | "taskType"): string {
  const values = [...new Set(wells.map((well) => well[field]).filter(Boolean))];
  if (values.length === 1) return values[0];
  if (values.length > 1) return "多个不同值（留空则保留）";
  return "未设置";
}

export default function QpcrAnalysisStudio() {
  const resultInput = useRef<HTMLInputElement>(null);
  const layoutInput = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<ImportedSource[]>([]);
  const [dataset, setDataset] = useState<CanonicalDataset | null>(null);
  const [draftWells, setDraftWells] = useState<WellRecord[]>([]);
  const [appliedWells, setAppliedWells] = useState<WellRecord[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<WorkspaceView>("overview");
  const [resultSection, setResultSection] = useState<ResultSection>("quantification");
  const [dataManagerOpen, setDataManagerOpen] = useState(true);
  const [needsRebuild, setNeedsRebuild] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingEditLogs, setPendingEditLogs] = useState<EditLog[]>([]);
  const [pendingExclusionLogs, setPendingExclusionLogs] = useState<ExclusionLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<(EditLog | ExclusionLog)[]>([]);
  const [batchSample, setBatchSample] = useState("");
  const [batchTarget, setBatchTarget] = useState("");
  const [batchTask, setBatchTask] = useState("");
  const [pasteBlock, setPasteBlock] = useState("");
  const [exclusionReason, setExclusionReason] = useState("技术复孔异常（人工判定）");
  const [referenceTargets, setReferenceTargets] = useState<string[]>([]);
  const [calibrator, setCalibrator] = useState("");
  const [qcSearch, setQcSearch] = useState("");
  const [qcIssueOnly, setQcIssueOnly] = useState(false);

  const readiness = useMemo(() => assessImportReadiness(sources), [sources]);
  const pendingCount = pendingEditLogs.length + pendingExclusionLogs.length;
  const selectedWells = useMemo(() => draftWells.filter((well) => selected.includes(well.id)), [draftWells, selected]);
  const qc = useMemo(() => calculateReplicateQc(appliedWells), [appliedWells]);
  const targets = useMemo(
    () => [...new Set(appliedWells.map((well) => well.targetName).filter(Boolean))].sort(),
    [appliedWells],
  );
  const samples = useMemo(
    () => [...new Set(appliedWells.map((well) => well.sampleName).filter(Boolean))].sort(),
    [appliedWells],
  );
  const relativeResults = useMemo(() => {
    if (!referenceTargets.length) return [];
    const settings: AnalysisSettings = {
      referenceTargets,
      calibratorType: "sample",
      calibratorValue: calibrator,
      replicateWarningThreshold: 0.5,
      tmWarningThreshold: 0.5,
      efficiencyByTarget: {},
      calculationMode: calibrator ? "delta-delta-cq" : "delta-cq",
    };
    return calculateRelativeQuantification(appliedWells, settings);
  }, [appliedWells, calibrator, referenceTargets]);
  const filteredQc = useMemo(() => {
    const query = qcSearch.trim().toLocaleLowerCase();
    return qc.filter((row) => (!qcIssueOnly || row.warningCodes.length > 0)
      && (!query || `${row.sampleName} ${row.targetName} ${row.wells.join(" ")}`.toLocaleLowerCase().includes(query)));
  }, [qc, qcIssueOnly, qcSearch]);

  const pastePreview = useMemo(() => {
    const rawRows = pasteBlock.trim() ? pasteBlock.trim().split(/\r?\n/).map((line) => line.split("\t").map((cell) => cell.trim())) : [];
    const first = rawRows[0]?.[0]?.toLocaleLowerCase() ?? "";
    const hasHeader = /^(?:well|孔位|sample|sample name|样本|样本名称)$/.test(first);
    const rows = hasHeader ? rawRows.slice(1) : rawRows;
    const hasWellColumn = Boolean(rows[0] && normalizeWell(rows[0][0]));
    return { rows, hasWellColumn };
  }, [pasteBlock]);

  function buildAndApply(sourceList: ImportedSource[]) {
    const built = buildCanonicalDataset(sourceList);
    setDataset(built);
    setDraftWells(built.wells);
    setAppliedWells(built.wells);
    const firstDefined = built.wells.find((well) => well.sampleName || well.targetName);
    setSelected(firstDefined ? [firstDefined.id] : []);
    setSelectionAnchor(firstDefined?.id ?? null);
    setPendingEditLogs([]);
    setPendingExclusionLogs([]);
    setAuditLogs([]);
    setNeedsRebuild(false);
    setView("overview");
    const hasCq = built.wells.some((well) => well.cq !== null);
    const hasMelt = built.wells.some((well) => well.tm1 !== null || well.tm2 !== null || Boolean(well.meltGroup));
    setResultSection(hasCq || !hasMelt ? "quantification" : "melt");
    const builtTargets = [...new Set(built.wells.map((well) => well.targetName).filter(Boolean))];
    const probableReference = builtTargets.find((target) => /^(?:gapdh|actb|18s|rplp0|b2m|hprt1)$/i.test(target))
      ?? builtTargets.find((target) => /gapdh|actb|18s|rplp0|b2m|hprt/i.test(target));
    setReferenceTargets(probableReference ? [probableReference] : []);
    setCalibrator("");
  }

  async function importFiles(files: FileList | File[]) {
    if (!files.length) return;
    setLoading(true);
    setError("");
    try {
      const parsed = await Promise.all([...files].map(parseBrowserFile));
      const nextSources = [...sources, ...parsed];
      setSources(nextSources);
      const nextReadiness = assessImportReadiness(nextSources);
      if (nextReadiness.canAnalyze) buildAndApply(nextSources);
      else {
        setDataset(null);
        setDraftWells([]);
        setAppliedWells([]);
        setNeedsRebuild(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件解析失败");
    } finally {
      setLoading(false);
      if (resultInput.current) resultInput.current.value = "";
      if (layoutInput.current) layoutInput.current.value = "";
    }
  }

  function updateSelectedTable(sourceId: string, tableId: string) {
    setSources((current) => current.map((source) => source.id === sourceId ? { ...source, selectedTableId: tableId } : source));
    setNeedsRebuild(true);
  }

  function updateMapping(sourceId: string, sourceColumn: string, canonicalField: CanonicalField | null) {
    setSources((current) => current.map((source) => {
      if (source.id !== sourceId) return source;
      return {
        ...source,
        tables: source.tables.map((table) => table.id !== source.selectedTableId ? table : {
          ...table,
          suggestedMappings: table.suggestedMappings.map((mapping) => mapping.sourceColumn !== sourceColumn ? mapping : {
            ...mapping,
            canonicalField,
            confidence: canonicalField ? 1 : 0,
            matchMethod: canonicalField ? "manual" : "unmapped",
            conflict: false,
            userConfirmed: true,
            evidence: canonicalField ? ["用户手动确认"] : ["用户设为不导入"],
          }),
        }),
      };
    }));
    setNeedsRebuild(true);
  }

  function removeSource(sourceId: string) {
    const nextSources = sources.filter((source) => source.id !== sourceId);
    setSources(nextSources);
    const nextReadiness = assessImportReadiness(nextSources);
    if (nextReadiness.canAnalyze) buildAndApply(nextSources);
    else {
      setDataset(null);
      setDraftWells([]);
      setAppliedWells([]);
      setNeedsRebuild(false);
    }
  }

  function rebuildCurrentSources() {
    const currentReadiness = assessImportReadiness(sources);
    if (currentReadiness.canAnalyze) buildAndApply(sources);
  }

  function clearProject() {
    setSources([]);
    setDataset(null);
    setDraftWells([]);
    setAppliedWells([]);
    setSelected([]);
    setSelectionAnchor(null);
    setAuditLogs([]);
    setPendingEditLogs([]);
    setPendingExclusionLogs([]);
    setReferenceTargets([]);
    setCalibrator("");
    setView("overview");
    setDataManagerOpen(true);
    setNeedsRebuild(false);
    setError("");
  }

  function rectangleSelection(anchorId: string, currentId: string): string[] {
    const anchor = draftWells.find((well) => well.id === anchorId);
    const current = draftWells.find((well) => well.id === currentId);
    if (!anchor || !current) return [currentId];
    const minRow = Math.min(anchor.row.charCodeAt(0), current.row.charCodeAt(0));
    const maxRow = Math.max(anchor.row.charCodeAt(0), current.row.charCodeAt(0));
    const minColumn = Math.min(anchor.column, current.column);
    const maxColumn = Math.max(anchor.column, current.column);
    return draftWells
      .filter((well) => well.row.charCodeAt(0) >= minRow && well.row.charCodeAt(0) <= maxRow && well.column >= minColumn && well.column <= maxColumn)
      .map((well) => well.id);
  }

  function startWellSelection(well: WellRecord, event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (event.shiftKey && selectionAnchor) {
      setSelected(rectangleSelection(selectionAnchor, well.id));
      setDragging(false);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      setSelected((current) => current.includes(well.id) ? current.filter((id) => id !== well.id) : [...current, well.id]);
      setSelectionAnchor(well.id);
      setDragging(false);
      return;
    }
    setSelected([well.id]);
    setSelectionAnchor(well.id);
    setDragging(true);
  }

  function extendWellSelection(well: WellRecord, event: React.MouseEvent<HTMLButtonElement>) {
    if (!dragging || event.buttons !== 1 || !selectionAnchor) return;
    setSelected(rectangleSelection(selectionAnchor, well.id));
  }

  function selectByField(field: "sampleName" | "targetName") {
    const values = new Set(selectedWells.map((well) => well[field]).filter(Boolean));
    if (!values.size) return;
    setSelected(draftWells.filter((well) => values.has(well[field])).map((well) => well.id));
  }

  function applyBatchEdit() {
    if (!selected.length) return;
    const changes: Partial<Pick<WellRecord, "sampleName" | "targetName" | "taskType">> = {};
    if (batchSample.trim()) changes.sampleName = batchSample.trim();
    if (batchTarget.trim()) changes.targetName = batchTarget.trim();
    if (batchTask.trim()) changes.taskType = batchTask.trim();
    if (!Object.keys(changes).length) return;
    const updated = updateWellFields(draftWells, selected, changes);
    setDraftWells(updated.wells);
    setPendingEditLogs((current) => [...current, ...updated.logs]);
    setBatchSample("");
    setBatchTarget("");
    setBatchTask("");
  }

  function applyPastedBlock() {
    if (!pastePreview.rows.length) return;
    const orderedSelected = draftWells
      .filter((well) => selected.includes(well.id))
      .sort((a, b) => a.row.localeCompare(b.row) || a.column - b.column);
    let nextWells = draftWells;
    const logs: EditLog[] = [];
    pastePreview.rows.forEach((cells, index) => {
      const wellName = pastePreview.hasWellColumn ? normalizeWell(cells[0]) : orderedSelected[index]?.well;
      if (!wellName) return;
      const destination = nextWells.find((well) => well.well === wellName);
      if (!destination) return;
      const offset = pastePreview.hasWellColumn ? 1 : 0;
      const [sampleName, targetName, taskType] = cells.slice(offset);
      if (sampleName === undefined) return;
      const updated = updateWellFields(nextWells, [destination.id], {
        sampleName,
        ...(targetName !== undefined ? { targetName } : {}),
        ...(taskType !== undefined ? { taskType } : {}),
      });
      nextWells = updated.wells;
      logs.push(...updated.logs);
    });
    setDraftWells(nextWells);
    setPendingEditLogs((current) => [...current, ...logs]);
    setPasteBlock("");
  }

  function setExclusion(excluded: boolean, ids = selected) {
    if (!ids.length) return;
    const updated = setWellExclusion(draftWells, ids, excluded, exclusionReason);
    setDraftWells(updated.wells);
    setPendingExclusionLogs((current) => [...current, ...updated.logs]);
  }

  function recalculate() {
    setAppliedWells(draftWells);
    setAuditLogs((current) => [...current, ...pendingEditLogs, ...pendingExclusionLogs]);
    setPendingEditLogs([]);
    setPendingExclusionLogs([]);
  }

  const detectedCount = appliedWells.filter((well) => well.cqStatus === "detected" && !well.userExcluded).length;
  const meltWellCount = appliedWells.filter((well) => well.tm1 !== null || well.tm2 !== null || Boolean(well.meltGroup) || well.meltScore !== null || well.meltResolution !== null).length;
  const secondaryPeakCount = appliedWells.filter((well) => well.tm2 !== null && !well.userExcluded).length;
  const hasQuantification = appliedWells.some((well) => well.cq !== null || well.cqStatus === "not-detected");
  const hasMeltAnalysis = meltWellCount > 0;
  const namedReactionCount = draftWells.filter((well) => well.sampleName || well.targetName).length;
  const qcIssueCount = qc.filter((row) => row.warningCodes.length).length;

  return (
    <main className="app-shell">
      <input ref={resultInput} hidden type="file" multiple accept=".xlsx,.csv,.txt,.tsv" onChange={(event) => event.target.files && importFiles(event.target.files)} />
      <input ref={layoutInput} hidden type="file" multiple accept=".xlsx,.csv,.txt,.tsv" onChange={(event) => event.target.files && importFiles(event.target.files)} />

      <header className="topbar">
        <button className="brand-lockup" type="button" onClick={() => dataset ? setView("overview") : setDataManagerOpen(true)}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span><strong>qPCR Analysis Studio</strong><small>Relative quantification workspace</small></span>
        </button>
        <div className="topbar-actions">
          <span className="privacy-pill"><i />Local processing</span>
          {dataset && <button className="quiet-button topbar-button" type="button" onClick={() => setDataManagerOpen(true)}>数据文件 <span className="file-count">{sources.length}</span></button>}
          {sources.length > 0 && <button className="quiet-button topbar-button" type="button" onClick={clearProject}>新建分析</button>}
        </div>
      </header>

      {dataManagerOpen || !dataset ? (
        <div className="data-manager-page">
          <section className="intake-hero">
            <div>
              <p className="eyebrow">qPCR · RELATIVE QUANTIFICATION & MELT REVIEW</p>
              <div className="hero-title-row"><h1>qPCR 分析工具</h1><span>RUO</span></div>
              <p>孔级 Cq 相对定量、复孔质控、Tm 与熔解分组复核；结果文件和修正板布局分类型导入。</p>
            </div>
          </section>
          <ImportManager
            sources={sources}
            readiness={readiness}
            loading={loading}
            error={error}
            hasDataset={Boolean(dataset && !needsRebuild)}
            onPickResults={() => resultInput.current?.click()}
            onPickLayout={() => layoutInput.current?.click()}
            onRemoveSource={removeSource}
            onUpdateSelectedTable={updateSelectedTable}
            onUpdateMapping={updateMapping}
            onRebuild={rebuildCurrentSources}
            onContinue={() => { setDataManagerOpen(false); setView("overview"); }}
          />
        </div>
      ) : (
        <div className="analysis-page">
          <section className="workspace-masthead">
            <div>
              <p className="eyebrow">ACTIVE ANALYSIS</p>
              <h1>{dataset.plate.plateFormat} 孔 qPCR 分析</h1>
              <p>{sources.length} 个来源文件 · {samples.length} 个样本 · {targets.length} 个靶标{hasQuantification ? ` · ${detectedCount} 个有效 Cq` : ""}{hasMeltAnalysis ? ` · ${meltWellCount} 个熔解记录` : ""}</p>
            </div>
            <div className="analysis-state"><span />已自动计算</div>
          </section>

          <nav className="workspace-tabs" aria-label="分析工作区">
            {VIEW_ITEMS.map(([value, label, english]) => (
              <button key={value} type="button" className={view === value ? "active" : ""} onClick={() => setView(value)}>
                <span>{label}</span><small>{english}</small>
              </button>
            ))}
          </nav>

          <section className="workspace-content">
            {view === "overview" && (
              <div className="overview-layout">
                <div className="section-heading overview-heading">
                  <div><p className="eyebrow">OVERVIEW + QUALITY CONTROL</p><h2>概览与复孔质控</h2><p className="section-summary">{dataset.plate.plateFormat} 孔板中定义 {namedReactionCount} 个反应；当前 {qcIssueCount} 个复孔组需要复核{secondaryPeakCount ? `，${secondaryPeakCount} 个孔检测到第二熔解峰` : ""}。</p></div>
                  <button className="quiet-button bordered" type="button" onClick={() => setDataManagerOpen(true)}>管理导入文件</button>
                </div>
                <div className="overview-qc-grid">
                  <article className="qc-workbench">
                    <div className="card-heading compact-card-heading">
                      <div><p className="eyebrow">REPLICATE QC</p><h3>技术复孔</h3></div>
                      <details className="inline-rules"><summary>规则：Cq/Tm 极差 &gt; 0.5</summary><p>仅提示，不自动排除；单孔不计算 SD/CV；Tm 偏移需结合曲线和实验设计人工判断。</p></details>
                    </div>
                    <div className="table-filterbar compact-filterbar">
                      <input value={qcSearch} onChange={(event) => setQcSearch(event.target.value)} placeholder="筛选样本、靶标或孔位" />
                      <button type="button" className={qcIssueOnly ? "filter-chip active" : "filter-chip"} onClick={() => setQcIssueOnly((current) => !current)}>仅看需复核</button>
                      <span>{filteredQc.length} / {qc.length} 组</span>
                    </div>
                    <div className="table-wrap compact-qc-table">
                      <table>
                        <thead><tr><th>样本</th><th>靶标</th><th>孔位</th>{hasQuantification && <><th>有效 Cq/总数</th><th>Mean Cq</th><th>SD</th><th>Cq range</th><th>线性量 CV%</th></>}{hasMeltAnalysis && <><th>Mean Tm1</th><th>Tm1 range</th><th>第二峰</th><th>熔解分组</th></>}<th>判定</th></tr></thead>
                        <tbody>{filteredQc.map((row) => <tr key={row.id} className={row.warningCodes.length ? "flagged-row" : ""}>
                          <td><b>{row.sampleName}</b></td><td>{row.targetName}</td><td>{row.wells.join(", ")}</td>{hasQuantification && <><td>{row.validReplicates}/{row.totalReplicates}</td><td>{formatNumber(row.meanCq, 3)}</td><td>{formatNumber(row.sdCq, 3)}</td><td>{formatNumber(row.cqRange, 3)}</td><td>{formatNumber(row.linearQuantityCvPercent, 1)}</td></>}{hasMeltAnalysis && <><td>{formatNumber(row.meanTm1, 2)}</td><td>{formatNumber(row.tm1Range, 2)}</td><td>{row.secondaryPeakCount || "—"}</td><td>{row.meltGroups.join(", ") || "—"}</td></>}<td>{row.warningCodes.length ? <span className="status warning-status">复核 {row.suspectWell ? `· ${row.suspectWell}` : ""}</span> : <span className="status pass-status">通过</span>}</td>
                        </tr>)}</tbody>
                      </table>
                    </div>
                  </article>

                  <aside className="overview-side-stack">
                    <article className="provenance-card">
                      <div className="card-heading"><div><p className="eyebrow">DATA SOURCES</p><h3>数据与假设</h3></div><button type="button" onClick={() => setDataManagerOpen(true)}>编辑</button></div>
                      <div className="source-summary-list">
                        {sources.map((source) => <div key={source.id}><span>{source.fileName}</span><small>{source.tables.find((table) => table.id === source.selectedTableId)?.sourceSheet ?? "—"}</small></div>)}
                      </div>
                      {(dataset.warnings.length > 0 || dataset.assumptions.length > 0) && <details className="assumption-details"><summary>{dataset.warnings.length + dataset.assumptions.length} 条数据说明</summary>{[...dataset.warnings, ...dataset.assumptions].map((item) => <p key={item}>{item}</p>)}</details>}
                    </article>
                    <article className="audit-card">
                      <div className="card-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h3>审计记录</h3></div><span>{auditLogs.length} 已应用 · {pendingCount} 待应用</span></div>
                      <div className="timeline compact-timeline">
                        {auditLogs.length === 0 && <div className="empty-table embedded">尚无已应用的人工改动。</div>}
                        {[...auditLogs].reverse().slice(0, 8).map((log) => (
                          <article key={log.id}><span className="timeline-dot" /><div><b>{"field" in log ? `编辑 ${log.field}` : log.action === "exclude" ? "排除反应孔" : "恢复反应孔"}</b><p>{"field" in log ? `${log.previousValue || "(空)"} → ${log.newValue || "(空)"}` : log.reason}</p><small>{log.wellRecordId} · {new Date(log.timestamp).toLocaleString("zh-CN")}</small></div></article>
                        ))}
                      </div>
                    </article>
                  </aside>
                </div>
              </div>
            )}

            {view === "plate" && (
              <div className="plate-workspace">
                <div className="section-heading plate-heading">
                  <div><p className="eyebrow">PLATE WORKSPACE</p><h2>{dataset.plate.plateFormat} 孔板 · {namedReactionCount} 个已定义反应</h2></div>
                  <div className="legend"><span><i className="dot selected-dot" />已选</span><span><i className="dot warning-dot" />QC 提示</span><span><i className="dot excluded-dot" />已排除</span></div>
                </div>
                {dataset.warnings.map((warning) => <div className="notice" key={warning}>{warning}</div>)}
                <div className="selection-guide">
                  <span>批量选择：</span>鼠标拖动框选 · Shift 选择矩形范围 · ⌘/Ctrl 追加或取消 · 点击行列标可整行/整列选择
                </div>
                <div className="plate-and-editor">
                  <div className="plate-scroll" onMouseUp={() => setDragging(false)} onMouseLeave={() => setDragging(false)}>
                    <div className={`plate-grid plate-${dataset.plate.plateFormat}`} style={{ gridTemplateColumns: `36px repeat(${dataset.plate.columns.length}, minmax(${dataset.plate.plateFormat === 384 ? 44 : 68}px, 1fr))` }}>
                      <div />
                      {dataset.plate.columns.map((column) => (
                        <button type="button" className="axis-label column-axis" key={column} onClick={() => setSelected(draftWells.filter((well) => well.column === column).map((well) => well.id))}>{column}</button>
                      ))}
                      {dataset.plate.rows.flatMap((row) => [
                        <button type="button" className="axis-label row-axis" key={`axis-${row}`} onClick={() => setSelected(draftWells.filter((well) => well.row === row).map((well) => well.id))}>{row}</button>,
                        ...dataset.plate.columns.map((column) => {
                          const wellName = `${row}${column}`;
                          const well = draftWells.find((item) => item.well === wellName);
                          const isSelected = Boolean(well && selected.includes(well.id));
                          const hasWarning = Boolean(well && (well.qcFlags.length || well.tm2 !== null));
                          return (
                            <button
                              type="button"
                              key={wellName}
                              className={`well-cell ${isSelected ? "selected" : ""} ${hasWarning ? "warning" : ""} ${well?.userExcluded ? "excluded" : ""}`}
                              style={{ "--well-color": targetColor(well?.targetName ?? "") } as React.CSSProperties}
                              title={well ? `${well.well} | ${well.sampleName || "未命名"} | ${well.targetName || "未命名"} | Cq ${formatNumber(well.cq)}` : wellName}
                              onMouseDown={(event) => well && startWellSelection(well, event)}
                              onMouseEnter={(event) => well && extendWellSelection(well, event)}
                              onContextMenu={(event) => { event.preventDefault(); if (well) { setSelected([well.id]); setExclusion(true, [well.id]); } }}
                            >
                              <span className="well-name">{wellName}</span>
                              {well && <><b>{well.sampleName || "—"}</b><small>{well.targetName || "空孔"}</small></>}
                            </button>
                          );
                        }),
                      ])}
                    </div>
                  </div>

                  <aside className="editor-panel">
                    <div className="editor-header"><p className="eyebrow">BATCH SELECTION</p><h3>{selectedWells.length ? `${selectedWells.length} 个孔已选` : "请选择孔位"}</h3><p>{selectedWells.length ? selectedWells.slice(0, 8).map((well) => well.well).join(", ") + (selectedWells.length > 8 ? "…" : "") : "可在板上拖动框选多个孔"}</p></div>
                    <div className="selection-actions">
                      <button type="button" onClick={() => selectByField("sampleName")} disabled={!selectedWells.some((well) => well.sampleName)}>选中同一样本</button>
                      <button type="button" onClick={() => selectByField("targetName")} disabled={!selectedWells.some((well) => well.targetName)}>选中同一基因</button>
                      <button type="button" onClick={() => setSelected([])} disabled={!selected.length}>清空</button>
                    </div>
                    <div className="selection-summary">
                      <div><span>Sample</span><b>{commonValue(selectedWells, "sampleName")}</b></div>
                      <div><span>Target</span><b>{commonValue(selectedWells, "targetName")}</b></div>
                      <div><span>Detected Cq</span><b>{selectedWells.filter((well) => well.cqStatus === "detected").length} / {selectedWells.length}</b></div>
                    </div>
                    <div className="form-stack batch-form">
                      <label>统一修改 Sample Name<input value={batchSample} placeholder={commonValue(selectedWells, "sampleName")} onChange={(event) => setBatchSample(event.target.value)} /></label>
                      <label>统一修改 Target Name<input value={batchTarget} placeholder={commonValue(selectedWells, "targetName")} onChange={(event) => setBatchTarget(event.target.value)} /></label>
                      <label>统一修改反应角色<input value={batchTask} placeholder={commonValue(selectedWells, "taskType")} onChange={(event) => setBatchTask(event.target.value)} /></label>
                      <button className="secondary-button" type="button" onClick={applyBatchEdit} disabled={!selected.length || ![batchSample, batchTarget, batchTask].some((value) => value.trim())}>应用到 {selected.length || 0} 个已选孔</button>
                    </div>

                    <details className="paste-details">
                      <summary>批量贴入不同孔信息 <span>Excel 专用</span></summary>
                      <p>仅当 Excel 每一行对应不同孔时使用。统一修改多个孔，请用上面的批量修改。</p>
                      <div className="paste-format"><b>支持两种格式</b><code>Well · Sample · Target · Role</code><code>Sample · Target · Role（按已选孔顺序）</code></div>
                      <textarea value={pasteBlock} placeholder={"A1\tS01\tGAPDH\tUnknown\nA2\tS01\tGENE1\tUnknown"} onChange={(event) => setPasteBlock(event.target.value)} />
                      {pastePreview.rows.length > 0 && <p className="paste-preview">已识别 {pastePreview.rows.length} 行 · {pastePreview.hasWellColumn ? "按 Well 精确匹配" : `按 ${selected.length} 个已选孔顺序匹配`}</p>}
                      <button className="quiet-button bordered full-width" type="button" onClick={applyPastedBlock} disabled={!pastePreview.rows.length || (!pastePreview.hasWellColumn && !selected.length)}>应用粘贴内容</button>
                    </details>

                    <div className="divider" />
                    <label className="form-label">排除原因<textarea value={exclusionReason} onChange={(event) => setExclusionReason(event.target.value)} /></label>
                    <div className="split-actions">
                      <button className="danger-button" type="button" onClick={() => setExclusion(true)} disabled={!selected.length}>排除已选孔</button>
                      <button className="quiet-button bordered" type="button" onClick={() => setExclusion(false)} disabled={!selected.length}>恢复</button>
                    </div>
                    <p className="microcopy">所有修改先保留为草稿；点击右下角“应用修改并重算”后才进入结果和审计记录。</p>
                  </aside>
                </div>
              </div>
            )}

            {view === "results" && (
              <div className="panel-stack results-panel">
                <div className="section-heading results-heading">
                  <div><p className="eyebrow">RESULTS & FIGURES</p><h2>{resultSection === "quantification" ? "相对定量结果" : "Tm 与熔解分析"}</h2></div>
                  <div className="result-mode-tabs" aria-label="结果类型">
                    <button type="button" disabled={!hasQuantification} className={resultSection === "quantification" ? "active" : ""} onClick={() => setResultSection("quantification")}>相对定量</button>
                    <button type="button" disabled={!hasMeltAnalysis} className={resultSection === "melt" ? "active" : ""} onClick={() => setResultSection("melt")}>Tm 与熔解</button>
                  </div>
                </div>
                {resultSection === "quantification" && hasQuantification && <>
                  <div className="settings-card compact-settings-card">
                    <div><p className="field-title">内参基因（可多选）</p><div className="choice-row">{targets.map((target) => <label className={referenceTargets.includes(target) ? "choice active" : "choice"} key={target}><input type="checkbox" checked={referenceTargets.includes(target)} onChange={() => setReferenceTargets((current) => current.includes(target) ? current.filter((item) => item !== target) : [...current, target])} />{target}</label>)}</div></div>
                    <label className="compact-field">校准样本<select value={calibrator} onChange={(event) => setCalibrator(event.target.value)}><option value="">仅计算 ΔCq</option>{samples.map((sample) => <option key={sample} value={sample}>{sample}</option>)}</select></label>
                    <p className="microcopy">多内参按相对量几何均值归一化；未提供扩增效率时暂按 100% 计算并保留假设。</p>
                  </div>
                  {!referenceTargets.length ? <div className="empty-table">请选择至少一个内参基因，系统随后生成可筛选结果表和发表级表达图。</div> : <ResultExplorer results={relativeResults} />}
                </>}
                {resultSection === "quantification" && !hasQuantification && <div className="empty-table">当前仅导入了 Tm/熔解结果；添加单孔 Cq/Ct/Cp 后可进行相对定量。</div>}
                {resultSection === "melt" && hasMeltAnalysis && <MeltAnalysis wells={appliedWells} />}
                {resultSection === "melt" && !hasMeltAnalysis && <div className="empty-table">当前没有 Tm 或熔解分组数据；可返回数据文件追加对应结果。</div>}
              </div>
            )}
          </section>
        </div>
      )}

      {dataset && !dataManagerOpen && pendingCount > 0 && (
        <button className="recalculate-button" type="button" onClick={recalculate}>
          <span className="recalc-count">{pendingCount}</span>
          <span><b>应用修改并重算</b><small>更新 QC、结果与审计记录</small></span>
          <span className="recalc-arrow">→</span>
        </button>
      )}
      <footer><span>qPCR Analysis Studio · Research use only</span><span>原始数据仅在当前浏览器中处理</span></footer>
    </main>
  );
}
