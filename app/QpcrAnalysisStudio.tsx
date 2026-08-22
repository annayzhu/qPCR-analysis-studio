"use client";

import { useMemo, useRef, useState } from "react";
import type {
  AnalysisSettings,
  AlignmentDispositionLog,
  AlignmentIssueType,
  CanonicalDataset,
  CanonicalField,
  EditLog,
  ExclusionLog,
  ImportedSource,
  LayoutOperationLog,
  ReplicateQc,
  WellRecord,
} from "@/packages/schemas/src";
import { normalizeWell } from "@/packages/schemas/src";
import {
  assessDatasetAlignment,
  assessImportReadiness,
  buildCanonicalDataset,
  getAnalysisBlockingError,
  getUnresolvedAlignmentIssues,
  parseBrowserFile,
  validateQpcrInputTemplate,
} from "@/packages/importers/src";
import {
  buildQcWorkspaceState,
  calculateRelativeQuantification,
  previewLayoutTransfer,
  restoreWellsToBaseline,
  setWellExclusion,
  transferLayoutAnnotations,
  updateWellFields,
} from "@/packages/qpcr-core/src";
import ImportManager from "./components/ImportManager";
import MeltAnalysis from "./components/MeltAnalysis";
import ResultExplorer from "./components/ResultExplorer";
import { localizeRuntimeMessage, useLanguage } from "./i18n";

type WorkspaceView = "overview" | "plate" | "results";
type ResultSection = "quantification" | "melt";
type DraftSnapshot = {
  wells: WellRecord[];
  editLogs: EditLog[];
  exclusionLogs: ExclusionLog[];
  operationLogs: LayoutOperationLog[];
  dispositionLogs: AlignmentDispositionLog[];
  dispositions: Record<string, AlignmentIssueType>;
};

const VIEW_ITEMS: WorkspaceView[] = ["overview", "plate", "results"];

