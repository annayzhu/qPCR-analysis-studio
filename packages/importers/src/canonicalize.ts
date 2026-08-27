import type {
  CanonicalDataset,
  CanonicalField,
  FieldMapping,
  ImportedSource,
  InstrumentType,
  AnalysisStart,
  PlateDefinition,
  QcFlag,
  RawImportedRow,
  WellRecord,
  SuppliedCalculationRecord,
} from "../../schemas/src";
import { analysisStartPolicy, createPhysicalWellId, normalizeWell } from "../../schemas/src";
import { applyInstrumentAdapter, selectedTable } from "./adapters";

const NON_DETECTED = /^(?:undetermined|no\s*ct|no\s*cq|n\/?a|na|nan|failed|无扩增|未检出)$/i;

function stableId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function mappingRecord(mappings: FieldMapping[]): Partial<Record<CanonicalField, string>> {
  const record: Partial<Record<CanonicalField, string>> = {};
  for (const mapping of [...mappings].sort((a, b) => b.confidence - a.confidence)) {
    if (!mapping.canonicalField || mapping.conflict || mapping.confidence < 0.7) continue;
    record[mapping.canonicalField] ??= mapping.sourceColumn;
  }
  return record;
}

function value(
  row: RawImportedRow,
  mappings: Partial<Record<CanonicalField, string>>,
  field: CanonicalField,
): unknown {
  const header = mappings[field];
  return header ? row.rawValues[header] : "";
}

function text(valueToParse: unknown): string {
  return String(valueToParse ?? "").normalize("NFKC").trim();
}

function numberOrNull(valueToParse: unknown, zeroIsMissing = false): number | null {
  const normalized = text(valueToParse);
  if (!normalized || NON_DETECTED.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || (zeroIsMissing && parsed <= 0)) return null;
  return parsed;
}

function cqValue(
  valueToParse: unknown,
  isRoche: boolean,
): Pick<WellRecord, "cq" | "cqStatus" | "cqReason"> {
  const normalized = text(valueToParse);
  if (!normalized) return { cq: null, cqStatus: "missing", cqReason: "空值" };
  if (NON_DETECTED.test(normalized)) {
    return { cq: null, cqStatus: "not-detected", cqReason: `未检出标记: ${normalized}` };
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 60) {
    return { cq: null, cqStatus: "invalid", cqReason: `无效 Cq: ${normalized}` };
  }
  if (isRoche && parsed === 0) {
    return { cq: null, cqStatus: "not-detected", cqReason: "Roche 480 导出的 0 值按未检出处理" };
  }
  return { cq: parsed, cqStatus: "detected", cqReason: "" };
}

function isInstrumentOmitted(raw: unknown, sourceHeader: string): boolean {
  const normalized = text(raw).toLowerCase();
  if (!normalized) return false;
  const truthy = /^(?:1|true|yes|y|是|include|included)$/i.test(normalized);
  const falsy = /^(?:0|false|no|n|否|exclude|excluded|omit)$/i.test(normalized);
  return /include/i.test(sourceHeader) ? falsy : truthy;
}

interface PartialWell {
  plateId: string;
  plateName: string;
  well: string;
  sampleName?: string;
  targetName?: string;
  cq?: Pick<WellRecord, "cq" | "cqStatus" | "cqReason">;
  reporter?: string;
  taskType?: string;
  replicate?: number | null;
  tm1?: number | null;
  tm2?: number | null;
  meltGroup?: string;
  meltScore?: number | null;
  meltResolution?: number | null;
  instrumentFlag?: string;
  instrumentOmit?: boolean;
  rawRow: RawImportedRow;
  qcFlags: QcFlag[];
  sourcePriority: number;
}

function plateIdentity(rawPlateName: string): { plateId: string; plateName: string } {
  const plateName = rawPlateName.trim() || "Plate 1";
  return {
    plateId: stableId("plate", plateName.toLowerCase()),
    plateName,
  };
}

function sourcePriority(source: ImportedSource): number {
  const table = selectedTable(source);
  if (!table) return 0;
  const fields = new Set(table.suggestedMappings.map((mapping) => mapping.canonicalField));
  return (fields.has("sampleName") ? 4 : 0) + (fields.has("targetName") ? 4 : 0) + (fields.has("cq") ? 2 : 0);
}

