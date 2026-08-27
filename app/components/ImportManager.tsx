"use client";

import { useRef, useState, type DragEvent } from "react";
import type { AnalysisStart, CanonicalField, ImportedSource } from "@/packages/schemas/src";
import {
  CANONICAL_FIELD_LABELS,
  getSourceCapabilities,
  validateQpcrInputTemplate,
  writeQpcrInputTemplate,
  type ImportReadiness,
  type ImportSourceRole,
} from "@/packages/importers/src";
import { localizeRuntimeMessage, useLanguage } from "../i18n";

const FIELD_OPTIONS = Object.entries(CANONICAL_FIELD_LABELS) as [CanonicalField, string][];

const INSTRUMENT_LABELS: Record<string, string> = {
  generic: "Generic table",
  "roche-lightcycler-480": "Roche LightCycler 480",
  "quantstudio-5": "QuantStudio 5",
  "abi-7500": "ABI 7500 / Fast",
};

function roleLabel(role: ImportSourceRole, l: (zh: string, en: string) => string): string {
  return {
    "primary-result": l("Cq / Ct 结果", "Cq / Ct result"),
    "supplemental-result": l("Tm / 熔解补充结果", "Tm / melt supplemental result"),
    "plate-layout": l("板布局", "Plate layout"),
    unknown: l("待确认", "Needs confirmation"),
  }[role];
}

