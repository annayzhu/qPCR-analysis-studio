"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildLogRatioAxis, mapRatioToY, chartLabelVisualUnits, wrapChartLabel } from "@/packages/qpcr-core/src";
import { useLanguage } from "../i18n";
import { facetChartRows } from "@/packages/qpcr-core/src/workflow-charts";
import { ChartPresentationContext } from "./ChartPresentation";
import { ResultsRail } from "./ResultsRail";
import { downloadBlob } from "../download";
export type ChartTheme = "dark" | "paper";
export type AxisMode = "log-ratio" | "linear";

/** Presentation data only. Upstream Cq and supplied delta values keep separate calculators. */
export interface ExpressionChartRow {
  label: string;
  rawValue: number | null;
  propagatedSd: number | null;
  targetValidReplicates: number;
  referenceValidReplicates: Record<string, number>;
  warning: boolean;
  calibrator: boolean;
}

function axisTickLabel(value: number): string {
  if (value >= 1) return Number.isInteger(value) ? String(value) : value.toFixed(1);
  return value >= 0.1 ? value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : value.toPrecision(2);
}

function safeFileName(value: string): string {
  return value.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-") || "qpcr-expression";
}

/** Saved figures, downloads and print use this width, so they do not depend on the window they were made in. */
const EXPORT_WIDTH = 680;
const EXPORT_PLOT_HEIGHT = 170;
const UNIT_WIDTH = 6.9;
const CHART_FONT = "Arial, Helvetica, 'PingFang SC', sans-serif";

type PlottedRow = ExpressionChartRow & { rawValue: number };
const CHART_COLORS: Record<ChartTheme, Record<string, string>> = {
  dark: {
    background: "#183330", border: "#55736e", text: "#f2f5f3", muted: "#c0cfcb",
    axis: "#d2dcda", grid: "#42605b", bar: "#70aaa2", calibrator: "#c8b9a7", calibratorStroke: "#eadfd2",
    warning: "#e2ad65", reference: "#e2ad65",
  },
  paper: {
    background: "#ffffff", border: "#ded8d0", text: "#292d2e", muted: "#60686a",
    axis: "#343a3b", grid: "#e7ded4", bar: "#4f827c", calibrator: "#d7cdc0", calibratorStroke: "#746c64",
    warning: "#b36b45", reference: "#a66a3f",
  },
};

interface ChartSvgProps {
  rows: PlottedRow[];
  axisRows: ExpressionChartRow[];
  displayNames?: Record<string, string>;
  target: string;
  showTechnicalSd: boolean;
  theme: ChartTheme;
  axisMode: AxisMode;
  width: number;
  plotHeight?: number;
  fitHeight?: number;
  fixedSize?: boolean;
  svgRef?: React.Ref<SVGSVGElement>;
  l: (zh: string, en: string) => string;
}

