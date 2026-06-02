# `/ewankb-server-query` 页面分析增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有页面分析从“markdown 结果塞输入框”升级为“证据卡片 + `/ewankb-server-query` 建议命令”，同时补齐页面功能词、动作意图、表头字段、接口词和 KB 候选提取。

**Architecture:** 后端 `dom-analyze` 路由负责返回结构化结果；扩展后台负责补齐静态/交互证据并发布 UI 事件；侧边栏新增专用分析卡片展示和“插入命令”动作。命令生成保持规则驱动，避免把整页文本原样拼接进查询。

**Tech Stack:** TypeScript、Node HTTP route、Chrome Extension background/sidepanel、Vitest、Node test

---

## 文件结构

### 后端结构化返回与规则归并

- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/routes/page-code-analysis.ts`
- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/chat-summary-builder.ts`
- 新建：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/analysis-card-builder.ts`
- 新建：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/suggested-command-builder.ts`
- 新建：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/kb-candidate-resolver.ts`
- 新建：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/page-feature-resolver.ts`
- 测试：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/analysis-card-builder.test.ts`
- 测试：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/suggested-command-builder.test.ts`
- 测试：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/kb-candidate-resolver.test.ts`
- 测试：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/app.test.ts`

### 扩展后台证据采集增强

- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/dom-analysis-evidence.ts`
- 新建：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/dom-analysis-structured-signals.ts`
- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-picker.ts`
- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-edit-element-analysis.ts`
- 测试：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/dom-analysis-evidence.test.ts`
- 测试：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-edit-element-analysis.test.ts`
- 测试：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-picker.test.ts`

### 侧边栏展示与命令插入

- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/lib/dom-analysis/types.ts`
- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/lib/agent-v2/client.ts`
- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/lib/agent-v2/session-selection.ts`
- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-edit.ts`
- 新建：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/components/chat/DomAnalysisSuggestionCard.tsx`
- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`
- 测试：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/components/chat/DomAnalysisSuggestionCard.test.tsx`
- 测试：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx`
- 测试：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-edit.test.ts`

### 文档与回归

- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/builtin-plugins/page-codebase-assistant/skills/current-page-codebase/SKILL.md`
- 修改：`/Users/zhanglt21/Desktop/accrnew/accr-ui/docs/superpowers/specs/2026-06-02-ewankb-page-analysis-design.md`

---

### Task 1: 定义结构化 DOM 分析结果与后端返回

**Files:**
- Create: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/analysis-card-builder.ts`
- Create: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/suggested-command-builder.ts`
- Create: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/kb-candidate-resolver.ts`
- Create: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/page-feature-resolver.ts`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/routes/page-code-analysis.ts`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/chat-summary-builder.ts`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/analysis-card-builder.test.ts`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/suggested-command-builder.test.ts`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/kb-candidate-resolver.test.ts`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/app.test.ts`

- [ ] **Step 1: 先写后端结构化返回测试**

在 `app.test.ts` 为 `/api/agent-v2/page-code-analysis/dom-analyze` 新增断言，确认返回体除了 `chatSummary.markdown`，还包含：

```ts
analysisCard: {
  pageName: '快递询价',
  route: '#/entrustedOrderModule/expressInquiry',
  targetAction: '点击「搜索」',
  actionType: '列表查询',
  tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
  recommendedApi: '/api-miloms/guarantee/expressCostPrice/summarySearch',
  confidence: 'medium',
}

suggestedCommand:
  '/ewankb-server-query graph gls "快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地 服务类型"'

evidence: {
  kbCandidate: 'gls',
  featureNameCandidates: ['快递询价'],
  actionTerms: ['搜索', '列表查询'],
  apiTerms: ['expressCostPrice', 'summarySearch'],
  fieldTerms: ['供应商简称', '目的地', '服务类型'],
}
```

- [ ] **Step 2: 运行单测确认当前失败**

Run:

```bash
pnpm --filter agent-backend-v2 test -- --runInBand src/app.test.ts
```

Expected: `dom-analyze` 返回字段缺失，相关断言失败。

- [ ] **Step 3: 为 KB 候选、功能词、命令裁剪写独立单测**

在三个新测试文件中分别覆盖：

```ts
test('kb candidate resolver combines host route and api hints', () => {
  assert.equal(
    resolveKbCandidate({
      url: 'https://gls-uat.annto.com/#/entrustedOrderModule/expressInquiry',
      hashRoute: '/entrustedOrderModule/expressInquiry',
      featureNameCandidates: ['快递询价'],
      observedApis: ['/api-miloms/guarantee/expressCostPrice/summarySearch'],
    }),
    'gls'
  );
});

