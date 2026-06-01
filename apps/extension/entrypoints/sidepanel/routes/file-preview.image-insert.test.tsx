// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownImageInsertOverlay } from './file-preview';

describe('MarkdownImageInsertOverlay', () => {
  it('asks for alt text with 图片 as the default', () => {
    render(
      <MarkdownImageInsertOverlay
        draft={{
          file: new File(['image'], 'image.png', { type: 'image/png' }),
          offset: 3,
          alt: '图片',
        }}
        saving={false}
        onAltChange={() => undefined}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );

    expect((screen.getByLabelText('图片说明') as HTMLInputElement).value).toBe('图片');
  });

  it('confirms with the edited alt text', () => {
    const onAltChange = vi.fn();
    const onConfirm = vi.fn();
    render(
      <MarkdownImageInsertOverlay
        draft={{
          file: new File(['image'], 'image.png', { type: 'image/png' }),
          offset: 3,
          alt: '图片',
        }}
        saving={false}
        onAltChange={onAltChange}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />
    );

    fireEvent.change(screen.getByLabelText('图片说明'), { target: { value: '流程图' } });
    fireEvent.click(screen.getByRole('button', { name: '插入' }));

    expect(onAltChange).toHaveBeenCalledWith('流程图');
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancels the overlay without confirming', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <MarkdownImageInsertOverlay
        draft={{
          file: new File(['image'], 'image.png', { type: 'image/png' }),
          offset: 3,
          alt: '图片',
        }}
        saving={false}
        onAltChange={() => undefined}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
