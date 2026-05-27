# accr-ui Native Server 安装与注册

本文档说明 `apps/native-server` 在本项目中的本地安装、构建与开发注册流程。

## 适用场景

以下情况建议参考本文档：

- 本地联调 Chrome 扩展与 Native Messaging
- 验证 native-server 是否正确注册
- 排查本地桥接能力无法连接的问题

## 基本准备

在仓库根目录先安装依赖：

```bash
pnpm install
```

如需单独构建 native-server，可执行：

```bash
pnpm --filter @mcp-b/native-server build
```

## 开发环境注册

开发模式下，推荐直接运行：

```bash
pnpm --filter @mcp-b/native-server dev
```

该命令会自动完成：

1. 监听源码变更
2. 重新构建 `dist/`
3. 执行开发环境注册

如果只想单独执行注册，可运行：

```bash
pnpm --filter @mcp-b/native-server register:dev
```

## 自检

可以使用下面的命令检查 native-server 是否已正确构建并可执行：

```bash
pnpm --filter @mcp-b/native-server self-check
```

## 联调建议

如果你要完整联调扩展、native-server 和 Agent Backend V2，建议在仓库根目录执行：

```bash
pnpm dev:local
```

这个命令会同时启动：

- Chrome 扩展开发服务
- native-server
- Agent Backend V2

## 常见排查点

- Chrome 扩展是否加载了正确的开发产物目录
- native-server 是否已经成功构建出 `dist/`
- 本地注册流程是否执行成功
- 相关端口是否已被其他进程占用

如需清理开发端口，可在仓库根目录执行：

```bash
pnpm dev:ports
```
