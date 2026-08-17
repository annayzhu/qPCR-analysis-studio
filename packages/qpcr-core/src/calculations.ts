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
  plateId: string;
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
    const key = `${well.plateId}\u241f${well.sampleName}\u241f${well.targetName}`;
    groups.set(key, [...(groups.get(key) ?? []), well.cq]);
  }
  return [...groups.entries()].map(([key, values]) => {
    const [plateId, sampleName, targetName] = key.split("\u241f");
    const sdCq = sampleSd(values);
    return {
      plateId,
      sampleName,
      targetName,
      meanCq: mean(values)!,
      sdCq,
      semCq: standardError(sdCq, values.length),
      validReplicates: values.length,
    };
  });
}

function rowKey(sampleName: string, targetName: string): string {
  return `${sampleName}\u241f${targetName}`;
}

function plateSampleKey(plateId: string, sampleName: string): string {
  return `${plateId}\u241f${sampleName}`;
}

function weightedMean<T>(items: T[], value: (item: T) => number, weight: (item: T) => number): number {
  const totalWeight = items.reduce((sum, item) => sum + weight(item), 0);
  return totalWeight > 0
    ? items.reduce((sum, item) => sum + value(item) * weight(item), 0) / totalWeight
    : mean(items.map(value))!;
}

function uniqueWarnings(...warningLists: string[][]): string[] {
  return [...new Set(warningLists.flat())];
}

function sumReferenceReplicates(rows: RelativeQuantificationResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const [target, count] of Object.entries(row.referenceValidReplicates)) {
      counts[target] = (counts[target] ?? 0) + count;
    }
  }
  return counts;
}

function meanOrNull(values: Array<number | null>): number | null {
  const numericValues = values.filter((value): value is number => value !== null);
  return numericValues.length === values.length && numericValues.length > 0 ? mean(numericValues)! : null;
}

function aggregatePlateAwareRows(rows: RelativeQuantificationResult[], settings: AnalysisSettings): RelativeQuantificationResult[] {
  const groups = new Map<string, RelativeQuantificationResult[]>();
  for (const row of rows) {
    const key = rowKey(row.sampleName, row.targetName);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];

    const base = settings.calculationMode === "efficiency-corrected"
      ? 1 + (settings.efficiencyByTarget[group[0].targetName] ?? 1)
      : 2;
    const normalizedQuantity = mean(group.map((row) => row.normalizedQuantity))!;
    const deltaCq = -Math.log(normalizedQuantity) / Math.log(base);
    const normalizedQuantitySd = sampleSd(group.map((row) => row.normalizedQuantity));
    const normalizedQuantitySem = standardError(normalizedQuantitySd, group.length);
    const deltaCqSd = sampleSd(group.map((row) => row.deltaCq));
    const deltaCqSem = standardError(deltaCqSd, group.length);

    return {
      ...group[0],
      targetMeanCq: weightedMean(group, (row) => row.targetMeanCq, (row) => row.targetValidReplicates),
      targetSdCq: meanOrNull(group.map((row) => row.targetSdCq)),
      targetSemCq: meanOrNull(group.map((row) => row.targetSemCq)),
      targetValidReplicates: group.reduce((sum, row) => sum + row.targetValidReplicates, 0),
      referenceMeanCq: mean(group.map((row) => row.referenceMeanCq))!,
      referenceSdCq: meanOrNull(group.map((row) => row.referenceSdCq)),
      referenceSemCq: meanOrNull(group.map((row) => row.referenceSemCq)),
      referenceValidReplicates: sumReferenceReplicates(group),
      deltaCq,
      deltaCqSd,
      deltaCqSem,
      normalizedQuantity,
      normalizedQuantitySd,
      normalizedQuantitySem,
      warningCodes: uniqueWarnings(group.flatMap((row) => row.warningCodes), ["MULTI_PLATE_TARGET_MERGED"]),
    };
  });
}

/**
 * Relative-quantification core. Technical replicates are merged first within
 * each plate/sample/target group. References are paired by the same plate and
 * sample before ΔCq is calculated, so a sample that is split across plates uses
 * the reference gene(s) repeated on that exact plate rather than a global
 * cross-plate reference pool.
 *
 * Multiple references are combined as the arithmetic mean of their mean Cq,
 * equivalent to the geometric mean of 2^-Cq reference quantities when E=100%.
 */
export function calculateRelativeQuantification(
  wells: WellRecord[],
  settings: AnalysisSettings,
): RelativeQuantificationResult[] {
  const means = targetMeans(wells);
  const byPlateSample = new Map<string, Map<string, TargetMean>>();
  const completeReferencePlateIdsBySample = new Map<string, Set<string>>();

  for (const item of means) {
    const key = plateSampleKey(item.plateId, item.sampleName);
    const targets = byPlateSample.get(key) ?? new Map<string, TargetMean>();
    targets.set(item.targetName, item);
    byPlateSample.set(key, targets);
  }

  for (const [key, targets] of byPlateSample) {
    const [plateId, sampleName] = key.split("\u241f");
    const hasCompleteReferenceSet = settings.referenceTargets.length > 0
      && settings.referenceTargets.every((target) => targets.has(target));
    if (!hasCompleteReferenceSet) continue;
    const plateIds = completeReferencePlateIdsBySample.get(sampleName) ?? new Set<string>();
    plateIds.add(plateId);
    completeReferencePlateIdsBySample.set(sampleName, plateIds);
  }

  const normalized = new Map<string, number>();
  const segmentRows: RelativeQuantificationResult[] = [];
  for (const [key, targets] of byPlateSample) {
    const [, sampleName] = key.split("\u241f");
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
      segmentRows.push({
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
        warningCodes: [
          ...(settings.calculationMode === "efficiency-corrected" && settings.efficiencyByTarget[targetName] === undefined
            ? ["EFFICIENCY_ASSUMED_100_PERCENT"]
            : []),
          ...((completeReferencePlateIdsBySample.get(sampleName)?.size ?? 0) > 1
            ? ["PLATE_AWARE_REFERENCE_PAIRING"]
            : []),
        ],
      });
    }
  }

  const rows = aggregatePlateAwareRows(segmentRows, settings);
  for (const row of rows) {
    normalized.set(rowKey(row.sampleName, row.targetName), row.normalizedQuantity);
  }

  return rows.map((row) => {
    if (settings.calculationMode === "delta-cq" || !settings.calibratorValue) return row;
    const calibratorQuantity = normalized.get(rowKey(settings.calibratorValue, row.targetName));
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