test('suggested command builder keeps high-signal query terms only', () => {
  const result = buildSuggestedCommand({
    kbCandidate: 'gls',
    featureName: '快递询价',
    actionTerms: ['搜索', '列表查询'],
    apiTerms: ['expressCostPrice', 'summarySearch', 'api-miloms'],
    fieldTerms: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
  });

  assert.equal(
    result,
    '/ewankb-server-query graph gls "快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地 服务类型"'
  );
});
```

- [ ] **Step 4: 实现最小 Builder 与 Resolver**

实现最小导出接口，保持职责单一：

```ts
export function resolvePageFeature(input: {
  pageTitle?: string | null;
  hashRoute?: string | null;
  navLabels?: string[];
  pageTextSummary: string[];
}): { pageName: string | null; candidates: string[] } { /* ... */ }

export function resolveKbCandidate(input: {
  url?: string | null;
  hashRoute?: string | null;
  featureNameCandidates: string[];
  observedApis: string[];
}): string | null { /* ... */ }

export function buildSuggestedCommand(input: {
  kbCandidate: string | null;
  featureName: string | null;
  actionTerms: string[];
  apiTerms: string[];
  fieldTerms: string[];
}): string | null { /* ... */ }

export function buildAnalysisCard(input: {
  pageName: string | null;
  route: string | null;
  elementText: string | null;
  actionType: string | null;
  tableHeaders: string[];
  recommendedApi: string | null;
  confidence: 'low' | 'medium' | 'high';
}): DomAnalysisCard { /* ... */ }
```

- [ ] **Step 5: 接入 `dom-analyze` 路由**

在 `page-code-analysis.ts` 中用新 builder 拼出结构化响应，同时保留现有 `chatSummary.markdown` 兼容旧链路。响应结构至少包含：

```ts
{
  page,
  targetElement,
  attribution,
  evidence,
  analysisCard,
  suggestedCommand,
  chatSummary: { markdown }
}
```

- [ ] **Step 6: 运行后端测试**

Run:

```bash
pnpm --filter agent-backend-v2 test -- --runInBand src/dom-analysis/analysis-card-builder.test.ts src/dom-analysis/suggested-command-builder.test.ts src/dom-analysis/kb-candidate-resolver.test.ts src/app.test.ts
```

Expected: PASS

- [ ] **Step 7: 提交这一批后端结构化返回改动**

```bash
git add \
  apps/agent-backend-v2/src/routes/page-code-analysis.ts \
  apps/agent-backend-v2/src/dom-analysis/chat-summary-builder.ts \
  apps/agent-backend-v2/src/dom-analysis/analysis-card-builder.ts \
  apps/agent-backend-v2/src/dom-analysis/suggested-command-builder.ts \
  apps/agent-backend-v2/src/dom-analysis/kb-candidate-resolver.ts \
  apps/agent-backend-v2/src/dom-analysis/page-feature-resolver.ts \
  apps/agent-backend-v2/src/dom-analysis/analysis-card-builder.test.ts \
  apps/agent-backend-v2/src/dom-analysis/suggested-command-builder.test.ts \
  apps/agent-backend-v2/src/dom-analysis/kb-candidate-resolver.test.ts \
  apps/agent-backend-v2/src/app.test.ts
git commit -m "feat: return structured ewankb dom analysis payload"
```

### Task 2: 增强扩展后台证据采集，补齐表头和动作词

**Files:**
- Create: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/dom-analysis-structured-signals.ts`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/dom-analysis-evidence.ts`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-picker.ts`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/dom-analysis-evidence.test.ts`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-picker.test.ts`

- [ ] **Step 1: 先写表头、标签、导航提取单测**

在 `dom-analysis-evidence.test.ts` 中增加页面 HTML 样例，断言会产出：

