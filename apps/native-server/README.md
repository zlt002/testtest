# accr-ui Native Server

`native-server` 是 `accr-ui` 中负责浏览器扩展与本地能力桥接的原生服务。

它主要承担两类职责：

- 作为 Chrome Native Messaging Host，与浏览器扩展通信
- 在本地启动和维护与 MCP 相关的桥接能力

## 目录定位

这个应用属于 `accr-ui` 工作区的一部分，通常与下面两个模块配合使用：

- `apps/extension`
- `apps/agent-backend-v2`

## 常用命令

```bash
pnpm --filter @mcp-b/native-server build
pnpm --filter @mcp-b/native-server dev
pnpm --filter @mcp-b/native-server register:dev
pnpm --filter @mcp-b/native-server self-check
```

## 开发说明

- `dev`：监听源码变更，重新构建，并执行开发环境注册
- `build`：构建原生服务产物到 `dist/`
- `register:dev`：注册开发环境下的 Native Messaging 清单
- `self-check`：执行本地自检，确认桥接能力是否可用

## 与扩展协作关系

运行链路通常如下：

1. Chrome 扩展发起本地通信请求。
2. `native-server` 通过 Native Messaging 接收请求。
3. 本地桥接逻辑将请求转交给对应的本地服务或 MCP 能力。
4. 结果再返回给扩展侧界面。

## 相关文档

- 安装与注册说明见 [install.md](./install.md)
- 整体项目说明见仓库根目录 `README.md`
