import type { AttributionResult, DomDocumentInput, DomDocumentLocation } from './types.ts';

function joinList(items: string[]): string {
  return items.length > 0 ? items.join('、') : '无';
}

function formatGraphProjects(title: string, projects: string[]): string {
  return `- ${title}：${joinList(projects)}`;
}

function formatSearchTerms(title: string, searchTerms: string[]): string {
  return `- ${title}：${joinList(searchTerms)}`;
}

function formatAttributionSummary(attribution: AttributionResult): string[] {
  return [
    `- 最佳接口：${attribution.bestApi ? `\`${attribution.bestApi}\`` : '未定位'}`,
    `- 置信度：${attribution.confidence}`,
    `- 是否需要补证据：${attribution.needsMoreEvidence ? '是' : '否'}`,
    `- 建议动作：\`${attribution.recommendedAction}\``,
  ];
}

function buildCurrentStateSection(page: DomDocumentInput['page'], location: DomDocumentLocation): string[] {
  return [
    '## 当前现状',
    `- 页面标题：${page.title}`,
    `- 页面 URL：${page.url}`,
    `- Hash 路由：${page.hashRoute ?? '无'}`,
    `- 目标元素：${page.targetElement}`,
    `- 页面匹配规则：${location.matchedRuleId ?? '未命中规则'}`,
  ];
}

function buildLocationSection(location: DomDocumentLocation): string[] {
  return [
    '## 代码定位结果',
    formatGraphProjects('前端图谱项目', location.frontend.graphProjects),
    formatGraphProjects('后端图谱项目', location.backend.graphProjects),
    formatGraphProjects('共享图谱项目', location.shared.graphProjects),
    formatSearchTerms('前端检索词', location.frontend.searchTerms),
    formatSearchTerms('后端检索词', location.backend.searchTerms),
    formatSearchTerms('共享检索词', location.shared.searchTerms),
  ];
}

function buildAnalysisReport(input: DomDocumentInput): string {
  const { page, attribution, location } = input;
  return [
    '# 页面 DOM 分析报告',
    '',
    '## 分析结论',
    ...formatAttributionSummary(attribution),
    '',
    ...buildCurrentStateSection(page, location),
    '',
    '## 候选接口',
    ...attribution.candidateApis.map(
      (candidate, index) =>
        `${index + 1}. \`${candidate.api}\`，得分 ${candidate.score}，证据：${joinList(candidate.evidence)}`
    ),
    '',
    ...buildLocationSection(location),
    '',
    '## 后续建议',
    `- 优先围绕 \`${attribution.bestApi ?? '候选接口'}\` 校验前后端联动逻辑。`,
    '- 结合图谱项目和检索词，继续定位页面组件、接口封装与共享模块。',
  ].join('\n');
}

function buildPrdDraft(input: DomDocumentInput): string {
  const { page, attribution, location } = input;
  return [
    '# PRD 草案',
    '',
    '## 背景与问题',
    `- 当前页面为“${page.title}”，目标元素为“${page.targetElement}”。`,
    `- 已初步归因到接口 ${attribution.bestApi ? `\`${attribution.bestApi}\`` : '待进一步确认'}，需要围绕该链路梳理产品改造点。`,
    '',
    '## 目标',
    '- 明确目标 DOM 对应的数据来源、前端展示逻辑与后端接口职责。',
    '- 为后续页面改造提供统一上下文，降低多人协作的沟通成本。',
    '',
    '## 范围',
    formatGraphProjects('涉及前端项目', location.frontend.graphProjects),
    formatGraphProjects('涉及后端项目', location.backend.graphProjects),
    formatGraphProjects('涉及共享项目', location.shared.graphProjects),
    '',
    '## 验收要点',
    '- DOM 展示结果与接口返回字段映射关系清晰。',
    '- 页面改造方案能指出至少一个前端入口和一个后端入口。',
    '- 形成可继续细化的技术方案与任务拆解。',
  ].join('\n');
}

function buildTechnicalDesign(input: DomDocumentInput): string {
  const { attribution, location } = input;
  return [
    '# 技术方案草案',
    '',
    '## 接口与数据来源',
    ...formatAttributionSummary(attribution),
    '',
    '## 前端改造点',
    formatGraphProjects('前端项目', location.frontend.graphProjects),
    formatSearchTerms('前端检索词', location.frontend.searchTerms),
    '',
    '## 后端改造点',
    formatGraphProjects('后端项目', location.backend.graphProjects),
    formatSearchTerms('后端检索词', location.backend.searchTerms),
    '',
    '## 共享模块评估',
    formatGraphProjects('共享项目', location.shared.graphProjects),
    formatSearchTerms('共享检索词', location.shared.searchTerms),
    '',
    '## 测试与验收建议',
    '- 校验目标 DOM 与接口字段映射是否一致。',
    '- 覆盖接口成功、空态和异常态渲染。',
    '- 若涉及共享模块，补充影响面回归验证。',
  ].join('\n');
}

function buildTaskBreakdown(input: DomDocumentInput): string {
  const { attribution, location } = input;
  return [
    '# 任务拆解',
    '',
    '## 开发任务',
    `1. 前端：基于 ${joinList(location.frontend.graphProjects)} 与检索词定位目标组件，梳理 \`${attribution.bestApi ?? '候选接口'}\` 的消费点。`,
    `2. 后端：基于 ${joinList(location.backend.graphProjects)} 确认接口实现、DTO 与数据组装逻辑。`,
    `3. 共享层：检查 ${joinList(location.shared.graphProjects)} 中是否存在可复用组件、类型或工具函数。`,
    '4. 联调验证：确认页面展示、接口返回与交互行为一致。',
    '',
    '## 输出物',
    '- 更新后的分析报告或技术方案备注。',
    '- 受影响模块列表与回归验证记录。',
    '- 如需继续实施，可直接转成研发任务卡片。',
  ].join('\n');
}

export function createDocumentBuilder() {
  return {
    build(input: DomDocumentInput): string {
      switch (input.documentType) {
        case 'analysis-report':
          return buildAnalysisReport(input);
        case 'prd-draft':
          return buildPrdDraft(input);
        case 'technical-design':
          return buildTechnicalDesign(input);
        case 'task-breakdown':
          return buildTaskBreakdown(input);
      }
    },
  };
}
