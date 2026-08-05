"use client";

import type { CanonicalField, ImportedSource } from "@/packages/schemas/src";
import {
  CANONICAL_FIELD_LABELS,
  getSourceCapabilities,
  type ImportReadiness,
  type ImportSourceRole,
} from "@/packages/importers/src";

const FIELD_OPTIONS = Object.entries(CANONICAL_FIELD_LABELS) as [CanonicalField, string][];

const INSTRUMENT_LABELS: Record<string, string> = {
  generic: "通用表格",
  "roche-lightcycler-480": "Roche LightCycler 480",
  "quantstudio-5": "QuantStudio 5",
  "abi-7500": "ABI 7500 / Fast",
};

const ROLE_LABELS: Record<ImportSourceRole, string> = {
  "primary-result": "Cq / Ct 结果",
  "supplemental-result": "Tm / 熔解补充结果",
  "plate-layout": "板布局",
  unknown: "待确认",
};

interface ImportManagerProps {
  sources: ImportedSource[];
  readiness: ImportReadiness;
  loading: boolean;
  error: string;
  hasDataset: boolean;
  onPickResults: () => void;
  onPickLayout: () => void;
  onRemoveSource: (sourceId: string) => void;
  onUpdateSelectedTable: (sourceId: string, tableId: string) => void;
  onUpdateMapping: (sourceId: string, sourceColumn: string, canonicalField: CanonicalField | null) => void;
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
  const table = source.tables.find((item) => item.id === source.selectedTableId) ?? source.tables[0];
  const capabilities = getSourceCapabilities(source);
  return (
    <article className="source-row">
      <div className={`source-type source-type-${capabilities.role}`} aria-hidden="true">
        {source.fileType.toUpperCase()}
      </div>
      <div className="source-main">
        <div className="source-title-row">
          <div>
            <h4>{source.fileName}</h4>
            <p>{INSTRUMENT_LABELS[source.instrumentType]} · {ROLE_LABELS[capabilities.role]}</p>
          </div>
          <div className="source-actions">
            <span className={`role-badge role-${capabilities.role}`}>{ROLE_LABELS[capabilities.role]}</span>
            <button className="icon-button" type="button" onClick={onRemove} aria-label={`移除 ${source.fileName}`}>×</button>
          </div>
        </div>

        {source.tables.length > 1 && (
          <label className="compact-field">使用工作表
            <select value={source.selectedTableId} onChange={(event) => onUpdateSelectedTable(event.target.value)}>
              {source.tables.map((item) => (
                <option key={item.id} value={item.id}>{item.sourceSheet} · {item.rawRows.length} 行</option>
              ))}
            </select>
          </label>
        )}

        {source.warnings.map((warning) => <p className="inline-warning" key={warning}>△ {warning}</p>)}

        {table && (
          <details className="mapping-details">
            <summary>
              查看字段识别
              <span>{table.suggestedMappings.filter((item) => item.conflict).length ? "有字段需要确认" : `${table.suggestedMappings.length} 列已读取`}</span>
            </summary>
            <div className="mapping-list">
              <div className="mapping-head"><span>输入列</span><span>统一字段</span><span>置信度</span></div>
              {table.suggestedMappings.map((mapping) => (
                <div className={mapping.conflict ? "mapping-row conflict" : "mapping-row"} key={mapping.sourceColumn}>
                  <code>{mapping.sourceColumn}</code>
                  <select
                    value={mapping.canonicalField ?? ""}
                    onChange={(event) => onUpdateMapping(mapping.sourceColumn, (event.target.value || null) as CanonicalField | null)}
                  >
                    <option value="">不导入</option>
                    {FIELD_OPTIONS.map(([field, label]) => <option value={field} key={field}>{label}</option>)}
                  </select>
                  <span>{Math.round(mapping.confidence * 100)}%{mapping.conflict ? " · 冲突" : ""}</span>
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
  onPickResults,
  onPickLayout,
  onRemoveSource,
  onUpdateSelectedTable,
  onUpdateMapping,
  onRebuild,
  onContinue,
}: ImportManagerProps) {
  const resultSources = sources.filter((source) => getSourceCapabilities(source).role !== "plate-layout");
  const layoutSources = sources.filter((source) => getSourceCapabilities(source).role === "plate-layout");

  return (
    <section className="intake-shell">
      <div className="intake-heading">
        <div>
          <p className="eyebrow">DATA INTAKE</p>
          <h2>结果与板布局，分开导入</h2>
          <p>先读取仪器结果，再判断它是否已经包含 Sample 和 Target。缺少布局时，系统才会要求第二类文件。</p>
        </div>
        <div className={`readiness-badge readiness-${readiness.status}`}>
          <span />{readiness.status === "ready" ? "分析已就绪" : readiness.status === "review-mapping" ? "需确认映射" : "等待数据"}
        </div>
      </div>

      {loading && <div className="notice">正在当前浏览器中解析文件…</div>}
      {error && <div className="notice error">{error}</div>}

      <div className="import-stage-grid">
        <article className="import-stage primary-stage">
          <div className="stage-number">01</div>
          <div className="stage-copy">
            <p className="stage-kicker">必需</p>
            <h3>仪器结果</h3>
            <p>导入 Cq/Ct/Cp；Tm 与熔解结果也放在这里。可以连续添加多个结果文件。</p>
          </div>
          <button className="primary-button" type="button" onClick={onPickResults}>+ 添加结果文件</button>
          <div className="stage-files">
            {resultSources.length === 0 ? <div className="stage-empty">尚未添加仪器结果</div> : resultSources.map((source) => (
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

        <article className={`import-stage ${readiness.layoutRequired ? "required-stage" : "optional-stage"}`}>
          <div className="stage-number">02</div>
          <div className="stage-copy">
            <p className="stage-kicker">{readiness.layoutRequired ? "当前需要" : "按需"}</p>
            <h3>板布局</h3>
            <p>{readiness.resultIncludesPlateLayout ? "结果文件已带 Sample/Target，这一步可以跳过。" : "结果中没有完整的样本和基因信息时，再导入修正后的布局表。"}</p>
          </div>
          <button className="secondary-button" type="button" onClick={onPickLayout}>+ 添加板布局</button>
          <div className="stage-files">
            {layoutSources.length === 0 ? (
              <div className="stage-empty">{readiness.resultIncludesPlateLayout ? "无需单独导入" : "尚未添加板布局"}</div>
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

      <div className={`readiness-panel readiness-${readiness.status}`}>
        <div className="readiness-icon">{readiness.status === "ready" ? "✓" : readiness.status === "review-mapping" ? "!" : "→"}</div>
        <div>
          <strong>{readiness.message}</strong>
          <p>已读取 {readiness.primaryResultCount} 个主结果、{readiness.supplementalResultCount} 个补充结果、{readiness.layoutCount} 个布局文件。文件仍可继续添加或移除。</p>
        </div>
        <div className="readiness-actions">
          {readiness.canAnalyze && <button className="quiet-button bordered" type="button" onClick={onRebuild}>重新合并并计算</button>}
          <button className="primary-button" type="button" disabled={!hasDataset} onClick={onContinue}>进入分析概览 →</button>
        </div>
      </div>
    </section>
  );
}
