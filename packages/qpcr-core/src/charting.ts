export interface LogRatioAxis {
  minExponent: number;
  maxExponent: number;
  tickExponents: number[];
  tickValues: number[];
}

function chartLabelUnit(character: string): number {
  return /[^\u0000-\u00ff]/.test(character) ? 2 : 1;
}

export function chartLabelVisualUnits(value: string): number {
  return Array.from(value).reduce((total, character) => total + chartLabelUnit(character), 0);
}

/**
 * Wraps a sample identifier without abbreviating or discarding any characters.
 * CJK characters count as two visual units so mixed Chinese/Latin labels remain
 * readable in exported SVG and PNG figures.
 */
export function wrapChartLabel(value: string, maxVisualUnits = 18): string[] {
  const lines: string[] = [];
  let current = "";
  let currentUnits = 0;

  for (const character of Array.from(value)) {
    const units = chartLabelUnit(character);
    if (current && currentUnits + units > maxVisualUnits) {
      lines.push(current);
      current = character;
      currentUnits = units;
    } else {
      current += character;
      currentUnits += units;
    }
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

/**
 * Builds a base-2 ratio axis for fold-change style qPCR plots.
 * The reference value 1 is always present, while the domain expands to contain
 * every positive finite observation. This avoids silently clipping extreme data.
 */
export function buildLogRatioAxis(values: number[], maxTickCount = 9): LogRatioAxis {
  const validValues = values.filter((value) => Number.isFinite(value) && value > 0);
  const dataExponents = validValues.map((value) => Math.log2(value));
  const minExponent = Math.min(-3, Math.floor(Math.min(...dataExponents, 0)));
  const maxExponent = Math.max(3, Math.ceil(Math.max(...dataExponents, 0)));
  const span = Math.max(1, maxExponent - minExponent);
  const step = Math.max(1, Math.ceil(span / Math.max(1, maxTickCount - 1)));
  const exponentSet = new Set<number>([minExponent, 0, maxExponent]);
  for (let exponent = minExponent; exponent <= maxExponent; exponent += step) {
    exponentSet.add(exponent);
  }
  const tickExponents = [...exponentSet].sort((a, b) => a - b);
  return {
    minExponent,
    maxExponent,
    tickExponents,
    tickValues: tickExponents.map((exponent) => 2 ** exponent),
  };
}

export function mapRatioToY(
  value: number,
  axis: Pick<LogRatioAxis, "minExponent" | "maxExponent">,
  top: number,
  bottom: number,
): number {
  const exponent = Math.log2(Math.max(value, Number.EPSILON));
  const clamped = Math.min(axis.maxExponent, Math.max(axis.minExponent, exponent));
  const fraction = (axis.maxExponent - clamped) / Math.max(1, axis.maxExponent - axis.minExponent);
  return top + fraction * (bottom - top);
}
