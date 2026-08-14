import type {
  AnalysisSettings,
  RelativeQuantificationResult,
  WellRecord,
} from "../../schemas/src";

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function standardError(sd: number | null, count: number): number | null {
  return sd === null || count < 2 ? null : sd / Math.sqrt(count);
}

interface TargetMean {
  sampleName: string;
  targetName: string;
  meanCq: number;
  sdCq: number | null;
  semCq: number | null;
  validReplicates: number;
}

function propagatedSd(parts: Array<number | null>): number | null {
  if (parts.some((value) => value === null)) return null;
  const numericParts = parts.filter((value): value is number => value !== null);
  return Math.sqrt(numericParts.reduce((sum, value) => sum + value ** 2, 0));
}

function exponentialSd(quantity: number, cqSd: number | null, base: number): number | null {
  return cqSd === null ? null : Math.log(base) * quantity * cqSd;
}

function targetMeans(wells: WellRecord[]): TargetMean[] {
  const groups = new Map<string, number[]>();
  for (const well of wells) {
    if (
      !well.sampleName ||
      !well.targetName ||
      well.cq === null ||
      well.cqStatus !== "detected" ||
      well.instrumentOmit ||
      well.userExcluded
    ) continue;
    const key = `${well.sampleName}\u241f${well.targetName}`;
    groups.set(key, [...(groups.get(key) ?? []), well.cq]);
  }
  return [...groups.entries()].map(([key, values]) => {
    const [sampleName, targetName] = key.split("\u241f");
    const sdCq = sampleSd(values);
    return {
      sampleName,
      targetName,
      meanCq: mean(values)!,
      sdCq,
      semCq: standardError(sdCq, values.length),
      validReplicates: values.length,
    };
  });
}

/**
 * Classic relative-quantification core. Technical replicates are merged first.
 * Multiple references are combined as the arithmetic mean of their mean Cq,
 * equivalent to the geometric mean of 2^-Cq reference quantities when E=100%.
 */
export function calculateRelativeQuantification(
  wells: WellRecord[],
  settings: AnalysisSettings,
): RelativeQuantificationResult[] {
  const means = targetMeans(wells);
  const bySample = new Map<string, Map<string, TargetMean>>();
  for (const item of means) {
    const targets = bySample.get(item.sampleName) ?? new Map<string, TargetMean>();
    targets.set(item.targetName, item);
    bySample.set(item.sampleName, targets);
  }

  const normalized = new Map<string, number>();
  const rows: RelativeQuantificationResult[] = [];
  for (const [sampleName, targets] of bySample) {
    const references = settings.referenceTargets
      .map((target) => targets.get(target))
      .filter((item): item is TargetMean => item !== undefined);
    if (references.length !== settings.referenceTargets.length || !references.length) continue;
    const referenceMeanCq = mean(references.map((item) => item.meanCq))!;
    const referenceSdCq = references.every((item) => item.sdCq !== null)
      ? Math.sqrt(references.reduce((sum, item) => sum + item.sdCq! ** 2, 0)) / references.length
      : null;
    const referenceSemCq = references.every((item) => item.semCq !== null)
      ? Math.sqrt(references.reduce((sum, item) => sum + item.semCq! ** 2, 0)) / references.length
      : null;
    const referenceValidReplicates = Object.fromEntries(
      references.map((item) => [item.targetName, item.validReplicates]),
    );
    for (const [targetName, targetSummary] of targets) {
      if (settings.referenceTargets.includes(targetName)) continue;
      const targetMeanCq = targetSummary.meanCq;
      const deltaCq = targetMeanCq - referenceMeanCq;
      const base = settings.calculationMode === "efficiency-corrected"
        ? 1 + (settings.efficiencyByTarget[targetName] ?? 1)
        : 2;
      const normalizedQuantity = base ** -deltaCq;
      const deltaCqSd = propagatedSd([targetSummary.sdCq, referenceSdCq]);
      const deltaCqSem = propagatedSd([targetSummary.semCq, referenceSemCq]);
      const normalizedQuantitySd = exponentialSd(normalizedQuantity, deltaCqSd, base);
      const normalizedQuantitySem = exponentialSd(normalizedQuantity, deltaCqSem, base);
      normalized.set(`${sampleName}\u241f${targetName}`, normalizedQuantity);
      rows.push({
        sampleName,
        targetName,
        targetMeanCq,
        targetSdCq: targetSummary.sdCq,
        targetSemCq: targetSummary.semCq,
        targetValidReplicates: targetSummary.validReplicates,
        referenceMeanCq,
        referenceSdCq,
        referenceSemCq,
        referenceValidReplicates,
        deltaCq,
        deltaCqSd,
        deltaCqSem,
        normalizedQuantity,
        normalizedQuantitySd,
        normalizedQuantitySem,
        deltaDeltaCq: null,
        deltaDeltaCqSd: null,
        deltaDeltaCqSem: null,
        relativeExpression: null,
        relativeExpressionSd: null,
        relativeExpressionSem: null,
        calibratorValue: settings.calibratorValue,
        referenceTargets: settings.referenceTargets,
        warningCodes:
          settings.calculationMode === "efficiency-corrected" && settings.efficiencyByTarget[targetName] === undefined
            ? ["EFFICIENCY_ASSUMED_100_PERCENT"]
            : [],
      });
    }
  }

  return rows.map((row) => {
    if (settings.calculationMode === "delta-cq" || !settings.calibratorValue) return row;
    const calibratorQuantity = normalized.get(`${settings.calibratorValue}\u241f${row.targetName}`);
    if (!calibratorQuantity) {
      return { ...row, warningCodes: [...row.warningCodes, "CALIBRATOR_MISSING"] };
    }
    const calibratorRow = rows.find(
      (candidate) => candidate.sampleName === settings.calibratorValue && candidate.targetName === row.targetName,
    );
    const deltaDeltaCq = calibratorRow ? row.deltaCq - calibratorRow.deltaCq : null;
    // The calibrator's center is fixed at 1, but its error is not fixed at 0:
    // retain its own target/reference technical-replicate dispersion around
    // the calibrator mean. Other samples additionally include calibrator error.
    const deltaDeltaCqSd = calibratorRow
      ? row.sampleName === settings.calibratorValue
        ? row.deltaCqSd
        : propagatedSd([row.deltaCqSd, calibratorRow.deltaCqSd])
      : null;
    const deltaDeltaCqSem = calibratorRow
      ? row.sampleName === settings.calibratorValue
        ? row.deltaCqSem
        : propagatedSd([row.deltaCqSem, calibratorRow.deltaCqSem])
      : null;
    const relativeExpression = row.normalizedQuantity / calibratorQuantity;
    const base = settings.calculationMode === "efficiency-corrected"
      ? 1 + (settings.efficiencyByTarget[row.targetName] ?? 1)
      : 2;
    return {
      ...row,
      deltaDeltaCq,
      deltaDeltaCqSd,
      deltaDeltaCqSem,
      relativeExpression,
      relativeExpressionSd: exponentialSd(relativeExpression, deltaDeltaCqSd, base),
      relativeExpressionSem: exponentialSd(relativeExpression, deltaDeltaCqSem, base),
    };
  });
}
