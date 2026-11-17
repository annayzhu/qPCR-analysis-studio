/**
 * Inside LabNest (same origin) the studio follows the current system style, which LabNest
 * publishes as light tokens under this key. Standalone and offline copies never see the key and
 * keep their own colours. Interface colours shift to the style's hue at their own lightness;
 * chart and result colours (set by the charts themselves) are not touched.
 */
import { THEMEABLE_COLOURS } from "./hostThemeColours";

export const HOST_THEME_KEY = "labnest.tool-theme.v1";

const MAPPING: Record<string, string> = {
  "--ink": "ink",
  "--ink-soft": "graphite",
  "--muted": "muted",
  "--line": "hairline",
  "--line-strong": "borderStrong",
  "--surface-soft": "stone",
  "--canvas": "paper",
  "--night": "accentHover",
  "--night-soft": "accent",
  "--teal": "accent",
  "--teal-bright": "accent",
  "--teal-soft": "accentSurface",
};

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** The same colour moved to the accent's hue, keeping its lightness and saturation. */
export function shiftToHue(hex: string, hue: number) {
  const [, saturation, lightness] = hexToHsl(hex.replace("#", ""));
  return hslToHex(hue, saturation, lightness);
}

export function hostThemeTokens(raw: string | null): Record<string, string> | null {
  try {
    const payload = JSON.parse(raw ?? "null");
    const tokens = payload?.version === 1 ? payload.tokens : null;
    if (!tokens) return null;
    const values = Object.values(MAPPING).map((name) => tokens[name]);
    return values.every((value) => /^#[0-9a-f]{6}$/i.test(String(value))) ? tokens : null;
  } catch {
    return null;
  }
}

export function applyHostTheme(root: HTMLElement, raw: string | null) {
  const tokens = hostThemeTokens(raw);
  for (const [property, token] of Object.entries(MAPPING)) {
    if (tokens) root.style.setProperty(property, tokens[token]);
    else root.style.removeProperty(property);
  }
  const hue = tokens ? hexToHsl(tokens.accent.slice(1))[0] : 0;
  for (const colour of THEMEABLE_COLOURS) {
    if (tokens) root.style.setProperty(`--hx-${colour}`, shiftToHue(colour, hue));
    else root.style.removeProperty(`--hx-${colour}`);
  }
}

if (typeof window !== "undefined") {
  const read = () => {
    try {
      return window.localStorage.getItem(HOST_THEME_KEY);
    } catch {
      return null;
    }
  };
  applyHostTheme(document.documentElement, read());
  window.addEventListener("storage", (event) => {
    if (event.key === HOST_THEME_KEY || event.key === null) applyHostTheme(document.documentElement, read());
  });
}