function formatNumber(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function singleWellCqDisplay(well: WellRecord, l: Localizer): string {
  if (well.cqStatus === "detected" && well.cq !== null) return formatNumber(well.cq, 3);
  if (well.cqStatus === "not-detected") return l("未检出", "Not detected");
  if (well.cqStatus === "invalid") return l("无效值", "Invalid value");
  if (well.cqStatus === "not-applicable") return l("不适用", "Not applicable");
  return l("未提供", "Not provided");
}

function targetColor(target: string): string {
  const palette = ["#198a80", "#b97235", "#516ca8", "#8b659d", "#b55566", "#397d9a", "#6b8751"];
  let hash = 0;
  for (const char of target) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return target ? palette[Math.abs(hash) % palette.length] : "#cbd1ce";
}

function makeLayoutOperationLog(
  operation: LayoutOperationLog["operation"],
  sourceWellRecordIds: string[],
  destinationWellRecordIds: string[],
  reason: string,
  changes: EditLog[] = [],
  previousSnapshot = "",
  newSnapshot = "",
): LayoutOperationLog {
  const timestamp = new Date().toISOString();
  return {
    id: `layout-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    operation,
    sourceWellRecordIds,
    destinationWellRecordIds,
    changes,
    previousSnapshot,
    newSnapshot,
    reason,
    timestamp,
  };
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

type Localizer = (zh: string, en: string) => string;

function warningLabel(code: string, l: Localizer): string {
  const labels: Record<string, [string, string]> = {
    CQ_RANGE_HIGH: ["Cq 复孔极差偏高", "High replicate Cq range"],
    TM_RANGE_HIGH: ["Tm1 复孔极差偏高", "High replicate Tm1 range"],
    REPLICATE_ID_INCOMPLETE: ["复孔编号不完整或重复", "Incomplete or duplicate replicate IDs"],
    SECONDARY_MELT_PEAK: ["检测到第二熔解峰", "Secondary melt peak detected"],
    EXCLUDED_OR_NON_DETECTED: ["排除或未检出", "Excluded or not detected"],
    INVALID_CQ: ["Cq 值无效", "Invalid Cq value"],
    INSTRUMENT_FLAG: ["仪器状态提醒", "Instrument status warning"],
    UNKNOWN_MELT_GROUP: ["未知熔解分组", "Unknown melt group"],
    TM_SHIFT_FROM_TARGET_MEDIAN: ["Tm 偏离目标中位数", "Tm shifted from target median"],
  };
  const label = labels[code];
  return label ? l(...label) : code;
}

function warningMessage(code: string, well: WellRecord, group: ReplicateQc | undefined, l: Localizer): string {
  const importedFlag = well.qcFlags.find((flag) => flag.code === code);
  if (code === "CQ_RANGE_HIGH") {
    const suspect = group?.suspectWell === well.well;
    return l(
      `该复孔组 Cq 极差为 ${formatNumber(group?.cqRange ?? null, 3)}，超过 0.5${suspect ? "；此孔距离组内中位数最远" : ""}。`,
      `This replicate group has a Cq range of ${formatNumber(group?.cqRange ?? null, 3)}, above 0.5${suspect ? "; this well is farthest from the group median" : ""}.`,
    );
  }
  if (code === "TM_RANGE_HIGH") {
    return l(
      `该复孔组 Tm1 极差为 ${formatNumber(group?.tm1Range ?? null, 3)}，超过 0.5。`,
      `This replicate group has a Tm1 range of ${formatNumber(group?.tm1Range ?? null, 3)}, above 0.5.`,
    );
  }
  if (code === "REPLICATE_ID_INCOMPLETE") {
    return l(
      "该组的显式复孔编号存在空缺、重复或未从 1 连续编号；请在布局修正后重算。",
      "Explicit replicate identifiers in this group are missing, duplicated, or not consecutive from 1. Correct the layout and recalculate.",
    );
  }
  if (code === "SECONDARY_MELT_PEAK") {
    if (well.tm2 !== null) {
      return l(`该孔检测到第二熔解峰，Tm2 = ${formatNumber(well.tm2, 2)}。`, `A secondary melt peak was detected in this well (Tm2 = ${formatNumber(well.tm2, 2)}).`);
    }
    return l(
      `该复孔组有 ${group?.secondaryPeakCount ?? 1} 个孔检测到第二熔解峰；当前选中孔不是第二峰所在孔。`,
      `${group?.secondaryPeakCount ?? 1} well(s) in this replicate group have a secondary melt peak; the selected well is not one of them.`,
    );
  }
  if (code === "EXCLUDED_OR_NON_DETECTED") {
    const zhReasons = [
      well.instrumentOmit ? "仪器标记排除" : "",
      well.userExcluded ? `人工排除${well.exclusionReason ? `：${well.exclusionReason}` : ""}` : "",
      well.cqStatus === "not-detected" ? `Cq 未检出${well.cqReason ? `：${well.cqReason}` : ""}` : "",
    ].filter(Boolean);
    const enReasons = [
      well.instrumentOmit ? "excluded by the instrument" : "",
      well.userExcluded ? `excluded by the user${well.exclusionReason ? `: ${well.exclusionReason}` : ""}` : "",
      well.cqStatus === "not-detected" ? "Cq not detected" : "",
    ].filter(Boolean);
    return l(zhReasons.join("；") || "该复孔组包含排除或未检出的反应。", enReasons.join("; ") || "This replicate group contains an excluded or non-detected reaction.");
  }
  if (code === "INVALID_CQ") {
    const rawValue = well.cqReason.split(":").slice(1).join(":").trim();
    return l(importedFlag?.message || well.cqReason || "导入的 Cq 值无效。", `The imported Cq value is invalid${rawValue ? `: ${rawValue}` : "."}`);
  }
  if (code === "INSTRUMENT_FLAG") {
    return l(importedFlag?.message || `仪器状态: ${well.instrumentFlag || "需复核"}`, `Instrument status: ${well.instrumentFlag || "review required"}.`);
  }
  return l(importedFlag?.message || code, importedFlag ? `${warningLabel(code, l)}.` : code);
}

function warningSource(code: string, well: WellRecord, l: Localizer): string {
  const source = well.qcFlags.find((flag) => flag.code === code)?.source;
  if (source === "instrument" || well.instrumentOmit) return l("仪器", "Instrument");
  if (source === "import") return l("导入检查", "Import check");
  if (source === "user" || well.userExcluded) return l("人工操作", "User action");
  if (source === "melt" || code.includes("MELT") || code.startsWith("TM_")) return l("熔解分析", "Melt analysis");
  return l("复孔 QC", "Replicate QC");
}

function auditLogTitle(
  log: EditLog | ExclusionLog | LayoutOperationLog | AlignmentDispositionLog,
  l: Localizer,
): string {
  if ("field" in log) return l(`编辑 ${log.field}`, `Edit ${log.field}`);
  if ("operation" in log) {
    const labels: Record<LayoutOperationLog["operation"], [string, string]> = {
      "batch-edit": ["批量编辑布局", "Batch edit layout"],
      paste: ["粘贴布局", "Paste layout"],
      clear: ["清空布局", "Clear layout"],
      move: ["移动布局", "Move layout"],
      copy: ["复制布局", "Copy layout"],
      swap: ["交换布局", "Swap layout"],
      "restore-selected": ["恢复选中孔", "Restore selected wells"],
      "restore-plate": ["恢复整板", "Restore whole plate"],
      apply: ["应用并重算", "Apply and recalculate"],
    };
    return l(...labels[log.operation]);
  }
  if ("issueType" in log) return l("确认对齐状态", "Confirm alignment state");
  return log.action === "exclude" ? l("排除反应孔", "Exclude well") : l("恢复反应孔", "Restore well");
}

function auditLogDescription(
  log: EditLog | ExclusionLog | LayoutOperationLog | AlignmentDispositionLog,
  l: Localizer,
): string {
  if ("field" in log) return `${log.previousValue ?? l("(空)", "(blank)")} → ${log.newValue ?? l("(空)", "(blank)")}`;
  if ("operation" in log) {
    const mapping = log.destinationWellRecordIds.length
      ? l(`${log.sourceWellRecordIds.length} 个源孔 → ${log.destinationWellRecordIds.length} 个目标孔`, `${log.sourceWellRecordIds.length} source well(s) → ${log.destinationWellRecordIds.length} destination well(s)`)
      : "";
    return [log.reason, mapping].filter(Boolean).join(" · ");
  }
  return log.reason;
}

function auditLogReference(
  log: EditLog | ExclusionLog | LayoutOperationLog | AlignmentDispositionLog,
  wells: WellRecord[],
): string {
  const wellById = new Map(wells.map((well) => [well.id, well]));
  const label = (wellId: string) => {
    const well = wellById.get(wellId);
    return well ? `${well.plateId} ${well.well}` : wellId;
  };
  if ("operation" in log) {
    return [...log.sourceWellRecordIds, ...log.destinationWellRecordIds].slice(0, 4).map(label).join(", ") || "layout snapshot";
  }
  return label(log.wellRecordId);
}

function layoutAnnotationSnapshot(wells: WellRecord[], wellIds: string[]): string {
  const ids = new Set(wellIds);
  return JSON.stringify(wells.filter((well) => ids.has(well.id)).map((well) => ({
    wellRecordId: well.id,
    sampleName: well.sampleName,
    targetName: well.targetName,
    taskType: well.taskType,
    replicate: well.replicate,
    userExcluded: well.userExcluded,
  })));
}

function auditWellReferences(wellIds: string[], wells: WellRecord[]): string {
  const wellById = new Map(wells.map((well) => [well.id, well]));
  return wellIds.map((wellId) => {
    const well = wellById.get(wellId);
    return well ? `${well.plateId} ${well.well}` : wellId;
  }).join("; ");
}

export default function QpcrAnalysisStudio() {
  const { language, setLanguage, l } = useLanguage();
  const resultInput = useRef<HTMLInputElement>(null);
  const layoutInput = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<ImportedSource[]>([]);
  const [dataset, setDataset] = useState<CanonicalDataset | null>(null);
  const [importedWells, setImportedWells] = useState<WellRecord[]>([]);
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
  const [pendingOperationLogs, setPendingOperationLogs] = useState<LayoutOperationLog[]>([]);
  const [pendingDispositionLogs, setPendingDispositionLogs] = useState<AlignmentDispositionLog[]>([]);
  const [alignmentDispositions, setAlignmentDispositions] = useState<Record<string, AlignmentIssueType>>({});
  const [auditLogs, setAuditLogs] = useState<(EditLog | ExclusionLog | LayoutOperationLog | AlignmentDispositionLog)[]>([]);
  const [batchSample, setBatchSample] = useState("");
  const [batchTarget, setBatchTarget] = useState("");
  const [batchTask, setBatchTask] = useState("");
  const [batchReplicate, setBatchReplicate] = useState("");
  const [pasteBlock, setPasteBlock] = useState("");
  const [pasteOverwriteConfirmed, setPasteOverwriteConfirmed] = useState(false);
  const [exclusionReason, setExclusionReason] = useState("");
  const [referenceTargets, setReferenceTargets] = useState<string[]>([]);
  const [calibrator, setCalibrator] = useState("");
  const [displaySamples, setDisplaySamples] = useState<string[]>([]);
  const [displayTargets, setDisplayTargets] = useState<string[]>([]);
  const [qcSearch, setQcSearch] = useState("");
  const [qcIssueOnly, setQcIssueOnly] = useState(false);
  const [alignmentReviewPending, setAlignmentReviewPending] = useState(false);
  const [draftHistory, setDraftHistory] = useState<DraftSnapshot[]>([]);
  const [transferDestination, setTransferDestination] = useState("");
  const [transferMode, setTransferMode] = useState<"move" | "copy" | "swap">("move");
  const [activePlateId, setActivePlateId] = useState("");
  const [transferDestinationPlateId, setTransferDestinationPlateId] = useState("");

  const readiness = useMemo(() => assessImportReadiness(sources), [sources]);
  const pendingCount = pendingEditLogs.length + pendingExclusionLogs.length + pendingOperationLogs.length + pendingDispositionLogs.length;
  const analysisLocked = alignmentReviewPending || pendingCount > 0;
  const selectedWells = useMemo(() => draftWells.filter((well) => selected.includes(well.id)), [draftWells, selected]);
  const plateIds = useMemo(() => [...new Set(draftWells.map((well) => well.plateId))], [draftWells]);
  const activePlateWells = useMemo(
    () => draftWells.filter((well) => well.plateId === (activePlateId || plateIds[0])),
    [activePlateId, draftWells, plateIds],
  );
  const importedWellById = useMemo(() => new Map(importedWells.map((well) => [well.id, well])), [importedWells]);
  const selectedRestorableCount = useMemo(() => selectedWells.filter((well) => {
    const baseline = importedWellById.get(well.id);
    return baseline && (
      well.sampleName !== baseline.sampleName ||
      well.targetName !== baseline.targetName ||
      well.taskType !== baseline.taskType ||
      well.replicate !== baseline.replicate ||
      well.userExcluded !== baseline.userExcluded
    );
  }).length, [importedWellById, selectedWells]);
  const appliedQcState = useMemo(() => buildQcWorkspaceState(appliedWells), [appliedWells]);
  const draftQcState = useMemo(() => buildQcWorkspaceState(draftWells), [draftWells]);
  const draftAlignment = useMemo(
    () => dataset
      ? assessDatasetAlignment({ ...dataset, wells: draftWells }, readiness.analysisMode)
      : null,
    [dataset, draftWells, readiness.analysisMode],
  );
  const alignmentIssueById = useMemo(() => {
    const issues = new Map<string, "result-without-annotation" | "annotation-without-result">();
    for (const issue of draftAlignment?.resultWithoutAnnotation ?? []) issues.set(issue.wellId, "result-without-annotation");
    for (const issue of draftAlignment?.annotationWithoutResult ?? []) issues.set(issue.wellId, "annotation-without-result");
    return issues;
  }, [draftAlignment]);
  const unresolvedAlignmentIssueIds = useMemo(
    () => new Set([...alignmentIssueById.keys()].filter((wellId) => !alignmentDispositions[wellId])),
    [alignmentDispositions, alignmentIssueById],
  );
  const qc = appliedQcState.replicateQc;
  const draftQc = draftQcState.replicateQc;
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
  const resultExportWarnings = useMemo(() => [...new Set([
    ...(dataset?.warnings ?? []),
    ...sources.flatMap((source) => source.warnings),
    ...sources.flatMap((source) => source.tables.flatMap((table) => table.warnings)),
    ...sources.flatMap((source) => validateQpcrInputTemplate(source)?.issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => `${issue.code}: ${issue.sourceSheet} row ${issue.sourceRowNumber ?? "-"} ${issue.messageEn}`) ?? []),
    ...appliedWells.flatMap((well) => well.qcFlags.map((flag) => `${flag.code}: ${flag.message}`)),
    ...appliedQcState.replicateQc.flatMap((group) => group.warningCodes.map((code) => `${code}: ${group.plateId} ${group.sampleName} ${group.targetName}`)),
  ])], [appliedQcState.replicateQc, appliedWells, dataset?.warnings, sources]);
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
  const pasteCollisionCount = useMemo(() => {
    const orderedSelected = activePlateWells
      .filter((well) => selected.includes(well.id))
      .sort((a, b) => a.row.localeCompare(b.row) || a.column - b.column);
    return pastePreview.rows.filter((cells, index) => {
      const wellName = pastePreview.hasWellColumn ? normalizeWell(cells[0]) : orderedSelected[index]?.well;
      const destination = wellName ? activePlateWells.find((well) => well.well === wellName) : undefined;
      if (!destination) return false;
      const offset = pastePreview.hasWellColumn ? 1 : 0;
      const [sampleName, targetName, taskType, replicateValue] = cells.slice(offset);
      return Boolean(
        (destination.sampleName || destination.targetName || destination.taskType !== "Unknown" || destination.replicate !== null)
        && (sampleName !== undefined && sampleName !== destination.sampleName
          || targetName !== undefined && targetName !== destination.targetName
          || taskType !== undefined && taskType !== destination.taskType
          || replicateValue !== undefined && Number(replicateValue) !== destination.replicate),
      );
    }).length;
  }, [activePlateWells, pastePreview, selected]);
  const layoutTransferPreview = useMemo(() => {
    const destinationWell = normalizeWell(transferDestination);
    const destinationPlate = transferDestinationPlateId || selectedWells[0]?.plateId;
    const destination = destinationWell
      ? draftWells.find((well) => well.well === destinationWell && (!destinationPlate || well.plateId === destinationPlate))
      : undefined;
    if (!selected.length || !destination) return null;
    return previewLayoutTransfer(draftWells, {
      mode: transferMode,
      sourceWellIds: selected,
      destinationAnchorWellId: destination.id,
    });
  }, [draftWells, selected, selectedWells, transferDestination, transferDestinationPlateId, transferMode]);

  function buildAndApply(sourceList: ImportedSource[]) {
    const built = buildCanonicalDataset(sourceList);
    const nextReadiness = assessImportReadiness(sourceList);
    const alignment = assessDatasetAlignment(built, nextReadiness.analysisMode);
    const blockingError = getAnalysisBlockingError(built, nextReadiness.analysisMode);
    setError(blockingError ?? "");
    setDataset(built);
    setImportedWells(built.wells);
    setDraftWells(built.wells);
    setAppliedWells(built.wells);
    const firstDefined = built.wells.find((well) => well.sampleName || well.targetName);
    setSelected(firstDefined ? [firstDefined.id] : []);
    setSelectionAnchor(firstDefined?.id ?? null);
    setPendingEditLogs([]);
    setPendingExclusionLogs([]);
    setPendingOperationLogs([]);
    setPendingDispositionLogs([]);
    setAlignmentDispositions({});
    setAuditLogs([]);
    setDraftHistory([]);
    setTransferDestination("");
    setActivePlateId(built.wells[0]?.plateId ?? "");
    setTransferDestinationPlateId(built.wells[0]?.plateId ?? "");
    setNeedsRebuild(false);
    setAlignmentReviewPending(alignment.status === "needs-correction" || Boolean(blockingError));
    setView(alignment.status === "needs-correction" || blockingError ? "plate" : "overview");
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

  function resetBuiltAnalysis() {
    setDataset(null);
    setImportedWells([]);
    setDraftWells([]);
    setAppliedWells([]);
    setAlignmentReviewPending(false);
    setDraftHistory([]);
    setPendingOperationLogs([]);
    setPendingDispositionLogs([]);
    setAlignmentDispositions({});
    setNeedsRebuild(false);
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
      else resetBuiltAnalysis();
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
    else resetBuiltAnalysis();
  }

  function rebuildCurrentSources() {
    const currentReadiness = assessImportReadiness(sources);
    if (currentReadiness.canAnalyze) buildAndApply(sources);
  }

  function clearProject() {
    setSources([]);
    setDataset(null);
    setImportedWells([]);
    setDraftWells([]);
    setAppliedWells([]);
    setSelected([]);
    setSelectionAnchor(null);
    setAuditLogs([]);
    setPendingEditLogs([]);
    setPendingExclusionLogs([]);
    setPendingOperationLogs([]);
    setPendingDispositionLogs([]);
    setAlignmentDispositions({});
    setDraftHistory([]);
    setAlignmentReviewPending(false);
    setTransferDestination("");
    setActivePlateId("");
    setTransferDestinationPlateId("");
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
      .filter((well) => well.plateId === anchor.plateId && well.row.charCodeAt(0) >= minRow && well.row.charCodeAt(0) <= maxRow && well.column >= minColumn && well.column <= maxColumn)
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
    setSelected(activePlateWells.filter((well) => values.has(well[field])).map((well) => well.id));
  }

  function rememberDraft() {
    const snapshot: DraftSnapshot = {
      wells: draftWells,
      editLogs: pendingEditLogs,
      exclusionLogs: pendingExclusionLogs,
      operationLogs: pendingOperationLogs,
      dispositionLogs: pendingDispositionLogs,
      dispositions: alignmentDispositions,
    };
    setDraftHistory((current) => [...current.slice(-19), snapshot]);
  }

  function undoLastDraftChange() {
    const snapshot = draftHistory[draftHistory.length - 1];
    if (!snapshot) return;
    setDraftWells(snapshot.wells);
    setPendingEditLogs(snapshot.editLogs);
    setPendingExclusionLogs(snapshot.exclusionLogs);
    setPendingOperationLogs(snapshot.operationLogs);
    setPendingDispositionLogs(snapshot.dispositionLogs);
    setAlignmentDispositions(snapshot.dispositions);
    setDraftHistory((current) => current.slice(0, -1));
    setError("");
  }

  function invalidateAlignmentDispositions(wellIds: string[]) {
    const ids = new Set(wellIds);
    setAlignmentDispositions((current) => {
      const next = { ...current };
      for (const wellId of ids) delete next[wellId];
      return next;
    });
    setPendingDispositionLogs((current) => current.filter((log) => !ids.has(log.wellRecordId)));
  }

  function applyBatchEdit() {
    if (!selected.length) return;
    const changes: Partial<Pick<WellRecord, "sampleName" | "targetName" | "taskType" | "replicate">> = {};
    if (batchSample.trim()) changes.sampleName = batchSample.trim();
    if (batchTarget.trim()) changes.targetName = batchTarget.trim();
    if (batchTask.trim()) changes.taskType = batchTask.trim();
    if (batchReplicate.trim()) {
      const replicate = Number(batchReplicate);
      if (Number.isInteger(replicate) && replicate > 0) changes.replicate = replicate;
    }
    if (!Object.keys(changes).length) return;
    rememberDraft();
    invalidateAlignmentDispositions(selected);
    const updated = updateWellFields(draftWells, selected, changes);
    setDraftWells(updated.wells);
    setPendingEditLogs((current) => [...current, ...updated.logs]);
    setPendingOperationLogs((current) => [...current, makeLayoutOperationLog("batch-edit", selected, selected, l("批量修改板布局字段", "Batch edit plate-layout fields"), updated.logs)]);
    setBatchSample("");
    setBatchTarget("");
    setBatchTask("");
    setBatchReplicate("");
  }

  function applyPastedBlock() {
    if (!pastePreview.rows.length) return;
    if (pasteCollisionCount > 0 && !pasteOverwriteConfirmed) return;
    rememberDraft();
    const orderedSelected = draftWells
      .filter((well) => selected.includes(well.id))
      .sort((a, b) => a.row.localeCompare(b.row) || a.column - b.column);
    let nextWells = draftWells;
    const logs: EditLog[] = [];
    const pastedWellIds: string[] = [];
    pastePreview.rows.forEach((cells, index) => {
      const wellName = pastePreview.hasWellColumn ? normalizeWell(cells[0]) : orderedSelected[index]?.well;
      if (!wellName) return;
      const destination = nextWells.find((well) => well.well === wellName && well.plateId === (activePlateId || plateIds[0]));
      if (!destination) return;
      const offset = pastePreview.hasWellColumn ? 1 : 0;
      const [sampleName, targetName, taskType, replicateValue] = cells.slice(offset);
      if (sampleName === undefined) return;
      const updated = updateWellFields(nextWells, [destination.id], {
        sampleName,
        ...(targetName !== undefined ? { targetName } : {}),
        ...(taskType !== undefined ? { taskType } : {}),
        ...(replicateValue !== undefined && Number.isInteger(Number(replicateValue)) && Number(replicateValue) > 0 ? { replicate: Number(replicateValue) } : {}),
      });
      nextWells = updated.wells;
      logs.push(...updated.logs);
      pastedWellIds.push(destination.id);
    });
    setDraftWells(nextWells);
    invalidateAlignmentDispositions(pastedWellIds);
    setPendingEditLogs((current) => [...current, ...logs]);
    setPendingOperationLogs((current) => [...current, makeLayoutOperationLog("paste", [], pastedWellIds, l("粘贴外部板布局字段", "Paste external plate-layout fields"), logs)]);
    setPasteBlock("");
    setPasteOverwriteConfirmed(false);
  }

  function setExclusion(excluded: boolean, ids = selected) {
    if (!ids.length) return;
    rememberDraft();
    invalidateAlignmentDispositions(ids);
    const updated = setWellExclusion(
      draftWells,
      ids,
      excluded,
      exclusionReason.trim() || l("技术复孔异常（人工判定）", "Technical replicate issue (manual decision)"),
    );
    setDraftWells(updated.wells);
    setPendingExclusionLogs((current) => [...current, ...updated.logs]);
  }

  function restoreSelectedWells() {
    if (!selected.length) return;
    rememberDraft();
    invalidateAlignmentDispositions(selected);
    const restored = restoreWellsToBaseline(
      draftWells,
      importedWells,
      selected,
      l("恢复为本次导入值", "Restore values from this import"),
    );
    setDraftWells(restored.wells);
    setPendingEditLogs((current) => [...current, ...restored.editLogs]);
    setPendingExclusionLogs((current) => [...current, ...restored.exclusionLogs]);
    setPendingOperationLogs((current) => [...current, makeLayoutOperationLog("restore-selected", selected, selected, l("恢复选中孔的导入布局", "Restore selected imported layout"), restored.editLogs)]);
    setBatchSample("");
    setBatchTarget("");
    setBatchTask("");
    setBatchReplicate("");
    setPasteBlock("");
    setExclusionReason("");
  }

  function clearSelectedAnnotations() {
    if (!selected.length) return;
    rememberDraft();
    invalidateAlignmentDispositions(selected);
    const updated = updateWellFields(draftWells, selected, {
      sampleName: "",
      targetName: "",
      taskType: "Unknown",
      replicate: null,
    });
    setDraftWells(updated.wells);
    setPendingEditLogs((current) => [...current, ...updated.logs]);
    setPendingOperationLogs((current) => [...current, makeLayoutOperationLog("clear", selected, [], l("清空选中孔布局；原始测量保留", "Clear selected layout; preserve raw measurements"), updated.logs)]);
  }

  function restoreWholePlate() {
    if (!draftWells.length) return;
    const currentPlateId = activePlateId || plateIds[0];
    const currentPlateWellIds = draftWells.filter((well) => well.plateId === currentPlateId).map((well) => well.id);
    if (!currentPlateWellIds.length) return;
    rememberDraft();
    invalidateAlignmentDispositions(currentPlateWellIds);
    const restored = restoreWellsToBaseline(
      draftWells,
      importedWells,
      currentPlateWellIds,
      l("整板恢复为本次导入值", "Restore whole plate to imported values"),
    );
    setDraftWells(restored.wells);
    setPendingEditLogs((current) => [...current, ...restored.editLogs]);
    setPendingExclusionLogs((current) => [...current, ...restored.exclusionLogs]);
    setPendingOperationLogs((current) => [...current, makeLayoutOperationLog("restore-plate", currentPlateWellIds, currentPlateWellIds, l("当前板恢复为导入布局", "Restore active plate to imported layout"), restored.editLogs)]);
  }

  function applyLayoutTransfer() {
    if (!layoutTransferPreview?.ok) return;
    const destinationWell = normalizeWell(transferDestination);
    const destinationPlate = transferDestinationPlateId || selectedWells[0]?.plateId;
    const destination = draftWells.find((well) => well.well === destinationWell && well.plateId === destinationPlate);
    if (!destination) return;
    rememberDraft();
    const transferred = transferLayoutAnnotations(draftWells, {
      mode: transferMode,
      sourceWellIds: selected,
      destinationAnchorWellId: destination.id,
    });
    if (!transferred.ok) return;
    invalidateAlignmentDispositions([...selected, ...transferred.mappings.map((mapping) => mapping.destinationWellId)]);
    setDraftWells(transferred.wells);
    setPendingEditLogs((current) => [...current, ...transferred.logs]);
    setPendingOperationLogs((current) => [...current, makeLayoutOperationLog(transferMode, selected, transferred.mappings.map((mapping) => mapping.destinationWellId), l("按相对几何位置修正布局", "Correct layout by relative geometry"), transferred.logs)]);
    setSelected(transferred.mappings.map((mapping) => mapping.destinationWellId));
    setSelectionAnchor(transferred.mappings[0]?.destinationWellId ?? null);
    setTransferDestination("");
  }

  function confirmSelectedAlignmentIssues() {
    const reviewed = selected.flatMap((wellId) => {
      const issueType = alignmentIssueById.get(wellId);
      return issueType && !alignmentDispositions[wellId] ? [{ wellId, issueType }] : [];
    });
    if (!reviewed.length) return;
    rememberDraft();
    const timestamp = new Date().toISOString();
    setAlignmentDispositions((current) => {
      const next = { ...current };
      for (const item of reviewed) next[item.wellId] = item.issueType;
      return next;
    });
    setPendingDispositionLogs((current) => [...current, ...reviewed.map((item) => ({
      id: `alignment-${timestamp}-${item.wellId}`,
      wellRecordId: item.wellId,
      issueType: item.issueType,
      action: "confirm-reviewed" as const,
      reason: item.issueType === "result-without-annotation"
        ? l("确认该结果孔保持无布局注释", "Confirm result-bearing well remains without layout annotation")
        : l("确认该已定义孔没有对应结果", "Confirm annotated well has no matching result"),
      timestamp,
    }))]);
    setError("");
  }

  function selectAlignmentIssueGroup(issues: Array<{ wellId: string; plateId: string }>) {
    if (!issues.length) return;
    const plateId = issues[0].plateId;
    const wellIds = issues.filter((issue) => issue.plateId === plateId).map((issue) => issue.wellId);
    setActivePlateId(plateId);
    setTransferDestinationPlateId(plateId);
    setSelected(wellIds);
    setSelectionAnchor(wellIds[0] ?? null);
  }

  async function exportCorrectedLayout() {
    if (!draftWells.length) return;
    const XLSX = (await import("xlsx-js-style")).default;
    const layoutRows = draftWells.map((well) => ({
      Plate: well.plateId,
      Well: well.well,
      Row: well.row,
      Column: well.column,
      "Sample Name": well.sampleName,
      "Target Name": well.targetName,
      "Reaction Role": well.taskType,
      Replicate: well.replicate,
      "User Excluded": well.userExcluded ? "Yes" : "No",
      "Exclusion Reason": well.exclusionReason,
    }));
    const metadataRows = [
      ["Artifact", "Corrected plate layout"],
      ["Exported at", new Date().toISOString()],
      ["Source files", sources.map((source) => source.fileName).join("; ")],
      ["Raw measurement policy", "Cp/Cq/Ct, Tm and instrument flags remain on their original physical wells"],
    ];
    const pendingAuditLogs = [...pendingEditLogs, ...pendingExclusionLogs, ...pendingOperationLogs, ...pendingDispositionLogs];
    const auditRows = [
      ...auditLogs.map((log) => ({ log, status: l("已应用", "Applied") })),
      ...pendingAuditLogs.map((log) => ({ log, status: l("待应用", "Pending") })),
    ].map(({ log, status }) => ({
      Timestamp: log.timestamp,
      Status: status,
      Action: auditLogTitle(log, l),
      Wells: auditLogReference(log, draftWells),
      "Source wells": "operation" in log ? auditWellReferences(log.sourceWellRecordIds, draftWells) : auditLogReference(log, draftWells),
      "Destination wells": "operation" in log ? auditWellReferences(log.destinationWellRecordIds, draftWells) : auditLogReference(log, draftWells),
      Field: "field" in log ? log.field : "",
      "Previous value": "field" in log ? log.previousValue : "previousState" in log ? String(log.previousState) : "operation" in log ? log.changes.map((change) => `${change.wellRecordId}.${change.field}=${change.previousValue ?? ""}`).join("; ") || log.previousSnapshot : "",
      "New value": "field" in log ? log.newValue : "newState" in log ? String(log.newState) : "operation" in log ? log.changes.map((change) => `${change.wellRecordId}.${change.field}=${change.newValue ?? ""}`).join("; ") || log.newSnapshot : "",
      Reason: auditLogDescription(log, l),
    }));
    const workbook = XLSX.utils.book_new();
    const layoutSheet = XLSX.utils.json_to_sheet(layoutRows);
    layoutSheet["!cols"] = [{ wch: 18 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 28 }, { wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 14 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(workbook, layoutSheet, "Corrected_Layout");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metadataRows), "Provenance");
    if (auditRows.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(auditRows), "Correction_Audit");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `qpcr_corrected_plate_layout_${new Date().toISOString().slice(0, 10)}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function recalculate() {
    if (!dataset) return;
    const candidateDataset = { ...dataset, wells: draftWells };
    const candidateAlignment = assessDatasetAlignment(candidateDataset, readiness.analysisMode);
    const unresolvedAlignmentIssues = getUnresolvedAlignmentIssues(candidateAlignment, Object.keys(alignmentDispositions));
    if (unresolvedAlignmentIssues.length) {
      setError("仍有板布局对齐提示未处理。请修正孔位，或选中后确认该状态。");
      setAlignmentReviewPending(true);
      setSelected(unresolvedAlignmentIssues.map((issue) => issue.wellId));
      setView("plate");
      return;
    }
    const blockingError = getAnalysisBlockingError(candidateDataset, readiness.analysisMode);
    if (blockingError) {
      setError(blockingError);
      setAlignmentReviewPending(true);
      setView("plate");
      return;
    }
    const nextSamples = [...new Set(draftWells.map((well) => well.sampleName).filter(Boolean))].sort();
    const nextTargets = [...new Set(draftWells.map((well) => well.targetName).filter(Boolean))].sort();
    const hadAllSamplesSelected = samples.length > 0 && samples.every((sample) => displaySamples.includes(sample));
    const hadAllTargetsSelected = targets.length > 0 && targets.every((target) => displayTargets.includes(target));
    setAppliedWells(draftWells);
    setDataset((current) => current ? { ...current, wells: draftWells } : current);
    const affectedWellIds = [...new Set([
      ...pendingEditLogs.map((log) => log.wellRecordId),
      ...pendingExclusionLogs.map((log) => log.wellRecordId),
      ...pendingDispositionLogs.map((log) => log.wellRecordId),
      ...pendingOperationLogs.flatMap((log) => [...log.sourceWellRecordIds, ...log.destinationWellRecordIds]),
    ])];
    const applyLog = makeLayoutOperationLog(
      "apply",
      affectedWellIds,
      affectedWellIds,
      l("应用布局快照并重算 QC 与结果", "Apply layout snapshot and recalculate QC and results"),
      pendingEditLogs,
      layoutAnnotationSnapshot(appliedWells, affectedWellIds),
      layoutAnnotationSnapshot(draftWells, affectedWellIds),
    );
    setAuditLogs((current) => [...current, ...pendingEditLogs, ...pendingExclusionLogs, ...pendingOperationLogs, ...pendingDispositionLogs, applyLog]);
    setPendingEditLogs([]);
    setPendingExclusionLogs([]);
    setPendingOperationLogs([]);
    setPendingDispositionLogs([]);
    setDraftHistory([]);
    setAlignmentReviewPending(false);
    setError("");
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
    if (analysisLocked && nextView !== "plate") return;
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
  const activeNamedReactionCount = activePlateWells.filter((well) => well.sampleName || well.targetName).length;
  const qcIssueCount = qc.filter((row) => row.warningCodes.length).length;
  const qcWellIssueCount = appliedQcState.specificWarnings.size;
  const selectedQcNotices = selectedWells.flatMap((well) => {
    const specificCodes = draftQcState.specificWarnings.get(well.well) ?? new Set<string>();
    const groupCodes = draftQcState.groupWarnings.get(well.well) ?? new Set<string>();
    return [...new Set([...specificCodes, ...groupCodes])].map((code) => {
      const group = draftQc.find((row) => row.wells.includes(well.well) && row.warningCodes.includes(code));
      const isSpecific = specificCodes.has(code);
      const isGroup = groupCodes.has(code);
      return {
        code,
        well,
        group,
        scope: isSpecific && isGroup
          ? l("孔级 + 复孔组", "Well + replicate group")
          : isSpecific
            ? l("孔级", "Well level")
            : l("复孔组", "Replicate group"),
      };
    });
  });
  const selectedAlignmentNotices = selectedWells.flatMap((well) => {
    const issue = alignmentIssueById.get(well.id);
    return issue ? [{ well, issue, reviewed: Boolean(alignmentDispositions[well.id]) }] : [];
  });
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
            alignmentReviewRequired={alignmentReviewPending}
            resultWithoutAnnotationCount={draftAlignment?.resultWithoutAnnotation.length ?? 0}
            annotationWithoutResultCount={draftAlignment?.annotationWithoutResult.length ?? 0}
            onPickResults={() => resultInput.current?.click()}
            onPickLayout={() => layoutInput.current?.click()}
            onImportFiles={importFiles}
            onRemoveSource={removeSource}
            onUpdateSelectedTable={updateSelectedTable}
            onUpdateMapping={updateMapping}
            onRebuild={rebuildCurrentSources}
            onContinue={() => { setDataManagerOpen(false); setView(alignmentReviewPending ? "plate" : "overview"); }}
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
            <div className={analysisLocked ? "analysis-state pending" : "analysis-state"}><span />{alignmentReviewPending ? l("板布局待复核，结果已锁定", "Plate layout review required; results locked") : pendingCount > 0 ? l(`${pendingCount} 项修改待重算`, `${pendingCount} change(s) awaiting recalculation`) : l("概览、板布局与结果已同步", "Overview, plate, and results synchronized")}</div>
          </section>

          <nav className="workspace-tabs" aria-label={l("分析工作区", "Analysis workspace")}>
            {VIEW_ITEMS.map((value) => {
              const [label, english] = viewLabels[value];
              return (
              <button
                key={value}
                type="button"
                className={view === value ? "active" : ""}
                disabled={analysisLocked && value !== "plate"}
                title={analysisLocked && value !== "plate" ? l("请先复核板布局、应用修改并重算", "Review the plate layout, apply changes, and recalculate first") : undefined}
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
                    `${dataset.plate.plateFormat} 孔板中定义 ${namedReactionCount} 个反应；当前 ${qcIssueCount} 个复孔组需要复核，${qcWellIssueCount} 个孔有孔级提醒${secondaryPeakCount ? `，其中 ${secondaryPeakCount} 个孔检测到第二熔解峰` : ""}。`,
                    `${namedReactionCount} reactions are defined on the ${dataset.plate.plateFormat}-well plate; ${qcIssueCount} replicate group(s) require review and ${qcWellIssueCount} well(s) have well-level alerts${secondaryPeakCount ? `, including secondary melt peaks in ${secondaryPeakCount} well(s)` : ""}.`,
                  )}</p></div>
                  <button className="quiet-button bordered" type="button" onClick={() => setDataManagerOpen(true)}>{l("管理导入文件", "Manage imported files")}</button>
                </div>
                <div className="overview-qc-grid">
                  <article className="qc-workbench">
                    <div className="card-heading compact-card-heading">
                      <div><p className="eyebrow">REPLICATE QC</p><h3>{l("技术复孔", "Technical replicates")}</h3><div className="qc-scope-counts"><span>{l(`复孔组 ${qcIssueCount}`, `${qcIssueCount} replicate group(s)`)}</span><span>{l(`孔级 ${qcWellIssueCount}`, `${qcWellIssueCount} well alert(s)`)}</span></div></div>
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
                          <article key={log.id}><span className="timeline-dot" /><div><b>{auditLogTitle(log, l)}</b><p>{auditLogDescription(log, l)}</p><small>{auditLogReference(log, draftWells)} · {new Date(log.timestamp).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</small></div></article>
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
                  <div><p className="eyebrow">PLATE WORKSPACE</p><h2>{l(`${dataset.plate.plateFormat} 孔板 · ${activeNamedReactionCount} 个已定义反应`, `${dataset.plate.plateFormat}-well plate · ${activeNamedReactionCount} defined reactions`)}</h2>{plateIds.length > 1 && <label className="active-plate-selector">{l("当前板", "Active plate")}<select value={activePlateId || plateIds[0]} onChange={(event) => { setActivePlateId(event.target.value); setTransferDestinationPlateId(event.target.value); setSelected([]); setSelectionAnchor(null); }}>{plateIds.map((plateId) => <option key={plateId} value={plateId}>{plateId}</option>)}</select></label>}</div>
                  <div className="legend"><span><i className="dot selected-dot" />{l("已选", "Selected")}</span><span><i className="dot alignment-warning-dot" />{l("布局对齐提示", "Layout alignment")}</span><span><i className="dot group-warning-dot" />{l("复孔组提示", "Replicate-group warning")}</span><span><i className="dot warning-dot" />{l("孔级提示", "Well-level alert")}</span><span><i className="dot excluded-dot" />{l("已排除", "Excluded")}</span></div>
                </div>
                {dataset.warnings.map((warning) => <div className="notice" key={warning}>{localizeRuntimeMessage(warning, language)}</div>)}
                {error && <div className="notice error">{localizeRuntimeMessage(error, language)}</div>}
                {draftAlignment && (draftAlignment.status === "needs-correction" || draftAlignment.incompleteReplicateGroups.length > 0) && (
                  <div className="alignment-diagnostics" role="alert">
                    <div><span>{l("布局对齐检查", "Layout alignment check")}</span><strong>{unresolvedAlignmentIssueIds.size ? l(`仍有 ${unresolvedAlignmentIssueIds.size} 个孔需要人工复核`, `${unresolvedAlignmentIssueIds.size} well(s) still require review`) : l("剩余差异均已人工确认", "All remaining differences were reviewed")}</strong><p>{l("Cp 始终留在仪器物理孔；这里只移动或修改 Sample、Target、反应角色和复孔编号。", "Cp always remains on its physical instrument well. Only Sample, Target, reaction-role, and replicate annotations are moved or edited here.")}</p></div>
                    <div className="alignment-diagnostic-actions">
                      <button type="button" onClick={() => selectAlignmentIssueGroup(draftAlignment.resultWithoutAnnotation)} disabled={!draftAlignment.resultWithoutAnnotation.length}><b>{draftAlignment.resultWithoutAnnotation.length}</b><span>{l("有 Cp、无布局", "Cp without layout")}</span></button>
                      <button type="button" onClick={() => selectAlignmentIssueGroup(draftAlignment.annotationWithoutResult)} disabled={!draftAlignment.annotationWithoutResult.length}><b>{draftAlignment.annotationWithoutResult.length}</b><span>{l("有布局、无 Cp", "Layout without Cp")}</span></button>
                      <button type="button" onClick={() => setDataManagerOpen(true)} disabled={!draftAlignment.plateIdentityConflicts.length} title={draftAlignment.plateIdentityConflicts.join("\n")}><b>{draftAlignment.plateIdentityConflicts.length}</b><span>{l("板身份冲突", "Plate identity conflict")}</span></button>
                      <button type="button" onClick={() => selectAlignmentIssueGroup(draftAlignment.duplicateDestinations)} disabled={!draftAlignment.duplicateDestinations.length}><b>{draftAlignment.duplicateDestinations.length}</b><span>{l("重复目标孔", "Duplicate destinations")}</span></button>
                      <button type="button" onClick={() => selectAlignmentIssueGroup(draftAlignment.incompleteReplicateGroups.flatMap((group) => group.wellIds.map((wellId) => ({ wellId, plateId: group.plateId }))))} disabled={!draftAlignment.incompleteReplicateGroups.length}><b>{draftAlignment.incompleteReplicateGroups.length}</b><span>{l("复孔编号待复核", "Replicate IDs to review")}</span></button>
                    </div>
                  </div>
                )}
                {analysisLocked && <div className="pending-recalculation-notice"><span>{alignmentReviewPending ? l("请复核并修正板布局", "Review and correct the plate layout") : l("板布局草稿已改变", "Plate draft changed")}</span><p>{l("概览和结果暂时锁定；应用修改并重算后，三处会基于同一份孔数据同步更新。", "Overview and results are temporarily locked. Apply changes and recalculate to synchronize all three views from the same well data.")}</p><button type="button" onClick={recalculate}>{l("应用布局并重算", "Apply layout & recalculate")}</button></div>}
                <div className="selection-guide">
                  <span>{l("批量选择：", "Batch selection: ")}</span>{l("鼠标拖动框选 · Shift 选择矩形范围 · ⌘/Ctrl 追加或取消 · 点击行列标可整行/整列选择", "Drag to select · Shift for a rectangular range · ⌘/Ctrl to add or remove · click a row/column label to select it")}
                </div>
                <div className="plate-and-editor">
                  <div className="plate-scroll" onMouseUp={() => setDragging(false)} onMouseLeave={() => setDragging(false)}>
                    <div className={`plate-grid plate-${dataset.plate.plateFormat}`} style={{ gridTemplateColumns: `36px repeat(${dataset.plate.columns.length}, minmax(${dataset.plate.plateFormat === 384 ? 44 : 68}px, 1fr))` }}>
                      <div />
                      {dataset.plate.columns.map((column) => (
                        <button type="button" className="axis-label column-axis" key={column} onClick={() => setSelected(activePlateWells.filter((well) => well.column === column).map((well) => well.id))}>{column}</button>
                      ))}
                      {dataset.plate.rows.flatMap((row) => [
                        <button type="button" className="axis-label row-axis" key={`axis-${row}`} onClick={() => setSelected(activePlateWells.filter((well) => well.row === row).map((well) => well.id))}>{row}</button>,
                        ...dataset.plate.columns.map((column) => {
                          const wellName = `${row}${column}`;
                          const well = activePlateWells.find((item) => item.well === wellName);
                          const isSelected = Boolean(well && selected.includes(well.id));
                          const hasGroupWarning = Boolean(well && draftQcState.groupWarnings.has(well.well));
                          const hasSpecificWarning = Boolean(well && draftQcState.specificWarnings.has(well.well));
                          const alignmentIssue = well ? alignmentIssueById.get(well.id) : undefined;
                          const warningText = well ? [...new Set([
                            ...(draftQcState.specificWarnings.get(well.well) ?? []),
                            ...(draftQcState.groupWarnings.get(well.well) ?? []),
                          ])].map((code) => warningLabel(code, l)).join(", ") : "";
                          return (
                            <button
                              type="button"
                              key={wellName}
                              className={`well-cell ${isSelected ? "selected" : ""} ${alignmentIssue ? "alignment-warning" : ""} ${hasGroupWarning ? "qc-group-warning" : ""} ${hasSpecificWarning ? "warning" : ""} ${well?.userExcluded ? "excluded" : ""}`}
                              style={{ "--well-color": targetColor(well?.targetName ?? "") } as React.CSSProperties}
                              title={well ? `${well.well} | ${well.sampleName || l("未命名", "Unnamed")} | ${well.targetName || l("未命名", "Unnamed")} | Cq ${formatNumber(well.cq)}${alignmentIssue ? ` | ${alignmentIssue === "result-without-annotation" ? l("有 Cp 但缺少 Sample/Target", "Cp without Sample/Target") : l("有布局但没有 Cp", "Layout without Cp")}` : ""}${warningText ? ` | QC: ${warningText}` : ""}` : wellName}
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
                      <button className="restore-import-button" type="button" onClick={restoreSelectedWells} disabled={!selectedRestorableCount} title={l("恢复 Sample、Target、反应角色和人工排除状态", "Restore Sample, Target, reaction role, and manual-exclusion state")}><span>↺</span>{l(`一键复原${selectedRestorableCount ? `（${selectedRestorableCount}）` : ""}`, `Restore imported${selectedRestorableCount ? ` (${selectedRestorableCount})` : ""}`)}</button>
                    </div>
                    <div className="selection-summary">
                      <div><span>Sample</span><b>{commonValue(selectedWells, "sampleName", l)}</b></div>
                      <div><span>Target</span><b>{commonValue(selectedWells, "targetName", l)}</b></div>
                      {selectedWells.length === 1
                        ? <div className="single-cq-value"><span>Ct / Cq / Cp</span><b title={selectedWells[0].cqReason || undefined}>{singleWellCqDisplay(selectedWells[0], l)}</b></div>
                        : <div><span>Detected Cq</span><b>{selectedWells.filter((well) => well.cqStatus === "detected").length} / {selectedWells.length}</b></div>}
                    </div>
                    {selectedAlignmentNotices.length > 0 && (
                      <section className="selection-qc-alerts has-alerts alignment-selection-alerts" aria-live="polite">
                        <div className="selection-qc-heading"><span>{l("布局", "Layout")}</span><b>{l(`${selectedAlignmentNotices.length} 条对齐提示`, `${selectedAlignmentNotices.length} alignment alert(s)`)}</b></div>
                        <div className="selection-qc-list">{selectedAlignmentNotices.map(({ well, issue, reviewed }) => (
                          <article key={`${well.id}-${issue}`}>
                            <div><strong>{well.well} · {issue === "result-without-annotation" ? l("有 Cp、无布局", "Cp without layout") : l("有布局、无 Cp", "Layout without Cp")}</strong><span>{reviewed ? l("已人工确认", "Reviewed") : l("导入对齐检查", "Import alignment check")}</span></div>
                            <p>{issue === "result-without-annotation"
                              ? l(`该物理孔保留仪器 Cp ${formatNumber(well.cq, 3)}，但缺少 Sample 或 Target。请为实际加样内容补充布局，或确认它应保持为空。`, `This physical well retains instrument Cp ${formatNumber(well.cq, 3)} but lacks Sample or Target. Assign the actual pipetting annotation or confirm that it should remain empty.`)
                              : l("该孔有 Sample/Target 布局，但结果文件没有对应 Cp。请检查是否发生错位、未加样或未检出。", "This well has Sample/Target annotations but no matching Cp in the result file. Check for an offset, missing reaction, or non-detection.")}</p>
                          </article>
                        ))}</div>
                        <button className="confirm-alignment-button" type="button" onClick={confirmSelectedAlignmentIssues} disabled={!selectedAlignmentNotices.some((item) => !item.reviewed)}>{l("确认所选状态已人工复核", "Confirm selected states reviewed")}</button>
                      </section>
                    )}
                    {selectedWells.length > 0 && (
                      <section className={selectedQcNotices.length ? "selection-qc-alerts has-alerts" : "selection-qc-alerts is-clear"} aria-live="polite">
                        <div className="selection-qc-heading"><span>QC</span><b>{selectedQcNotices.length ? l(`${selectedQcNotices.length} 条提示`, `${selectedQcNotices.length} alert(s)`) : l("无提示", "No alerts")}</b></div>
                        {selectedQcNotices.length ? <div className="selection-qc-list">{selectedQcNotices.map(({ code, well, group, scope }) => (
                          <article key={`${well.id}-${code}`}>
                            <div><strong>{well.well} · {warningLabel(code, l)}</strong><span>{scope} · {warningSource(code, well, l)}</span></div>
                            <p>{warningMessage(code, well, group, l)}</p>
                            {group && <small>{l(`关联复孔：${group.wells.join(", ")}`, `Replicate group: ${group.wells.join(", ")}`)}</small>}
                          </article>
                        ))}</div> : <p>{l("当前选中孔没有黄色孔级提示或复孔组提醒。", "The selected wells have no yellow well-level alerts or replicate-group warnings.")}</p>}
                      </section>
                    )}
                    <div className="form-stack batch-form">
                      <label>{l("统一修改 Sample Name", "Set Sample Name for selection")}<input value={batchSample} placeholder={commonValue(selectedWells, "sampleName", l)} onChange={(event) => setBatchSample(event.target.value)} /></label>
                      <label>{l("统一修改 Target Name", "Set Target Name for selection")}<input value={batchTarget} placeholder={commonValue(selectedWells, "targetName", l)} onChange={(event) => setBatchTarget(event.target.value)} /></label>
                      <label>{l("统一修改反应角色", "Set reaction role for selection")}<input value={batchTask} placeholder={commonValue(selectedWells, "taskType", l)} onChange={(event) => setBatchTask(event.target.value)} /></label>
                      <label>{l("统一修改复孔编号", "Set replicate number for selection")}<input type="number" min="1" step="1" value={batchReplicate} placeholder={l("例如 1、2、3", "For example 1, 2, 3")} onChange={(event) => setBatchReplicate(event.target.value)} /></label>
                      <button className="secondary-button" type="button" onClick={applyBatchEdit} disabled={!selected.length || ![batchSample, batchTarget, batchTask, batchReplicate].some((value) => value.trim())}>{l(`应用到 ${selected.length || 0} 个已选孔`, `Apply to ${selected.length || 0} selected well(s)`)}</button>
                    </div>

                    <section className="layout-correction-tools">
                      <div className="layout-correction-heading"><div><span>{l("错位修正", "Offset correction")}</span><b>{l("移动的是布局，不是 Cp", "Move layout, not Cp")}</b></div><div className="layout-correction-header-actions"><button type="button" className="quiet-button bordered" onClick={undoLastDraftChange} disabled={!draftHistory.length}>{l("撤销", "Undo")}</button><button type="button" className="quiet-button bordered" onClick={() => void exportCorrectedLayout()}>{l("导出布局", "Export layout")}</button></div></div>
                      <div className="layout-utility-actions">
                        <button type="button" onClick={clearSelectedAnnotations} disabled={!selected.length}>{l("清空已选布局", "Clear selected layout")}</button>
                        <button type="button" onClick={restoreWholePlate} disabled={!activePlateWells.length}>{l("当前板恢复导入值", "Restore active plate")}</button>
                      </div>
                      <div className="layout-transfer-form">
                        <label>{l("操作", "Operation")}<select value={transferMode} onChange={(event) => setTransferMode(event.target.value as "move" | "copy" | "swap")}><option value="move">{l("移动", "Move")}</option><option value="copy">{l("复制", "Copy")}</option><option value="swap">{l("交换", "Swap")}</option></select></label>
                        {plateIds.length > 1 && <label>{l("目标板", "Destination plate")}<select value={transferDestinationPlateId || selectedWells[0]?.plateId || plateIds[0]} onChange={(event) => setTransferDestinationPlateId(event.target.value)}>{plateIds.map((plateId) => <option key={plateId} value={plateId}>{plateId}</option>)}</select></label>}
                        <label>{l("目标左上角孔", "Destination top-left well")}<input value={transferDestination} placeholder="B4" onChange={(event) => setTransferDestination(event.target.value.toUpperCase())} /></label>
                      </div>
                      {transferDestination && (
                        <div className={`layout-transfer-preview ${layoutTransferPreview?.ok ? "is-valid" : "is-invalid"}`}>
                          {layoutTransferPreview?.ok ? <><b>{l("可应用", "Ready to apply")}</b><span>{layoutTransferPreview.mappings.slice(0, 4).map((mapping) => {
                            const source = draftWells.find((well) => well.id === mapping.sourceWellId);
                            const destination = draftWells.find((well) => well.id === mapping.destinationWellId);
                            const sourceLabel = [source?.sampleName, source?.targetName].filter(Boolean).join(" / ") || l("无布局注释", "No layout annotation");
                            return `${source?.plateId ?? ""} ${mapping.sourceWell} [${sourceLabel}] → ${destination?.plateId ?? ""} ${mapping.destinationWell} [Cp ${destination ? singleWellCqDisplay(destination, l) : "—"}]`;
                          }).join(" · ")}{layoutTransferPreview.mappings.length > 4 ? "…" : ""}</span></> : <><b>{l("暂不能应用", "Cannot apply")}</b><span>{layoutTransferPreview?.error === "collision" ? l("目标区域已有布局，系统不会静默覆盖。请先清空、移动或使用交换。", "The destination already contains layout annotations. Nothing will be overwritten silently; clear, move, or use swap first.") : layoutTransferPreview?.error === "out-of-bounds" ? l("目标区域超出孔板范围。", "The destination extends beyond the plate.") : layoutTransferPreview?.error === "mixed-source-plates" ? l("一次操作只能选择同一块板。", "One operation can only use wells from the same plate.") : layoutTransferPreview?.error === "overlapping-copy" ? l("复制目标不能与源区域重叠，否则无法完整保留源布局。", "A copy destination cannot overlap the source region because the full source must be retained.") : layoutTransferPreview?.error === "overlapping-swap" ? l("交换区域不能与源区域重叠。", "Swap regions cannot overlap.") : l("请输入板内有效目标孔。", "Enter a valid destination well.")}</span></>}
                        </div>
                      )}
                      <button className="secondary-button full-width" type="button" onClick={applyLayoutTransfer} disabled={!layoutTransferPreview?.ok}>{l(`应用${transferMode === "move" ? "移动" : transferMode === "copy" ? "复制" : "交换"}`, `Apply ${transferMode}`)}</button>
                      <p className="microcopy">{l("按所选孔相对位置整体变换；目标冲突和越界会在写入前拦截。所有 Cp、Tm 和仪器标记始终留在原物理孔。", "Relative geometry is preserved. Collisions and out-of-bounds destinations are blocked before mutation. Cp, Tm, and instrument flags always stay on their physical wells.")}</p>
                    </section>

                    <details className="paste-details">
                      <summary>{l("批量贴入不同孔信息", "Paste different values by well")} <span>{l("Excel 专用", "Excel")}</span></summary>
                      <p>{l("仅当 Excel 每一行对应不同孔时使用。统一修改多个孔，请用上面的批量修改。", "Use this only when each Excel row maps to a different well. Use the fields above to apply one value to multiple wells.")}</p>
                      <div className="paste-format"><b>{l("支持两种格式", "Two supported formats")}</b><code>Well · Sample · Target · Role · Replicate</code><code>{l("Sample · Target · Role · Replicate（按已选孔顺序）", "Sample · Target · Role · Replicate (selected-well order)")}</code></div>
                      <textarea value={pasteBlock} placeholder={"A1\tS01\tGAPDH\tUnknown\t1\nA2\tS01\tGENE1\tUnknown\t2"} onChange={(event) => { setPasteBlock(event.target.value); setPasteOverwriteConfirmed(false); }} />
                      {pastePreview.rows.length > 0 && <p className="paste-preview">{l(`已识别 ${pastePreview.rows.length} 行 · ${pastePreview.hasWellColumn ? "按 Well 精确匹配" : `按 ${selected.length} 个已选孔顺序匹配`}`, `${pastePreview.rows.length} row(s) recognized · ${pastePreview.hasWellColumn ? "matched by Well" : `matched to ${selected.length} selected well(s) in order`}`)}</p>}
                      {pasteCollisionCount > 0 && <label className="paste-collision-confirm"><input type="checkbox" checked={pasteOverwriteConfirmed} onChange={(event) => setPasteOverwriteConfirmed(event.target.checked)} /><span>{l(`检测到 ${pasteCollisionCount} 个目标孔已有不同布局；确认后才允许覆盖`, `${pasteCollisionCount} destination well(s) already contain different layout values; confirm before overwrite`)}</span></label>}
                      <button className="quiet-button bordered full-width" type="button" onClick={applyPastedBlock} disabled={!pastePreview.rows.length || (!pastePreview.hasWellColumn && !selected.length) || (pasteCollisionCount > 0 && !pasteOverwriteConfirmed)}>{l("应用粘贴内容", "Apply pasted values")}</button>
                    </details>

                    <div className="divider" />
                    <label className="form-label">{l("排除原因", "Exclusion reason")}<textarea value={exclusionReason} placeholder={l("技术复孔异常（人工判定）", "Technical replicate issue (manual decision)")} onChange={(event) => setExclusionReason(event.target.value)} /></label>
                    <div className="split-actions">
                      <button className="danger-button" type="button" onClick={() => setExclusion(true)} disabled={!selected.length}>{l("排除已选孔", "Exclude selected")}</button>
                      <button className="quiet-button bordered" type="button" onClick={() => setExclusion(false)} disabled={!selected.length}>{l("恢复", "Restore")}</button>
                    </div>
                    <p className="microcopy">{l("“一键复原”恢复本次导入后的值。所有修改先保留为草稿；点击右下角“应用修改并重算”后才进入结果和审计记录。", "“Restore imported” returns selected wells to values from this import. Edits remain in draft until you select “Apply changes & recalculate”; then QC, results, and the audit trail are updated.")}</p>
                  </aside>
                </div>
              </div>
            )}

            {view === "results" && (
              <div className="panel-stack results-panel">
                <div className="section-heading results-heading">
                  <div><h2>{resultSection === "quantification" ? l("相对定量结果", "Relative quantification") : l("Tm 与熔解分析", "Tm & melt analysis")}</h2><p className="section-summary">{resultSection === "quantification" ? l("设置归一化、展示顺序与校准样本后，图表和表格同步更新。", "Configure normalization, display order, and the calibrator; charts and tables update together.") : l("查看 Tm 峰值、熔解分组与需复核反应。", "Review Tm peaks, melt groups, and reactions requiring attention.")}</p></div>
                  <div className="result-mode-tabs" aria-label={l("结果类型", "Result type")}>
                    <button type="button" disabled={!hasQuantification} className={resultSection === "quantification" ? "active" : ""} onClick={() => setResultSection("quantification")}>{l("相对定量", "Quantification")}</button>
                    <button type="button" disabled={!hasMeltAnalysis} className={resultSection === "melt" ? "active" : ""} onClick={() => setResultSection("melt")}>{l("Tm 与熔解", "Tm & melt")}</button>
                  </div>
                </div>
                {resultSection === "quantification" && hasQuantification && <>
                  <div className="result-settings-grid">
                    <section className="result-setting-step reference-step">
                      <div className="setting-step-heading"><span>1</span><div><h3>{l("选择内参基因", "Select reference targets")}</h3><p>{l("归一化", "Normalization")}</p></div><small>{l("可多选", "Multiple")}</small></div>
                      <div className="choice-row">{targets.map((target) => <label className={referenceTargets.includes(target) ? "choice active" : "choice"} key={target}><input type="checkbox" checked={referenceTargets.includes(target)} onChange={() => setReferenceTargets((current) => current.includes(target) ? current.filter((item) => item !== target) : [...current, target])} />{target}</label>)}</div>
                      <p>{l("多内参按相对量几何均值归一化。", "Multiple reference targets are normalized by the geometric mean of relative quantities.")}</p>
                    </section>

                    <section className="result-setting-step display-step">
                      <div className="setting-step-heading"><span>2</span><div><h3>{l("选择展示的基因和样本", "Choose displayed targets & samples")}</h3><p>{l("点选顺序即图表顺序", "Selection order defines chart order")}</p></div><button className="clear-selection-button" type="button" onClick={() => { setDisplayTargets([]); setDisplaySamples([]); }} disabled={!displayTargets.length && !displaySamples.length}>{l("清空", "Clear")}</button></div>
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
                      <div className="setting-step-heading"><span>3</span><div><h3>{l("选择校准样本", "Select calibrator sample")}</h3><p>{l("ΔΔCq 基准", "ΔΔCq baseline")}</p></div></div>
                      <label className="compact-field">{l("校准样本", "Calibrator")}<select value={calibrator} onChange={(event) => setCalibrator(event.target.value)}><option value="">{l("不设置，仅计算 ΔCq", "None - calculate ΔCq only")}</option>{samples.map((sample) => <option key={sample} value={sample}>{sample}</option>)}</select></label>
                      <p>{l("设置后计算 ΔΔCq 与相对表达量；未提供扩增效率时按 100% 计算并记录假设。", "A calibrator enables ΔΔCq and relative expression. Missing amplification efficiency is recorded and assumed to be 100%.")}</p>
                    </section>
                  </div>
                  {!referenceTargets.length ? <div className="empty-table">{l("请先在第 1 区选择至少一个内参基因。", "Select at least one reference target in section 1.")}</div> : <ResultExplorer results={relativeResults} sampleOrder={displaySamples} targetOrder={selectedDisplayTargets} calculationMode={calibrator ? "delta-delta-cq" : "delta-cq"} provenanceWarnings={resultExportWarnings} />}
                </>}
                {resultSection === "quantification" && !hasQuantification && <div className="empty-table">{l("当前仅导入了 Tm/熔解结果；添加单孔 Cq/Ct/Cp 后可进行相对定量。", "Only Tm/melt results are currently imported. Add well-level Cq/Ct/Cp data for relative quantification.")}</div>}
                {resultSection === "melt" && hasMeltAnalysis && <MeltAnalysis wells={appliedWells} />}
                {resultSection === "melt" && !hasMeltAnalysis && <div className="empty-table">{l("当前没有 Tm 或熔解分组数据；可返回数据文件追加对应结果。", "No Tm or melt-group data are available. Return to Data files to add the corresponding result.")}</div>}
              </div>
            )}
          </section>
        </div>
      )}

      {dataset && !dataManagerOpen && analysisLocked && (
        <button className="recalculate-button" type="button" onClick={recalculate}>
          <span className="recalc-count">{pendingCount || "!"}</span>
          <span><b>{l("应用修改并重算", "Apply changes & recalculate")}</b><small>{l("更新 QC、结果与审计记录", "Update QC, results, and audit trail")}</small></span>
          <span className="recalc-arrow">→</span>
        </button>
      )}
      <footer><span>qPCR Analysis Studio · {l("仅供科研使用", "Research use only")}</span><span>{l("原始数据仅在当前浏览器中处理", "Raw data are processed only in this browser")}</span></footer>
    </main>
  );
}
