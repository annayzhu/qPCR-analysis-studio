import { assessDatasetAlignment, getAnalysisBlockingError, getUnresolvedAlignmentIssues } from "../../importers/src";
import { buildQcWorkspaceState, calculateRelativeQuantification, calculateFromSuppliedCalculations } from "../../qpcr-core/src";
import type { AnalysisSessionState, AnalysisAuditLog } from "./session";

/** Validation only: applying a draft must not compute (and discard) scientific results. */
export function reviewSessionAlignment(state: AnalysisSessionState) {
  const candidate = { ...state.dataset, wells: state.draftWells };
  const draftAlignment = assessDatasetAlignment(candidate, state.analysisMode);
  return {
    draftAlignment,
    unresolvedAlignmentIssues: getUnresolvedAlignmentIssues(draftAlignment, Object.keys(state.alignmentDispositions)),
    blockingError: getAnalysisBlockingError(candidate, state.analysisMode),
  };
}

/** Stateless projection, also the reference implementation for cache-equivalence tests. */
export function projectAnalysisSession(state: AnalysisSessionState) {
  return project(state);
}

export interface AnalysisSessionReadModel extends Pick<AnalysisSessionState,
  "dataset" | "importedWells" | "draftWells" | "appliedWells" | "settings" | "auditLogs" | "alignmentDispositions"
>, ReturnType<typeof reviewSessionAlignment> {
  draftQcState: ReturnType<typeof buildQcWorkspaceState>;
  appliedQcState: ReturnType<typeof buildQcWorkspaceState>;
  relativeResults: ReturnType<typeof calculateRelativeQuantification>;
  suppliedResults: ReturnType<typeof calculateFromSuppliedCalculations>;
  pendingCount: number;
  analysisLocked: boolean;
  alignmentReviewPending: boolean;
  pendingAuditLogs: AnalysisAuditLog[];
  canUndo: boolean;
}
interface PreviousProjection { state: AnalysisSessionState; view: AnalysisSessionReadModel }

/** One projector per mounted workspace; retains only the previous snapshot.
 * State transitions are immutable. Reuse follows those identities, not a revision
 * counter or a second mutable result store. Discarding this cache is always safe.
 */
export function createAnalysisSessionProjector() {
  let previous: PreviousProjection | undefined;
  return (state: AnalysisSessionState): AnalysisSessionReadModel => {
    if (previous?.state === state) return previous.view;
    const view = project(state, previous);
    previous = { state, view };
    return view;
  };
}

function project(state: AnalysisSessionState, previous?: PreviousProjection): AnalysisSessionReadModel {
  const prior = previous?.state;
  const view = previous?.view;
  const sameDraft = prior?.draftWells === state.draftWells;
  const sameApplied = prior?.appliedWells === state.appliedWells;
  const sameStart = prior?.dataset.analysisStart === state.dataset.analysisStart;
  const review = view && sameDraft && sameStart
    && prior?.analysisMode === state.analysisMode
    && prior?.dataset.warnings === state.dataset.warnings
    && prior?.alignmentDispositions === state.alignmentDispositions
    ? view : reviewSessionAlignment(state);

  const draftQcState = view && sameDraft ? view.draftQcState : buildQcWorkspaceState(state.draftWells);
  const appliedQcState = state.appliedWells === state.draftWells ? draftQcState
    : view && sameApplied ? view.appliedQcState : buildQcWorkspaceState(state.appliedWells);
  const relativeResults = view && sameApplied && sameStart && prior?.settings === state.settings
    ? view.relativeResults
    : state.dataset.analysisStart === "cq" && state.settings.referenceTargets.length
      ? calculateRelativeQuantification(state.appliedWells, state.settings) : [];
  const suppliedResults = view && sameStart
    && prior?.dataset.suppliedCalculations === state.dataset.suppliedCalculations
    && prior?.settings.calibratorValue === state.settings.calibratorValue
    ? view.suppliedResults
    : state.dataset.analysisStart === "cq" ? []
      : calculateFromSuppliedCalculations(state.dataset.suppliedCalculations, {
          analysisStart: state.dataset.analysisStart, calibratorValue: state.settings.calibratorValue,
        });
  const pendingAuditLogs: AnalysisAuditLog[] = [
    ...state.pendingEditLogs, ...state.pendingExclusionLogs,
    ...state.pendingOperationLogs, ...state.pendingDispositionLogs,
  ];
  const pendingCount = pendingAuditLogs.length;
  const alignmentReviewPending = review.unresolvedAlignmentIssues.length > 0 || Boolean(review.blockingError);
  return {
    dataset: state.dataset,
    importedWells: state.importedWells,
    draftWells: state.draftWells,
    appliedWells: state.appliedWells,
    settings: state.settings,
    draftAlignment: review.draftAlignment,
    unresolvedAlignmentIssues: review.unresolvedAlignmentIssues,
    blockingError: review.blockingError,
    draftQcState, appliedQcState, relativeResults, suppliedResults,
    pendingCount,
    analysisLocked: alignmentReviewPending || pendingCount > 0,
    alignmentReviewPending,
    pendingAuditLogs,
    auditLogs: state.auditLogs,
    alignmentDispositions: state.alignmentDispositions,
    canUndo: state.history.length > 0,
  };
}
