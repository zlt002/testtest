# Chrome 扩展开发与打包

本文档说明 `apps/extension` 的本地开发、手动加载和打包流程。

## 本地开发

在仓库根目录执行：

```bash
pnpm dev:extension
```

等价命令：

```bash
pnpm --filter @mcp-b/extension dev
```

默认情况下，WXT 会启动扩展开发流程并输出开发产物，但不会强制帮你打开浏览器窗口。

如果你希望开发时自动打开浏览器，可执行：

```bash
WXT_OPEN_BROWSER=true pnpm dev:extension
```

## 开发产物目录

开发模式输出目录：

```txt
apps/extension/.output/chrome-mv3-dev
```

手动加载开发版扩展时，请只加载这个目录。

## 手动加载开发版扩展

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `apps/extension/.output/chrome-mv3-dev`

如源码变更后浏览器未自动刷新，请在扩展管理页手动刷新扩展。

## 本地联调

如果你需要同时启动扩展、native-server 和 Agent Backend V2，可在仓库根目录执行：

```bash
pnpm dev:local
```

这个命令会一并处理本地开发所需端口，并启动整套联调链路。

## 打包构建

执行：

```bash
pnpm build:extension
```

等价命令：

```bash
pnpm --filter @mcp-b/extension build
```

构建产物目录：

```txt
apps/extension/.output/chrome-mv3
```

验证正式构建产物时，请加载这个目录，而不是开发目录。

## 清理输出

如果需要清理扩展输出目录，可在仓库根目录执行：

```bash
pnpm clean:extension:dev
pnpm clean:extension:build
pnpm clean:extension:output
```

## 代码 Inspector

如果你需要点击界面元素快速跳转源码，可在本地环境中开启 `CODE_INSPECTOR=true`。

该能力仅建议在本地调试时使用，不建议作为默认常开配置。
