import { summarizePromptForDisplay } from '../../../../../shared/utils/src/prompt-metadata.ts';

export type CurrentChatContext = {
  sessionTitle: string;
  workspaceName: string;
  workspacePath: string | null;
};

function normalizeLabel(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function deriveSessionTitleFromMessage(value?: string | null) {
  const normalized = normalizeLabel(value && summarizePromptForDisplay(value))?.replace(/\s+/g, ' ');
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function getWorkspaceName(projectPath?: string | null) {
  const normalizedPath = normalizeLabel(projectPath);
  if (!normalizedPath) {
    return {
      workspaceName: '请选择工作区',
      workspacePath: null,
    };
  }

  const normalizedSeparators = normalizedPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  const workspaceName = normalizedSeparators.at(-1) || normalizedPath;

  return {
    workspaceName,
    workspacePath: normalizedPath,
  };
}

export function deriveCurrentChatContext(input: {
  sessionTitle?: string | null;
  projectPath?: string | null;
}): CurrentChatContext {
  const sessionTitle = deriveSessionTitleFromMessage(input.sessionTitle) || '新会话';
  const workspace = getWorkspaceName(input.projectPath);

  return {
    sessionTitle,
    workspaceName: workspace.workspaceName,
    workspacePath: workspace.workspacePath,
  };
}
