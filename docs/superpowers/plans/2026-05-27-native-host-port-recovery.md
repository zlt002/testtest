# Native Host Port Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 native server 在 `12306` 被旧实例占用时优先复用健康服务，否则只清理本项目旧进程后再启动。

**Architecture:** 在 native-server 启动前增加一个端口恢复辅助模块，负责探活、识别旧进程和定向清理。`Server.start` 仅编排恢复流程和最终监听，不改扩展侧协议。

**Tech Stack:** TypeScript, Fastify, Node.js 进程/网络能力, Vitest

---

### Task 1: 为端口恢复逻辑补失败测试

**Files:**
- Create: `apps/native-server/src/server/port-recovery.test.ts`
- Test: `apps/native-server/src/server/port-recovery.test.ts`

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行测试确认失败**

### Task 2: 实现最小端口恢复逻辑

**Files:**
- Create: `apps/native-server/src/server/port-recovery.ts`
- Modify: `apps/native-server/src/server/index.ts`
- Test: `apps/native-server/src/server/port-recovery.test.ts`

- [ ] **Step 1: 实现探活与定向清理辅助函数**
- [ ] **Step 2: 在 `Server.start` 接入恢复逻辑**
- [ ] **Step 3: 运行测试确认通过**

### Task 3: 验证关键回归

**Files:**
- Test: `apps/native-server/src/server/port-recovery.test.ts`
- Test: `apps/native-server/src/server/streamable-http-json.test.ts`

- [ ] **Step 1: 运行 native-server 相关测试**
- [ ] **Step 2: 确认无新增回归**
