import type { PickedElementContext } from '@/entrypoints/lib/page-picker';

import type { PageEditElementAnalysisMode } from './page-edit-element-analysis';

function summarizeTarget(target: PickedElementContext): string {
  const text = target.text?.trim();
  if (text) {
    return text;
  }

  const id = target.id?.trim();
  if (id) {
    return `<${target.tagName.toLowerCase()}#${id}>`;
  }

  const classSuffix = target.classList.length > 0 ? `.${target.classList.join('.')}` : '';
  return `<${target.tagName.toLowerCase()}${classSuffix}>`;
}

export function createPageEditElementAnalysisSummaryBuilder() {
  return {
    buildStartMessage(input: {
      analysisMode: PageEditElementAnalysisMode;
      target: PickedElementContext;
    }) {
      const lines = ['已开始页面元素分析。', `目标元素：${summarizeTarget(input.target)}`];

      if (input.analysisMode === 'interactive') {
        lines.push('请在页面上执行一次真实点击或交互，系统会自动抓取候选接口请求。');
      } else {
        lines.push('请刷新页面或触发一次重新加载，系统会自动抓取候选接口请求。');
      }

      return lines.join('\n');
    },
  };
}
