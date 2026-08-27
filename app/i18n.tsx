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
  "数据模板存在阻断错误。请按工作表、行号和列提示修正后重新导入。": "The data template contains blocking errors. Correct the listed sheet, row, and column issues, then re-import it.",
  "未找到与样本和基因正确合并的有效 Cq/Ct/Cp。请检查结果文件与板布局的板名和孔位是否对应。": "No valid Cq/Ct/Cp values were joined to annotated sample/target wells. Check that plate names and well positions match between the result file and plate layout.",
  "仍有板布局对齐提示未处理。请修正孔位，或选中后确认该状态。": "Some plate-layout alignment alerts remain unresolved. Correct the wells or select them and confirm their state.",
  "结果文件未包含完整的 Sample/Target 信息，请再导入修正后的板布局。": "The result file does not contain complete Sample/Target information. Import the corrected plate layout.",
  "Tm/熔解结果与板布局已就绪，可进入熔解分析；相对定量仍需 Cq/Ct/Cp。": "Tm/melt results and the plate layout are ready. Melt analysis is available; relative quantification still requires Cq/Ct/Cp data.",
  "结果文件已包含板布局信息，无需另传布局；相对定量已就绪。": "The result file already contains the plate layout. Relative quantification is ready.",
  "仪器结果与板布局均已就绪；相对定量已自动计算。": "Instrument results and the plate layout are ready. Relative quantification has been calculated.",
  "当前分析从用户提供的 ΔCq/ΔΔCq 开始，无需板布局；计算结果已就绪。": "This analysis starts from user-supplied Delta Cq/Delta-delta Cq. No plate layout is required; calculation results are ready.",
  "用户计算结果未提供内参基因；数值仍可分析，但计算依据不完整。": "Reference Target(s) were not provided for the user-supplied calculations. Values remain analyzable, but the calculation basis is incomplete.",
  "多个来源文件提供了不同的内参基因集合；当前保留第一个集合，请复核来源文件。": "Source files provide conflicting Reference Target sets. The first set is retained; review the source files.",
  "多个来源文件提供了不同的内参处理方法；当前保留第一个方法，请复核来源文件。": "Source files provide conflicting reference methods. The first method is retained; review the source files.",
  "多个来源文件提供了不同的校准样本；当前保留第一个校准样本，请复核来源文件。": "Source files provide conflicting calibrators. The first calibrator is retained; review the source files.",
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
  const unsupported = message.match(/^暂不支持 (.+)；请选择 XLSX、CSV、TXT 或 TSV。$/);
  if (unsupported) return `${unsupported[1]} is not supported. Choose an XLSX, CSV, TXT, or TSV file.`;
  return message;
}
