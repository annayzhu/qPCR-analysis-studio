"use client";

import { useLanguage } from "../i18n";

export const DEFAULT_VISUALIZATION_STUDIO_BAR_URL = "https://visualization-studio.pountneycitlali784.chatgpt.site/?plot=bar";

function visualizationStudioBarUrl(): string {
  const configured = typeof process === "undefined"
    ? ""
    : process.env.NEXT_PUBLIC_VISUALIZATION_STUDIO_URL?.trim();
  return configured || DEFAULT_VISUALIZATION_STUDIO_BAR_URL;
}

export default function VisualizationStudioLink() {
  const { l } = useLanguage();
  const label = l("打开 Visualization Studio 柱状图", "Open Visualization Studio bar chart");
  return (
    <a
      className="visualization-studio-arrow"
      href={visualizationStudioBarUrl()}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5.75 14.25 14.25 5.75M7.5 5.75h6.75v6.75" />
      </svg>
    </a>
  );
}
