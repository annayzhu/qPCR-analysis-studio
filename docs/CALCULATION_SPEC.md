# qPCR 计算规范（V1 Draft）

## 1. 数据层级

```text
仪器/板图原始行 → 统一孔记录 → 技术复孔组 → 生物学样本 → 分组比较
```

原始行不修改。手动编辑、排除和恢复只作用于统一孔记录，并保留时间、原值、新值与理由。

## 2. 缺失值与未检出

- `Undetermined`、`No Ct`、`N/A`、`Failed`、空值、“无扩增”等转为 `Cq=null`，同时保留原始文本和原因。
- 不将未检出孔自动赋值为 40 或循环上限。
- Roche LightCycler 480 当前真实导出中 `Cp=0`、`Tm=0` 是无结果占位值，仅在 Roche 适配器中转为空值。
- 通用文件中的数字 0 不使用 Roche 规则，避免跨仪器污染。

## 3. 技术复孔 QC

分组键为 `Plate + Sample + Target + Reporter`。仪器排除、用户排除和未检出孔不参与数值计算，但保留在总复孔数中。

| 指标 | 定义 | 单孔 |
|---|---|---|
| Mean Cq | 有效复孔 Cq 算术平均 | 可计算 |
| SD | 样本标准差，分母 n-1 | `null` |
| Cq range | max(Cq)-min(Cq) | `null` |
| 线性量 CV% | 对 `2^-Cq` 计算样本 SD / mean × 100 | `null` |
| Tm1 range | max(Tm1)-min(Tm1) | `null` |

默认 Cq range > 0.5 产生警告。n≥3 时可标记距离中位数最远的孔位作为“可疑孔”，但不自动排除。

## 4. 归一化与相对定量

技术复孔先合并为样本-基因 Mean Cq。

单内参：

\[
\Delta Cq = \overline{Cq}_{target} - \overline{Cq}_{reference}
\]

\[
Q_{norm} = 2^{-\Delta Cq}
\]

多内参：在默认 100% 效率时，先计算各内参的 Mean Cq，取其算术平均作为参考 Cq。该操作等价于对各内参的 `2^-Cq` 相对量取几何均值。

指定校准样本后：

\[
\Delta\Delta Cq = \Delta Cq_{sample} - \Delta Cq_{calibrator}
\]

\[
Relative\ Expression = 2^{-\Delta\Delta Cq}
\]

### 4.1 可选的技术复孔传播 SD

图表默认不显示误差线。用户启用“技术复孔传播 SD”后，系统使用一阶 delta method 将各孔 Cq 的样本 SD 传播到最终线性量。该指标只描述技术重复性，不代表生物学重复、SEM、95% CI 或统计显著性。

单内参：

\[
SD_{\Delta Cq}=\sqrt{SD_{target}^{2}+SD_{reference}^{2}}
\]

多内参（内参 Mean Cq 的算术平均）：

\[
SD_{reference}=\frac{\sqrt{\sum_{j=1}^{f}SD_{reference,j}^{2}}}{f}
\]

\[
SD_{\Delta Cq}=\sqrt{SD_{target}^{2}+SD_{reference}^{2}}
\]

对 \(Q=b^{-x}\) 进行指数变换后：

\[
SD_Q=\ln(b)\,Q\,SD_x
\]

指定校准样本时，非校准样本按独立误差传播：

\[
SD_{\Delta\Delta Cq}=\sqrt{SD_{\Delta Cq,sample}^{2}+SD_{\Delta Cq,calibrator}^{2}}
\]

校准样本本身是数值 1 的定义锚点，和自身相减后的传播 SD 记为 0。目标或任一内参只有 1 个有效技术复孔时，传播 SD 记为 `null` 且不绘制误差线；不得把缺失 SD 当作 0。每个图自动列出目标及各内参实际参与计算的有效复孔数。

## 5. 扩增效率接口

目标基因可设置效率 `E`，100% 表示 `E=1`，扩增因子为 `1+E`。未提供时暂按 100% 计算并生成 `EFFICIENCY_ASSUMED_100_PERCENT` 警告。V1 已保留计算接口，效率标准曲线拟合和不确定性传播作为后续模块。

## 6. 统计单位

- 技术复孔不是独立的 n。
- 组间统计应在技术复孔合并后，以生物学样本为 n。
- V1 导入与定量闭环不自动选择 t 检验/Wilcoxon；必须先确认实验设计、配对关系、样本量和分布。
