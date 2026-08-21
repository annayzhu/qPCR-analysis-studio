import type { CanonicalField } from "../../schemas/src";

export const FIELD_SYNONYMS: Record<CanonicalField, readonly string[]> = {
  sampleName: [
    "Sample", "Sample Name", "Sample ID", "Sample No", "Sample Number", "Samples",
    "样本", "样本名", "样本名称", "样本编号", "样品", "样品名称", "标本", "标本编号",
  ],
  targetName: [
    "Target", "Targets", "Target Name", "Assay", "Assay Name", "Gene", "Gene Name",
    "Detector", "Detector Name", "基因", "基因名", "基因名称", "靶标", "靶基因", "目标基因", "检测项目",
  ],
  well: ["Well", "Well Position", "Well ID", "Position", "Pos", "孔", "孔位", "反应孔"],
  cq: ["Ct", "Cq", "Cp", "Cq/Ct/Cp", "Ct/Cq/Cp", "Crt", "Crossing Point", "Crossing Threshold", "Ct值", "Cq值", "Cp值"],
  cqMean: ["Ct Mean", "Cq Mean", "Cp Mean", "Mean Ct", "Mean Cq", "平均Ct", "Ct均值"],
  plateName: ["Plate", "Plate Name", "Plate ID", "板", "板名称", "板编号", "孔板名称"],
  row: ["Row", "行", "孔板行"],
  column: ["Column", "Col", "列", "孔板列"],
  taskType: ["Task", "Type", "Sample Type", "Assay Type", "Role", "类型", "样本类型", "检测类型"],
  reporter: ["Reporter", "Dye", "Channel", "Fluorophore", "荧光通道", "荧光染料"],
  instrumentFlag: ["Flag", "Quality", "Status", "Amp Status", "QC", "仪器状态", "质控状态"],
  omit: ["Omit", "Exclude", "Excluded", "Include", "剔除", "排除", "是否纳入"],
  replicate: ["Replicate", "Rep", "Technical Replicate", "复孔", "复孔序号"],
  tm1: ["Tm1", "Tm", "Melting Temperature", "主峰Tm", "熔解温度"],
  tm2: ["Tm2", "Second Tm", "第二峰Tm"],
  meltGroup: ["Group", "Melt Group", "HRM Group", "熔解分组"],
  meltScore: ["Score", "Melt Score", "HRM Score", "熔解评分"],
  meltResolution: ["Res", "Resolution", "Melt Resolution", "分辨率"],
};

export const CANONICAL_FIELD_LABELS: Record<CanonicalField, string> = {
  plateName: "Plate Name",
  well: "Well",
  row: "Row",
  column: "Column",
  sampleName: "Sample Name",
  targetName: "Target Name",
  cq: "Cq / Ct / Cp",
  cqMean: "Cq Mean（汇总值）",
  reporter: "Reporter / Channel",
  taskType: "Task / Role",
  replicate: "Technical Replicate",
  instrumentFlag: "Instrument Flag",
  omit: "Omit / Include",
  tm1: "Tm1",
  tm2: "Tm2",
  meltGroup: "Melt Group",
  meltScore: "Melt Score",
  meltResolution: "Melt Resolution",
};
