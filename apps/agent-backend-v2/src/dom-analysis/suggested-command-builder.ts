type BuildSuggestedCommandInput = {
  triggerSkill: string | null;
  ewankbMode: 'graph' | 'kb' | 'deep' | null;
  kbCandidate: string | null;
  featureName: string | null;
  actionTerms: string[];
  apiTerms: string[];
  fieldTerms: string[];
};

const GENERIC_API_TERMS = new Set(['api', 'api-miloms', 'guarantee']);
const PREFERRED_FIELD_KEYWORDS = ['简称', '目的地', '服务类型', '供应商', '客户', '单号', '编码', '状态'];

function dedupe(items: string[]): string[] {
  return items.filter((item, index) => item.length > 0 && items.indexOf(item) === index);
}

function resolveCommandPrefix(input: {
  triggerSkill: string | null;
  ewankbMode: 'graph' | 'kb' | 'deep' | null;
}): string | null {
  if (input.triggerSkill !== '/ewankb-server-query') {
    return null;
  }

  if (!input.ewankbMode) {
    return null;
  }

  return `${input.triggerSkill} ${input.ewankbMode}`;
}

function scoreFieldTerm(term: string): number {
  let score = 0;
  if (/简称|目的地|服务类型/.test(term)) score += 10;
  if (/供应商|客户|单号|编码|状态/.test(term)) score += 4;
  if (/名称|起始|地区/.test(term)) score -= 2;
  return score;
}

export function extractApiTerms(api: string | null): string[] {
  if (!api) {
    return [];
  }

  return dedupe(
    api
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.trim())
      .filter((segment) => /[A-Z]/.test(segment) || /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(segment))
  );
}

export function extractFieldTerms(tableHeaders: string[]): string[] {
  const prioritized = dedupe(tableHeaders).filter((term) =>
    PREFERRED_FIELD_KEYWORDS.some((keyword) => term.includes(keyword))
  );

  return [...prioritized]
    .sort((left, right) => scoreFieldTerm(right) - scoreFieldTerm(left))
    .slice(0, 3);
}

export function buildSuggestedCommand(input: BuildSuggestedCommandInput): string | null {
  const commandPrefix = resolveCommandPrefix({
    triggerSkill: input.triggerSkill,
    ewankbMode: input.ewankbMode,
  });

  if (!commandPrefix || !input.kbCandidate) {
    return null;
  }

  const apiTerms = dedupe(input.apiTerms).filter((term) => !GENERIC_API_TERMS.has(term));
  const queryTerms = dedupe([
    input.featureName ?? '',
    ...input.actionTerms,
    ...apiTerms,
    ...extractFieldTerms(input.fieldTerms),
  ]).slice(0, 8);

  if (queryTerms.length === 0) {
    return null;
  }

  return `${commandPrefix} ${input.kbCandidate} "${queryTerms.join(' ')}"`;
}