function mergePartial(current: PartialWell | undefined, incoming: PartialWell): PartialWell {
  if (!current) return incoming;
  const preferIncoming = incoming.sourcePriority > current.sourcePriority;
  return {
    ...current,
    sampleName: preferIncoming
      ? incoming.sampleName || current.sampleName
      : current.sampleName || incoming.sampleName,
    targetName: preferIncoming
      ? incoming.targetName || current.targetName
      : current.targetName || incoming.targetName,
    cq: incoming.cq?.cqStatus !== "missing" ? incoming.cq : current.cq,
    reporter: current.reporter || incoming.reporter,
    taskType: current.taskType || incoming.taskType,
    replicate: current.replicate ?? incoming.replicate,
    tm1: incoming.tm1 ?? current.tm1,
    tm2: incoming.tm2 ?? current.tm2,
    meltGroup: incoming.meltGroup || current.meltGroup,
    meltScore: incoming.meltScore ?? current.meltScore,
    meltResolution: incoming.meltResolution ?? current.meltResolution,
    instrumentFlag: incoming.instrumentFlag || current.instrumentFlag,
    instrumentOmit: Boolean(current.instrumentOmit || incoming.instrumentOmit),
    rawRow: preferIncoming ? incoming.rawRow : current.rawRow,
    qcFlags: [...current.qcFlags, ...incoming.qcFlags],
    sourcePriority: Math.max(current.sourcePriority, incoming.sourcePriority),
  };
}

function detectPlate(wells: string[], instrumentType: InstrumentType): PlateDefinition {
  const positions = wells
    .map((well) => normalizeWell(well))
    .filter((well): well is string => Boolean(well));
  const maxRow = positions.reduce((max, well) => Math.max(max, well.charCodeAt(0) - 64), 0);
  const maxColumn = positions.reduce((max, well) => Math.max(max, Number(well.slice(1))), 0);
  const plateFormat = maxRow > 8 || maxColumn > 12 ? 384 : 96;
  const exactBoundary = plateFormat === 384 ? maxRow === 16 && maxColumn === 24 : maxRow === 8 && maxColumn === 12;
  return {
    plateId: "plate-1",
    plateName: "Plate 1",
    plateFormat,
    rows: Array.from({ length: plateFormat === 384 ? 16 : 8 }, (_, index) => String.fromCharCode(65 + index)),
    columns: Array.from({ length: plateFormat === 384 ? 24 : 12 }, (_, index) => index + 1),
    instrumentType,
    confidence: exactBoundary ? 1 : 0.82,
    requiresConfirmation: !exactBoundary,
  };
}

