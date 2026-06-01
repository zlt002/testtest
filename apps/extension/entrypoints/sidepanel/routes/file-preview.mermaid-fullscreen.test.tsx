// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg viewBox="0 0 800 400"><rect width="800" height="400"></rect></svg>',
    })),
  },
}));

import { MermaidBlock } from './file-preview';

describe('MermaidBlock fullscreen', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      })
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('opens a fullscreen dialog for the mermaid chart', async () => {
    render(<MermaidBlock chart={'graph TD\nA-->B'} />);

    fireEvent.click(await screen.findByRole('button', { name: '全屏' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('流程图全屏查看')).toBeTruthy();
  });
});
