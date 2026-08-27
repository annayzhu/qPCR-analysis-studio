import type { AnalysisStart, ImportedSource } from "../../schemas/src";

export interface AnalysisStartImportState<TSession> {
  analysisStart: AnalysisStart;
  sources: ImportedSource[];
  analysisSession: TSession | null;
  needsRebuild: boolean;
  error: string;
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