```ts
pageContext.structuredSignals = {
  navLabels: ['委托中心', '快递询价'],
  formLabels: ['客户', '航线', '状态', '加价模型编码', '创建人'],
  tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter extension test -- --runInBand apps/extension/entrypoints/background/src/services/dom-analysis-evidence.test.ts apps/extension/entrypoints/background/src/services/page-picker.test.ts
```

Expected: `structuredSignals` 未定义或字段为空。

- [ ] **Step 3: 新建结构化 DOM 信号提取 helper**

在 `dom-analysis-structured-signals.ts` 中实现：

```ts
export type StructuredDomSignals = {
  navLabels: string[];
  formLabels: string[];
  tableHeaders: string[];
};

export function extractStructuredDomSignals(doc: Document): StructuredDomSignals {
  // 读取激活导航、表单标签、thead th / role=columnheader
}
```

要求：

- 表头最多 12 个
- 过滤 `操作`、`序号`、`更多`
- 去重、去空白

- [ ] **Step 4: 把结构化信号并入 `PageEvidence` 构建过程**

在 `buildPageEvidence` 的页面内容读取阶段扩展字段，把 `structuredSignals` 放进 `pageContext` 或新增兼容字段；如果需要扩合同步更新前端 `DomAnalyzeRequest` 消费类型。

- [ ] **Step 5: 在目标元素附近推断动作词**

在 `dom-analysis-evidence.ts` 内新增轻量规则：

```ts
function inferActionType(input: {
  tagName: string;
  text: string | null;
  hasFormContext: boolean;
  hasTableContext: boolean;
}): string | null
```

对 `button + 搜索/查询/筛选/检索 + 表单区 + 表格区` 返回 `列表查询`。

- [ ] **Step 6: 运行扩展后台测试**

Run:

```bash
pnpm --filter extension test -- --runInBand apps/extension/entrypoints/background/src/services/dom-analysis-evidence.test.ts apps/extension/entrypoints/background/src/services/page-picker.test.ts
```

Expected: PASS

- [ ] **Step 7: 提交证据采集增强**

```bash
git add \
  apps/extension/entrypoints/background/src/services/dom-analysis-structured-signals.ts \
  apps/extension/entrypoints/background/src/services/dom-analysis-evidence.ts \
  apps/extension/entrypoints/background/src/services/page-picker.ts \
  apps/extension/entrypoints/background/src/services/dom-analysis-evidence.test.ts \
  apps/extension/entrypoints/background/src/services/page-picker.test.ts
git commit -m "feat: collect structured dom signals for ewankb analysis"
```

### Task 3: 扩展前后端契约，替换“只回 markdown”的页面分析结果

**Files:**
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/lib/dom-analysis/types.ts`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/lib/agent-v2/client.ts`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-edit-element-analysis.ts`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-edit-element-analysis.test.ts`

- [ ] **Step 1: 先写契约变更测试**

在 `page-edit-element-analysis.test.ts` 中把 mock 返回从：

```ts
{ chatSummary: { markdown: '# 页面元素接口联分析' } }
```

改成：

```ts
{
  analysisCard: { /* ... */ },
  suggestedCommand: '/ewankb-server-query graph gls "..."',
  chatSummary: { markdown: '# 页面元素接口联分析' },
}
```

并断言 `completeSelectionAnalysis` 返回结构体，而不是只返回 `{ markdown }`。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter extension test -- --runInBand apps/extension/entrypoints/background/src/services/page-edit-element-analysis.test.ts
```

Expected: 返回值类型不匹配或字段缺失。

- [ ] **Step 3: 更新前端契约类型**

在 `sidepanel/lib/dom-analysis/types.ts` 中新增：

```ts
export type DomAnalysisCard = {
  pageName: string | null;
  route: string | null;
  targetAction: string | null;
  actionType: string | null;
  tableHeaders: string[];
  recommendedApi: string | null;
  confidence: 'low' | 'medium' | 'high';
};

