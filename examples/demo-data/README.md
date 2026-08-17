# qPCR Analysis Studio 示例数据 / Demo data

这些文件可直接拖入 qPCR Analysis Studio 的“拖入仪器结果文件”区域。

## 文件

- `qpcr_single_plate_expression_demo.xlsx` / `.tsv`：普通 96 孔单板相对表达示例。
  - 内参：`GAPDH`
  - 校准样本建议：`Control_01`
  - 包含一个故意偏离的技术复孔：`Treat_02 × FBN2`，用于测试 QC 提示。

- `qpcr_two_plate_split_sample_demo.xlsx` / `.tsv`：双板跨板样本示例。
  - 内参：`T1_REF`
  - 关键样本：`S7_split`
  - `S7_split × T2` 位于 Plate 01，应使用 Plate 01 的 `S7_split × T1_REF`。
  - `S7_split × T3` 位于 Plate 02，应使用 Plate 02 的 `S7_split × T1_REF`。
  - 如果错误地全局合并内参，T2/T3 的 ΔCq 会明显偏移；当前优化后的工具会按同板内参配对。

## 推荐分析设置

1. 导入文件后进入结果页。
2. Reference target / 内参选择：`GAPDH` 或 `T1_REF`。
3. 单板示例可选择 calibrator：`Control_01`。
4. 双板示例如果只看 ΔCq，可不选 calibrator；如果选 calibrator，需保证对应 target 有同名校准样本。
