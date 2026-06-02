# MashAI x accr-ui 深度集成方案（控制总线 + 侧边栏）

## 1) 目标与边界

### 目标
1. 使用 `accr-ui` 的能力路由体系，驱动 `MashAI` 完成网页动作（打开/切换/导航/读取状态）。
2. 复用 `MashAI` 的 Tab/侧边栏能力，给 Claude/agent 提供一致的浏览器上下文。
3. 先保证可控性与可靠性，再扩展到更完整的页面自动化命令。

### 不在当前范围
1. 重构 `MashAI` 的 UI 外观。
2. 引入大规模浏览器 DOM 自动化替代（例如 Playwright）
3. 统一替换原有 `accr-ui` 扩展侧边栏实现。

## 2) 现状对齐

### MashAI 能力边界（当前）
- 已支持：创建/关闭/切换 tab、返回/前进/刷新、profile 切换、副作用（侧边栏钉住）、分区会话。
- 已有前端可见状态：`tabs`, `activeTabId`, `profiles`, `sidePanelState`, `settings`。
- 已暴露 IPC：`create-tab`, `create-tab-with-url`, `switch-tab`, `close-tab`, `reload-tab`, `nav-back`, `nav-forward`, `nav-reload`, `create-tab-with-url`, `switch-profile`, `pin-to-side-panel`, `unpin-side-panel`, `set-panel-width`, `get-side-panel-state` 等。

### accr-ui 能力边界（当前）
- `agent-backend-v2` 已有能力路由与 runtime capability 接口。
- 本地 `native-server` 已有 MCP 工具桥接能力，可作为后续扩展到 MashAI 的通道。
- 当前交互策略对“外部浏览器自动化”有约束，需明确定义让策略认可 MashAI 控制能力。

## 3) 统一方案（推荐）

采用“三层总线”

1. `MashAI Automation Bridge`（MashAI 侧新增）
- 新增一个最小控制接口（IPC + 命令队列 + 状态事件）。
- 只做“浏览器态控制”与“状态回放”。

2. `accr-ui Agent Adapter`（accr-ui 侧新增）
- 通过本地 HTTP/MCP 将 Claude 指令映射为 MashAI 命令。
- 负责能力发现、参数校验、重试与错误归一化。

3. `Policy Alignment`
- 在 `agent-backend-v2` runtime policy 里增加 MashAI 专属工具前缀为优先通道。
- 默认拒绝“绕过主路径”的外部工具，保证一致性。

## 4) 设计目标
- 可观测：命令发送、执行结果、超时、错误码都有统一日志。
- 幂等：对重复命令具备幂等 key 与重试策略。
- 安全：来源鉴权 + 命令白名单 + URL/协议白名单。
- 可回滚：功能按阶段上线，不一次性全量打通。

## 5) 详细技术实现

### 5.1 MashAI 端新增模块

#### A. `electron/ipc/AutomationHandlers.ts`（新）
处理控制类 IPC：
- `automation-command`（通用命令入口）
- `automation-status`（读状态）
- `automation-subscribe-events`（订阅事件）

返回统一结果：
- `requestId`
- `command`
- `status: success | failed | timeout | rejected`
- `payload?`
- `error?: { code, message, detail }`

#### B. 命令对象（建议 schema）

```json
{
  "requestId": "uuid",
  "command": "navigation.openUrl",
  "profileId": "work",
  "tabId": "tab-xxx",
  "params": {
    "url": "https://www.baidu.com"
  },
  "timeoutMs": 12000,
  "idempotencyKey": "sha256(...)"
}
```

#### C. MashAI 支持的首批命令
1. `navigation.openUrl`
- 行为：`create-tab-with-url` 或 `switch-to-existing-tab-or-open`。
- 结果：返回 `tabId` + 初始 URL。

2. `navigation.activateTab`
- 行为：`switch-tab`。
- 结果：`activeTabId`。

3. `navigation.goBack`
- 行为：`nav-back`。

4. `navigation.goForward`
- 行为：`nav-forward`。

5. `navigation.reload`
- 行为：`nav-reload`。

6. `navigation.readUrl`
- 行为：读取当前活动 tab URL/标题。
- 结果：`{ url, title, tabId }`。

7. `sidepanel.pinTab`
- 行为：`pin-to-side-panel`。

8. `sidepanel.unpinTab`
- 行为：`unpin-side-panel`。

#### D. 事件总线
- 新增 `automation-event` 向 renderer 发送：
  - `tab-created`
  - `tab-updated`
  - `tab-closed`
  - `side-panel-changed`
  - `navigation-started`
  - `navigation-failed`

### 5.2 accr-ui 端能力适配

#### A. 新增能力项
在 `agent-backend-v2` `capabilities` 中新增 `browserTools` 映射（保留现有可扩展）
- 显式支持 `browserTools: 'local_mcp_http'` 下新增 `mashai-browser-extension` 子能力入口。

