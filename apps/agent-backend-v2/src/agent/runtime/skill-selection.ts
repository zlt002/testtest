import { fileURLToPath } from 'node:url';

const WEBEDIT_HOSTS = new Set(['doc.midea.com', 'webedit.midea.com', 'mapnew5.midea.com']);
const MANAGED_SYSTEM_HOSTS = new Set(['an-uat.annto.com']);

const WEBEDIT_SHEET_KEYWORDS = [
  '表格',
  '表头',
  '单元格',
  '工作表',
  '公式',
  '美化',
  '格式化',
  '样式',
  '边框',
  '对齐',
  '选区',
  '框选',
  '列宽',
  '行高',
  '合并',
  '插行',
  '排序',
  '查找',
  '清空',
  '示例表',
  '任务表',
  '销售表',
  '库存表',
  'spreadsheet',
  'sheet',
  'cell',
  'table',
  'header',
  'formula',
  'style',
  'format',
  'border',
  'align',
  'sort',
  'find',
  'selection',
  'range',
];

const WEBEDIT_WORD_KEYWORDS = [
  '文档',
  '正文',
  '段落',
  '标题',
  '摘要',
  '润色',
  '改写',
  '续写',
  '插入',
  '替换',
  '批注',
  '选中文本',
  '光标',
  '阅读',
  '总结',
  '提炼',
  '翻译',
  '改错',
  'document',
  'word',
  'paragraph',
  'heading',
  'cursor',
  'selection text',
  'rewrite',
  'summarize',
  'translate',
];

const PAGE_ANCHOR_KEYWORDS = ['当前页面', '这个页面', '此页面'];
const CODE_ANALYSIS_KEYWORDS = ['逻辑', '接口', '链路', '源码', '代码', '仓库', '改哪里', '怎么改'];
const BUTTON_TECH_INTENT_KEYWORDS = ['接口', '逻辑', '代码', '改哪里'];
const API_TECH_INTENT_KEYWORDS = ['在哪', '链路', '代码', '后端'];

const BUILTIN_PLUGIN_PATH = fileURLToPath(
  new URL('../../../builtin-plugins/webedit-assistant', import.meta.url)
);

const WEBEDIT_PLUGIN = {
  type: 'local' as const,
  path: BUILTIN_PLUGIN_PATH,
};

const WEBEDIT_SYSTEM_PROMPT_APPEND =
  '当前是 WebEdit 扩展内置办公会话。优先使用 webedit-assistant skills 和 webedit_* website tools，遵循先读取上下文、再执行写入、最后回读验证的流程；当工具缺失、选区不稳定或运行时异常时，明确进入诊断或只读模式，不要伪造成功。';

const WEBEDIT_OFFICE_SKILL = 'webedit-assistant:webedit-office';
const WEBEDIT_WORD_SKILL = 'webedit-assistant:webedit-word';
const WEBEDIT_SHEET_SKILL = 'webedit-assistant:webedit-sheet';
const PAGE_CODEBASE_SKILL = '/ewankb-server-query';

export type BrowserContextLike = {
  url?: unknown;
};

export type WebEditSessionSkillPlan = {
  enabled: boolean;
  mode?: 'office' | 'word' | 'sheet';
  skills?: string[];
  plugins?: Array<{ type: 'local'; path: string }>;
  systemPrompt?: {
    type: 'preset';
    preset: 'claude_code';
    append: string;
  };
};

function extractHostname(url: unknown) {
  if (typeof url !== 'string' || !url) {
    return null;
  }

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function includesKeyword(prompt: string, keywords: string[]) {
  const normalized = prompt.trim().toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

export function isWebEditSkillContext(browserContext?: BrowserContextLike) {
  const hostname = extractHostname(browserContext?.url);
  return !!hostname && WEBEDIT_HOSTS.has(hostname);
}

export function isManagedSystemContext(browserContext?: BrowserContextLike) {
  const hostname = extractHostname(browserContext?.url);
  return !!hostname && MANAGED_SYSTEM_HOSTS.has(hostname);
}

export function isWebEditSheetIntent(prompt: string) {
  return includesKeyword(prompt, WEBEDIT_SHEET_KEYWORDS);
}

export function isWebEditWordIntent(prompt: string) {
  return includesKeyword(prompt, WEBEDIT_WORD_KEYWORDS);
}

export function isWebEditSkillIntent(prompt: string) {
  return isWebEditSheetIntent(prompt) || isWebEditWordIntent(prompt);
}

export function isCurrentPageCodebaseIntent(prompt: string) {
  const normalized = prompt.trim().toLowerCase();
  const hasPageAnchor = PAGE_ANCHOR_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );
  const hasCodeAnalysisAnchor = CODE_ANALYSIS_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );
  if (hasPageAnchor && hasCodeAnalysisAnchor) {
    return true;
  }

  const hasButtonAnchor = normalized.includes('这个按钮');
  const hasButtonTechIntent = BUTTON_TECH_INTENT_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );
  if (hasButtonAnchor && hasButtonTechIntent) {
    return true;
  }

  const hasApiAnchor = normalized.includes('这个接口');
  const hasApiTechIntent = API_TECH_INTENT_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );
  if (hasApiAnchor && hasApiTechIntent) {
    return true;
  }

  return false;
}

export function selectSessionSkillPlan(input: {
  prompt: string;
  browserContext?: BrowserContextLike;
}): WebEditSessionSkillPlan | undefined {
  if (isWebEditSkillContext(input.browserContext)) {
    const sheetIntent = isWebEditSheetIntent(input.prompt);
    const wordIntent = isWebEditWordIntent(input.prompt);

    const skills = [WEBEDIT_OFFICE_SKILL];
    let mode: WebEditSessionSkillPlan['mode'] = 'office';

    if (sheetIntent && !wordIntent) {
      mode = 'sheet';
      skills.push(WEBEDIT_SHEET_SKILL);
    } else if (wordIntent && !sheetIntent) {
      mode = 'word';
      skills.push(WEBEDIT_WORD_SKILL);
    } else if (sheetIntent && wordIntent) {
      mode = 'office';
      skills.push(WEBEDIT_WORD_SKILL, WEBEDIT_SHEET_SKILL);
    }

    return {
      enabled: true,
      mode,
      skills,
      plugins: [WEBEDIT_PLUGIN],
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: WEBEDIT_SYSTEM_PROMPT_APPEND,
      },
    };
  }

  if (isManagedSystemContext(input.browserContext) && isCurrentPageCodebaseIntent(input.prompt)) {
    return {
      enabled: true,
      skills: [PAGE_CODEBASE_SKILL],
    };
  }

  return undefined;
}

export function selectSessionSkills(input: {
  prompt: string;
  browserContext?: BrowserContextLike;
}): string[] | undefined {
  return selectSessionSkillPlan(input)?.skills;
}
