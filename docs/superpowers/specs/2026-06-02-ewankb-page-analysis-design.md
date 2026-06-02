# 页面分析服务 `/ewankb-server-query` 设计

## 背景

当前页面分析能力更偏向“页面事实采集 + 候选接口判断”，适合回答“这个按钮可能对应哪个接口”，但不适合直接服务当前的 `/ewankb-server-query` 工作流。

现状问题：

- 输出内容偏原始采集结果，缺少对知识库查询有用的结构化归并
- 页面文本摘要噪声较多，容易把无关词带入查询
- 缺少业务功能词、动作意图、表头字段等高价值信号
- 前台展示与可执行命令没有分层，难以做到“先确认、再触发查询”

目标是把页面分析改造成 `/ewankb-server-query` 的前置证据整理器，输出“证据卡片 + 建议命令”，帮助用户更快、更准地查询知识库和穿透代码。

## 目标

页面分析完成后，系统应同时产出两份结果：

1. 面向用户确认的证据卡片
2. 可直接插入输入框的 `/ewankb-server-query ...` 建议命令

设计目标：

- 优先服务 `/ewankb-server-query graph <kb> "<query>"` 查询
- 同时兼顾后续 `query_kb`、`search_source`、`read_source_file` 的代码穿透关键词
- 默认采用“静态证据 + 交互证据”双轨并行
- 不把大量底层字段直接铺到输入框或聊天区
- 保持输出可解释、可裁剪、可规则化维护

非目标：

- 不在页面分析主流程中直接执行知识库查询
- 不在页面分析阶段强依赖大模型做自由语义理解
- 不在页面分析阶段自动判定完整业务答案

## 总体方案

页面分析改成四层输出链路：

1. 采集原始证据
2. 归并结构化字段
3. 生成证据卡片
4. 生成建议命令

最终结果分为三层：

- `analysisCard`：面向用户展示
- `suggestedCommand`：面向输入框插入
- `evidence`：面向调试、规则优化、后续扩展

## 核心字段分组

### 1. 页面身份

- `url`
- `pathname`
- `hashRoute`
- `pageTitle`
- `featureNameCandidates`

用途：

- 标识当前页面
- 提取业务功能词
- 辅助 KB 归属判断

### 2. 操作意图

- `elementTag`
- `elementText`
- `actionType`
- `actionTarget`

用途：

- 表示当前用户分析的是哪个元素
- 把按钮文本归并成稳定动作，例如“列表查询”“新增”“导出”

### 3. 业务对象

- `tableHeaders`
- `formLabels`
- `domainTerms`

用途：

- 提供更贴近业务领域的检索词
- 补足仅靠 URL 和接口名不够时的语义线索

### 4. 接口证据

- `observedApis`
- `recommendedApi`
- `apiConfidence`
- `requestMethod`

用途：

- 为图谱查询和代码穿透提供高价值技术关键词
- 在用户做过真实点击/刷新后显著提升精度

### 5. 代码穿透关键词

- `queryTerms`
- `codeTerms`
- `resourceHints`

用途：

- 构造精简查询语句
- 为 `search_source` 提供更稳定的技术术语

## 字段提取规则

## 页面功能词提取

按以下优先级提取 `featureNameCandidates`：

1. 页面主标题
2. 页签名、面包屑、区域标题
3. 左侧激活菜单名
4. Hash 路由末段映射
5. 页面高频词回退

规则要求：

- 优先使用页面结构化区域，而不是整页文本摘要直接猜
- Hash 路由支持维护映射，例如 `expressInquiry -> 快递询价`
- 如果多个候选词冲突，优先标题区和激活导航

## 操作意图提取

通过规则归并 `actionType`，避免把原始按钮文案直接用于检索。

示例规则：

- 元素为 `button`
- 文本命中 `搜索 / 查询 / 筛选 / 检索`
- 同区域存在表单项
- 下方存在表格或列表

满足时归并为：

- `actionType = 列表查询`

后续可扩展动作类型：

- `新增`
- `导出`
- `编辑`
- `删除`
- `详情查看`
- `切换页签`

## 表头提取

新增 DOM 结构化提取逻辑，优先级如下：

1. `thead th`
2. 首行表头单元格
3. `role=columnheader`
4. 虚拟表格兼容选择器

规则：

- 最多保留前 8 到 12 个表头
- 去掉停用词：`操作`、`序号`、`更多`
- 去掉空白、纯符号、过短文本
- `analysisCard` 展示可保留更多表头
- `suggestedCommand` 只保留 2 到 4 个区分度最高的字段

## 表单标签提取

从目标按钮附近的搜索区、筛选区提取：

- 标签文本
- placeholder
- 选项标签

主要用于辅助判断“当前动作的业务对象是什么”，默认不直接全部进入命令。

## 接口词提取

从 `recommendedApi` 或高分 `observedApis` 中提取语义片段。

例如：

- `/api-miloms/guarantee/expressCostPrice/summarySearch`

提取为：

- `expressCostPrice`
- `summarySearch`

