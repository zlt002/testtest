import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantBubble } from './AssistantBubble';

class ResizeObserverMock {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  disconnect() {}
}

describe('AssistantBubble', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  it('collapses long assistant responses and expands on demand', () => {
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(640);

    render(
      <AssistantBubble>
        <div>line 1</div>
        <div>line 2</div>
        <div>line 3</div>
      </AssistantBubble>
    );

    const viewport = screen.getByTestId('assistant-bubble-viewport');
    const content = viewport.firstElementChild as HTMLDivElement;

    expect(viewport.style.maxHeight).toBe('420px');
    expect(content.style.transform).toBe('');

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    expect(viewport.style.maxHeight).toBe('');
    expect(content.style.transform).toBe('');
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy();

    scrollHeightSpy.mockRestore();
  });

  it('does not show expand controls for short assistant responses', () => {
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(180);

    render(
      <AssistantBubble>
        <div>short message</div>
      </AssistantBubble>
    );

    expect(screen.queryByRole('button', { name: '展开' })).toBeNull();

    scrollHeightSpy.mockRestore();
  });
});
