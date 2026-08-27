export type InstrumentType =
  | "generic"
  | "roche-lightcycler-480"
  | "quantstudio-5"
  | "abi-7500";

export type AnalysisStart = "cq" | "delta-cq" | "delta-delta-cq";

export type CanonicalField =
  | "plateName"
  | "well"
  | "row"
  | "column"
  | "sampleName"
  | "targetName"
  | "cycleType"
  | "cq"
  | "cqMean"
  | "deltaCq"
  | "deltaDeltaCq"
  | "reporter"
  | "taskType"
  | "replicate"
  | "instrumentFlag"
  | "omit"
  | "tm1"
  | "tm2"
  | "meltGroup"
  | "meltScore"
  | "meltResolution";

export type CqStatus =
  | "detected"
  | "not-detected"
  | "invalid"
  | "missing"
  | "not-applicable";

export interface RawImportedRow {
  sourceId: string;
  sourceFileName: string;
  sourceSheet: string;
  sourceRowNumber: number;
  rawHeaders: readonly string[];
  rawValues: Readonly<Record<string, unknown>>;
}

export interface FieldMapping {
  sourceColumn: string;
  canonicalField: CanonicalField | null;
  confidence: number;
  matchMethod:
    | "exact-synonym"
    | "combined-header"
    | "content"
    | "adapter"
    | "manual"
    | "unmapped";
  evidence: string[];
  conflict: boolean;
  userConfirmed: boolean;
}

export interface ImportedTable {
  id: string;
  sourceId: string;
  sourceFileName: string;
  sourceSheet: string;
  matrix: unknown[][];
  headerRowIndex: number;
  headers: string[];
  rawRows: RawImportedRow[];
  suggestedMappings: FieldMapping[];
  score: number;
  warnings: string[];
}

export interface ImportedSource {
  id: string;
  fileName: string;
  fileType: "xlsx" | "csv" | "txt";
  adapterId: string;
  instrumentType: InstrumentType;
  tables: ImportedTable[];
  selectedTableId: string;
  metadata: Record<string, string>;
  warnings: string[];
}

export interface QcFlag {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  source: "instrument" | "import" | "replicate" | "melt" | "user";
}

export interface WellRecord {
  id: string;
  plateId: string;
  well: string;
  row: string;
  column: number;
  sampleName: string;
  targetName: string;
  cq: number | null;
  cqStatus: CqStatus;
  cqReason: string;
  reporter: string;
  taskType: string;
  replicate: number | null;
  tm1: number | null;
  tm2: number | null;
  meltGroup: string;
  meltScore: number | null;
  meltResolution: number | null;
  instrumentFlag: string;
  instrumentOmit: boolean;
  userExcluded: boolean;
  exclusionReason: string;
  sourceSheet: string;
  sourceRowNumber: number;
  rawRow: RawImportedRow;
  qcFlags: QcFlag[];
}

export interface PlateDefinition {
  plateId: string;
  plateName: string;
  plateFormat: 96 | 384;
  rows: string[];
  columns: number[];
  instrumentType: InstrumentType;
  confidence: number;
  requiresConfirmation: boolean;
}

export interface ExclusionLog {
  id: string;
  wellRecordId: string;
  action: "exclude" | "restore";
  reason: string;
  timestamp: string;
  previousState: boolean;
  newState: boolean;
}

export interface EditLog {
  id: string;
  wellRecordId: string;
  field: "sampleName" | "targetName" | "taskType" | "replicate";
  previousValue: string | number | null;
  newValue: string | number | null;
  timestamp: string;
}

export type AlignmentIssueType = "result-without-annotation" | "annotation-without-result";

export interface AlignmentDispositionLog {
  id: string;
  wellRecordId: string;
  issueType: AlignmentIssueType;
  action: "confirm-reviewed";
  reason: string;
  timestamp: string;
}

export interface LayoutOperationLog {
  id: string;
  operation: "batch-edit" | "paste" | "clear" | "move" | "copy" | "swap" | "restore-selected" | "restore-plate" | "apply";
  sourceWellRecordIds: string[];
  destinationWellRecordIds: string[];
  changes: EditLog[];
  previousSnapshot: string;
  newSnapshot: string;
  reason: string;
  timestamp: string;
}

export interface AnalysisSettings {
  referenceTargets: string[];
  calibratorType: "sample" | "group";
  calibratorValue: string;
  replicateWarningThreshold: number;
  tmWarningThreshold: number;
  efficiencyByTarget: Record<string, number>;
  calculationMode: "delta-cq" | "delta-delta-cq" | "efficiency-corrected";
}

export interface SuppliedCalculationRecord {
  sampleName: string;
  targetName: string;
  replicate: number | null;
  value: number;
  analysisStart?: Exclude<AnalysisStart, "cq">;
  plateId?: string;
  well?: string;
  cycleType?: string;
  sourceSheet?: string;
  sourceRowNumber?: number;
  rawRow?: RawImportedRow;
}

export interface CanonicalDataset {
  id: string;
  createdAt: string;
  sources: ImportedSource[];
  analysisStart: AnalysisStart;
  plate: PlateDefinition;
  wells: WellRecord[];
  suppliedCalculations: SuppliedCalculationRecord[];
  mappings: FieldMapping[];
  warnings: string[];
  assumptions: string[];
}

export interface ReplicateQc {
  id: string;
  plateId: string;
  sampleName: string;
  targetName: string;
  reporter: string;
  wells: string[];
  totalReplicates: number;
  validReplicates: number;
  meanCq: number | null;
  sdCq: number | null;
  cqRange: number | null;
  linearQuantityCvPercent: number | null;
  meanTm1: number | null;
  tm1Range: number | null;
  secondaryPeakCount: number;
  meltGroups: string[];
  warningCodes: string[];
  suspectWell: string | null;
}

export interface RelativeQuantificationResult {
  sampleName: string;
  targetName: string;
  assayTypeRole: string;
  targetMeanCq: number;
  targetSdCq: number | null;
  targetSemCq: number | null;
  targetValidReplicates: number;
  referenceMeanCq: number;
  referenceSdCq: number | null;
  referenceSemCq: number | null;
  referenceValidReplicates: Record<string, number>;
  deltaCq: number;
  deltaCqSd: number | null;
  deltaCqSem: number | null;
  normalizedQuantity: number;
  normalizedQuantitySd: number | null;
  normalizedQuantitySem: number | null;
  deltaDeltaCq: number | null;
  deltaDeltaCqSd: number | null;
  deltaDeltaCqSem: number | null;
  relativeExpression: number | null;
  relativeExpressionSd: number | null;
  relativeExpressionSem: number | null;
  calibratorValue: string;
  referenceTargets: string[];
  warningCodes: string[];
}
