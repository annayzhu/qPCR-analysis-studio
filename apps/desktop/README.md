# Desktop wrapper boundary

未来 Electron/Windows 离线版应复用 `packages/schemas`、`packages/importers` 和 `packages/qpcr-core`，不在桌面层复制计算公式。桌面层只负责文件系统访问、项目存档、本地导出和窗口生命周期。