function FileDropzone({
  kind,
  loading,
  onPick,
  onFiles,
}: {
  kind: "results" | "layout";
  loading: boolean;
  onPick: () => void;
  onFiles: (files: FileList | File[]) => void | Promise<void>;
}) {
  const { l } = useLanguage();
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (event: DragEvent<HTMLButtonElement>) => Array.from(event.dataTransfer.types).includes("Files");

  function handleDragEnter(event: DragEvent<HTMLButtonElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLButtonElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragActive(false);
    if (!loading && event.dataTransfer.files.length) void onFiles(event.dataTransfer.files);
  }

  const isResults = kind === "results";
  return (
    <button
      className={`file-dropzone ${dragActive ? "is-dragging" : ""} ${loading ? "is-loading" : ""}`}
      type="button"
      aria-busy={loading}
      aria-disabled={loading}
      onClick={() => { if (!loading) onPick(); }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className="dropzone-icon" aria-hidden="true">↓</span>
      <span><b>{isResults ? l("拖入仪器结果文件", "Drop instrument result files") : l("拖入板布局文件", "Drop a plate-layout file")}</b><small>{l("拖到这里，或点击选择", "Drop here, or click to browse")}</small></span>
      <em>XLSX · CSV · TXT · TSV</em>
    </button>
  );
}

interface ImportManagerProps {
  sources: ImportedSource[];
  readiness: ImportReadiness;
  loading: boolean;
  error: string;
  hasDataset: boolean;
  alignmentReviewRequired: boolean;
  resultWithoutAnnotationCount: number;
  annotationWithoutResultCount: number;
  analysisStart: AnalysisStart;
  onPickResults: () => void;
  onPickLayout: () => void;
  onImportFiles: (files: FileList | File[]) => void | Promise<void>;
  onRemoveSource: (sourceId: string) => void;
  onUpdateSelectedTable: (sourceId: string, tableId: string) => void;
  onUpdateMapping: (sourceId: string, sourceColumn: string, canonicalField: CanonicalField | null) => void;
  onAnalysisStartChange: (analysisStart: AnalysisStart) => void;
  onRebuild: () => void;
  onContinue: () => void;
}

function SourceCard({
  source,
  onRemove,
  onUpdateSelectedTable,
  onUpdateMapping,
}: {
  source: ImportedSource;
  onRemove: () => void;
  onUpdateSelectedTable: (tableId: string) => void;
  onUpdateMapping: (sourceColumn: string, canonicalField: CanonicalField | null) => void;
}) {
  const { language, l } = useLanguage();
  const table = source.tables.find((item) => item.id === source.selectedTableId) ?? source.tables[0];
  const capabilities = getSourceCapabilities(source);
  const templateValidation = validateQpcrInputTemplate(source);
  const sourceRole = roleLabel(capabilities.role, l);
  return (
    <article className="source-row">
      <div className={`source-type source-type-${capabilities.role}`} aria-hidden="true">
        {source.fileType.toUpperCase()}
      </div>
      <div className="source-main">
        <div className="source-title-row">
          <div>
            <h4>{source.fileName}</h4>
            <p>{source.instrumentType === "generic" ? l("通用表格", "Generic table") : INSTRUMENT_LABELS[source.instrumentType]} · {sourceRole}</p>
          </div>
          <div className="source-actions">
            <span className={`role-badge role-${capabilities.role}`}>{sourceRole}</span>
            <button className="icon-button" type="button" onClick={onRemove} aria-label={l(`移除 ${source.fileName}`, `Remove ${source.fileName}`)}>×</button>
          </div>
        </div>

        {source.tables.length > 1 && (
          <label className="compact-field">{l("使用工作表", "Worksheet")}
            <select value={source.selectedTableId} onChange={(event) => onUpdateSelectedTable(event.target.value)}>
              {source.tables.map((item) => (
                <option key={item.id} value={item.id}>{item.sourceSheet} · {item.rawRows.length} {l("行", "rows")}</option>
              ))}
            </select>
          </label>
        )}

        {source.warnings.map((warning) => <p className="inline-warning" key={warning}>△ {localizeRuntimeMessage(warning, language)}</p>)}

        {templateValidation && (
          <div className={`template-validation-summary ${templateValidation.errorCount ? "has-errors" : "is-valid"}`}>
            <div><strong>{templateValidation.errorCount ? l("模板需要修正", "Template requires correction") : l("模板校验通过", "Template validation passed")}</strong><span>{l(
              `${templateValidation.totalRows} 行 · ${templateValidation.detectedCount} 个有效数值 · ${templateValidation.nonDetectedCount} 个未检出 · ${templateValidation.warningCount} 条提醒 · ${templateValidation.errorCount} 个错误`,
              `${templateValidation.totalRows} rows · ${templateValidation.detectedCount} detected · ${templateValidation.nonDetectedCount} non-detected · ${templateValidation.warningCount} warning(s) · ${templateValidation.errorCount} error(s)`,
            )}</span></div>
            {templateValidation.issues.length > 0 && <details><summary>{l("查看逐行校验", "Review row-level validation")}</summary><ul>{templateValidation.issues.slice(0, 20).map((item, index) => <li key={`${item.code}-${item.sourceRowNumber}-${index}`} className={item.severity}><b>{item.sourceSheet}{item.sourceRowNumber ? ` · ${l("第", "row ")}${item.sourceRowNumber}${language === "zh" ? " 行" : ""}` : ""} · {item.column}</b><span>{language === "zh" ? item.messageZh : item.messageEn}</span></li>)}</ul>{templateValidation.issues.length > 20 && <p>{l(`另有 ${templateValidation.issues.length - 20} 条，请修正前述问题后重新导入。`, `${templateValidation.issues.length - 20} more issue(s); correct the listed problems and re-import.`)}</p>}</details>}
          </div>
        )}

        {table && (
          <details className="mapping-details">
            <summary>
              {l("查看字段识别", "Review field detection")}
              <span>{table.suggestedMappings.filter((item) => item.conflict).length ? l("有字段需要确认", "Fields require confirmation") : l(`${table.suggestedMappings.length} 列已读取`, `${table.suggestedMappings.length} columns read`)}</span>
            </summary>
            <div className="mapping-list">
              <div className="mapping-head"><span>{l("输入列", "Input column")}</span><span>{l("统一字段", "Canonical field")}</span><span>{l("置信度", "Confidence")}</span></div>
              {table.suggestedMappings.map((mapping) => (
                <div className={mapping.conflict ? "mapping-row conflict" : "mapping-row"} key={mapping.sourceColumn}>
                  <code>{mapping.sourceColumn}</code>
                  <select
                    value={mapping.canonicalField ?? ""}
                    onChange={(event) => onUpdateMapping(mapping.sourceColumn, (event.target.value || null) as CanonicalField | null)}
                  >
                    <option value="">{l("不导入", "Do not import")}</option>
                    {FIELD_OPTIONS.map(([field, label]) => <option value={field} key={field}>{language === "en" && field === "cqMean" ? "Cq Mean (summary value)" : label}</option>)}
                  </select>
                  <span>{Math.round(mapping.confidence * 100)}%{mapping.conflict ? l(" · 冲突", " · conflict") : ""}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}

export default function ImportManager({
  sources,
  readiness,
  loading,
  error,
  hasDataset,
  alignmentReviewRequired,
  resultWithoutAnnotationCount,
  annotationWithoutResultCount,
  analysisStart,
  onPickResults,
  onPickLayout,
  onImportFiles,
  onRemoveSource,
  onUpdateSelectedTable,
  onUpdateMapping,
  onAnalysisStartChange,
  onRebuild,
  onContinue,
}: ImportManagerProps) {
  const { language, l } = useLanguage();
  const calculationOnly = analysisStart !== "cq";
  const resultSources = sources.filter((source) => getSourceCapabilities(source).role !== "plate-layout");
  const layoutSources = sources.filter((source) => getSourceCapabilities(source).role === "plate-layout");

  function downloadInputTemplate() {
    const bytes = writeQpcrInputTemplate();
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "qpcr-analysis-input-template-v2.1.0.xlsx";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="intake-shell">
      <div className="intake-heading">
        <div>
          <p className="eyebrow">DATA INTAKE</p>
          <h2>{l("分类型导入，再统一分析", "Import by type, then analyze together")}</h2>
          <p>{l("Cq 用于相对定量；Tm/熔解结果用于峰值与分组复核。系统读取结果后，只有缺少 Sample/Target 时才要求板布局。", "Cq supports relative quantification; Tm/melt results support peak and grouping review. A separate plate layout is required only when Sample/Target information is missing.")}</p>
        </div>
        <div className={`readiness-badge readiness-${alignmentReviewRequired ? "alignment-review" : readiness.status}`}>
          <span />{alignmentReviewRequired ? l("需复核板布局", "Review plate layout") : readiness.status === "ready" ? l("分析已就绪", "Ready") : readiness.status === "review-mapping" ? l("需确认映射", "Confirm mapping") : l("等待数据", "Waiting for data")}
        </div>
      </div>

      {loading && <div className="notice">{l("正在当前浏览器中解析文件…", "Parsing files in this browser…")}</div>}
      {error && <div className="notice error">{localizeRuntimeMessage(error, language)}</div>}
      {alignmentReviewRequired && (
        <div className="notice alignment-review-notice">
          <strong>{l("检测到结果与板布局可能错位", "Possible result/layout misalignment detected")}</strong>
          <span>{l(
            `${resultWithoutAnnotationCount} 个孔有 Cp 但缺少 Sample/Target；${annotationWithoutResultCount} 个已定义孔没有 Cp。原始 Cp 已保留，请进入板工作区修正布局后再计算。`,
            `${resultWithoutAnnotationCount} well(s) have Cp but no Sample/Target; ${annotationWithoutResultCount} annotated well(s) have no Cp. Raw Cp values are preserved. Correct the layout in Plate Workspace before calculation.`,
          )}</span>
        </div>
      )}

      <section className="analysis-start-panel" aria-label={l("选择分析起点", "Select analysis start")}>
        <div>
          <p className="eyebrow">ANALYSIS START</p>
          <h3>{l("选择分析起点", "Select analysis start")}</h3>
          <p>{l("一次分析只使用一个正式起点；其他已填写数值仅保留用于溯源和核验。", "One authoritative start is used per analysis; other supplied values are retained only for provenance and checks.")}</p>
        </div>
        <div className="analysis-start-options" role="radiogroup" aria-label={l("分析起点", "Analysis start")}>
          {([
            ["cq", l("从 Cq/Ct/Cp 开始", "Start from Cq/Ct/Cp"), l("完整孔级 QC 与归一化", "Full well-level QC and normalization")],
            ["delta-cq", l("从 ΔCq 开始", "Start from ΔCq"), l("用户已完成内参归一化", "Reference normalization already completed")],
            ["delta-delta-cq", l("从 ΔΔCq 开始", "Start from ΔΔCq"), l("用户已完成归一化和校准", "Normalization and calibration already completed")],
          ] as Array<[AnalysisStart, string, string]>).map(([value, label, description]) => (
            <button
              type="button"
              role="radio"
              aria-checked={analysisStart === value}
              className={analysisStart === value ? "analysis-start-option active" : "analysis-start-option"}
              key={value}
              onClick={() => onAnalysisStartChange(value)}
            >
              <span>{analysisStart === value ? "●" : "○"}</span><b>{label}</b><small>{description}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="import-stage-grid" aria-label={l("分阶段数据导入", "Staged data import")}>
        <article className="import-stage primary-stage">
          <div className="stage-header">
            <div className="stage-number">01</div>
            <div className="stage-copy">
              <div className="stage-title-line"><h3>{l("仪器结果", "Instrument results")}</h3><span className="stage-kicker">{l("必需", "Required")}</span></div>
              <p>{calculationOnly
                ? l("导入包含 Sample、Assay、Replicate 及所选 Δ 值的表格；无需板布局。", "Import a table containing Sample, Assay, Replicate, and the selected delta value; no plate layout is required.")
                : l("可连续添加 Cq/Ct/Cp、Tm 或熔解分组文件；具备板信息后即可进入对应结果页。", "Add multiple Cq/Ct/Cp, Tm, or melt-group files. Analysis becomes available when plate information is present.")}</p>
            </div>
            <div className="stage-header-actions">
              <button className="quiet-button bordered template-download-button" type="button" onClick={downloadInputTemplate}>↓ {l("下载数据导入模板", "Download input template")}</button>
              <button className="primary-button" type="button" disabled={loading} onClick={onPickResults}>+ {l("添加结果", "Add results")}</button>
            </div>
          </div>
          <div className="stage-files">
            <FileDropzone kind="results" loading={loading} onPick={onPickResults} onFiles={onImportFiles} />
            {resultSources.length === 0 ? <div className="stage-empty">{l("尚未添加仪器结果", "No instrument results added")}</div> : resultSources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                onRemove={() => onRemoveSource(source.id)}
                onUpdateSelectedTable={(tableId) => onUpdateSelectedTable(source.id, tableId)}
                onUpdateMapping={(sourceColumn, canonicalField) => onUpdateMapping(source.id, sourceColumn, canonicalField)}
              />
            ))}
          </div>
        </article>

        <article className={`import-stage ${calculationOnly ? "not-applicable-stage" : readiness.layoutRequired ? "required-stage" : "optional-stage"}`}>
          <div className="stage-header">
            <div className="stage-number">02</div>
            <div className="stage-copy">
              <div className="stage-title-line"><h3>{l("板布局", "Plate layout")}</h3><span className="stage-kicker">{calculationOnly ? l("不适用", "Not applicable") : readiness.layoutRequired ? l("当前需要", "Required now") : l("按需", "If needed")}</span></div>
              <p>{calculationOnly ? l("当前从用户提供的 ΔCq/ΔΔCq 开始，不导入或推断物理孔板。", "This analysis starts from user-supplied Delta Cq/Delta-delta Cq; no physical plate is imported or inferred.") : readiness.resultIncludesPlateLayout ? l("结果已带 Sample/Target，可跳过；如需纠正错位，仍可追加修正版。", "Sample/Target information is already present. Skip this step or add a corrected layout to fix offsets.") : l("结果缺少完整样本和基因信息时，导入修正后的布局表。", "Import the corrected layout when result files lack complete sample and target information.")}</p>
            </div>
            <button className="secondary-button" type="button" disabled={loading || calculationOnly} onClick={onPickLayout}>+ {l("添加布局", "Add layout")}</button>
          </div>
          <div className="stage-files">
            {!calculationOnly && <FileDropzone kind="layout" loading={loading} onPick={onPickLayout} onFiles={onImportFiles} />}
            {layoutSources.length === 0 ? (
              <div className="stage-empty">{calculationOnly ? l("计算结果分析无需板布局", "No plate layout for calculation-only analysis") : readiness.resultIncludesPlateLayout ? l("无需单独导入", "No separate layout required") : l("尚未添加板布局", "No plate layout added")}</div>
            ) : layoutSources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                onRemove={() => onRemoveSource(source.id)}
                onUpdateSelectedTable={(tableId) => onUpdateSelectedTable(source.id, tableId)}
                onUpdateMapping={(sourceColumn, canonicalField) => onUpdateMapping(source.id, sourceColumn, canonicalField)}
              />
            ))}
          </div>
        </article>
      </div>

      <div className={`readiness-panel readiness-${alignmentReviewRequired ? "alignment-review" : readiness.status}`}>
        <div className="readiness-icon">{alignmentReviewRequired ? "!" : readiness.status === "ready" ? "✓" : readiness.status === "review-mapping" ? "!" : "→"}</div>
        <div>
          <strong>{alignmentReviewRequired ? l("文件已解析，需复核板布局后再计算", "Files parsed; review the plate layout before calculation") : localizeRuntimeMessage(readiness.message, language)}</strong>
          <p>{l(`已读取 ${readiness.primaryResultCount} 个 Cq 结果、${readiness.supplementalResultCount} 个 Tm/熔解结果、${readiness.layoutCount} 个布局文件。进入分析后仍可返回追加或替换。`, `${readiness.primaryResultCount} Cq result(s), ${readiness.supplementalResultCount} Tm/melt result(s), and ${readiness.layoutCount} layout file(s) loaded. You can return later to add or replace files.`)}</p>
        </div>
        <div className="readiness-actions">
          {readiness.canAnalyze && <button className="quiet-button bordered" type="button" onClick={onRebuild}>{l("重新合并并计算", "Re-merge & calculate")}</button>}
          <button className="primary-button" type="button" disabled={!hasDataset} onClick={onContinue}>{alignmentReviewRequired ? l("检查并修正板布局", "Review & correct layout") : readiness.analysisMode === "melt-only" ? l("进入熔解分析", "Open melt analysis") : l("进入分析", "Open analysis")} →</button>
        </div>
      </div>
    </section>
  );
}
