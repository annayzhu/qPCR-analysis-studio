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
import { buildCanonicalDataset, CANONICAL_FIELD_LABELS, parseBrowserFile } from "@/packages/importers/src";
import {
  calculateRelativeQuantification,
  calculateReplicateQc,
  setWellExclusion,
  updateWellFields,
} from "@/packages/qpcr-core/src";

type WorkspaceTab = "import" | "plate" | "qc" | "results" | "audit";
const FIELD_OPTIONS = Object.entries(CANONICAL_FIELD_LABELS) as [CanonicalField, string][];

const INSTRUMENT_LABELS: Record<string, string> = {
  generic: "通用表格",
  "roche-lightcycler-480": "Roche LightCycler 480",
  "quantstudio-5": "QuantStudio 5",
  "abi-7500": "ABI 7500 / Fast",
};

function formatNumber(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function adapterLabel(adapterId: string): string {
  if (adapterId.endsWith("cq-results")) return "Cq 结果";
  if (adapterId.endsWith("tm-summary")) return "Tm 摘要";
  if (adapterId.endsWith("melt-grouping")) return "熔解分组";
  return "通用导入";
}

function targetColor(target: string): string {
  const palette = ["#4c63c7", "#0e8a78", "#c46b34", "#8b5aae", "#b64562", "#327c9e"];
  let hash = 0;
  for (const char of target) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return target ? palette[Math.abs(hash) % palette.length] : "#cbd1dc";
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <section className="empty-state" onClick={onPick}>
      <div className="upload-mark" aria-hidden="true">↑</div>
      <div>
        <p className="eyebrow">本地处理 · 原始数据不上传</p>
        <h2>把仪器结果和板布局一起放进来</h2>
        <p>可同时选择 XLSX、CSV、TXT。系统会自动区分板图、Cq、Tm 和熔解分组结果。</p>
      </div>
      <button type="button" className="primary-button">选择文件</button>
    </section>
  );
}

