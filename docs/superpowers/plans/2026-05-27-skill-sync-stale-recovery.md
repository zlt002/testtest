# Skill Sync Stale Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复本地技能目录被手工破坏后“同步检查通过、技能列表残留、点开技能报 500”这一整条失效链路。

**Architecture:** 在远端同步层补充本地 `~/.claude/skills` 健康检查，将目录缺失视为强制重同步条件；在能力目录服务里把缺失技能文件统一转换为 404 语义错误；在前端技能管理中识别失效错误并自动强刷列表，给出中文提示。

**Tech Stack:** Node.js test runner、Vitest、React、TypeScript

---

### Task 1: 同步层强制重同步

**Files:**
- Modify: `apps/agent-backend-v2/src/accr-sync/remote-sync-manager.ts`
- Test: `apps/agent-backend-v2/src/accr-sync/remote-sync-manager.test.ts`

- [x] 为 `createRemoteSyncManager` 增加本地 `skills` 目录健康探测依赖，默认检查 `<targetDir>/skills` 是否存在且为目录。
- [x] 先写失败测试，覆盖“版本未变化但本地技能目录损坏时仍应重下并重铺”。
- [x] 实现 `!isLocalSkillsHealthy` 时的强制重同步逻辑。
- [x] 运行 `pnpm --filter @mcp-b/agent-backend-v2 exec node --import tsx --test src/accr-sync/remote-sync-manager.test.ts` 验证。

### Task 2: 缺失技能文件返回明确错误

**Files:**
- Modify: `apps/agent-backend-v2/src/management/capability-catalog-service.ts`
- Test: `apps/agent-backend-v2/src/management/capability-catalog-service.test.ts`

- [x] 先写失败测试，覆盖主 `SKILL.md` 丢失与子文件丢失两种场景。
- [x] 在 `capabilityFromFile`、`assertNoSymlinkTraversal`、`readCapabilityFile` 中把 `ENOENT` 转成 `404 CapabilityMissing`。
- [x] 保持其他错误语义不变，只收敛失效技能相关分支。
- [x] 运行 `pnpm --filter @mcp-b/agent-backend-v2 exec node --import tsx --test src/management/capability-catalog-service.test.ts` 验证。

### Task 3: 技能管理自动刷新失效列表

**Files:**
- Modify: `apps/extension/entrypoints/sidepanel/components/settings/ManagementWorkspace.tsx`
- Test: `apps/extension/entrypoints/sidepanel/components/settings/ManagementWorkspace.test.tsx`

- [x] 先写失败测试，覆盖选中已失效技能时自动 `forceRefresh` 列表。
- [x] 在前端增加失效错误识别与统一恢复逻辑，刷新后清空选中状态并提示“技能已失效，列表已刷新。”。
- [x] 保持二进制文件预览等既有错误分支不受影响。
- [x] 运行 `pnpm --filter @mcp-b/extension exec vitest run entrypoints/sidepanel/components/settings/ManagementWorkspace.test.tsx` 验证。

### Task 4: 增加技能自检入口

**Files:**
- Modify: `apps/agent-backend-v2/src/accr-sync/accr-sync-service.ts`
- Modify: `apps/agent-backend-v2/src/routes/accr-sync.ts`
- Modify: `apps/agent-backend-v2/src/server.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/client.ts`
- Modify: `apps/extension/entrypoints/sidepanel/lib/agent-v2/types.ts`
- Modify: `apps/extension/entrypoints/sidepanel/components/settings/ManagementWorkspace.tsx`
- Test: `apps/agent-backend-v2/src/accr-sync/accr-sync-service.test.ts`
- Test: `apps/agent-backend-v2/src/routes/accr-sync.test.ts`
- Test: `apps/extension/entrypoints/sidepanel/components/settings/ManagementWorkspace.test.tsx`

- [x] 新增 `GET /api/accr-sync/health`，返回本地 `~/.claude/skills` 自检结果与建议动作。
- [x] 在同步服务里加入 `checkHealth()` 委托，避免把自检逻辑塞进路由层。
- [x] 在技能管理列表头部增加“技能自检”按钮，点击后展示中文结论。
- [x] 当自检异常时自动强刷一次技能列表，帮助用户立即看到最新状态。
- [x] 运行 `pnpm --filter @mcp-b/agent-backend-v2 exec node --import tsx --test src/accr-sync/accr-sync-service.test.ts src/routes/accr-sync.test.ts` 与 `pnpm --filter @mcp-b/extension exec vitest run entrypoints/sidepanel/components/settings/ManagementWorkspace.test.tsx` 验证。
