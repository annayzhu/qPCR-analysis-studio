import type {
  AlignmentDispositionLog,
  AlignmentIssueType,
  AnalysisSettings,
  CanonicalDataset,
  EditLog,
  ExclusionLog,
  LayoutOperationLog,
  RelativeQuantificationResult,
  WellRecord,
} from "../../schemas/src";
import type { DatasetAlignment, ImportReadiness } from "../../importers/src";
import {
  assessDatasetAlignment,
  getAnalysisBlockingError,
  getUnresolvedAlignmentIssues,
} from "../../importers/src";
import type { LayoutTransferRequest, LayoutTransferResult, QcWorkspaceState } from "../../qpcr-core/src";
import {
  buildQcWorkspaceState,
  calculateRelativeQuantification,
  previewLayoutTransfer,
  restoreWellsToBaseline,
  setWellExclusion,
  transferLayoutAnnotations,
  updateWellFields,
} from "../../qpcr-core/src";

export type AnalysisMode = NonNullable<ImportReadiness["analysisMode"]>;
export type AnalysisAuditLog = EditLog | ExclusionLog | LayoutOperationLog | AlignmentDispositionLog;
export type EditableWellFields = Pick<WellRecord, "sampleName" | "targetName" | "taskType" | "replicate">;

interface DraftSnapshot {
  wells: WellRecord[];
  editLogs: EditLog[];
  exclusionLogs: ExclusionLog[];
  operationLogs: LayoutOperationLog[];
  dispositionLogs: AlignmentDispositionLog[];
  dispositions: Record<string, AlignmentIssueType>;
}

/**
 * The session is the sole owner of scientific/workflow state after import.
 * React may store this value, but callers change it only through transitionAnalysisSession.
 */
export interface AnalysisSessionState {
  sessionId: string;
  revision: number;
  appliedRevision: number;
  analysisMode: AnalysisMode;
  dataset: CanonicalDataset;
  importedWells: WellRecord[];
  draftWells: WellRecord[];
  appliedWells: WellRecord[];
  settings: AnalysisSettings;
  pendingEditLogs: EditLog[];
  pendingExclusionLogs: ExclusionLog[];
  pendingOperationLogs: LayoutOperationLog[];
  pendingDispositionLogs: AlignmentDispositionLog[];
  alignmentDispositions: Record<string, AlignmentIssueType>;
  auditLogs: AnalysisAuditLog[];
  history: DraftSnapshot[];
}

export interface AnalysisSessionReadModel {
  dataset: CanonicalDataset;
  importedWells: WellRecord[];
  draftWells: WellRecord[];
  appliedWells: WellRecord[];
  settings: AnalysisSettings;
  draftAlignment: DatasetAlignment;
  unresolvedAlignmentIssues: ReturnType<typeof getUnresolvedAlignmentIssues>;
  blockingError: string | null;
  draftQcState: QcWorkspaceState;
  appliedQcState: QcWorkspaceState;
  relativeResults: RelativeQuantificationResult[];
  pendingCount: number;
  analysisLocked: boolean;
  alignmentReviewPending: boolean;
  pendingAuditLogs: AnalysisAuditLog[];
  auditLogs: AnalysisAuditLog[];
  alignmentDispositions: Readonly<Record<string, AlignmentIssueType>>;
  canUndo: boolean;
}

export interface AnalysisSessionDependencies {
  now(): string;
  nextId(prefix: string): string;
}

export interface WellAnnotationAssignment {
  wellId: string;
  changes: Partial<EditableWellFields>;
}

export type AnalysisSessionCommand =
  | {
    type: "assign-annotations";
    assignments: WellAnnotationAssignment[];
    operation: "batch-edit" | "paste" | "clear";
    reason: string;
  }
  | {
    type: "set-exclusion";
    wellIds: string[];
    excluded: boolean;
    reason: string;
  }
  | {
    type: "restore-imported";
    wellIds: string[];
    operation: "restore-selected" | "restore-plate";
    reason: string;
  }
  | {
    type: "transfer-annotations";
    request: Omit<LayoutTransferRequest, "timestamp">;
    reason: string;
  }
  | {
    type: "record-alignment-dispositions";
    wellIds: string[];
    reasonByIssueType: Record<AlignmentIssueType, string>;
  }
  | { type: "undo" }
  | { type: "apply"; reason: string }
  | { type: "configure-analysis"; settings: AnalysisSettings };

export type AnalysisSessionPreview =
  | { kind: "layout-transfer"; result: LayoutTransferResult }
  | { kind: "none" };