export type DomAnalyzeResult = {
  // existing fields...
  analysisCard?: DomAnalysisCard | null;
  suggestedCommand?: string | null;
  evidence?: {
    kbCandidate?: string | null;
    featureNameCandidates?: string[];
    actionTerms?: string[];
    apiTerms?: string[];
    fieldTerms?: string[];
    pageTextSummary: string[];
    apiCandidates: string[];
    resourceHints: string[];
  };
}
```

- [ ] **Step 4: 更新 background service 返回值**

把 `completeSelectionAnalysis` 从：

```ts
Promise<{ markdown: string }>
```

调整为：

```ts
Promise<{
  markdown: string;
  analysisCard: DomAnalyzeResult['analysisCard'];
  suggestedCommand: string | null;
}>
```

并保留 markdown 字段给兼容链路。

- [ ] **Step 5: 运行契约相关测试**

Run:

```bash
pnpm --filter extension test -- --runInBand apps/extension/entrypoints/background/src/services/page-edit-element-analysis.test.ts
```

Expected: PASS

- [ ] **Step 6: 提交契约层改动**

```bash
git add \
  apps/extension/entrypoints/sidepanel/lib/dom-analysis/types.ts \
  apps/extension/entrypoints/sidepanel/lib/agent-v2/client.ts \
  apps/extension/entrypoints/background/src/services/page-edit-element-analysis.ts \
  apps/extension/entrypoints/background/src/services/page-edit-element-analysis.test.ts
git commit -m "refactor: return structured dom analysis result to extension"
```

### Task 4: 新增侧边栏证据卡片与“插入命令”交互

**Files:**
- Create: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/components/chat/DomAnalysisSuggestionCard.tsx`
- Create: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/components/chat/DomAnalysisSuggestionCard.test.tsx`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/lib/agent-v2/session-selection.ts`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-edit.ts`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/routes/chat.index.tsx`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/background/src/services/page-edit.test.ts`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx`

- [ ] **Step 1: 先写 UI 卡片与消息流测试**

新增 `DomAnalysisSuggestionCard.test.tsx`，断言卡片展示：

```tsx
<DomAnalysisSuggestionCard
  card={{
    pageName: '快递询价',
    route: '#/entrustedOrderModule/expressInquiry',
    targetAction: '点击「搜索」',
    actionType: '列表查询',
    tableHeaders: ['供应商简称', '价目表名称', '起始国/地区', '目的地', '服务类型'],
    recommendedApi: '/api-miloms/guarantee/expressCostPrice/summarySearch',
    confidence: 'medium',
  }}
  suggestedCommand='/ewankb-server-query graph gls "快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地 服务类型"'
/>
```

并断言点击“插入命令”后触发 `publishAgentV2ComposerAppend`。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter extension test -- --runInBand apps/extension/entrypoints/sidepanel/components/chat/DomAnalysisSuggestionCard.test.tsx apps/extension/entrypoints/background/src/services/page-edit.test.ts
```

Expected: 组件、事件或消息类型不存在。

- [ ] **Step 3: 扩展侧边栏消息通道**

在 `session-selection.ts` 新增专用 payload：

```ts
export type AgentV2DomAnalysisSuggestion = {
  card: DomAnalysisCard;
  suggestedCommand: string | null;
  createdAt: string;
};
```

并新增：

```ts
publishAgentV2DomAnalysisSuggestion()
readAgentV2DomAnalysisSuggestion()
isAgentV2DomAnalysisSuggestionMessage()
```

不要复用当前仅支持 `success | error | pending` 的 quick action feedback。

- [ ] **Step 4: 在 background 发布“卡片 + 命令”而不是 markdown 入输入框**

在 `page-edit.ts` 的 `publishPageEditSelectionAnalysisResult()` 中改成：

```ts
await publishAgentV2DomAnalysisSuggestion({
  card: completed.analysisCard,
  suggestedCommand: completed.suggestedCommand,
});
```

只在异常场景继续走纯文本提示；不要自动把 markdown 塞进输入框。

- [ ] **Step 5: 在 `chat.index.tsx` 挂接卡片状态**

新增 state：

```ts
const [domAnalysisSuggestion, setDomAnalysisSuggestion] =
  useState<AgentV2DomAnalysisSuggestion | null>(null);
