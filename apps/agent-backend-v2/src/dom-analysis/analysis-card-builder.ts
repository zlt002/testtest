import type { AttributionConfidence } from './types.ts';

export type DomAnalysisCard = {
  pageName: string | null;
  route: string | null;
  targetAction: string | null;
  actionType: string | null;
  tableHeaders: string[];
  recommendedApi: string | null;
  confidence: AttributionConfidence;
};

type BuildAnalysisCardInput = {
  pageName: string | null;
  route: string | null;
  elementText: string | null;
  actionType: string | null;
  tableHeaders: string[];
  recommendedApi: string | null;
  confidence: AttributionConfidence;
};

type ResolveAnalysisSignalsInput = {
  elementText: string | null;
  pageTextSummary: string[];
  recommendedApi: string | null;
  attributionConfidence: AttributionConfidence;
  interactionEvidenceCount: number;
};

type AnalysisSignals = {
  actionType: string | null;
  tableHeaders: string[];
  confidence: AttributionConfidence;
};

const ACTION_TYPE_KEYWORDS = ['搜索', '查询', '筛选', '检索'];
const IGNORED_TABLE_TERMS = new Set([
  '快递询价',
  '快递管理',
  '搜索',
  '查询',
  '列表查询',
  '首页',
  '委托中心',
  '物流订单号，多条运号隔开',
  '快递单号，多条运号隔开',
]);
const TABLE_HEADER_POSITIVE_KEYWORDS = [
  '单号',
  '简称',
  '公司',
  '名称',
  '类型',
  '服务',
  '收货',
  '发运',
  '始发',
  '目的地',
  '地区',
  '状态',
  '物流',
  '快递',
];

function dedupe(items: string[]): string[] {
  return items.filter((item, index) => item.length > 0 && items.indexOf(item) === index);
}

function scoreTableHeader(term: string): number {
  let score = 0;
  if (TABLE_HEADER_POSITIVE_KEYWORDS.some((keyword) => term.includes(keyword))) {
    score += 10;
  }
  if (/管理|中心|新增|导入|导出|刷新|按钮|菜单|首页/.test(term)) {
    score -= 10;
  }
  if (/隔开|请输入|请选择/.test(term)) {
    score -= 12;
  }
  if (term.length >= 8) {
    score += 2;
  }
  return score;
}

function formatRoute(route: string | null): string | null {
  if (!route) {
    return null;
  }
  return route.startsWith('#') ? route : `#${route}`;
}

function formatTargetAction(elementText: string | null): string | null {
  const normalized = elementText?.trim();
  return normalized ? `点击「${normalized}」` : null;
}

export function resolveActionType(elementText: string | null): string | null {
  const normalized = elementText?.trim() ?? '';
  if (!normalized) {
    return null;
  }

  if (ACTION_TYPE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return '列表查询';
  }

  return normalized;
}

export function extractTableHeaders(pageTextSummary: string[]): string[] {
  return dedupe(
    pageTextSummary
      .map((term) => term.trim())
      .filter(
        (term) =>
          term.length >= 2 &&
          !IGNORED_TABLE_TERMS.has(term) &&
          !/监控|概览|首页/.test(term) &&
          scoreTableHeader(term) > 0
      )
      .sort((left, right) => scoreTableHeader(right) - scoreTableHeader(left))
  ).slice(0, 5);
}

export function resolveCardConfidence(input: {
  recommendedApi: string | null;
  attributionConfidence: AttributionConfidence;
  interactionEvidenceCount: number;
}): AttributionConfidence {
  if (!input.recommendedApi) {
    return 'low';
  }

  if (input.interactionEvidenceCount === 0 && input.attributionConfidence === 'high') {
    return 'medium';
  }

  return input.attributionConfidence;
}

export function resolveAnalysisCardSignals(input: ResolveAnalysisSignalsInput): AnalysisSignals {
  return {
    actionType: resolveActionType(input.elementText),
    tableHeaders: extractTableHeaders(input.pageTextSummary),
    confidence: resolveCardConfidence({
      recommendedApi: input.recommendedApi,
      attributionConfidence: input.attributionConfidence,
      interactionEvidenceCount: input.interactionEvidenceCount,
    }),
  };
}

export function buildAnalysisCard(input: BuildAnalysisCardInput): DomAnalysisCard {
  return {
    pageName: input.pageName,
    route: formatRoute(input.route),
    targetAction: formatTargetAction(input.elementText),
    actionType: input.actionType,
    tableHeaders: input.tableHeaders,
    recommendedApi: input.recommendedApi,
    confidence: input.confidence,
  };
}