/** One figure laid out for a real width: labels wrap to the room their category actually has. */
function ChartSvg({ rows: chartRows, axisRows, displayNames, target, showTechnicalSd, theme, axisMode, width: requestedWidth, plotHeight, fitHeight, fixedSize, svgRef, l }: ChartSvgProps) {
  const values = axisRows.filter(row=>row.rawValue!==null && row.rawValue>0).flatMap((entry) => {
    const row=entry as PlottedRow;
    if (!showTechnicalSd || row.propagatedSd === null) return [row.rawValue];
    const lower = row.rawValue - row.propagatedSd;
    return lower > 0
      ? [lower, row.rawValue, row.rawValue + row.propagatedSd]
      : [row.rawValue, row.rawValue + row.propagatedSd];
  });
  const left = 86;
  const right = 22;
  const top = 42;
  const minimumSlotWidth = chartRows.length > 16 ? 36 : chartRows.length > 8 ? 46 : 54;
  const width = Math.max(requestedWidth, left + right + chartRows.length * minimumSlotWidth);
  const plotWidth = width - left - right;
  const slotWidth = plotWidth / chartRows.length;
  const wrappedSampleLabels = chartRows.map((row) => wrapChartLabel(displayNames?.[row.label] || row.label, Math.max(5, Math.floor((slotWidth - 8) / UNIT_WIDTH))));
  const maxLabelLines = Math.max(...wrappedSampleLabels.map((lines) => lines.length));
  const labelLineHeight = 16;
  const labelBlock = 15 + (maxLabelLines - 1) * labelLineHeight + 21 + 17;
  const plot = fitHeight ? Math.max(180, fitHeight - top - labelBlock) : plotHeight ?? EXPORT_PLOT_HEIGHT;
  const bottom = top + plot;
  const labelTop = bottom + 15;
  const axisTitleY = labelTop + (maxLabelLines - 1) * labelLineHeight + 21;
  const height = axisTitleY + 17;
  const barWidth = Math.min(72, slotWidth * .46);
  const ratioAxis = buildLogRatioAxis(values);
  const linearMax = Math.max(1.2, Math.max(...values) * 1.14);
  const linearTicks = Array.from({ length: 6 }, (_, index) => (linearMax / 5) * index);
  const ticks = axisMode === "log-ratio" ? ratioAxis.tickValues : linearTicks;
  const y = (value: number) => axisMode === "log-ratio"
    ? mapRatioToY(value, ratioAxis, top, bottom)
    : bottom - (Math.min(linearMax, Math.max(0, value)) / linearMax) * (bottom - top);
  const referenceY = y(1);
  const colors = CHART_COLORS[theme];
  const usesCalibrator = chartRows.some((row) => row.calibrator);
  return (
        <svg
          ref={svgRef}
          xmlns="http://www.w3.org/2000/svg"
          className="expression-chart publication-expression-chart"
          viewBox={`0 0 ${width} ${height}`}
          width={fixedSize ? width : undefined}
          height={fixedSize ? height : undefined}
          role="img"
          aria-label={l(`${target} 相对表达量图`, `${target} relative-expression chart`)}
          fontFamily={CHART_FONT}
          style={fixedSize ? undefined : { width: `${width}px`, background: colors.background }}
        >
          <rect x="0" y="0" width={width} height={height} fill={colors.background} />
          {theme === "dark" && <rect x="1" y="1" width={width - 2} height={height - 2} fill="none" stroke={colors.border} strokeWidth="1" />}
          <g transform={`translate(${left}, 22)`}>
            <line x1="0" x2="16" y1="-1" y2="-1" stroke={colors.reference} strokeDasharray="4 3" />
            <text x="22" y="2" fill={colors.muted} fontSize="13">Reference = 1</text>
            {usesCalibrator && <g transform="translate(122, 0)"><rect x="0" y="-7" width="10" height="10" fill={colors.calibrator} stroke={colors.calibratorStroke} strokeWidth=".8" /><text x="15" y="2" fill={colors.muted} fontSize="13">{l("校准样本", "Calibrator")}</text></g>}
            {showTechnicalSd && <g transform={`translate(${usesCalibrator ? 218 : 112}, 0)`}>
              <line x1="5" x2="5" y1="-7" y2="5" stroke={colors.axis} strokeWidth="1" />
              <line x1="1" x2="9" y1="-7" y2="-7" stroke={colors.axis} strokeWidth="1" />
              <line x1="1" x2="9" y1="5" y2="5" stroke={colors.axis} strokeWidth="1" />
              <text x="15" y="2" fill={colors.muted} fontSize="13">{l("技术 SD", "Technical SD")}</text>
            </g>}
          </g>

          {ticks.map((tick) => {
            const tickY = y(tick);
            return (
              <g key={tick}>
                <line x1={left} x2={width - right} y1={tickY} y2={tickY} stroke={colors.grid} strokeWidth=".8" />
                <line x1={left - 5} x2={left} y1={tickY} y2={tickY} stroke={colors.axis} strokeWidth="1" />
                <text x={left - 10} y={tickY + 3.5} textAnchor="end" fill={colors.muted} fontSize="13">{axisTickLabel(tick)}</text>
              </g>
            );
          })}
          <line x1={left} x2={left} y1={top} y2={bottom} stroke={colors.axis} strokeWidth="1" />
          <line x1={left} x2={width - right} y1={bottom} y2={bottom} stroke={colors.axis} strokeWidth="1" />
          {referenceY >= top && referenceY <= bottom && (
            <line x1={left} x2={width - right} y1={referenceY} y2={referenceY} stroke={colors.reference} strokeWidth="1.2" strokeDasharray="5 4" />
          )}
          {chartRows.map((row, index) => {
            const centerX = left + slotWidth * (index + .5);
            const barTop = y(row.rawValue);
            const barHeight = Math.max(1, bottom - barTop);
            const labelLines = wrappedSampleLabels[index];
            const lowerError = row.propagatedSd === null ? null : Math.max(0, row.rawValue - row.propagatedSd);
            const upperError = row.propagatedSd === null ? null : row.rawValue + row.propagatedSd;
            const errorTop = upperError === null ? null : y(upperError);
            const errorBottom = lowerError === null ? null : axisMode === "log-ratio" && lowerError === 0 ? bottom : y(lowerError);
            const replicateTitle = Object.entries(row.referenceValidReplicates)
              .map(([reference, count]) => `${reference} n=${count}`)
              .join(", ");
            return (
              <g key={`${row.label}-${index}`}>
                <title>{row.label}: {row.rawValue.toFixed(4)}{showTechnicalSd && row.propagatedSd !== null ? ` ± ${row.propagatedSd.toFixed(4)} ${l("技术复孔传播 SD", "propagated technical SD")}` : ""} · {target} n={row.targetValidReplicates}{replicateTitle ? `; ${replicateTitle}` : ""}{row.warning ? l(" · QC 提示", " · QC warning") : ""}</title>
                <rect x={centerX - barWidth / 2} y={barTop} width={barWidth} height={barHeight} fill={row.calibrator ? colors.calibrator : colors.bar} fillOpacity=".9" stroke={row.warning ? colors.warning : row.calibrator ? colors.calibratorStroke : colors.axis} strokeWidth={row.warning ? 1.35 : .7} />
                {showTechnicalSd && errorTop !== null && errorBottom !== null && <g aria-label={l(`${row.label} 技术复孔传播 SD`, `${row.label} propagated technical-replicate SD`)}>
                  <line x1={centerX} x2={centerX} y1={errorTop} y2={errorBottom} stroke={colors.axis} strokeWidth="1.15" />
                  <line x1={centerX - 5} x2={centerX + 5} y1={errorTop} y2={errorTop} stroke={colors.axis} strokeWidth="1.15" />
                  <line x1={centerX - 5} x2={centerX + 5} y1={errorBottom} y2={errorBottom} stroke={colors.axis} strokeWidth="1.15" />
                </g>}
                {row.warning && <circle cx={centerX} cy={Math.max(top + 4, (errorTop ?? barTop) - 7)} r="3" fill={colors.background} stroke={colors.warning} strokeWidth="1.2" />}
                <text
                  x={centerX}
                  y={labelTop}
                  textAnchor="middle"
                  fill={colors.muted}
                  fontSize="13"
                  aria-label={row.label}
                >{labelLines.map((line, lineIndex) => <tspan key={`${line}-${lineIndex}`} x={centerX} dy={lineIndex === 0 ? 0 : labelLineHeight}>{line}</tspan>)}</text>
              </g>
            );
          })}
          <text x={(left + width - right) / 2} y={axisTitleY} textAnchor="middle" fill={colors.text} fontSize="12">{l("样本", "Sample")}</text>
          <text x="20" y={(top + bottom) / 2} textAnchor="middle" transform={`rotate(-90 20 ${(top + bottom) / 2})`} fill={colors.text} fontSize="12">
            {axisMode === "log-ratio" ? "Relative expression (log₂ ratio axis)" : "Relative expression"}
          </text>
        </svg>
  );
}

