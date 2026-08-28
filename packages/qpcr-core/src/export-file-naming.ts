import type { AnalysisStart } from "../../schemas/src";

const EXTENSION_PATTERN = /\.(?:xlsx?|csv|tsv|txt)$/i;

function safeStemPart(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(EXTENSION_PATTERN, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/[-_.]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
}

function analysisStartPart(analysisStart: AnalysisStart): string {
  if (analysisStart === "delta-cq") return "delta-cq";
  if (analysisStart === "delta-delta-cq") return "delta-delta-cq";
  return "cq";
}

function compactDate(createdAt: string): string {
  const matched = createdAt.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return matched ? `${matched[1]}${matched[2]}${matched[3]}` : "";
}

/**
 * Produces a stable, human-readable prefix for every artifact from one analysis.
 * It preserves the source file identity while avoiding internal dataset IDs.
 */
export function buildAnalysisExportStem(
  sourceFileNames: string[],
  analysisStart: AnalysisStart,
  createdAt: string,
): string {
  const sourceParts = sourceFileNames.map(safeStemPart).filter(Boolean);
  const firstSource = (sourceParts[0] || "qpcr-analysis").slice(0, 72).replace(/[-_.]+$/g, "");
  const sourceSummary = sourceParts.length > 1
    ? `${firstSource}-plus-${sourceParts.length - 1}-files`
    : firstSource;
  const date = compactDate(createdAt);
  return [sourceSummary, analysisStartPart(analysisStart), date].filter(Boolean).join("-");
}
