"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type Language = "zh" | "en";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  l: (zh: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
const languageListeners = new Set<() => void>();

function readLanguage(): Language {
  const saved = window.localStorage.getItem("qpcr-analysis-language");
  if (saved === "zh" || saved === "en") return saved;
  return window.navigator.language.toLocaleLowerCase().startsWith("zh") ? "zh" : "en";
}

function subscribeToLanguage(listener: () => void) {
  languageListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === "qpcr-analysis-language") listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    languageListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function updateStoredLanguage(language: Language) {
  window.localStorage.setItem("qpcr-analysis-language", language);
  for (const listener of languageListeners) listener();
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const language = useSyncExternalStore(subscribeToLanguage, readLanguage, (): Language => "zh");

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const setLanguage = useCallback((next: Language) => updateStoredLanguage(next), []);
  const toggleLanguage = useCallback(() => updateStoredLanguage(language === "zh" ? "en" : "zh"), [language]);
  const l = useCallback((zh: string, en: string) => language === "zh" ? zh : en, [language]);
  const value = useMemo(() => ({ language, setLanguage, toggleLanguage, l }), [l, language, setLanguage, toggleLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}

const ENGLISH_RUNTIME_MESSAGES: Record<string, string> = {
  "工作簿中没有可读取的工作表": "No readable worksheet was found in the workbook.",
  "文本中没有可读取的数据表": "No readable table was found in the text file.",
  "文件解析失败": "File parsing failed.",
  "请先导入 Cq/Ct/Cp 或 Tm/熔解结果文件。": "Import a Cq/Ct/Cp or Tm/melt result file first.",
  "关键字段存在映射冲突，请确认孔位、样本、基因或结果字段后再分析。": "Key field mappings conflict. Confirm the well, sample, target, or result fields before analysis.",
  "结果文件未包含完整的 Sample/Target 信息，请再导入修正后的板布局。": "The result file does not contain complete Sample/Target information. Import the corrected plate layout.",
  "Tm/熔解结果与板布局已就绪，可进入熔解分析；相对定量仍需 Cq/Ct/Cp。": "Tm/melt results and the plate layout are ready. Melt analysis is available; relative quantification still requires Cq/Ct/Cp data.",
  "结果文件已包含板布局信息，无需另传布局；相对定量已就绪。": "The result file already contains the plate layout. Relative quantification is ready.",
  "仪器结果与板布局均已就绪；相对定量已自动计算。": "Instrument results and the plate layout are ready. Relative quantification has been calculated.",
  "该文件是熔解分组摘要，不是温度-荧光原始曲线。": "This file is a melt-group summary, not a raw temperature-fluorescence curve.",
  "板规格由部分孔位推断，请在计算前确认 96/384 孔。": "The plate format was inferred from a subset of wells. Confirm 96/384 wells before calculation.",
  "导入的 Roche melt 文件是分组摘要；完整曲线需另行导出原始温度-荧光数据。": "The imported Roche melt file is a grouping summary. Export raw temperature-fluorescence data separately for complete curves.",
};

export function localizeRuntimeMessage(message: string, language: Language): string {
  if (language === "zh") return message;
  if (ENGLISH_RUNTIME_MESSAGES[message]) return ENGLISH_RUNTIME_MESSAGES[message];
  const mappingConflict = message.match(/^(.*): (\d+) 个字段映射冲突已留待确认。$/);
  if (mappingConflict) return `${mappingConflict[1]}: ${mappingConflict[2]} field mapping conflict(s) require confirmation.`;
  const plateNote = message.match(/^板布局备注（(.+)）: (.+)$/);
  if (plateNote) return `Plate layout note (${plateNote[1]}): ${plateNote[2]}`;
  const unsupported = message.match(/^暂不支持 (.+)；请选择 XLSX、CSV 或 TXT。$/);
  if (unsupported) return `${unsupported[1]} is not supported. Choose an XLSX, CSV, or TXT file.`;
  return message;
}
