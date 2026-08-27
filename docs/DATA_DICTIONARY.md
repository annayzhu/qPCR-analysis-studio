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
| `cq` | Ct, Cq, Cp, Cq/Ct/Cp, Crt, Crossing Point | 单孔值；模板不接受 Ct Mean 代替 |
| `cqMean` | CT Mean, Mean Cq, 平均 Ct | 必须与单孔 Cq 分开 |
| `reporter` | Reporter, Dye, Channel, Color, 荧光通道 | 仪器适配器可细化 |
| `taskType` | Task, Type, Sample Type, Assay Type, Role | 避免仅依赖模糊的 `Type` |
| `instrumentFlag` | Flag, Quality, Status, QC | 保留原值 |
| `omit` | Omit, Exclude, Include, 剔除 | `Include` 与 `Omit` 逻辑相反 |

## 映射元数据

`FieldMapping` 保留：输入列、统一字段、信心度、识别方式、证据、冲突标志和用户确认状态。当两个输入列都可能映射到同一核心字段且信心度接近时，系统不静默决定，必须人工确认。

### `SuppliedCalculationProvenance`

仅在从用户提供的 `ΔCq` 或 `ΔΔCq` 开始分析时存在。这些字段记录用户在上游采用的计算依据，不参与再次归一化。

| 字段 | 类型 | 约束/含义 |
|---|---|---|
| `referenceTargets` | string[] | 一个或多个用户声明的内参基因；系统不从基因名或数值猜测 |
| `referenceMethod` | string | 用户声明的单/多内参处理方法；仅用于溯源 |
| `calibratorValue` | string | 导入文件声明的来源校准样本；与结果页后来选择的下游校准样本分开保存 |

### `CanonicalDataset.suppliedCalculationProvenance`

类型为 `SuppliedCalculationProvenance | null`。原始 Cq 工作流固定为 `null`，也不会产生用户计算值元数据冲突提醒。

## 用户输入模板（schema 2.2.0）

- `Data`：空白录入表，每行一个物理孔；必需列为 `Well`、`Sample`、`Assay`、`Assay Type`、`Replicate`、`Cq/Ct/Cp`。
- `Example`：仅包含合成、去标识化示例。
- `Field Dictionary`：双语字段定义、允许值、同义词和模板版本。
- `Analysis Settings`：声明分析起点，并可填写 `Reference Target(s) / 内参基因`、`Reference Method / 内参处理方法`、`Calibrator / 校准样本`。
- 从 `ΔCq` 或 `ΔΔCq` 开始时，`Sample`、`Assay`、`Replicate` 和对应 Δ 值为最小数据字段；无需板布局。内参信息缺失时仍可分析，但必须显示并导出 `REFERENCE_TARGET_NOT_PROVIDED`。
- `Plate`：单板时可空；多板时必须提供并与 `Well` 共同构成唯一物理身份。
- `Plate Format`：可选填 `96` 或 `384`；填写后，超出对应板型范围的孔位会阻断导入。
- `Tm1`、`Tm2`：可选数值层，不作为相对定量的必需条件。

## 完整结果导出（schema 1.0.0）

完整结果使用稳定英文列名。XLSX 附带 `Data Dictionary` 工作表，TSV 下载会同时生成独立的数据字典 TSV。`assay_type_role` 保留参与目标结果行的输入 Assay Type/role；`warnings` 汇总导入、孔级/复孔 QC 与计算警告。`target_technical_sd` 与 `target_technical_sem` 为目标技术复孔统计；`reference_technical_sd` 与 `reference_technical_sem` 为内参传播统计；`relative_expression_technical_sd` 与 `relative_expression_technical_sem` 为相对表达传播统计。它们均不代表生物学重复变异、置信区间或推断统计。当有效技术复孔少于 2 个时，SD/SEM 留空而不是记为 0。

## 用户计算值结果导出（schema 1.1.0）

- XLSX 包含 `Complete Results`、`Supplied Values`、`Export Metadata`、`Data Dictionary` 四个工作表；TSV 结果会同时下载独立的数据字典 TSV。
- `reference_targets`、`reference_method`、`source_calibrator` 是导入文件声明的上游计算依据，仅用于溯源。
- `calibrator` 是当前结果实际采用的下游校准样本。它与 `source_calibrator` 分列，避免用户在结果页改变或清空校准选择时改写来源记录。
- `supplied_value` 保留用户导入的原始 Δ 值；系统计算的均值、SD、SEM 和负二次幂转换另列输出。
- `warnings` 在未提供内参时包含 `REFERENCE_TARGET_NOT_PROVIDED`。技术复孔不足或找不到下游校准样本时保留对应警告代码。
- 同一次用户计算值分析中的多个工作簿必须声明一致的内参集合、处理方法和来源校准样本；不一致时阻止合并，避免把第一份文件的来源信息错误套用到其他行。
- 全部 SD/SEM 均为技术复孔统计，不代表生物学重复、置信区间或推断统计。
