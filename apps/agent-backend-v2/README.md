# Agent Backend V2

`agent-backend-v2` 是 `accr-ui` 中负责本地 Agent 会话、文件能力和 MCP 接入的后端服务。

## 主要职责

- 提供 Agent V2 运行所需的本地后端能力
- 提供文件、命令、会话与 MCP 相关接口
- 与浏览器扩展、native-server 协同完成本地工作流

## 常用命令

启动开发服务：

```bash
pnpm --filter @mcp-b/agent-backend-v2 dev
```

类型检查：

```bash
pnpm --filter @mcp-b/agent-backend-v2 typecheck
```

测试：

```bash
pnpm --filter @mcp-b/agent-backend-v2 test
```

## 模块边界

这个服务当前聚焦于 Agent V2 相关能力，本身不承担以下旧式或非目标职责：

- 传统 `/api/chat` 接口
- Git API
- SQLite 持久化
- 后端自管事件日志文件

## 联调方式

如果要和扩展、native-server 一起联调，建议在仓库根目录执行：

```bash
pnpm dev:apps
```
