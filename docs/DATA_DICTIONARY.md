# 统一数据字典（V1 Draft）

## 核心实体

### `RawImportedRow`

| 字段 | 类型 | 含义 |
|---|---|---|
| `sourceId` | string | 导入文件稳定 ID |
| `sourceFileName` | string | 原文件名 |
| `sourceSheet` | string | 工作表/文本数据表 |
| `sourceRowNumber` | integer | 1-based 原始行号 |
| `rawHeaders` | readonly string[] | 原表头 |
| `rawValues` | readonly object | 原值，不覆盖 |

### `WellRecord`

| 字段 | 类型 | 约束/含义 |
|---|---|---|
| `plateId` | string | 孔板 ID |
| `well` | string | `A1`–`H12` 或 `A1`–`P24`，导入时将 `A01` 规范为 `A1` |
| `row` | string | A–P |
| `column` | integer | 1–24 |
| `sampleName` | string | 样本名，可后补 |
| `targetName` | string | 基因/Assay/Target，可后补 |
| `cq` | number \| null | 单孔 Cq/Ct/Cp；未检出为 null |
| `cqStatus` | enum | `detected` / `not-detected` / `invalid` / `missing` / `not-applicable` |
| `cqReason` | string | 空值、未检出或无效原因 |
| `reporter` | string | 荧光通道/染料 |
| `taskType` | string | Unknown / NTC / no-RT / Standard 等 |
| `replicate` | integer \| null | 技术复孔编号，不用于生物学 n |
| `tm1`, `tm2` | number \| null | 熔解主峰/第二峰温度 |
| `meltGroup` | string | HRM/熔解分组摘要 |
| `meltScore` | number \| null | 仪器熔解评分 |
| `meltResolution` | number \| null | 仪器熔解分辨率摘要 |
| `instrumentFlag` | string | 仪器原始质控状态 |
| `instrumentOmit` | boolean | 仪器标记的排除 |
| `userExcluded` | boolean | 用户排除状态 |
| `exclusionReason` | string | 排除理由 |
| `rawRow` | RawImportedRow | 可追溯原始行 |
| `qcFlags` | QcFlag[] | 仪器/导入/复孔/熔解/用户警告 |

## 统一字段映射

| 内部字段 | 常见输入表头示例 | 备注 |
|---|---|---|
| `sampleName` | Sample, Sample ID, Sample No, 样本, 样本编号, 标本 | 中英文可混合 |
| `targetName` | Target, Assay, Gene, Detector, 基因, 靶基因 | 不硬编码具体基因 |
| `well` | Well, Well Position, Pos, 孔位 | 也可由 Row + Column 合成 |
| `cq` | Ct, Cq, Cp, Crt, Crossing Point | 单孔值 |
| `cqMean` | CT Mean, Mean Cq, 平均 Ct | 必须与单孔 Cq 分开 |
| `reporter` | Reporter, Dye, Channel, Color, 荧光通道 | 仪器适配器可细化 |
| `taskType` | Task, Type, Sample Type, Assay Type, Role | 避免仅依赖模糊的 `Type` |
| `instrumentFlag` | Flag, Quality, Status, QC | 保留原值 |
| `omit` | Omit, Exclude, Include, 剔除 | `Include` 与 `Omit` 逻辑相反 |

## 映射元数据

`FieldMapping` 保留：输入列、统一字段、信心度、识别方式、证据、冲突标志和用户确认状态。当两个输入列都可能映射到同一核心字段且信心度接近时，系统不静默决定，必须人工确认。

