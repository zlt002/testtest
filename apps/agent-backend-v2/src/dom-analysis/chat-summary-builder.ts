import type { AttributionResult } from './types.ts';

type ChatSummaryPage = {
  title?: string;
  url: string;
  pathname?: string | null;
  hashRoute?: string | null;
};

type ChatSummaryTargetElement = {
  tagName: string;
  text: string | null;
  selector: string | null;
  xpath: string | null;
};

type ChatSummaryEvidence = {
  pageTextSummary: string[];
  apiCandidates: string[];
  resourceHints: string[];
};

type ChatSummaryInput = {
  page: ChatSummaryPage;
  targetElement: ChatSummaryTargetElement;
  attribution: AttributionResult;
  evidence: ChatSummaryEvidence;
};

function joinList(items: string[]): string {
  return items.length > 0 ? items.join('、') : '无';
}

function formatRecommendedAction(attribution: AttributionResult): string {
  switch (attribution.recommendedAction) {
    case 'inspect-best-api':
      return '先检查最佳接口，再决定是否需要继续做代码定位。';
    case 'validate-top-candidates':
      return '先交叉验证高分候选接口，避免过早下结论。';
    case 'collect-more-evidence':
      return '建议补一次真实点击或交互，继续收集网络证据。';
  }
}

export function createChatSummaryBuilder() {
  return {
    build(input: ChatSummaryInput): string {
      const candidateLines =
        input.attribution.candidateApis.length > 0
          ? input.attribution.candidateApis.map(
              (candidate, index) =>
                `${index + 1}. \`${candidate.api}\`，得分 ${candidate.score}，证据：${joinList(candidate.evidence)}`
            )
          : ['1. 暂无候选接口，请补充交互或页面线索。'];

      return [
        '# 页面元素接口联分析',
        '',
        '## 目标元素',
        `- 页面标题：${input.page.title}`,
        `- 页面 URL：${input.page.url}`,
        `- 页面路径：${input.page.pathname ?? '无'}`,
        `- Hash 路由：${input.page.hashRoute ?? '无'}`,
        `- 目标元素：<${input.targetElement.tagName.toLowerCase()}> ${input.targetElement.text ?? '无文本'}`,
        `- Selector：${input.targetElement.selector ?? '无'}`,
        `- XPath：${input.targetElement.xpath ?? '无'}`,
        '',
        '## 接口判断',
        `- 推荐接口：${input.attribution.bestApi ? `\`${input.attribution.bestApi}\`` : '未定位'}`,
        `- 置信度：${input.attribution.confidence}`,
        `- 是否需要补证据：${input.attribution.needsMoreEvidence ? '是' : '否'}`,
        '',
        '## 候选接口',
        ...candidateLines,
        '',
        '## 页面证据',
        `- 页面摘要关键词：${joinList(input.evidence.pageTextSummary)}`,
        `- 运行时接口候选：${joinList(input.evidence.apiCandidates)}`,
        `- 资源线索：${joinList(input.evidence.resourceHints)}`,
        '',
        '## 后续建议',
        `- 建议动作：${formatRecommendedAction(input.attribution)}`,
        '- 代码来源判断与知识库查询已改由独立 skill 处理，当前结果仅保留页面事实证据。',
      ].join('\n');
    },
  };
}