function exportedFigure(props: Omit<ChartSvgProps, "width" | "fixedSize" | "svgRef" | "plotHeight" | "fitHeight">) {
  return renderToStaticMarkup(<ChartSvg {...props} width={EXPORT_WIDTH} fixedSize />);
}

function ExpressionPanel({
  rows,
  axisRows,
  displayNames,
  metricLabel,
  target,
  showTechnicalSd,
  theme,
  axisMode,
  exportFileStem,
  width,
  plotHeight,
  fitHeight,
  exportFigures,
}: {
  rows: PlottedRow[];
  axisRows: ExpressionChartRow[];
  displayNames: Record<string,string>;
  metricLabel: string;
  target: string;
  showTechnicalSd: boolean;
  theme: ChartTheme;
  axisMode: AxisMode;
  exportFileStem: string;
  width: number;
  plotHeight?: number;
  fitHeight?: number;
  exportFigures: string[];
}) {
  const { l } = useLanguage();
  const [exportError, setExportError] = useState("");
  const replicateSummary = rows.map((row) => {
    const referenceCounts = Object.entries(row.referenceValidReplicates)
      .map(([reference, count]) => `${reference} n=${count}`)
      .join(", ");
    return `${row.label}: ${target} n=${row.targetValidReplicates}${referenceCounts ? `; ${referenceCounts}` : ""}`;
  }).join(" · ");
  const colors = CHART_COLORS[theme];

  /** Every panel of the chart, stacked into one file. */
  function serializedSvg(): string {
    let offset = 0;
    let exportWidth = 0;
    const contents = exportFigures.map((figure) => {
      const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(figure)!;
      const figureWidth = Number(size[1]), figureHeight = Number(size[2]);
      const placed = figure.replace("<svg ", `<svg x="0" y="${offset}" `);
      offset += figureHeight;
      exportWidth = Math.max(exportWidth, figureWidth);
      return placed;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${exportWidth}" height="${offset}" viewBox="0 0 ${exportWidth} ${offset}">${contents}</svg>`;
  }

  function exportSvg() {
    downloadBlob(new Blob([serializedSvg()], { type: "image/svg+xml;charset=utf-8" }), `${exportFileStem}-${safeFileName(target)}-relative-expression.svg`);
  }

  async function exportPng() {
    const sourceUrl = URL.createObjectURL(new Blob([serializedSvg()], { type: "image/svg+xml;charset=utf-8" }));
    setExportError("");
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(l("图表渲染失败", "Chart rendering failed")));
        image.src = sourceUrl;
      });
      const scale = 4;
      const canvas = document.createElement("canvas");
      const exportWidth=image.naturalWidth,exportHeight=image.naturalHeight;
      canvas.width = exportWidth * scale;
      canvas.height = exportHeight * scale;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(l("浏览器无法创建图像画布", "The browser could not create an image canvas"));
      context.scale(scale, scale);
      context.fillStyle = colors.background;
      context.fillRect(0, 0, exportWidth, exportHeight);
      context.drawImage(image, 0, 0, exportWidth, exportHeight);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
      if (!blob) throw new Error(l("浏览器无法导出 PNG，请使用 SVG", "PNG export failed; please use SVG"));
      downloadBlob(blob, `${exportFileStem}-${safeFileName(target)}-relative-expression-4x.png`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  return (
    <div className={`chart-card publication-chart-card chart-theme-${theme}`}>
      <div className="chart-heading publication-chart-heading">
        <div><h3>{target}</h3><p>{metricLabel}</p></div>
        <div className="chart-export-actions compact-chart-export-actions">
          <button type="button" onClick={exportSvg}>SVG</button>
          <button type="button" onClick={() => void exportPng()}>PNG 4×</button>
        </div>
      </div>
      {exportError && <p role="alert">{exportError}</p>}
      <div className="chart-scroll">
        <ChartSvg rows={rows} axisRows={axisRows} displayNames={displayNames} target={target} showTechnicalSd={showTechnicalSd} theme={theme} axisMode={axisMode} width={width} plotHeight={plotHeight} fitHeight={fitHeight} l={l} />
      </div>
      <details className="chart-replicate-details"><summary>{l("有效技术复孔 n", "Valid technical-replicate n")}</summary><p>{replicateSummary}</p></details>
    </div>
  );
}

/** Long names need wider categories, so fewer of them share a panel. */
function panelSize(names: string[]) {
  const longest = Math.max(0, ...names.map(chartLabelVisualUnits));
  return longest <= 12 ? 12 : longest <= 24 ? 8 : 6;
}

export default function ExpressionChart(props: {
  rows: ExpressionChartRow[];
  metricLabel: string;
  target: string;
  targets: string[];
  sampleOrder: string[];
  showTechnicalSd: boolean;
  theme: ChartTheme;
  axisMode: AxisMode;
  exportFileStem: string;
}) {
 const {l}=useLanguage();
 const {config,update}=useContext(ChartPresentationContext);
 const [facet,setFacet]=useState(0);
 const [wholeChart,setWholeChart]=useState(false);
 const [expanded,setExpanded]=useState(false);
 const [size,setSize]=useState({width:880,height:0,windowHeight:800});
 const root=useRef<HTMLDivElement>(null);
 const valid=props.rows.filter((row):row is PlottedRow=>row.rawValue!==null && Number.isFinite(row.rawValue) && row.rawValue>0).sort((a,b)=>props.sampleOrder.indexOf(a.label)-props.sampleOrder.indexOf(b.label));
 const setting={showTechnicalSd:props.showTechnicalSd,theme:props.theme,axisMode:props.axisMode};
 useEffect(()=>{const saved=config.settings[props.target];if(JSON.stringify(saved)!==JSON.stringify(setting))update({settings:{...config.settings,[props.target]:setting}});},[props.showTechnicalSd,props.theme,props.axisMode]);
 useEffect(()=>{if(!expanded)return;const prior=document.activeElement as HTMLElement;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();event.preventDefault();setExpanded(false);prior?.focus();}};document.addEventListener('keydown',escape,true);return()=>document.removeEventListener('keydown',escape,true);},[expanded]);
 useEffect(()=>{
  const element=root.current;
  if(!element)return;
  const measure=()=>{if(element.clientWidth)setSize({width:element.clientWidth,height:element.clientHeight,windowHeight:window.innerHeight});};
  measure();
  const observer=new ResizeObserver(measure);
  observer.observe(element);
  return()=>observer.disconnect();
 },[expanded]);
 const names=Object.fromEntries(valid.map((row,index)=>{const name=config.names[row.label] || row.label;const duplicates=valid.filter(item=>(config.names[item.label] || item.label)===name).length;return [row.label,duplicates>1?`${name} [${index+1}]`:name];}));
 const facets=facetChartRows(valid,panelSize(Object.values(names)));
 const figureProps={axisRows:valid,displayNames:names,target:props.target,showTechnicalSd:props.showTechnicalSd,theme:props.theme,axisMode:props.axisMode,l};
 const exportFigures=useMemo(()=>facets.map(rows=>exportedFigure({...figureProps,rows})),[JSON.stringify(names),JSON.stringify(valid),props.target,props.showTechnicalSd,props.theme,props.axisMode,l]);
 const selected=config.selectedTargets.includes(props.target);
 const active=config.overview || !config.activeTarget || config.activeTarget===props.target;
 const showPicker=props.targets.length>1 && (!config.overview || props.targets[0]===props.target);
 const chartWidth=Math.max(320,size.width-(expanded?64:34));
 const plotHeight=Math.round(Math.min(chartWidth*.4,Math.max(220,size.windowHeight-400)));
 const panelProps={...props,axisRows:valid,displayNames:names,width:chartWidth,exportFigures};
 const fitHeight=expanded?Math.max(320,size.height-156):undefined;
 const shown=wholeChart?-1:Math.min(facet,facets.length-1);
 return <div ref={root} className={expanded?'workflow-chart is-expanded':'workflow-chart'} data-chart-target={props.target} data-chart-selected={selected} hidden={!active}>
   <div className="workflow-chart-toolbar">
     {showPicker&&<div className="chart-target-picker"><label>{l("基因", "Target")}<select value={config.activeTarget} onChange={event=>update({activeTarget:event.target.value,overview:false})}>{props.targets.map(target=><option key={target}>{target}</option>)}</select></label><button type="button" onClick={()=>update({overview:!config.overview})}>{config.overview?l("单图查看","Single chart"):l("多图概览","All charts")}</button></div>}
     <div className="chart-facet-nav">
       <span>{valid.length} {l("个类别","categories")}</span>
       {facets.length>1&&<>
         <div className="segmented-control chart-facet-mode"><button type="button" className={wholeChart?"":"active"} aria-pressed={!wholeChart} onClick={()=>setWholeChart(false)}>{l("分面","Panels")}</button><button type="button" className={wholeChart?"active":""} aria-pressed={wholeChart} onClick={()=>setWholeChart(true)}>{l("整体","All")}</button></div>
         {!wholeChart&&<span className="chart-facet-pager"><button type="button" aria-label={l("上一面", "Previous panel")} disabled={facet===0} onClick={()=>setFacet(facet-1)}>‹</button><span>{l("分面","panel")} {shown+1} / {facets.length}</span><button type="button" aria-label={l("下一面", "Next panel")} disabled={facet>=facets.length-1} onClick={()=>setFacet(facet+1)}>›</button></span>}
       </>}
     </div>
     <div className="chart-actions">
       <label><input type="checkbox" checked={selected} onChange={event=>update({selectedTargets:event.target.checked?[...config.selectedTargets,props.target]:config.selectedTargets.filter(target=>target!==props.target)})}/>{l("插入此图", "Include chart")}</label>
       <button type="button" onClick={()=>setExpanded(!expanded)}>{expanded?l("收起","Collapse"):l("展开查看","Expand")}</button>
       {facets.length>1&&<button type="button" onClick={()=>{exportFigures.forEach((figure,index)=>downloadBlob(new Blob([figure],{type:'image/svg+xml'}),`${props.target}-facet-${index+1}.svg`));}}>{l("导出全部分面", "Export all panels")}</button>}
     </div>
   </div>
   {active&&(!config.overview||props.targets[0]===props.target)&&<ResultsRail><details className="workflow-display-names"><summary>{l("显示名称", "Display names")}</summary>{valid.map(row=><label key={row.label}><span>{row.label}</span><input aria-label={`${row.label} 显示名称`} value={config.names[row.label]??row.label} onChange={event=>update({names:{...config.names,[row.label]:event.target.value}})}/></label>)}</details></ResultsRail>}
   {valid.length===0&&<div className="empty-chart">{l("当前筛选下没有可绘制的数据。", "No plottable data are available for the current selection.")}</div>}
   {exportFigures.map((figure,index)=><span key={index} hidden className="chart-export-source" data-panel={index+1} data-svg={figure}/>)}
   {wholeChart?<div className="workflow-facet" data-facet="all"><ExpressionPanel {...panelProps} rows={valid} plotHeight={plotHeight} fitHeight={fitHeight}/></div>:facets.map((rows,index)=><div key={index} className="workflow-facet" hidden={index!==shown} data-facet={index+1}><ExpressionPanel {...panelProps} rows={rows} plotHeight={plotHeight} fitHeight={fitHeight}/></div>)}
 </div>;
}