```

监听新 message；渲染卡片；点击按钮后调用：

```ts
appendToInput(suggestedCommand)
```

- [ ] **Step 6: 运行 UI 与消息流测试**

Run:

```bash
pnpm --filter extension test -- --runInBand apps/extension/entrypoints/sidepanel/components/chat/DomAnalysisSuggestionCard.test.tsx apps/extension/entrypoints/background/src/services/page-edit.test.ts apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx
```

Expected: PASS

- [ ] **Step 7: 提交 UI 卡片链路**

```bash
git add \
  apps/extension/entrypoints/sidepanel/components/chat/DomAnalysisSuggestionCard.tsx \
  apps/extension/entrypoints/sidepanel/components/chat/DomAnalysisSuggestionCard.test.tsx \
  apps/extension/entrypoints/sidepanel/lib/agent-v2/session-selection.ts \
  apps/extension/entrypoints/background/src/services/page-edit.ts \
  apps/extension/entrypoints/sidepanel/routes/chat.index.tsx \
  apps/extension/entrypoints/background/src/services/page-edit.test.ts \
  apps/extension/entrypoints/sidepanel/routes/chat-selection-quote.interaction.test.tsx
git commit -m "feat: show ewankb dom analysis suggestion card"
```

### Task 5: 回归 chatSummary、文档和技能说明

**Files:**
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/chat-summary-builder.ts`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/builtin-plugins/page-codebase-assistant/skills/current-page-codebase/SKILL.md`
- Modify: `/Users/zhanglt21/Desktop/accrnew/accr-ui/docs/superpowers/specs/2026-06-02-ewankb-page-analysis-design.md`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/dom-analysis/chat-summary-builder.test.ts`
- Test: `/Users/zhanglt21/Desktop/accrnew/accr-ui/apps/agent-backend-v2/src/app.test.ts`

- [ ] **Step 1: 先写回归测试**

补充断言：

- `chatSummary.markdown` 继续存在，供旧入口兼容
- markdown 中不混入 `/ewankb-server-query` 原始命令
- 新结构化字段承载“卡片”和“命令”

- [ ] **Step 2: 运行测试确认失败或部分失败**

Run:

```bash
pnpm --filter agent-backend-v2 test -- --runInBand src/dom-analysis/chat-summary-builder.test.ts src/app.test.ts
```

Expected: 旧摘要或新断言不一致。

- [ ] **Step 3: 调整 chat summary 到兼容模式**

保留原摘要作为“调试/回退文本”，但去掉对“建议知识库/建议查询模式”的任何暗示；由结构化字段单独承载建议命令。

- [ ] **Step 4: 更新技能说明文档**

在 `current-page-codebase/SKILL.md` 中补充：

- 当前页面分析优先输出证据卡片和建议命令
- 知识库查询由 `/ewankb-server-query` 承接
- 页面分析不再直接承担知识库回答职责

- [ ] **Step 5: 运行完整回归**

Run:

```bash
pnpm --filter agent-backend-v2 test -- --runInBand src/app.test.ts src/dom-analysis/chat-summary-builder.test.ts
pnpm --filter extension test -- --runInBand \
  apps/extension/entrypoints/background/src/services/dom-analysis-evidence.test.ts \
  apps/extension/entrypoints/background/src/services/page-edit-element-analysis.test.ts \
  apps/extension/entrypoints/background/src/services/page-edit.test.ts \
  apps/extension/entrypoints/sidepanel/components/chat/DomAnalysisSuggestionCard.test.tsx
```

Expected: PASS

- [ ] **Step 6: 提交文档与回归收口**

```bash
git add \
  apps/agent-backend-v2/src/dom-analysis/chat-summary-builder.ts \
  apps/agent-backend-v2/builtin-plugins/page-codebase-assistant/skills/current-page-codebase/SKILL.md \
  docs/superpowers/specs/2026-06-02-ewankb-page-analysis-design.md
git commit -m "docs: align page analysis workflow with ewankb query flow"
```

## 自检

### Spec coverage

- 证据卡片：Task 1、Task 4
- 建议命令：Task 1、Task 4
- 页面功能词：Task 1、Task 2
- 动作意图：Task 2
- 表头提取：Task 2
- KB 候选：Task 1
- 前台展示分层：Task 4
- 兼容旧 markdown：Task 3、Task 5

### Placeholder scan

- 已避免使用 TBD / TODO / “后续补充”
- 每个任务都包含文件、命令、目标输出

### Type consistency

- 卡片统一使用 `DomAnalysisCard`
- 后端结构化响应统一使用 `analysisCard`、`suggestedCommand`、`evidence`
- 前端插入命令统一使用 `publishAgentV2ComposerAppend`

