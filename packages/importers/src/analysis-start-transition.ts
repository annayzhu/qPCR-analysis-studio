import type { AnalysisStart, ImportedSource } from "../../schemas/src";

export interface AnalysisStartImportState<TSession> {
  analysisStart: AnalysisStart;
  sources: ImportedSource[];
  analysisSession: TSession | null;
  needsRebuild: boolean;
  error: string;
}

export interface AnalysisStartImportChoice {
  selectedStart: AnalysisStart;
  selectedByUser: boolean;
  declaredStart?: AnalysisStart;
}

export function resolveAnalysisStartForImport({
  selectedStart,
  selectedByUser,
  declaredStart,
}: AnalysisStartImportChoice): AnalysisStart {
  return selectedByUser ? selectedStart : declaredStart ?? selectedStart;
}

export function transitionAnalysisStart<TSession>(
  current: AnalysisStartImportState<TSession>,
  next: AnalysisStart,
): AnalysisStartImportState<TSession> {
  if (current.analysisStart === next) return current;
  return {
    analysisStart: next,
    sources: [],
    analysisSession: null,
    needsRebuild: false,
    error: "",
  };
}