export function buildCanonicalDataset(inputSources: ImportedSource[]): CanonicalDataset {
  const sources = inputSources.map(applyInstrumentAdapter);
  const declaredStarts = [...new Set(sources
    .map((source) => source.metadata.qpcrAnalysisStart as AnalysisStart | undefined)
    .filter((start): start is AnalysisStart => Boolean(start)))];
  const analysisStart: AnalysisStart = declaredStarts.length === 1 ? declaredStarts[0] : "cq";
  const partials = new Map<string, PartialWell>();
  const suppliedCalculations: SuppliedCalculationRecord[] = [];
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const allMappings: FieldMapping[] = [];
  const explicitPlateNames = new Set<string>();
  const sourceHasExplicitPlate = new Map<string, boolean>();
  const primaryResultSourceIds = new Set<string>();

  for (const source of sources) {
    const table = selectedTable(source);
    if (!table) continue;
    const mappings = mappingRecord(table.suggestedMappings);
    if (table.suggestedMappings.some((mapping) => mapping.canonicalField === "cq" && mapping.confidence >= 0.7 && !mapping.conflict)) {
      primaryResultSourceIds.add(source.id);
    }
    let hasExplicitPlate = false;
    for (const rawRow of table.rawRows) {
      const plateName = text(value(rawRow, mappings, "plateName"));
      if (plateName) {
        explicitPlateNames.add(plateName);
        hasExplicitPlate = true;
      }
    }
    sourceHasExplicitPlate.set(source.id, hasExplicitPlate);
  }
  const singleNamedPlate = explicitPlateNames.size === 1 ? [...explicitPlateNames][0] : "";
  const anonymousPrimarySourceIds = [...primaryResultSourceIds].filter((sourceId) => !sourceHasExplicitPlate.get(sourceId));
  const anonymousPrimaryPlateName = new Map(anonymousPrimarySourceIds.map((sourceId, index) => [sourceId, `Unassigned result ${index + 1}`]));
  if (anonymousPrimarySourceIds.length > 1 && singleNamedPlate) {
    warnings.push("检测到多个未命名的 Cq/Ct/Cp 结果文件和一个具名板布局；无法自动判断板布局对应哪一个结果文件，已保留为独立板等待人工确认。");
  }

  for (const source of sources) {
    for (const table of source.tables.filter((item) => /plate[ _-]?map|板布局/i.test(item.sourceSheet))) {
      const notes = table.matrix
        .flat()
        .map(text)
        .filter((cell) => /(?:可能|错位|错了|两遍|备注|注意)/.test(cell));
      for (const note of [...new Set(notes)]) assumptions.push(`板布局备注（${table.sourceSheet}）: ${note}`);
    }
  }

  for (const source of [...sources].sort((a, b) => sourcePriority(b) - sourcePriority(a))) {
    const table = selectedTable(source);
    if (!table) continue;
    allMappings.push(...table.suggestedMappings);
    const conflicted = table.suggestedMappings.filter((mapping) => mapping.conflict);
    if (conflicted.length) warnings.push(`${source.fileName}: ${conflicted.length} 个字段映射冲突已留待确认。`);
    const mappings = mappingRecord(table.suggestedMappings);
    const priority = sourcePriority(source);
    const isRoche = source.instrumentType === "roche-lightcycler-480";

    for (const rawRow of table.rawRows) {
      const rowLabel = text(value(rawRow, mappings, "row"));
      const columnLabel = text(value(rawRow, mappings, "column"));
      const rawPlateName = text(value(rawRow, mappings, "plateName"));
      const inferredPlateName = primaryResultSourceIds.size <= 1
        ? singleNamedPlate
        : anonymousPrimaryPlateName.get(source.id) ?? (sourceHasExplicitPlate.get(source.id) ? "" : `Unassigned source ${source.id}`);
      // Instrument exports commonly omit the plate name while a separately
      // corrected layout names it. With exactly one named plate, both sources
      // describe the same physical well grid and must join by well position.
      const plate = plateIdentity(rawPlateName || inferredPlateName);
      const well =
        normalizeWell(value(rawRow, mappings, "well")) ??
        normalizeWell(`${rowLabel}${columnLabel}`);

      let sampleName = text(value(rawRow, mappings, "sampleName"));
      let targetName = text(value(rawRow, mappings, "targetName"));
      const placeholder = sampleName === "1" && targetName === "1";
      if (placeholder) {
        sampleName = "";
        targetName = "";
      }
      const cqRaw = value(rawRow, mappings, "cq");
      const omitHeader = mappings.omit ?? "";
      const qcFlags: QcFlag[] = [];
      const cq = cqValue(cqRaw, isRoche);
      if (analysisStart !== "cq") {
        const selectedField = analysisStartPolicy(analysisStart).authoritativeValueField;
        const suppliedValue = numberOrNull(value(rawRow, mappings, selectedField));
        if (suppliedValue !== null && sampleName && targetName) {
          suppliedCalculations.push({
            sampleName,
            targetName,
            replicate: numberOrNull(value(rawRow, mappings, "replicate")),
            value: suppliedValue,
            analysisStart,
            ...(rawPlateName ? { plateId: plateIdentity(rawPlateName).plateId } : {}),
            ...(rawPlateName ? { plateName: rawPlateName } : {}),
            ...(well ? { well } : {}),
            cycleType: text(value(rawRow, mappings, "cycleType")),
            plateFormat: (() => {
              const header = rawRow.rawHeaders.find((item) => /^(?:plate\s*format|plate\s*size|板型)$/i.test(item.normalize("NFKC").trim()));
              const parsed = header ? Number(rawRow.rawValues[header]) : NaN;
              return parsed === 96 || parsed === 384 ? parsed : undefined;
            })(),
            assayType: text(value(rawRow, mappings, "taskType")),
            tm1: numberOrNull(value(rawRow, mappings, "tm1")),
            tm2: numberOrNull(value(rawRow, mappings, "tm2")),
            verificationStatus: "unverified",
            sourceSheet: rawRow.sourceSheet,
            sourceRowNumber: rawRow.sourceRowNumber,
            rawRow,
          });
        }
        continue;
      }
      if (!well) continue;
      if (cq.cqStatus === "invalid") {
        qcFlags.push({ code: "INVALID_CQ", severity: "error", message: cq.cqReason, source: "import" });
      }
      const instrumentFlag = text(value(rawRow, mappings, "instrumentFlag"));
      if (instrumentFlag && !/^(?:passed|pass|ok|success|valid)$/i.test(instrumentFlag)) {
        qcFlags.push({
          code: "INSTRUMENT_FLAG",
          severity: "warning",
          message: `仪器状态: ${instrumentFlag}`,
          source: "instrument",
        });
      }
      const incoming: PartialWell = {
        plateId: plate.plateId,
        plateName: plate.plateName,
        well,
        sampleName,
        targetName,
        cq,
        reporter: text(value(rawRow, mappings, "reporter")),
        taskType: text(value(rawRow, mappings, "taskType")),
        replicate: numberOrNull(value(rawRow, mappings, "replicate")),
        tm1: numberOrNull(value(rawRow, mappings, "tm1"), isRoche),
        tm2: numberOrNull(value(rawRow, mappings, "tm2"), isRoche),
        meltGroup: text(value(rawRow, mappings, "meltGroup")),
        meltScore: numberOrNull(value(rawRow, mappings, "meltScore")),
        meltResolution: numberOrNull(value(rawRow, mappings, "meltResolution")),
        instrumentFlag,
        instrumentOmit: isInstrumentOmitted(value(rawRow, mappings, "omit"), omitHeader),
        rawRow,
        qcFlags,
        sourcePriority: priority,
      };
      const partialKey = createPhysicalWellId(plate.plateId, well);
      partials.set(partialKey, mergePartial(partials.get(partialKey), incoming));
    }
  }

  const instrumentTypes = new Set(sources.map((source) => source.instrumentType).filter((type) => type !== "generic"));
  const instrumentType: InstrumentType = instrumentTypes.size === 1 ? [...instrumentTypes][0] : "generic";
  const plate = partials.size
    ? detectPlate([...partials.values()].map((partial) => partial.well), instrumentType)
    : null;
  if (plate?.requiresConfirmation) warnings.push("板规格由部分孔位推断，请在计算前确认 96/384 孔。");
  if (sources.some((source) => source.adapterId.endsWith("melt-grouping"))) {
    assumptions.push("导入的 Roche melt 文件是分组摘要；完整曲线需另行导出原始温度-荧光数据。");
  }
  const plateNames = [...new Set([...partials.values()].map((partial) => partial.plateName))];
  if (plateNames.length > 1) {
    assumptions.push(`检测到 ${plateNames.length} 块板：${plateNames.join(", ")}。相对定量会按同一块板内的样本内参进行配对。`);
  }

  const wells: WellRecord[] = [...partials.values()]
    .sort((a, b) => a.plateName.localeCompare(b.plateName) || a.well.charCodeAt(0) - b.well.charCodeAt(0) || Number(a.well.slice(1)) - Number(b.well.slice(1)))
    .map((partial) => {
      const row = partial.well[0];
      const column = Number(partial.well.slice(1));
      const cq = partial.cq ?? { cq: null, cqStatus: "missing" as const, cqReason: "未提供 Cq 数据" };
      return {
        id: stableId("well", `${partial.plateId}:${partial.well}`),
        plateId: partial.plateId,
        well: partial.well,
        row,
        column,
        sampleName: partial.sampleName ?? "",
        targetName: partial.targetName ?? "",
        ...cq,
        reporter: partial.reporter ?? "",
        taskType: partial.taskType ?? "Unknown",
        replicate: partial.replicate ?? null,
        tm1: partial.tm1 ?? null,
        tm2: partial.tm2 ?? null,
        meltGroup: partial.meltGroup ?? "",
        meltScore: partial.meltScore ?? null,
        meltResolution: partial.meltResolution ?? null,
        instrumentFlag: partial.instrumentFlag ?? "",
        instrumentOmit: Boolean(partial.instrumentOmit),
        userExcluded: false,
        exclusionReason: "",
        sourceSheet: partial.rawRow.sourceSheet,
        sourceRowNumber: partial.rawRow.sourceRowNumber,
        rawRow: partial.rawRow,
        qcFlags: partial.qcFlags,
      };
    });

  return {
    id: stableId("dataset", sources.map((source) => source.id).join(":")),
    createdAt: new Date().toISOString(),
    sources,
    analysisStart,
    plate,
    wells,
    suppliedCalculations,
    mappings: allMappings,
    warnings,
    assumptions,
  };
}
