/** Scalar statistics shared by QC, quantification and export.
 * Callers select valid observations; this layer never drops values or imputes missing data.
 */
export function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Sample SD (n−1), not population SD or biological-replicate uncertainty. */
export function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const center = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

export function standardError(sd: number | null, count: number): number | null {
  return sd === null || count < 2 ? null : sd / Math.sqrt(count);
}

/** First-order propagation through base^-Cq; the caller supplies SD or SEM explicitly. */
export function exponentialUncertainty(quantity: number, cycleError: number | null, base = 2): number | null {
  return cycleError === null ? null : Math.log(base) * quantity * cycleError;
}