默认丢弃：

- `api-*`
- 网关前缀
- 过泛路径片段

## KB 候选提取

`kbCandidate` 不应写死在 DOM 分析主流程中，而应来自独立规则。

建议信号来源：

- host
- hashRoute
- featureNameCandidates
- observedApis / recommendedApi

当规则明确命中时，可生成：

- `kbCandidate = gls`

## 查询词裁剪规则

`suggestedCommand` 中的查询词采用分层组装，不直接拼接整页文本。

优先级：

1. 页面功能词
2. 操作意图词
3. 接口技术词
4. 业务字段词

示例：

```text
/ewankb-server-query graph gls "快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地 服务类型"
```

组装约束：

- 查询词控制在 6 到 10 个片段
- 优先保留强信号
- 超长时裁掉低优先级业务字段词

默认不进入命令的内容：

- 完整 URL
- selector / XPath
- 所有表头全文
- `medium` 等置信度词
- 无语义技术前缀
- 页面泛词

## 前台展示设计

页面分析完成后，前台默认展示一张紧凑证据卡片，而不是把所有底层字段写入输入框。

推荐卡片格式：

```md
页面：快递询价
位置：#/entrustedOrderModule/expressInquiry

目标操作：点击「搜索」
推断意图：列表查询

业务对象：
- 表头：供应商简称、价目表名称、起始国/地区、目的地、服务类型

候选接口：
- /api-miloms/guarantee/expressCostPrice/summarySearch
- 置信度：medium
```

卡片下方单独展示命令区：

```text
/ewankb-server-query graph gls "快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地 服务类型"
```

推荐动作按钮：

- `插入命令`
- `重新取证`

## 后台返回结构

建议从仅返回 markdown，改为返回结构化数据：

```json
{
  "analysisCard": {
    "pageName": "快递询价",
    "route": "#/entrustedOrderModule/expressInquiry",
    "targetAction": "点击「搜索」",
    "actionType": "列表查询",
    "tableHeaders": [
      "供应商简称",
      "价目表名称",
      "起始国/地区",
      "目的地",
      "服务类型"
    ],
    "recommendedApi": "/api-miloms/guarantee/expressCostPrice/summarySearch",
    "confidence": "medium"
  },
  "suggestedCommand": "/ewankb-server-query graph gls \"快递询价 搜索 列表查询 expressCostPrice summarySearch 供应商简称 目的地 服务类型\"",
  "evidence": {
    "kbCandidate": "gls",
    "featureNameCandidates": ["快递询价"],
    "actionTerms": ["搜索", "列表查询"],
    "apiTerms": ["expressCostPrice", "summarySearch"],
    "fieldTerms": ["供应商简称", "目的地", "服务类型"]
  }
}
```

职责分层：

- `analysisCard`：用户确认
- `suggestedCommand`：输入框插入
- `evidence`：调试和规则优化

## 采集流程

推荐链路：

1. 用户点击“分析”
2. 系统采集静态证据
3. 如目标元素可交互，则等待一次真实点击或刷新补交互证据
4. 后台归并字段
5. 生成证据卡片
6. 生成建议命令
7. 用户确认后插入输入框并发送

静态证据包括：

- URL
- Hash
- 页面标题
- 激活导航
- 表头
- 按钮文本

交互证据包括：

- observedApis
- recommendedApi
- requestMethod
- apiConfidence

## 兼容策略

### 无真实交互

仍然生成一版建议命令，但优先使用：

- 页面功能词
- 动作词
- 表头词

并在卡片中提示“当前接口证据不足，可点击或刷新补证据”。

### 有真实交互

优先把高分接口词加入建议命令，提升图谱和代码穿透命中率。

### 页面结构不规范

当标题、表头、导航提取失败时，回退到：

- hashRoute 词
- 页面摘要词
- 候选接口词

但仍要控制噪声数量。

## 风险与约束

主要风险：

- 规则过重导致维护成本上升
- 页面结构差异大时，表头/标题提取不稳定
- 过度自动化 KB 判断可能引入误导

缓解策略：

- 保持“规则优先、可维护、可回退”
- 把 KB 判断与 DOM 分析主流程解耦
- 前台以“证据卡片 + 用户确认”为主，不直接自动发起查询

## 验证方案

应覆盖以下测试场景：

1. 无交互时仅依赖静态证据生成卡片和命令
2. 有真实点击时正确提取推荐接口和接口词
3. 搜索按钮正确归并为“列表查询”
4. 表格页正确提取表头并裁剪命令字段
5. 命令始终以 `/ewankb-server-query` 开头
6. 命令长度受控，不混入 selector / XPath / 全量表头
7. KB 候选规则可单独维护和回归测试

## 推荐落地顺序

1. 先新增结构化返回：`analysisCard + suggestedCommand + evidence`
2. 再补页面功能词和动作词归并
3. 再补表头提取
4. 最后补 KB 候选规则和命令裁剪优化

这样可以先把展示和命令链路跑通，再逐步提高命中率。