export default function QpcrAnalysisStudio() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<ImportedSource[]>([]);
  const [dataset, setDataset] = useState<CanonicalDataset | null>(null);
  const [draftWells, setDraftWells] = useState<WellRecord[]>([]);
  const [appliedWells, setAppliedWells] = useState<WellRecord[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<WorkspaceTab>("import");
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

  const pendingCount = pendingEditLogs.length + pendingExclusionLogs.length;
  const selectedWells = draftWells.filter((well) => selected.includes(well.id));
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

  async function importFiles(files: FileList | File[]) {
    setLoading(true);
    setError("");
    try {
      const parsed = await Promise.all([...files].map(parseBrowserFile));
      setSources((current) => [...current, ...parsed]);
      setTab("import");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件解析失败");
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function updateSelectedTable(sourceId: string, tableId: string) {
    setSources((current) => current.map((source) => source.id === sourceId ? { ...source, selectedTableId: tableId } : source));
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
  }

  function createDataset() {
    const built = buildCanonicalDataset(sources);
    setDataset(built);
    setDraftWells(built.wells);
    setAppliedWells(built.wells);
    setSelected(built.wells.find((well) => well.sampleName || well.targetName)?.id ? [built.wells.find((well) => well.sampleName || well.targetName)!.id] : []);
    setTab("plate");
    const probableReference = built.wells.map((well) => well.targetName).find((target) => /gapdh|actb|18s|rplp0|b2m/i.test(target));
    if (probableReference) setReferenceTargets([probableReference]);
  }

  function toggleWell(id: string, additive: boolean) {
    setSelected((current) => additive
      ? current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      : [id]);
  }

  function applyBatchEdit() {
    if (!selected.length) return;
    const changes: Partial<Pick<WellRecord, "sampleName" | "targetName" | "taskType">> = {};
    if (batchSample.trim()) changes.sampleName = batchSample.trim();
    if (batchTarget.trim()) changes.targetName = batchTarget.trim();
    if (batchTask.trim()) changes.taskType = batchTask.trim();
    const updated = updateWellFields(draftWells, selected, changes);
    setDraftWells(updated.wells);
    setPendingEditLogs((current) => [...current, ...updated.logs]);
    setBatchSample("");
    setBatchTarget("");
    setBatchTask("");
  }

  function applyPastedBlock() {
    const rows = pasteBlock.trim().split(/\r?\n/).map((line) => line.split("\t"));
    if (!rows.length || !selected.length) return;
    const orderedIds = draftWells
      .filter((well) => selected.includes(well.id))
      .sort((a, b) => a.row.localeCompare(b.row) || a.column - b.column)
      .map((well) => well.id);
    let nextWells = draftWells;
    const logs: EditLog[] = [];
    orderedIds.forEach((id, index) => {
      const [sampleName, targetName, taskType] = rows[index] ?? [];
      if (sampleName === undefined) return;
      const updated = updateWellFields(nextWells, [id], {
        sampleName: sampleName.trim(),
        ...(targetName !== undefined ? { targetName: targetName.trim() } : {}),
        ...(taskType !== undefined ? { taskType: taskType.trim() } : {}),
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

  function clearProject() {
    setSources([]);
    setDataset(null);
    setDraftWells([]);
    setAppliedWells([]);
    setSelected([]);
    setAuditLogs([]);
    setPendingEditLogs([]);
    setPendingExclusionLogs([]);
    setTab("import");
  }

  return (
    <main className="app-shell">
      <input
        ref={fileInput}
        hidden
        type="file"
        multiple
        accept=".xlsx,.csv,.txt,.tsv"
        onChange={(event) => event.target.files && importFiles(event.target.files)}
      />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><i /><i /><i /></div>
          <div>
            <strong>qPCR Analysis Studio</strong>
            <span>实时定量 PCR 分析台</span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="privacy-pill"><span />Local only</span>
          {sources.length > 0 && <button className="quiet-button" onClick={clearProject}>新建分析</button>}
          <button className="primary-button compact" onClick={() => fileInput.current?.click()}>+  导入文件</button>
        </div>
      </header>

      <section className="hero-strip">
        <div>
          <p className="eyebrow">INSTRUMENT-INDEPENDENT WORKSPACE</p>
          <h1>从原始孔位到可追溯结果</h1>
          <p>自动识别仪器文件，但所有关键映射、异常孔和重新计算都保留人工确认。</p>
        </div>
        <div className="support-row">
          <span>Roche LC480</span><span>QuantStudio 5</span><span>ABI 7500</span><span>Generic XLSX / CSV / TXT</span>
        </div>
      </section>

      {sources.length === 0 ? (
        <div className="workspace-frame">
          <EmptyState onPick={() => fileInput.current?.click()} />
          <div className="principle-grid">
            <article><b>01</b><h3>原始数据不覆盖</h3><p>每一行保留来源文件、工作表和原始行号。</p></article>
            <article><b>02</b><h3>只警告，不自动删除</h3><p>仪器 flag、复孔差异和熔解异常均由用户决定。</p></article>
            <article><b>03</b><h3>计算与界面分离</h3><p>同一纯函数内核可复用于网页版与未来离线版。</p></article>
          </div>
        </div>
      ) : (
        <div className="workspace-layout">
          <nav className="step-nav" aria-label="分析步骤">
            {([
              ["import", "01", "导入与映射"],
              ["plate", "02", "板布局与编辑"],
              ["qc", "03", "复孔 QC"],
              ["results", "04", "相对定量"],
              ["audit", "05", "审计记录"],
            ] as [WorkspaceTab, string, string][]).map(([value, number, label]) => (
              <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>
                <span>{number}</span>{label}
              </button>
            ))}
          </nav>

          <section className="workspace-content">
            {loading && <div className="notice">正在本地解析文件…</div>}
            {error && <div className="notice error">{error}</div>}

            {tab === "import" && (
              <div className="panel-stack">
                <div className="section-heading">
                  <div><p className="eyebrow">IMPORT REVIEW</p><h2>先确认文件角色和字段映射</h2></div>
                  <button className="primary-button" onClick={createDataset} disabled={!sources.length}>构建统一数据集 →</button>
                </div>
                <div className="source-grid">
                  {sources.map((source) => {
                    const table = source.tables.find((item) => item.id === source.selectedTableId) ?? source.tables[0];
                    return (
                      <article className="source-card" key={source.id}>
                        <div className="source-card-head">
                          <div className="file-icon">{source.fileType.toUpperCase()}</div>
                          <div><h3>{source.fileName}</h3><p>{INSTRUMENT_LABELS[source.instrumentType]} · {adapterLabel(source.adapterId)}</p></div>
                          <span className="confidence">{source.instrumentType === "generic" ? "待确认" : "已识别"}</span>
                        </div>
                        {source.tables.length > 1 && (
                          <label className="field-label">数据工作表
                            <select value={source.selectedTableId} onChange={(event) => updateSelectedTable(source.id, event.target.value)}>
                              {source.tables.map((item) => <option key={item.id} value={item.id}>{item.sourceSheet} · {item.rawRows.length} 行</option>)}
                            </select>
                          </label>
                        )}
                        {source.warnings.map((warning) => <p className="inline-warning" key={warning}>△ {warning}</p>)}
                        {table && (
                          <div className="mapping-list">
                            <div className="mapping-head"><span>输入列</span><span>统一字段</span><span>信心度</span></div>
                            {table.suggestedMappings.map((mapping) => (
                              <div className={mapping.conflict ? "mapping-row conflict" : "mapping-row"} key={mapping.sourceColumn}>
                                <code>{mapping.sourceColumn}</code>
                                <select
                                  value={mapping.canonicalField ?? ""}
                                  onChange={(event) => updateMapping(source.id, mapping.sourceColumn, (event.target.value || null) as CanonicalField | null)}
                                >
                                  <option value="">不导入</option>
                                  {FIELD_OPTIONS.map(([field, label]) => <option value={field} key={field}>{label}</option>)}
                                </select>
                                <span className="mapping-score">{Math.round(mapping.confidence * 100)}%{mapping.conflict ? " · 冲突" : ""}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "plate" && dataset && (
              <div className="plate-workspace">
                <div className="section-heading plate-heading">
                  <div><p className="eyebrow">PLATE WORKSPACE</p><h2>{dataset.plate.plateFormat} 孔板 · {draftWells.filter((well) => well.sampleName || well.targetName).length} 个已定义反应</h2></div>
                  <div className="legend"><span><i className="dot selected-dot" />已选</span><span><i className="dot warning-dot" />QC 提示</span><span><i className="dot excluded-dot" />已排除</span></div>
                </div>
                {dataset.warnings.map((warning) => <div className="notice" key={warning}>{warning}</div>)}
                <div className="plate-and-editor">
                  <div className="plate-scroll">
                    <div className={`plate-grid plate-${dataset.plate.plateFormat}`} style={{ gridTemplateColumns: `36px repeat(${dataset.plate.columns.length}, minmax(${dataset.plate.plateFormat === 384 ? 42 : 64}px, 1fr))` }}>
                      <div />
                      {dataset.plate.columns.map((column) => <div className="axis-label" key={column}>{column}</div>)}
                      {dataset.plate.rows.flatMap((row) => [
                        <div className="axis-label row-axis" key={`axis-${row}`}>{row}</div>,
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
                              onClick={(event) => well && toggleWell(well.id, event.metaKey || event.ctrlKey || event.shiftKey)}
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
                    <div className="editor-header"><p className="eyebrow">SELECTION</p><h3>{selectedWells.length ? `${selectedWells.length} 个孔已选` : "选择孔位"}</h3></div>
                    {selectedWells[0] && (
                      <div className="well-summary">
                        <strong>{selectedWells[0].well}</strong>
                        <span>Cq {formatNumber(selectedWells[0].cq)}</span>
                        <span>Tm1 {formatNumber(selectedWells[0].tm1)}</span>
                        <span>{selectedWells[0].instrumentFlag || "No instrument flag"}</span>
                      </div>
                    )}
                    <div className="form-stack">
                      <label>样本 / Sample Name<input value={batchSample} placeholder={selectedWells[0]?.sampleName || "输入后批量应用"} onChange={(event) => setBatchSample(event.target.value)} /></label>
                      <label>基因 / Target Name<input value={batchTarget} placeholder={selectedWells[0]?.targetName || "如 GAPDH"} onChange={(event) => setBatchTarget(event.target.value)} /></label>
                      <label>反应角色<input value={batchTask} placeholder={selectedWells[0]?.taskType || "Unknown / NTC / no-RT"} onChange={(event) => setBatchTask(event.target.value)} /></label>
                      <button className="secondary-button" onClick={applyBatchEdit} disabled={!selected.length}>应用到已选孔</button>
                    </div>
                    <div className="paste-box">
                      <label>从 Excel 粘贴：样本、基因、角色（可选）
                        <textarea value={pasteBlock} placeholder={"S01\tGAPDH\tUnknown\nS01\tGENE1\tUnknown"} onChange={(event) => setPasteBlock(event.target.value)} />
                      </label>
                      <button className="quiet-button bordered" onClick={applyPastedBlock} disabled={!pasteBlock.trim() || !selected.length}>按孔位顺序粘贴</button>
                    </div>
                    <div className="divider" />
                    <label className="form-label">排除原因<textarea value={exclusionReason} onChange={(event) => setExclusionReason(event.target.value)} /></label>
                    <div className="split-actions">
                      <button className="danger-button" onClick={() => setExclusion(true)} disabled={!selected.length}>排除</button>
                      <button className="quiet-button bordered" onClick={() => setExclusion(false)} disabled={!selected.length}>恢复</button>
                    </div>
                    <p className="microcopy">右键孔位可快速排除。所有改动在“重新计算”前都是草稿。</p>
                  </aside>
                </div>
              </div>
            )}

            {tab === "qc" && dataset && (
              <div className="panel-stack">
                <div className="section-heading"><div><p className="eyebrow">REPLICATE QC</p><h2>技术复孔质控</h2></div><div className="metric-chip"><b>{qc.filter((row) => row.warningCodes.length).length}</b><span>组需复核</span></div></div>
                <div className="method-note"><b>当前规则</b><span>Cq 极差 &gt; 0.5 警告</span><span>只标记可疑孔，不自动排除</span><span>单孔 SD / CV 不计算</span></div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>样本</th><th>基因</th><th>孔位</th><th>有效/总数</th><th>Mean Cq</th><th>SD</th><th>Range</th><th>线性量 CV%</th><th>Tm1 range</th><th>判定</th></tr></thead>
                    <tbody>{qc.map((row) => <tr key={row.id} className={row.warningCodes.length ? "flagged-row" : ""}>
                      <td>{row.sampleName}</td><td>{row.targetName}</td><td>{row.wells.join(", ")}</td><td>{row.validReplicates}/{row.totalReplicates}</td><td>{formatNumber(row.meanCq, 3)}</td><td>{formatNumber(row.sdCq, 3)}</td><td>{formatNumber(row.cqRange, 3)}</td><td>{formatNumber(row.linearQuantityCvPercent, 1)}</td><td>{formatNumber(row.tm1Range, 2)}</td><td>{row.warningCodes.length ? <span className="status warning-status">复核 {row.suspectWell ? `· ${row.suspectWell}` : ""}</span> : <span className="status pass-status">通过</span>}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </div>
            )}

            {tab === "results" && dataset && (
              <div className="panel-stack">
                <div className="section-heading"><div><p className="eyebrow">RELATIVE QUANTIFICATION</p><h2>ΔCq / ΔΔCq 相对定量</h2></div></div>
                <div className="settings-card">
                  <div><p className="field-title">内参基因（可多选）</p><div className="choice-row">{targets.map((target) => <label className={referenceTargets.includes(target) ? "choice active" : "choice"} key={target}><input type="checkbox" checked={referenceTargets.includes(target)} onChange={() => setReferenceTargets((current) => current.includes(target) ? current.filter((item) => item !== target) : [...current, target])} />{target}</label>)}</div></div>
                  <label className="field-label">校准样本<select value={calibrator} onChange={(event) => setCalibrator(event.target.value)}><option value="">仅计算 ΔCq</option>{samples.map((sample) => <option key={sample} value={sample}>{sample}</option>)}</select></label>
                  <p className="microcopy">多内参默认按内参相对量的几何均值归一化。未提供扩增效率时当前按 100% 计算。</p>
                </div>
                {!referenceTargets.length ? <div className="empty-table">请先选择至少一个内参基因。</div> : (
                  <div className="table-wrap"><table><thead><tr><th>样本</th><th>目标基因</th><th>Target Mean Cq</th><th>Reference Mean Cq</th><th>ΔCq</th><th>2^-ΔCq</th><th>ΔΔCq</th><th>相对表达量</th><th>提示</th></tr></thead><tbody>{relativeResults.map((row) => <tr key={`${row.sampleName}-${row.targetName}`}><td>{row.sampleName}</td><td>{row.targetName}</td><td>{formatNumber(row.targetMeanCq, 3)}</td><td>{formatNumber(row.referenceMeanCq, 3)}</td><td>{formatNumber(row.deltaCq, 3)}</td><td>{formatNumber(row.normalizedQuantity, 4)}</td><td>{formatNumber(row.deltaDeltaCq, 3)}</td><td><b>{formatNumber(row.relativeExpression, 4)}</b></td><td>{row.warningCodes.join(", ") || "—"}</td></tr>)}</tbody></table></div>
                )}
              </div>
            )}

            {tab === "audit" && (
              <div className="panel-stack">
                <div className="section-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>数据来源与人工改动</h2></div></div>
                <div className="audit-summary"><div><b>{sources.length}</b><span>来源文件</span></div><div><b>{dataset?.wells.length ?? 0}</b><span>原始孔记录</span></div><div><b>{auditLogs.length}</b><span>已应用改动</span></div><div><b>{pendingCount}</b><span>待应用</span></div></div>
                <div className="timeline">
                  {auditLogs.length === 0 && <div className="empty-table">尚无已应用的人工改动。</div>}
                  {[...auditLogs].reverse().map((log) => (
                    <article key={log.id}><span className="timeline-dot" /><div><b>{"field" in log ? `编辑 ${log.field}` : log.action === "exclude" ? "排除反应孔" : "恢复反应孔"}</b><p>{"field" in log ? `${log.previousValue || "(空)"} → ${log.newValue || "(空)"}` : log.reason}</p><small>{log.wellRecordId} · {new Date(log.timestamp).toLocaleString("zh-CN")}</small></div></article>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {dataset && pendingCount > 0 && (
        <button className="recalculate-button" onClick={recalculate}>
          <span className="recalc-count">{pendingCount}</span>
          <span><b>重新计算</b><small>应用待处理改动</small></span>
          <span className="recalc-arrow">→</span>
        </button>
      )}
      <footer><span>qPCR Analysis Studio · Research use</span><span>原始数据仅在当前浏览器处理</span></footer>
    </main>
  );
}
