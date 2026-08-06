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
import { localizeRuntimeMessage, useLanguage } from "./i18n";

type WorkspaceView = "overview" | "plate" | "results";
type ResultSection = "quantification" | "melt";

const VIEW_ITEMS: WorkspaceView[] = ["overview", "plate", "results"];

function formatNumber(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function targetColor(target: string): string {
  const palette = ["#198a80", "#b97235", "#516ca8", "#8b659d", "#b55566", "#397d9a", "#6b8751"];
  let hash = 0;
  for (const char of target) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return target ? palette[Math.abs(hash) % palette.length] : "#cbd1ce";
}

function commonValue(
  wells: WellRecord[],
  field: "sampleName" | "targetName" | "taskType",
  l: (zh: string, en: string) => string,
): string {
  const values = [...new Set(wells.map((well) => well[field]).filter(Boolean))];
  if (values.length === 1) return values[0];
  if (values.length > 1) return l("多个不同值（留空则保留）", "Multiple values (leave blank to keep)");
  return l("未设置", "Not set");
}

export default function QpcrAnalysisStudio() {
  const { language, setLanguage, l } = useLanguage();
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
  const [exclusionReason, setExclusionReason] = useState("");
  const [referenceTargets, setReferenceTargets] = useState<string[]>([]);
  const [calibrator, setCalibrator] = useState("");
  const [displaySamples, setDisplaySamples] = useState<string[]>([]);
  const [displayTargets, setDisplayTargets] = useState<string[]>([]);
  const [qcSearch, setQcSearch] = useState("");
  const [qcIssueOnly, setQcIssueOnly] = useState(false);

  const readiness = useMemo(() => assessImportReadiness(sources), [sources]);
  const pendingCount = pendingEditLogs.length + pendingExclusionLogs.length;
  const selectedWells = useMemo(() => draftWells.filter((well) => selected.includes(well.id)), [draftWells, selected]);
  const qc = useMemo(() => calculateReplicateQc(appliedWells), [appliedWells]);
  const draftQc = useMemo(() => calculateReplicateQc(draftWells), [draftWells]);
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
  const plateQcState = useMemo(() => {
    const groupWarnings = new Map<string, Set<string>>();
    const specificWarnings = new Map<string, Set<string>>();
    const wellByName = new Map(draftWells.map((well) => [well.well, well]));
    const addWarning = (map: Map<string, Set<string>>, wellName: string, warning: string) => {
      const warnings = map.get(wellName) ?? new Set<string>();
      warnings.add(warning);
      map.set(wellName, warnings);
    };

    for (const row of draftQc.filter((item) => item.warningCodes.length > 0)) {
      for (const wellName of row.wells) {
        for (const warning of row.warningCodes) addWarning(groupWarnings, wellName, warning);
      }
      if (row.suspectWell && row.warningCodes.includes("CQ_RANGE_HIGH")) {
        addWarning(specificWarnings, row.suspectWell, "CQ_RANGE_HIGH");
      }
      if (row.warningCodes.includes("SECONDARY_MELT_PEAK")) {
        for (const wellName of row.wells) {
          if (wellByName.get(wellName)?.tm2 !== null) addWarning(specificWarnings, wellName, "SECONDARY_MELT_PEAK");
        }
      }
      if (row.warningCodes.includes("EXCLUDED_OR_NON_DETECTED")) {
        for (const wellName of row.wells) {
          const well = wellByName.get(wellName);
          if (well && (well.instrumentOmit || well.userExcluded || well.cqStatus === "not-detected")) {
            addWarning(specificWarnings, wellName, "EXCLUDED_OR_NON_DETECTED");
          }
        }
      }
    }

    for (const well of draftWells) {
      for (const warning of well.qcFlags) addWarning(specificWarnings, well.well, warning.code);
      if (well.tm2 !== null) addWarning(specificWarnings, well.well, "SECONDARY_MELT_PEAK");
      if (well.instrumentOmit || well.userExcluded || well.cqStatus === "not-detected") {
        addWarning(specificWarnings, well.well, "EXCLUDED_OR_NON_DETECTED");
      }
    }
    return { groupWarnings, specificWarnings };
  }, [draftQc, draftWells]);
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
    setDisplaySamples([...new Set(built.wells.map((well) => well.sampleName).filter(Boolean))].sort());
    setDisplayTargets([...new Set(built.wells.map((well) => well.targetName).filter(Boolean))].sort());
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
    setDisplaySamples([]);
    setDisplayTargets([]);
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
    const updated = setWellExclusion(
      draftWells,
      ids,
      excluded,
      exclusionReason.trim() || l("技术复孔异常（人工判定）", "Technical replicate issue (manual decision)"),
    );
    setDraftWells(updated.wells);
    setPendingExclusionLogs((current) => [...current, ...updated.logs]);
  }

  function recalculate() {
    const nextSamples = [...new Set(draftWells.map((well) => well.sampleName).filter(Boolean))].sort();
    const nextTargets = [...new Set(draftWells.map((well) => well.targetName).filter(Boolean))].sort();
    const hadAllSamplesSelected = samples.length > 0 && samples.every((sample) => displaySamples.includes(sample));
    const hadAllTargetsSelected = targets.length > 0 && targets.every((target) => displayTargets.includes(target));
    setAppliedWells(draftWells);
    setDataset((current) => current ? { ...current, wells: draftWells } : current);
    setAuditLogs((current) => [...current, ...pendingEditLogs, ...pendingExclusionLogs]);
    setPendingEditLogs([]);
    setPendingExclusionLogs([]);
    setDisplaySamples((current) => {
      const retained = current.filter((sample) => nextSamples.includes(sample));
      return hadAllSamplesSelected ? [...retained, ...nextSamples.filter((sample) => !retained.includes(sample))] : retained;
    });
    setDisplayTargets((current) => {
      const retained = current.filter((target) => nextTargets.includes(target));
      return hadAllTargetsSelected ? [...retained, ...nextTargets.filter((target) => !retained.includes(target))] : retained;
    });
    setReferenceTargets((current) => current.filter((target) => nextTargets.includes(target)));
    if (calibrator && !nextSamples.includes(calibrator)) setCalibrator("");
  }

  function switchWorkspaceView(nextView: WorkspaceView) {
    if (pendingCount > 0 && nextView !== "plate") return;
    setView(nextView);
  }

  function toggleOrderedSelection(value: string, selectedValues: string[], update: (values: string[]) => void) {
    update(selectedValues.includes(value)
      ? selectedValues.filter((item) => item !== value)
      : [...selectedValues, value]);
  }

  const detectedCount = appliedWells.filter((well) => well.cqStatus === "detected" && !well.userExcluded).length;
  const meltWellCount = appliedWells.filter((well) => well.tm1 !== null || well.tm2 !== null || Boolean(well.meltGroup) || well.meltScore !== null || well.meltResolution !== null).length;
  const secondaryPeakCount = appliedWells.filter((well) => well.tm2 !== null && !well.userExcluded).length;
  const hasQuantification = appliedWells.some((well) => well.cq !== null || well.cqStatus === "not-detected");
  const hasMeltAnalysis = meltWellCount > 0;
  const namedReactionCount = draftWells.filter((well) => well.sampleName || well.targetName).length;
  const qcIssueCount = qc.filter((row) => row.warningCodes.length).length;
  const selectedDisplayTargets = displayTargets.filter((target) => !referenceTargets.includes(target));
  const viewLabels: Record<WorkspaceView, [string, string]> = {
    overview: [l("概览与 QC", "Overview & QC"), "Overview + QC"],
    plate: [l("板工作区", "Plate workspace"), "Plate"],
    results: [l("结果与图表", "Results & figures"), "Results"],
  };

  return (
    <main className="app-shell">
      <input ref={resultInput} hidden type="file" multiple accept=".xlsx,.csv,.txt,.tsv" onChange={(event) => event.target.files && importFiles(event.target.files)} />
      <input ref={layoutInput} hidden type="file" multiple accept=".xlsx,.csv,.txt,.tsv" onChange={(event) => event.target.files && importFiles(event.target.files)} />

      <header className="topbar">
        <button className="brand-lockup" type="button" onClick={() => dataset ? switchWorkspaceView("overview") : setDataManagerOpen(true)}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span><strong>qPCR Analysis Studio</strong><small>Relative quantification workspace</small></span>
        </button>
        <div className="topbar-actions">
          <span className="privacy-pill"><i />{l("本地处理", "Local processing")}</span>
          <div className="language-switch" role="group" aria-label={l("语言选择", "Language selection")}>
            <button type="button" className={language === "zh" ? "active" : ""} onClick={() => setLanguage("zh")}>中文</button>
            <button type="button" className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button>
          </div>
          {dataset && <button className="quiet-button topbar-button" type="button" onClick={() => setDataManagerOpen(true)}>{l("数据文件", "Data files")} <span className="file-count">{sources.length}</span></button>}
          {sources.length > 0 && <button className="quiet-button topbar-button" type="button" onClick={clearProject}>{l("新建分析", "New analysis")}</button>}
        </div>
      </header>

      {dataManagerOpen || !dataset ? (
        <div className="data-manager-page">
          <section className="intake-hero">
            <div>
              <p className="eyebrow">qPCR · RELATIVE QUANTIFICATION & MELT REVIEW</p>
              <div className="hero-title-row"><h1>{l("qPCR 分析工具", "qPCR Analysis Studio")}</h1><span>RUO</span></div>
              <p>{l("孔级 Cq 相对定量、复孔质控、Tm 与熔解分组复核；结果文件和修正板布局分类型导入。", "Well-level Cq relative quantification, replicate QC, and Tm/melt-group review with separate result and corrected-layout imports.")}</p>
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
              <h1>{l(`${dataset.plate.plateFormat} 孔 qPCR 分析`, `${dataset.plate.plateFormat}-well qPCR analysis`)}</h1>
              <p>{l(
                `${sources.length} 个来源文件 · ${samples.length} 个样本 · ${targets.length} 个靶标${hasQuantification ? ` · ${detectedCount} 个有效 Cq` : ""}${hasMeltAnalysis ? ` · ${meltWellCount} 个熔解记录` : ""}`,
                `${sources.length} source file(s) · ${samples.length} sample(s) · ${targets.length} target(s)${hasQuantification ? ` · ${detectedCount} valid Cq` : ""}${hasMeltAnalysis ? ` · ${meltWellCount} melt record(s)` : ""}`,
              )}</p>
            </div>
            <div className={pendingCount > 0 ? "analysis-state pending" : "analysis-state"}><span />{pendingCount > 0 ? l(`${pendingCount} 项修改待重算`, `${pendingCount} change(s) awaiting recalculation`) : l("概览、板布局与结果已同步", "Overview, plate, and results synchronized")}</div>
          </section>

          <nav className="workspace-tabs" aria-label={l("分析工作区", "Analysis workspace")}>
            {VIEW_ITEMS.map((value) => {
              const [label, english] = viewLabels[value];
              return (
              <button
                key={value}
                type="button"
                className={view === value ? "active" : ""}
                disabled={pendingCount > 0 && value !== "plate"}
                title={pendingCount > 0 && value !== "plate" ? l("请先应用板布局修改并重算", "Apply plate edits and recalculate first") : undefined}
                onClick={() => switchWorkspaceView(value)}
              >
                <span>{label}</span><small>{english}</small>
              </button>
              );
            })}
          </nav>

          <section className="workspace-content">
            {view === "overview" && (
              <div className="overview-layout">
                <div className="section-heading overview-heading">
                  <div><p className="eyebrow">OVERVIEW + QUALITY CONTROL</p><h2>{l("概览与复孔质控", "Overview & replicate QC")}</h2><p className="section-summary">{l(
                    `${dataset.plate.plateFormat} 孔板中定义 ${namedReactionCount} 个反应；当前 ${qcIssueCount} 个复孔组需要复核${secondaryPeakCount ? `，${secondaryPeakCount} 个孔检测到第二熔解峰` : ""}。`,
                    `${namedReactionCount} reactions are defined on the ${dataset.plate.plateFormat}-well plate; ${qcIssueCount} replicate group(s) require review${secondaryPeakCount ? `, with secondary melt peaks in ${secondaryPeakCount} well(s)` : ""}.`,
                  )}</p></div>
                  <button className="quiet-button bordered" type="button" onClick={() => setDataManagerOpen(true)}>{l("管理导入文件", "Manage imported files")}</button>
                </div>
                <div className="overview-qc-grid">
                  <article className="qc-workbench">
                    <div className="card-heading compact-card-heading">
                      <div><p className="eyebrow">REPLICATE QC</p><h3>{l("技术复孔", "Technical replicates")}</h3></div>
                      <details className="inline-rules"><summary>{l("规则：Cq/Tm 极差 > 0.5", "Rule: Cq/Tm range > 0.5")}</summary><p>{l("仅提示，不自动排除；单孔不计算 SD/CV；Tm 偏移需结合曲线和实验设计人工判断。", "Warnings do not automatically exclude wells. SD/CV are not calculated for a single well. Interpret Tm shifts with the curve and experimental design.")}</p></details>
                    </div>
                    <div className="table-filterbar compact-filterbar">
                      <input value={qcSearch} onChange={(event) => setQcSearch(event.target.value)} placeholder={l("筛选样本、靶标或孔位", "Filter sample, target, or well")} />
                      <button type="button" className={qcIssueOnly ? "filter-chip active" : "filter-chip"} onClick={() => setQcIssueOnly((current) => !current)}>{l("仅看需复核", "Review only")}</button>
                      <span>{filteredQc.length} / {qc.length} {l("组", "groups")}</span>
                    </div>
                    <div className="table-wrap compact-qc-table">
                      <table>
                        <thead><tr><th>{l("样本", "Sample")}</th><th>{l("靶标", "Target")}</th><th>{l("孔位", "Wells")}</th>{hasQuantification && <><th>{l("有效 Cq/总数", "Valid/total Cq")}</th><th>Mean Cq</th><th>SD</th><th>Cq range</th><th>{l("线性量 CV%", "Linear quantity CV%")}</th></>}{hasMeltAnalysis && <><th>Mean Tm1</th><th>Tm1 range</th><th>{l("第二峰", "Second peak")}</th><th>{l("熔解分组", "Melt groups")}</th></>}<th>{l("判定", "Status")}</th></tr></thead>
                        <tbody>{filteredQc.map((row) => <tr key={row.id} className={row.warningCodes.length ? "flagged-row" : ""}>
                          <td><b>{row.sampleName}</b></td><td>{row.targetName}</td><td>{row.wells.join(", ")}</td>{hasQuantification && <><td>{row.validReplicates}/{row.totalReplicates}</td><td>{formatNumber(row.meanCq, 3)}</td><td>{formatNumber(row.sdCq, 3)}</td><td>{formatNumber(row.cqRange, 3)}</td><td>{formatNumber(row.linearQuantityCvPercent, 1)}</td></>}{hasMeltAnalysis && <><td>{formatNumber(row.meanTm1, 2)}</td><td>{formatNumber(row.tm1Range, 2)}</td><td>{row.secondaryPeakCount || "—"}</td><td>{row.meltGroups.join(", ") || "—"}</td></>}<td>{row.warningCodes.length ? <span className="status warning-status">{l("复核", "Review")} {row.suspectWell ? `· ${row.suspectWell}` : ""}</span> : <span className="status pass-status">{l("通过", "Pass")}</span>}</td>
                        </tr>)}</tbody>
                      </table>
                    </div>
                  </article>

                  <aside className="overview-side-stack">
                    <article className="provenance-card">
                      <div className="card-heading"><div><p className="eyebrow">DATA SOURCES</p><h3>{l("数据与假设", "Data & assumptions")}</h3></div><button type="button" onClick={() => setDataManagerOpen(true)}>{l("编辑", "Edit")}</button></div>
                      <div className="source-summary-list">
                        {sources.map((source) => <div key={source.id}><span>{source.fileName}</span><small>{source.tables.find((table) => table.id === source.selectedTableId)?.sourceSheet ?? "—"}</small></div>)}
                      </div>
                      {(dataset.warnings.length > 0 || dataset.assumptions.length > 0) && <details className="assumption-details"><summary>{dataset.warnings.length + dataset.assumptions.length} {l("条数据说明", "data note(s)")}</summary>{[...dataset.warnings, ...dataset.assumptions].map((item) => <p key={item}>{localizeRuntimeMessage(item, language)}</p>)}</details>}
                    </article>
                    <article className="audit-card">
                      <div className="card-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h3>{l("审计记录", "Audit trail")}</h3></div><span>{auditLogs.length} {l("已应用", "applied")} · {pendingCount} {l("待应用", "pending")}</span></div>
                      <div className="timeline compact-timeline">
                        {auditLogs.length === 0 && <div className="empty-table embedded">{l("尚无已应用的人工改动。", "No applied manual changes yet.")}</div>}
                        {[...auditLogs].reverse().slice(0, 8).map((log) => (
                          <article key={log.id}><span className="timeline-dot" /><div><b>{"field" in log ? l(`编辑 ${log.field}`, `Edit ${log.field}`) : log.action === "exclude" ? l("排除反应孔", "Exclude well") : l("恢复反应孔", "Restore well")}</b><p>{"field" in log ? `${log.previousValue || l("(空)", "(blank)")} → ${log.newValue || l("(空)", "(blank)")}` : localizeRuntimeMessage(log.reason, language)}</p><small>{log.wellRecordId} · {new Date(log.timestamp).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</small></div></article>
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
                  <div><p className="eyebrow">PLATE WORKSPACE</p><h2>{l(`${dataset.plate.plateFormat} 孔板 · ${namedReactionCount} 个已定义反应`, `${dataset.plate.plateFormat}-well plate · ${namedReactionCount} defined reactions`)}</h2></div>
                  <div className="legend"><span><i className="dot selected-dot" />{l("已选", "Selected")}</span><span><i className="dot group-warning-dot" />{l("复孔组提示", "Replicate-group warning")}</span><span><i className="dot warning-dot" />{l("疑似异常孔", "Suspect well")}</span><span><i className="dot excluded-dot" />{l("已排除", "Excluded")}</span></div>
                </div>
                {dataset.warnings.map((warning) => <div className="notice" key={warning}>{localizeRuntimeMessage(warning, language)}</div>)}
                {pendingCount > 0 && <div className="pending-recalculation-notice"><span>{l("板布局草稿已改变", "Plate draft changed")}</span><p>{l("概览和结果暂时锁定；应用修改并重算后，三处会基于同一份孔数据同步更新。", "Overview and results are temporarily locked. Apply changes and recalculate to synchronize all three views from the same well data.")}</p><button type="button" onClick={recalculate}>{l("立即应用并重算", "Apply & recalculate")}</button></div>}
                <div className="selection-guide">
                  <span>{l("批量选择：", "Batch selection: ")}</span>{l("鼠标拖动框选 · Shift 选择矩形范围 · ⌘/Ctrl 追加或取消 · 点击行列标可整行/整列选择", "Drag to select · Shift for a rectangular range · ⌘/Ctrl to add or remove · click a row/column label to select it")}
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
                          const hasGroupWarning = Boolean(well && plateQcState.groupWarnings.has(well.well));
                          const hasSpecificWarning = Boolean(well && plateQcState.specificWarnings.has(well.well));
                          const warningText = well ? [...new Set([
                            ...(plateQcState.specificWarnings.get(well.well) ?? []),
                            ...(plateQcState.groupWarnings.get(well.well) ?? []),
                          ])].join(", ") : "";
                          return (
                            <button
                              type="button"
                              key={wellName}
                              className={`well-cell ${isSelected ? "selected" : ""} ${hasGroupWarning ? "qc-group-warning" : ""} ${hasSpecificWarning ? "warning" : ""} ${well?.userExcluded ? "excluded" : ""}`}
                              style={{ "--well-color": targetColor(well?.targetName ?? "") } as React.CSSProperties}
                              title={well ? `${well.well} | ${well.sampleName || l("未命名", "Unnamed")} | ${well.targetName || l("未命名", "Unnamed")} | Cq ${formatNumber(well.cq)}${warningText ? ` | QC: ${warningText}` : ""}` : wellName}
                              onMouseDown={(event) => well && startWellSelection(well, event)}
                              onMouseEnter={(event) => well && extendWellSelection(well, event)}
                              onContextMenu={(event) => { event.preventDefault(); if (well) { setSelected([well.id]); setExclusion(true, [well.id]); } }}
                            >
                              <span className="well-name">{wellName}</span>
                              {well && <><b>{well.sampleName || "—"}</b><small>{well.targetName || l("空孔", "Empty")}</small></>}
                            </button>
                          );
                        }),
                      ])}
                    </div>
                  </div>

                  <aside className="editor-panel">
                    <div className="editor-header"><p className="eyebrow">BATCH SELECTION</p><h3>{selectedWells.length ? l(`${selectedWells.length} 个孔已选`, `${selectedWells.length} well(s) selected`) : l("请选择孔位", "Select wells")}</h3><p>{selectedWells.length ? selectedWells.slice(0, 8).map((well) => well.well).join(", ") + (selectedWells.length > 8 ? "…" : "") : l("可在板上拖动框选多个孔", "Drag across the plate to select multiple wells")}</p></div>
                    <div className="selection-actions">
                      <button type="button" onClick={() => selectByField("sampleName")} disabled={!selectedWells.some((well) => well.sampleName)}>{l("选中同一样本", "Same sample")}</button>
                      <button type="button" onClick={() => selectByField("targetName")} disabled={!selectedWells.some((well) => well.targetName)}>{l("选中同一基因", "Same target")}</button>
                      <button type="button" onClick={() => setSelected([])} disabled={!selected.length}>{l("清空", "Clear")}</button>
                    </div>
                    <div className="selection-summary">
                      <div><span>Sample</span><b>{commonValue(selectedWells, "sampleName", l)}</b></div>
                      <div><span>Target</span><b>{commonValue(selectedWells, "targetName", l)}</b></div>
                      <div><span>Detected Cq</span><b>{selectedWells.filter((well) => well.cqStatus === "detected").length} / {selectedWells.length}</b></div>
                    </div>
                    <div className="form-stack batch-form">
                      <label>{l("统一修改 Sample Name", "Set Sample Name for selection")}<input value={batchSample} placeholder={commonValue(selectedWells, "sampleName", l)} onChange={(event) => setBatchSample(event.target.value)} /></label>
                      <label>{l("统一修改 Target Name", "Set Target Name for selection")}<input value={batchTarget} placeholder={commonValue(selectedWells, "targetName", l)} onChange={(event) => setBatchTarget(event.target.value)} /></label>
                      <label>{l("统一修改反应角色", "Set reaction role for selection")}<input value={batchTask} placeholder={commonValue(selectedWells, "taskType", l)} onChange={(event) => setBatchTask(event.target.value)} /></label>
                      <button className="secondary-button" type="button" onClick={applyBatchEdit} disabled={!selected.length || ![batchSample, batchTarget, batchTask].some((value) => value.trim())}>{l(`应用到 ${selected.length || 0} 个已选孔`, `Apply to ${selected.length || 0} selected well(s)`)}</button>
                    </div>

                    <details className="paste-details">
                      <summary>{l("批量贴入不同孔信息", "Paste different values by well")} <span>{l("Excel 专用", "Excel")}</span></summary>
                      <p>{l("仅当 Excel 每一行对应不同孔时使用。统一修改多个孔，请用上面的批量修改。", "Use this only when each Excel row maps to a different well. Use the fields above to apply one value to multiple wells.")}</p>
                      <div className="paste-format"><b>{l("支持两种格式", "Two supported formats")}</b><code>Well · Sample · Target · Role</code><code>{l("Sample · Target · Role（按已选孔顺序）", "Sample · Target · Role (selected-well order)")}</code></div>
                      <textarea value={pasteBlock} placeholder={"A1\tS01\tGAPDH\tUnknown\nA2\tS01\tGENE1\tUnknown"} onChange={(event) => setPasteBlock(event.target.value)} />
                      {pastePreview.rows.length > 0 && <p className="paste-preview">{l(`已识别 ${pastePreview.rows.length} 行 · ${pastePreview.hasWellColumn ? "按 Well 精确匹配" : `按 ${selected.length} 个已选孔顺序匹配`}`, `${pastePreview.rows.length} row(s) recognized · ${pastePreview.hasWellColumn ? "matched by Well" : `matched to ${selected.length} selected well(s) in order`}`)}</p>}
                      <button className="quiet-button bordered full-width" type="button" onClick={applyPastedBlock} disabled={!pastePreview.rows.length || (!pastePreview.hasWellColumn && !selected.length)}>{l("应用粘贴内容", "Apply pasted values")}</button>
                    </details>

                    <div className="divider" />
                    <label className="form-label">{l("排除原因", "Exclusion reason")}<textarea value={exclusionReason} placeholder={l("技术复孔异常（人工判定）", "Technical replicate issue (manual decision)")} onChange={(event) => setExclusionReason(event.target.value)} /></label>
                    <div className="split-actions">
                      <button className="danger-button" type="button" onClick={() => setExclusion(true)} disabled={!selected.length}>{l("排除已选孔", "Exclude selected")}</button>
                      <button className="quiet-button bordered" type="button" onClick={() => setExclusion(false)} disabled={!selected.length}>{l("恢复", "Restore")}</button>
                    </div>
                    <p className="microcopy">{l("所有修改先保留为草稿；点击右下角“应用修改并重算”后才进入结果和审计记录。", "Edits remain in draft until you select “Apply changes & recalculate”; then QC, results, and the audit trail are updated.")}</p>
                  </aside>
                </div>
              </div>
            )}

            {view === "results" && (
              <div className="panel-stack results-panel">
                <div className="section-heading results-heading">
                  <div><p className="eyebrow">RESULTS & FIGURES</p><h2>{resultSection === "quantification" ? l("相对定量结果", "Relative quantification") : l("Tm 与熔解分析", "Tm & melt analysis")}</h2></div>
                  <div className="result-mode-tabs" aria-label={l("结果类型", "Result type")}>
                    <button type="button" disabled={!hasQuantification} className={resultSection === "quantification" ? "active" : ""} onClick={() => setResultSection("quantification")}>{l("相对定量", "Quantification")}</button>
                    <button type="button" disabled={!hasMeltAnalysis} className={resultSection === "melt" ? "active" : ""} onClick={() => setResultSection("melt")}>{l("Tm 与熔解", "Tm & melt")}</button>
                  </div>
                </div>
                {resultSection === "quantification" && hasQuantification && <>
                  <div className="result-settings-grid">
                    <section className="result-setting-step reference-step">
                      <div className="setting-step-heading"><span>1</span><div><p className="eyebrow">NORMALIZATION</p><h3>{l("选择内参基因", "Select reference targets")}</h3></div><small>{l("可多选", "Multiple")}</small></div>
                      <div className="choice-row">{targets.map((target) => <label className={referenceTargets.includes(target) ? "choice active" : "choice"} key={target}><input type="checkbox" checked={referenceTargets.includes(target)} onChange={() => setReferenceTargets((current) => current.includes(target) ? current.filter((item) => item !== target) : [...current, target])} />{target}</label>)}</div>
                      <p>{l("多内参按相对量几何均值归一化。", "Multiple reference targets are normalized by the geometric mean of relative quantities.")}</p>
                    </section>

                    <section className="result-setting-step display-step">
                      <div className="setting-step-heading"><span>2</span><div><p className="eyebrow">DISPLAY ORDER</p><h3>{l("选择展示的基因和样本", "Choose displayed targets & samples")}</h3></div><button className="clear-selection-button" type="button" onClick={() => { setDisplayTargets([]); setDisplaySamples([]); }} disabled={!displayTargets.length && !displaySamples.length}>{l("清空", "Clear")}</button></div>
                      <div className="display-choice-group">
                        <div className="display-choice-label"><span>{l("基因", "Targets")}</span><small>{selectedDisplayTargets.length} {l("已选", "selected")}</small></div>
                        <div className="ordered-choice-row">{targets.map((target) => {
                          const isReference = referenceTargets.includes(target);
                          const selectionIndex = selectedDisplayTargets.indexOf(target);
                          return <button type="button" key={target} disabled={isReference} aria-pressed={selectionIndex >= 0 && !isReference} className={selectionIndex >= 0 && !isReference ? "ordered-choice active" : "ordered-choice"} onClick={() => toggleOrderedSelection(target, displayTargets, setDisplayTargets)}><span>{target}</span>{isReference ? <em>{l("内参", "Ref")}</em> : selectionIndex >= 0 ? <i>{selectionIndex + 1}</i> : null}</button>;
                        })}</div>
                      </div>
                      <div className="display-choice-group sample-display-group">
                        <div className="display-choice-label"><span>{l("样本", "Samples")}</span><small>{l(`${displaySamples.length} 已选 · 编号即图中从左到右顺序`, `${displaySamples.length} selected · numbers define left-to-right order`)}</small></div>
                        <div className="ordered-choice-row">{samples.map((sample) => {
                          const selectionIndex = displaySamples.indexOf(sample);
                          return <button type="button" key={sample} aria-pressed={selectionIndex >= 0} className={selectionIndex >= 0 ? "ordered-choice active" : "ordered-choice"} onClick={() => toggleOrderedSelection(sample, displaySamples, setDisplaySamples)}><span>{sample}</span>{selectionIndex >= 0 && <i>{selectionIndex + 1}</i>}</button>;
                        })}</div>
                      </div>
                    </section>

                    <section className="result-setting-step calibrator-step">
                      <div className="setting-step-heading"><span>3</span><div><p className="eyebrow">CALIBRATION</p><h3>{l("选择校准样本", "Select calibrator sample")}</h3></div></div>
                      <label className="compact-field">{l("校准样本", "Calibrator")}<select value={calibrator} onChange={(event) => setCalibrator(event.target.value)}><option value="">{l("不设置，仅计算 ΔCq", "None — calculate ΔCq only")}</option>{samples.map((sample) => <option key={sample} value={sample}>{sample}</option>)}</select></label>
                      <p>{l("设置后计算 ΔΔCq 与相对表达量；未提供扩增效率时按 100% 计算并记录假设。", "A calibrator enables ΔΔCq and relative expression. Missing amplification efficiency is recorded and assumed to be 100%.")}</p>
                    </section>
                  </div>
                  {!referenceTargets.length ? <div className="empty-table">{l("请先在第 1 区选择至少一个内参基因。", "Select at least one reference target in section 1.")}</div> : <ResultExplorer results={relativeResults} sampleOrder={displaySamples} targetOrder={selectedDisplayTargets} />}
                </>}
                {resultSection === "quantification" && !hasQuantification && <div className="empty-table">{l("当前仅导入了 Tm/熔解结果；添加单孔 Cq/Ct/Cp 后可进行相对定量。", "Only Tm/melt results are currently imported. Add well-level Cq/Ct/Cp data for relative quantification.")}</div>}
                {resultSection === "melt" && hasMeltAnalysis && <MeltAnalysis wells={appliedWells} />}
                {resultSection === "melt" && !hasMeltAnalysis && <div className="empty-table">{l("当前没有 Tm 或熔解分组数据；可返回数据文件追加对应结果。", "No Tm or melt-group data are available. Return to Data files to add the corresponding result.")}</div>}
              </div>
            )}
          </section>
        </div>
      )}

      {dataset && !dataManagerOpen && pendingCount > 0 && (
        <button className="recalculate-button" type="button" onClick={recalculate}>
          <span className="recalc-count">{pendingCount}</span>
          <span><b>{l("应用修改并重算", "Apply changes & recalculate")}</b><small>{l("更新 QC、结果与审计记录", "Update QC, results, and audit trail")}</small></span>
          <span className="recalc-arrow">→</span>
        </button>
      )}
      <footer><span>qPCR Analysis Studio · {l("仅供科研使用", "Research use only")}</span><span>{l("原始数据仅在当前浏览器中处理", "Raw data are processed only in this browser")}</span></footer>
    </main>
  );
}
