import type { PickedElementContext } from './page-picker';

export type WorkspacePageCaptureMode = 'page' | 'element';

export type WorkspacePageCaptureInput = {
  mode: WorkspacePageCaptureMode;
  projectPath?: string;
  target?: PickedElementContext;
};

export type WorkspacePageCaptureResult = {
  entryPath: string;
  assetCount?: number;
  warningCount?: number;
};

export function normalizeProjectPath(projectPath: string | undefined): string {
  return (projectPath || '').trim();
}

export function assertWorkspacePageCaptureInput(input: WorkspacePageCaptureInput): {
  mode: WorkspacePageCaptureMode;
  projectPath: string;
  target?: PickedElementContext;
} {
  const projectPath = normalizeProjectPath(input.projectPath);
  if (!projectPath) {
    throw new Error('请先选择当前工作区后再采集网页');
  }

  if (input.mode === 'element' && !input.target) {
    throw new Error('请先选择页面元素后再采集到工作区');
  }

  return {
    mode: input.mode,
    projectPath,
    ...(input.target ? { target: input.target } : {}),
  };
}

export async function triggerWorkspacePageCapture(
  input: WorkspacePageCaptureInput,
  execute: (payload: {
    mode: WorkspacePageCaptureMode;
    projectPath: string;
    target?: PickedElementContext;
  }) => Promise<WorkspacePageCaptureResult>
): Promise<WorkspacePageCaptureResult> {
  return execute(assertWorkspacePageCaptureInput(input));
}
