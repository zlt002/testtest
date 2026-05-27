# accr-ui

accr-ui 是一个以浏览器扩展和本地配套服务为核心的 AI 工具集成项目，当前交付重点是：

- Chrome 扩展
- Windows Lite 轻量版打包产物

项目保留了 MCP 生态相关依赖与传输能力，并在此基础上组合浏览器扩展、Native Server 和 Agent Backend V2。

## 项目组成

```text
accr-ui/
├── apps/
│   ├── extension/          # Chrome 扩展
│   ├── agent-backend-v2/   # 本地 Agent V2 后端
│   └── native-server/      # 浏览器与本地 MCP 客户端之间的原生服务
├── shared/                 # 内部共享包
└── scripts/                # 构建、清理和发布脚本
```

## 环境要求

- Node.js >= 22.12，推荐使用 `.nvmrc` 中的版本
- pnpm ^10
- Chrome 浏览器，用于扩展开发、调试和加载构建产物

## 快速开始

```bash
pnpm install
pnpm build:shared
pnpm dev
```

## 常用开发命令

- `pnpm dev`：启动主要开发流程
- `pnpm dev:apps`：启动扩展、native-server 和 agent-backend-v2
- `pnpm dev:extension`：单独启动 Chrome 扩展开发
- `pnpm dev:agent`：单独启动 Agent V2 后端
- `pnpm build`：构建整个工作区
- `pnpm build:extension`：构建 Chrome 扩展
- `pnpm build:apps`：构建扩展、native-server 和 agent-backend-v2

> 说明：当前仓库中的部分内部包名、依赖名和过滤器仍沿用 `@mcp-b/*`，这是构建和包解析所需的技术标识，不代表当前项目品牌。

## Chrome 扩展打包

Chrome 扩展相关的常用命令如下：

```bash
pnpm dev:extension
pnpm build:extension
```

构建完成后，可在扩展应用的输出目录中获取 Chrome 扩展产物，并在 Chrome 的扩展管理页中以开发者模式加载。

## Windows Lite 打包

Windows Lite 相关脚本已经在根目录 `package.json` 中配置好：

```bash
pnpm release:windows-lite
pnpm serve:windows-lite-release
pnpm configure:windows-lite-local-update
pnpm smoke:windows-lite
```

这些命令分别用于：

1. 生成 Windows Lite 打包产物。
2. 本地托管 Windows Lite 发布包，便于联调。
3. 写入本地更新配置。
4. 对 Windows Lite 包执行冒烟验证。

## 架构概览

accr-ui 由三层组成：

1. 浏览器扩展：负责发现网页和扩展环境中的工具，并提供侧边栏交互界面。
2. Native Server：负责把浏览器运行时能力桥接到本地 MCP 客户端。
3. Agent Backend V2：负责本地会话、工作区、文件和运行流的后端能力。

整体数据流为：

1. 网站或扩展环境注册可调用工具。
2. 浏览器扩展发现并展示这些工具。
3. Agent 或用户通过结构化调用执行工具。
4. 结果回传到侧边栏和本地后端状态中。

## 质量检查

提交前建议运行：

```bash
pnpm typecheck
pnpm test
pnpm check-all
```

如只修改单个应用，可优先运行对应 package 的过滤命令，确认后再跑全量检查。
