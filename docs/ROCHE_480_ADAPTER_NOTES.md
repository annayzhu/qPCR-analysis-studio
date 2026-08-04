# Roche LightCycler 480 适配记录

## 产品边界

Roche LightCycler 480 是 qPCR Analysis Studio 的第一个真实仪器适配案例。产品名、统一数据模型、QC 和计算内核不依赖 Roche 命名或列定义。

## 已验证的真实导出

| 类型 | 列 | 适配结果 |
|---|---|---|
| Cq 结果 | Include, Color, Pos, Name, Cp, Concentration, Standard, Status | `Pos→well`, `Cp→cq`, `Status→instrumentFlag` |
| Tm 摘要 | Include, Color, Pos, Name, Tm1, Tm2, Status | `Tm1/Tm2` 合并到同孔 |
| 熔解分组 | Include, Color, Pos, Name, Group, Score, Res, Status | 记为分组摘要，不冒充原始曲线 |
| 修正板布局 | `Well_Detail` 含 Well/Sample/Target | 作为样本和基因真值来源 |

真实回归验证（2026-08-04）：

- 三个 Roche TXT 均为 384 孔，孔位集一致。
- 修正布局中 240 个已定义反应，144 个占位/空孔。
- 识别 7 个第二 Tm 峰和 5 个 `Unknown` 熔解分组。
- 板图中两条加样备注被保留为数据集假设/注释，不被误解为反应孔。
- `Cp=0` 和 `Tm=0` 按该组 Roche 导出的无结果占位值处理。

## 未评估边界

- 当前提供的 `meltingcurve.txt` 实际是 HRM/熔解分组摘要，没有温度-荧光序列，因此不能重画原始熔解曲线。
- Roche 软件其他版本、其他分析模块和 96 孔导出格式尚需新的真实文件回归。
- 适配器不根据文件名判断，而是根据表头结构与元数据检测。

