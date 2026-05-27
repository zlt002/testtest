# accr-ui Chrome Extension

`apps/extension` 是 `accr-ui` 的 Chrome 扩展应用，负责提供侧边栏交互、网页工具发现、页面编辑和与本地能力的连接入口。

## 功能定位

当前扩展主要承担以下职责：

- 提供侧边栏 AI 交互界面
- 连接本地 Agent Backend V2
- 与 native-server 协作完成浏览器到本地的桥接
- 提供网页编辑与页面上下文相关能力

## 环境准备

如需本地开发，请先在仓库根目录安装依赖：

```bash
pnpm install
```

扩展支持通过环境变量调整本地调试行为，常见配置包括：

- `CHROME_PATH`：可选，指定本地 Chrome 路径
- `CODE_INSPECTOR`：可选，是否启用点击跳转源码能力

## 常用命令

```bash
pnpm dev:extension
pnpm build:extension
pnpm --filter @mcp-b/extension test
pnpm --filter @mcp-b/extension typecheck
```

## 输出目录

开发与构建产物分开管理：

- 开发产物：`apps/extension/.output/chrome-mv3-dev`
- 构建产物：`apps/extension/.output/chrome-mv3`

本地开发时，手动加载扩展请使用开发目录；验证发布产物时，再加载构建目录。

## 页面编辑模式

- 在 sidepanel 中进入网页编辑后，可对当前页面启用可视化编辑
- `Alt+Shift+D` 可快速切换当前标签页编辑状态
- 当前编辑状态为临时态，页面刷新、跳转或关闭后会退出

## 相关文档

- 更完整的开发和打包说明见 [DEV_AND_BUILD.md](./DEV_AND_BUILD.md)