export interface AnalysisSessionError {
  code:
    | "empty-change"
    | "layout-transfer-failed"
    | "nothing-to-undo"
    | "alignment-review-required"
    | "analysis-blocked";
  message: string;
  wellIds: string[];
  cause?: LayoutTransferResult["error"];
}

export type AnalysisSessionTransition =
  | { ok: true; state: AnalysisSessionState; readModel: AnalysisSessionReadModel }
  | { ok: false; state: AnalysisSessionState; readModel: AnalysisSessionReadModel; error: AnalysisSessionError };

const defaultDependencies: AnalysisSessionDependencies = {
  now: () => new Date().toISOString(),
  nextId: (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
};

export function createAnalysisSession(
  dataset: CanonicalDataset,
  analysisMode: AnalysisMode,
  settings: AnalysisSettings,
  dependencies: AnalysisSessionDependencies = defaultDependencies,
): AnalysisSessionState {
  return {
    sessionId: dependencies.nextId("analysis-session"),
    revision: 0,
    appliedRevision: 0,
    analysisMode,
    dataset,
    importedWells: dataset.wells,
    draftWells: dataset.wells,
    appliedWells: dataset.wells,
    settings,
    pendingEditLogs: [],
    pendingExclusionLogs: [],
    pendingOperationLogs: [],
    pendingDispositionLogs: [],
    alignmentDispositions: {},
    auditLogs: [],
    history: [],
  };
}

export function projectAnalysisSession(state: AnalysisSessionState): AnalysisSessionReadModel {
  const candidateDataset = { ...state.dataset, wells: state.draftWells };
  const draftAlignment = assessDatasetAlignment(candidateDataset, state.analysisMode);
  const unresolvedAlignmentIssues = getUnresolvedAlignmentIssues(
    draftAlignment,
    Object.keys(state.alignmentDispositions),
  );
  const blockingError = getAnalysisBlockingError(candidateDataset, state.analysisMode);
  const pendingAuditLogs: AnalysisAuditLog[] = [
    ...state.pendingEditLogs,
    ...state.pendingExclusionLogs,
    ...state.pendingOperationLogs,
    ...state.pendingDispositionLogs,
  ];
  const pendingCount = pendingAuditLogs.length;
  const alignmentReviewPending = unresolvedAlignmentIssues.length > 0 || Boolean(blockingError);

  return {
    dataset: state.dataset,
    importedWells: state.importedWells,
    draftWells: state.draftWells,
    appliedWells: state.appliedWells,
    settings: state.settings,
    draftAlignment,
    unresolvedAlignmentIssues,
    blockingError,
    draftQcState: buildQcWorkspaceState(state.draftWells),
    appliedQcState: buildQcWorkspaceState(state.appliedWells),
    relativeResults: state.settings.referenceTargets.length
      ? calculateRelativeQuantification(state.appliedWells, state.settings)
      : [],
    pendingCount,
    analysisLocked: alignmentReviewPending || pendingCount > 0,
    alignmentReviewPending,
    pendingAuditLogs,
    auditLogs: state.auditLogs,
    alignmentDispositions: state.alignmentDispositions,
    canUndo: state.history.length > 0,
  };
}

export function previewAnalysisSessionChange(
  state: AnalysisSessionState,
  command: AnalysisSessionCommand,
): AnalysisSessionPreview {
  if (command.type !== "transfer-annotations") return { kind: "none" };
  return {
    kind: "layout-transfer",
    result: previewLayoutTransfer(state.draftWells, command.request),
  };
}

export function transitionAnalysisSession(
  state: AnalysisSessionState,
  command: AnalysisSessionCommand,
  dependencies: AnalysisSessionDependencies = defaultDependencies,
): AnalysisSessionTransition {
  const timestamp = dependencies.now();

  if (command.type === "configure-analysis") {
    return succeeded({ ...state, revision: state.revision + 1, settings: command.settings });
  }

  if (command.type === "undo") {
    const snapshot = state.history.at(-1);
    if (!snapshot) return failed(state, "nothing-to-undo", "No draft change is available to undo.", []);
    return succeeded({
      ...state,
      revision: state.revision + 1,
      draftWells: snapshot.wells,
      pendingEditLogs: snapshot.editLogs,
      pendingExclusionLogs: snapshot.exclusionLogs,
      pendingOperationLogs: snapshot.operationLogs,
      pendingDispositionLogs: snapshot.dispositionLogs,
      alignmentDispositions: snapshot.dispositions,
      history: state.history.slice(0, -1),
    });
  }

  if (command.type === "apply") {
    const readModel = projectAnalysisSession(state);
    if (readModel.unresolvedAlignmentIssues.length) {
      return failed(
        state,
        "alignment-review-required",
        "Plate-layout alignment issues remain unresolved.",
        readModel.unresolvedAlignmentIssues.map((issue) => issue.wellId),
      );
    }
    if (readModel.blockingError) {
      return failed(state, "analysis-blocked", readModel.blockingError, []);
    }

    const affectedWellIds = affectedWells(state);
    const applyLog = operationLog(
      dependencies,
      timestamp,
      "apply",
      affectedWellIds,
      affectedWellIds,
      command.reason,
      state.pendingEditLogs,
      annotationSnapshot(state.appliedWells, affectedWellIds),
      annotationSnapshot(state.draftWells, affectedWellIds),
    );
    const nextRevision = state.revision + 1;
    return succeeded({
      ...state,
      revision: nextRevision,
      appliedRevision: nextRevision,
      dataset: { ...state.dataset, wells: state.draftWells },
      appliedWells: state.draftWells,
      auditLogs: [
        ...state.auditLogs,
        ...state.pendingEditLogs,
        ...state.pendingExclusionLogs,
        ...state.pendingOperationLogs,
        ...state.pendingDispositionLogs,
        applyLog,
      ],
      pendingEditLogs: [],
      pendingExclusionLogs: [],
      pendingOperationLogs: [],
      pendingDispositionLogs: [],
      history: [],
    });
  }

  const history = [...state.history.slice(-19), snapshotOf(state)];

  if (command.type === "assign-annotations") {
    let wells = state.draftWells;
    const logs: EditLog[] = [];
    const wellIds: string[] = [];
    for (const assignment of command.assignments) {
      const updated = updateWellFields(wells, [assignment.wellId], assignment.changes, timestamp);
      wells = updated.wells;
      logs.push(...updated.logs);
      wellIds.push(assignment.wellId);
    }
    if (!logs.length) return failed(state, "empty-change", "The requested annotation change has no effect.", wellIds);
    const next = invalidateDispositions(state, wellIds);
    return succeeded({
      ...next,
      revision: state.revision + 1,
      draftWells: wells,
      pendingEditLogs: [...next.pendingEditLogs, ...logs],
      pendingOperationLogs: [
        ...next.pendingOperationLogs,
        operationLog(dependencies, timestamp, command.operation, command.operation === "paste" ? [] : wellIds, command.operation === "clear" ? [] : wellIds, command.reason, logs),
      ],
      history,
    });
  }

  if (command.type === "set-exclusion") {
    const updated = setWellExclusion(state.draftWells, command.wellIds, command.excluded, command.reason, timestamp);
    if (!updated.logs.length) return failed(state, "empty-change", "The requested exclusion change has no effect.", command.wellIds);
    const next = invalidateDispositions(state, command.wellIds);
    return succeeded({
      ...next,
      revision: state.revision + 1,
      draftWells: updated.wells,
      pendingExclusionLogs: [...next.pendingExclusionLogs, ...updated.logs],
      history,
    });
  }

  if (command.type === "restore-imported") {
    const restored = restoreWellsToBaseline(
      state.draftWells,
      state.importedWells,
      command.wellIds,
      command.reason,
      timestamp,
    );
    if (!restored.editLogs.length && !restored.exclusionLogs.length) {
      return failed(state, "empty-change", "The selected wells already match the imported baseline.", command.wellIds);
    }
    const next = invalidateDispositions(state, command.wellIds);
    return succeeded({
      ...next,
      revision: state.revision + 1,
      draftWells: restored.wells,
      pendingEditLogs: [...next.pendingEditLogs, ...restored.editLogs],
      pendingExclusionLogs: [...next.pendingExclusionLogs, ...restored.exclusionLogs],
      pendingOperationLogs: [
        ...next.pendingOperationLogs,
        operationLog(dependencies, timestamp, command.operation, command.wellIds, command.wellIds, command.reason, restored.editLogs),
      ],
      history,
    });
  }

  if (command.type === "transfer-annotations") {
    const transferred = transferLayoutAnnotations(state.draftWells, { ...command.request, timestamp });
    if (!transferred.ok) {
      return failed(
        state,
        "layout-transfer-failed",
        `Layout transfer failed: ${transferred.error ?? "unknown"}.`,
        transferred.collisionWellIds,
        transferred.error,
      );
    }
    const destinationIds = transferred.mappings.map((mapping) => mapping.destinationWellId);
    const changedWellIds = [...new Set([...command.request.sourceWellIds, ...destinationIds])];
    const next = invalidateDispositions(state, changedWellIds);
    return succeeded({
      ...next,
      revision: state.revision + 1,
      draftWells: transferred.wells,
      pendingEditLogs: [...next.pendingEditLogs, ...transferred.logs],
      pendingOperationLogs: [
        ...next.pendingOperationLogs,
        operationLog(dependencies, timestamp, command.request.mode, command.request.sourceWellIds, destinationIds, command.reason, transferred.logs),
      ],
      history,
    });
  }

  const currentAlignment = assessDatasetAlignment({ ...state.dataset, wells: state.draftWells }, state.analysisMode);
  const issueTypeById = new Map<string, AlignmentIssueType>([
    ...currentAlignment.resultWithoutAnnotation.map((issue) => [issue.wellId, "result-without-annotation"] as const),
    ...currentAlignment.annotationWithoutResult.map((issue) => [issue.wellId, "annotation-without-result"] as const),
  ]);
  const dispositions = { ...state.alignmentDispositions };
  const logs = command.wellIds.flatMap((wellId): AlignmentDispositionLog[] => {
    const issueType = issueTypeById.get(wellId);
    if (!issueType || dispositions[wellId]) return [];
    dispositions[wellId] = issueType;
    return [{
      id: dependencies.nextId("alignment"),
      wellRecordId: wellId,
      issueType,
      action: "confirm-reviewed",
      reason: command.reasonByIssueType[issueType],
      timestamp,
    }];
  });
  if (!logs.length) return failed(state, "empty-change", "No unreviewed alignment issue was selected.", command.wellIds);
  return succeeded({
    ...state,
    revision: state.revision + 1,
    alignmentDispositions: dispositions,
    pendingDispositionLogs: [...state.pendingDispositionLogs, ...logs],
    history,
  });
}

function succeeded(state: AnalysisSessionState): AnalysisSessionTransition {
  return { ok: true, state, readModel: projectAnalysisSession(state) };
}

function failed(
  state: AnalysisSessionState,
  code: AnalysisSessionError["code"],
  message: string,
  wellIds: string[],
  cause?: LayoutTransferResult["error"],
): AnalysisSessionTransition {
  return { ok: false, state, readModel: projectAnalysisSession(state), error: { code, message, wellIds, cause } };
}

function snapshotOf(state: AnalysisSessionState): DraftSnapshot {
  return {
    wells: state.draftWells,
    editLogs: state.pendingEditLogs,
    exclusionLogs: state.pendingExclusionLogs,
    operationLogs: state.pendingOperationLogs,
    dispositionLogs: state.pendingDispositionLogs,
    dispositions: state.alignmentDispositions,
  };
}

function invalidateDispositions(state: AnalysisSessionState, wellIds: string[]): AnalysisSessionState {
  const ids = new Set(wellIds);
  const alignmentDispositions = { ...state.alignmentDispositions };
  for (const wellId of ids) delete alignmentDispositions[wellId];
  return {
    ...state,
    alignmentDispositions,
    pendingDispositionLogs: state.pendingDispositionLogs.filter((log) => !ids.has(log.wellRecordId)),
  };
}

function affectedWells(state: AnalysisSessionState): string[] {
  return [...new Set([
    ...state.pendingEditLogs.map((log) => log.wellRecordId),
    ...state.pendingExclusionLogs.map((log) => log.wellRecordId),
    ...state.pendingDispositionLogs.map((log) => log.wellRecordId),
    ...state.pendingOperationLogs.flatMap((log) => [...log.sourceWellRecordIds, ...log.destinationWellRecordIds]),
  ])];
}

function operationLog(
  dependencies: AnalysisSessionDependencies,
  timestamp: string,
  operation: LayoutOperationLog["operation"],
  sourceWellRecordIds: string[],
  destinationWellRecordIds: string[],
  reason: string,
  changes: EditLog[] = [],
  previousSnapshot = "",
  newSnapshot = "",
): LayoutOperationLog {
  return {
    id: dependencies.nextId("layout"),
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

function annotationSnapshot(wells: WellRecord[], wellIds: string[]): string {
  const ids = new Set(wellIds);
  return JSON.stringify(wells.filter((well) => ids.has(well.id)).map((well) => ({
    id: well.id,
    sampleName: well.sampleName,
    targetName: well.targetName,
    taskType: well.taskType,
    replicate: well.replicate,
    userExcluded: well.userExcluded,
    exclusionReason: well.exclusionReason,
  })));
}
