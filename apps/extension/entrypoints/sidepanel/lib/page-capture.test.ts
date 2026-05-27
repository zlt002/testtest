import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertWorkspacePageCaptureInput, triggerWorkspacePageCapture } from './page-capture';
import type { PickedElementContext } from './page-picker';

const execute = vi.fn();
const pickedElement: PickedElementContext = {
  url: 'https://example.com',
  selector: '#hero',
  xpath: '//*[@id="hero"]',
  tagName: 'section',
  id: 'hero',
  classList: ['hero'],
  dataAttributes: { role: 'banner' },
  text: 'Hero',
  rect: { x: 10, y: 20, width: 300, height: 40 },
  outerHTMLSnippet: '<section id="hero">Hero</section>',
  ancestors: [],
  siblings: { previous: null, next: null },
};

describe('triggerWorkspacePageCapture', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it('calls the background page capture mutation with mode after workspace validation', async () => {
    execute.mockResolvedValueOnce({
      entryPath: 'captures/2026-05-12-example',
    });

    await expect(
      triggerWorkspacePageCapture(
        {
          mode: 'page',
          projectPath: '/tmp/project',
        },
        execute
      )
    ).resolves.toEqual({
      entryPath: 'captures/2026-05-12-example',
    });

    expect(execute).toHaveBeenCalledWith({
      mode: 'page',
      projectPath: '/tmp/project',
    });
  });

  it('rejects when no workspace is selected', async () => {
    await expect(
      triggerWorkspacePageCapture(
        {
          mode: 'element',
          projectPath: '',
        },
        execute
      )
    ).rejects.toThrow('请先选择当前工作区后再采集网页');

    expect(execute).not.toHaveBeenCalled();
  });

  it('normalizes workspace input before executing capture', () => {
    expect(
      assertWorkspacePageCaptureInput({
        mode: 'element',
        projectPath: '  /tmp/project  ',
        target: pickedElement,
      })
    ).toEqual({
      mode: 'element',
      projectPath: '/tmp/project',
      target: pickedElement,
    });
  });

  it('passes the picked element target for element capture', async () => {
    execute.mockResolvedValueOnce({
      entryPath: 'captures/2026-05-12-example',
    });

    await triggerWorkspacePageCapture(
      {
        mode: 'element',
        projectPath: '/tmp/project',
        target: pickedElement,
      },
      execute
    );

    expect(execute).toHaveBeenCalledWith({
      mode: 'element',
      projectPath: '/tmp/project',
      target: pickedElement,
    });
  });

  it('rejects element capture without a picked target', async () => {
    await expect(
      triggerWorkspacePageCapture(
        {
          mode: 'element',
          projectPath: '/tmp/project',
        },
        execute
      )
    ).rejects.toThrow('请先选择页面元素后再采集到工作区');
  });
});
