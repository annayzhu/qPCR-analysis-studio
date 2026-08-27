# qPCR Analysis Studio

面向科研场景的仪器无关 qPCR 相对定量工作台。网页端在浏览器本地解析文件，原始实验数据不上传。Roche LightCycler 480 是第一个真实适配案例，不是产品或内核的命名边界。

## 当前可用闭环

1. 多文件导入：XLSX、CSV、TXT/TSV。
2. 中英文表头同义词识别，字段冲突需人工确认。
3. 仪器适配器与通用解析器分离。
4. 板布局与 Cq/Tm/熔解摘要按孔位合并。
5. 浏览器本地生成三工作表 XLSX 导入模板，并对模板逐行校验。
6. 96/384 孔板可视化，多选、批量编辑、错位移动/复制/交换、Excel 区域粘贴与恢复。
7. 原始物理孔测量只读；布局修正以草稿、应用快照和审计记录分层保存。
8. 复孔 QC、可疑孔提示、手动排除/恢复、审计记录。
9. ΔCq、ΔΔCq、2^-\DeltaCq、2^-\Delta\DeltaCq 及多内参接口。
10. 完整结果 XLSX 分层导出最终结果、逐孔计算、板内汇总、计算指南和数据字典；逐孔保留原始 Cq/Cp、同板内参中心及 `well Cq − reference mean`。
11. Visualization Studio 导出明确为 Bar 图五列格式：`category`、`value`、`sd`、`sem`、`group`。

## 架构

```text
app/                         网页界面
packages/schemas/            统一数据模型与验证
packages/importers/          通用表格导入、字段映射、仪器适配器
packages/qpcr-core/          纯 TypeScript 计算、QC 与审计函数
packages/analysis-session/   草稿、应用、对齐、重算与审计的不可变工作流边界
scripts/                     真实文件回归验证
docs/                        计算规范、数据字典、适配记录
apps/desktop/                未来 Electron 离线封装边界
```

界面只通过 Analysis Session 的创建、读取投影、变更预览和状态迁移接口操作分析状态；原始测量、布局草稿、已应用快照和计算结果不会在 React 组件内分别维护。领域术语见 [`CONTEXT.md`](./CONTEXT.md)，关键取舍见 [`docs/adr/`](./docs/adr/)。

## 本地运行

```bash
npm install
npm run dev
```

默认开发地址由 vinext 输出，通常是 `http://localhost:3000` 或下一个可用端口。

“打开 Bar 图”默认链接到 Visualization Studio 本地独立版 `http://127.0.0.1:3400/visualization-studio/?plot=bar`。部署时可通过 `NEXT_PUBLIC_VISUALIZATION_STUDIO_URL` 指向实际的 Visualization Studio 地址；单文件离线版在没有 Node.js `process` 对象时也会安全使用该默认地址。

## 验证

```bash
npm run lint
npm run test:unit
npm run typecheck
npm run build
npm test
```

真实 Roche 480 回归不将实验文件复制入仓库：

```bash
npm run test:real -- /path/cq.txt /path/tm.txt /path/melt-grouping.txt /path/layout.xlsx
```

## 安全与科学边界

- 原始行只读，所有编辑作用于统一数据层并记录日志。
- `Undetermined`/空值/仪器未检出值不替换成 Cq=40。
- 仪器 flag、复孔差异和熔解异常不会自动删除。
- 统计推断必须以生物学样本为 n；当前版本不用技术复孔冒充生物学重复。
- 本工具用于科研分析，不是临床诊断软件。