#### B. 新增 Adapter（建议）
- 文件：`apps/agent-backend-v2/src/agent/runtime/tools/mashai-bridge.ts`（按当前风格创建）
- 负责把能力调用映射到 MashAI 控制服务。

#### C. 命令路由（示意）
- `mashai_open_url` -> `navigation.openUrl`
- `mashai_switch_tab` -> `navigation.activateTab`
- `mashai_back` -> `navigation.goBack`
- `mashai_forward` -> `navigation.goForward`
- `mashai_reload` -> `navigation.reload`
- `mashai_get_page_state` -> `navigation.readUrl`
- `mashai_pin_sidebar_tab` -> `sidepanel.pinTab`
- `mashai_unpin_sidebar` -> `sidepanel.unpinTab`

#### D. 服务地址配置
- 可复用现有 HTTP 结构：`accr-ui` 在本地调用一个轻量端点（建议 127.0.0.1 + 固定端口）。
- 先用开发环境直连；上线后走配置文件环境变量。

### 5.3 状态同步模型

- 在 `TabManager` 层维护 `automationStateView`（只读快照）
- 每次关键动作后推送状态到前端（可复用已有 `tab-created/tab-updated`）
- `accr-ui` 侧保持最终一致性：收到事件更新本地状态，不依赖本地猜测。

## 6) 鉴权与安全

### 6.1 基线
- 接口在本地环回监听。
- 所有命令必须带 `requestId + timeoutMs + idempotencyKey`。
- 限制危险操作：
  - 限制 `file:`、`chrome://` 等。
  - `openUrl` 仅允许 http/https（可配置例外）。

### 6.2 速率与幂等
- 每窗口并发上限：2~4。
- 幂等 key 命中返回上一次结果。

## 7) 与现有交互策略的对齐

- 在 `interaction-policy-router` 中将 `mcp__browser_extension__...` 等现有规则扩展为：
  - 对于 active web page 的操作优先走 `accr-ui` 的 MashAI 工具前缀。
  - 不允许无上下文强制切换到外部 browser automation。
- 这避免了策略与新通道冲突，减少拒绝/绕行风险。

## 8) 实施里程碑（可按周）

1. 第 1 阶段（2~3 天）
- 在 MashAI 新增最小 automation command 通道。
- 支持 `openUrl / activateTab / back / forward / reload / readUrl`。
- 验证 `accr-ui` 可调用并拿到成功回执。

2. 第 2 阶段（2~3 天）
- 打通 sidepanel 相关命令。
- 加入事件订阅（状态回推）。
- 接入策略对齐与错误码体系。

3. 第 3 阶段（2~3 天）
- 增加执行页内动作（点击/输入）占位与安全沙箱。
- 增加超时重试与幂等测试。

## 9) 风险与缓解

- 风险1：当前 `WebContentsView` 缺少完整 DOM 操作能力
  - 缓解：阶段 1 仅做导航和 tab 管理；阶段 2 再接 DOM。

- 风险2：accr-ui 与 MashAI 的多进程事件一致性
  - 缓解：所有命令都返回请求结果 + 事件订阅冗余校验。

- 风险3：已有策略拒绝链路
  - 缓解：同步更新 `interaction-policy-router` 与 capability 宣告。

## 10) 验收标准（MVP）

- 1) `mcp__mashai_open_url` 可打开 `https://www.baidu.com`，并返回 tab id。
- 2) 连续命令下发中，`activateTab` 与 `readUrl` 返回一致的活动页。
- 3) sidepanel 能针对此 tab 切换可用（pin/unpin）。
- 4) 当超时/失败发生，返回结构化错误码，不出现静默卡死。

## 11) 代码影响清单

### MashAI
- 新增：`electron/ipc/AutomationHandlers.ts`
- 新增：`electron/types/automation.ts`（建议）
- 修改：`electron/main.ts`
- 修改：`electron/preload.ts`
- 修改：`src/types/index.ts`

### accr-ui
- 修改：`apps/agent-backend-v2/src/app.ts`
- 修改：`apps/agent-backend-v2/src/capabilities/capabilities.ts`
- 修改：`apps/agent-backend-v2/src/agent/runtime/interaction-policy-router.ts`
- 新增：`apps/agent-backend-v2/src/agent/runtime/tools/mashai-bridge.ts`
- 修改：`apps/agent-backend-v2/src/capabilities/*`（如需能力暴露注册）

## 12) 建议先行命名

- 标准工具前缀：`mashai_*`
- 示例：`mashai_open_url`, `mashai_switch_tab`, `mashai_reload`, `mashai_get_page_state`
- 事件名：`MashAIAutomation`

## 13) 里程碑产出与负责人

- 第 1 周：我建议由你我一起完成协议层与事件模型。
- 第 2 周：你做本地端配置 + 验收脚本。
- 第 3 周：策略兼容、回归和边界测试。

