import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SessionTabStrip } from './SessionTabStrip';

describe('SessionTabStrip', () => {
  it('shows a single trigger using the first selected tab initial and selected count', () => {
    render(
      <SessionTabStrip
        tabs={[
          { tabId: 11, title: 'Baidu', url: 'https://www.baidu.com', active: true },
          { tabId: 12, title: 'GitHub', url: 'https://github.com', active: false },
        ]}
        selectedTabIds={[11]}
        onToggleTab={vi.fn()}
      />
    );

    expect(screen.getByLabelText('已选标签页 Baidu，共 1 个')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('uses the first selected tab for the trigger and shows total selected count in the badge', () => {
    render(
      <SessionTabStrip
        tabs={[
          { tabId: 11, title: 'A', url: 'https://a.example.com', active: true },
          { tabId: 12, title: 'B', url: 'https://b.example.com', active: false },
          { tabId: 13, title: 'C', url: 'https://c.example.com', active: false },
          { tabId: 14, title: 'D', url: 'https://d.example.com', active: false },
          { tabId: 15, title: 'E', url: 'https://e.example.com', active: false },
          { tabId: 16, title: 'F', url: 'https://f.example.com', active: false },
        ]}
        selectedTabIds={[11, 12]}
        onToggleTab={vi.fn()}
      />
    );

    expect(screen.getByLabelText('已选标签页 A，共 2 个')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('+1')).toBeNull();
  });

  it('shows the tab list only after clicking the trigger', async () => {
    const anchorRef = createRef<HTMLDivElement>();
    render(
      <div>
        <div ref={anchorRef} />
        <SessionTabStrip
          tabs={[{ tabId: 11, title: 'Baidu', url: 'https://www.baidu.com', active: true }]}
          selectedTabIds={[11]}
          onToggleTab={vi.fn()}
          menuAnchorRef={anchorRef}
        />
      </div>
    );

    vi.spyOn(anchorRef.current as HTMLDivElement, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 200,
      top: 200,
      left: 20,
      bottom: 260,
      right: 320,
      width: 300,
      height: 60,
      toJSON: () => ({}),
    });

    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByLabelText('已选标签页 Baidu，共 1 个'));

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Baidu' }).getAttribute('data-state')).toBe(
      'checked'
    );
  });

  it('toggles a tab from the hover list', async () => {
    const onToggleTab = vi.fn();
    render(
      <SessionTabStrip
        tabs={[{ tabId: 12, title: 'GitHub', url: 'https://github.com', active: false }]}
        selectedTabIds={[]}
        onToggleTab={onToggleTab}
      />
    );

    fireEvent.click(screen.getByLabelText('已选标签页 GitHub，共 0 个'));
    fireEvent.click(await screen.findByText('GitHub'));

    expect(onToggleTab).toHaveBeenCalledWith(12);
  });

  it('keeps the tab list open after toggling inside and closes only on outside click', async () => {
    const onToggleTab = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <SessionTabStrip
          tabs={[{ tabId: 12, title: 'GitHub', url: 'https://github.com', active: false }]}
          selectedTabIds={[]}
          onToggleTab={onToggleTab}
        />
      </div>
    );

    fireEvent.click(screen.getByLabelText('已选标签页 GitHub，共 0 个'));
    expect(await screen.findByRole('menu')).toBeTruthy();

    fireEvent.click(screen.getByText('GitHub'));
    expect(onToggleTab).toHaveBeenCalledWith(12);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('falls back to a visible tab icon when favicon loading fails', async () => {
    render(
      <SessionTabStrip
        tabs={[
          {
            tabId: 11,
            title: 'Baidu',
            url: 'https://www.baidu.com/search',
            favIconUrl: 'https://www.baidu.com/favicon.ico',
            active: true,
          },
        ]}
        selectedTabIds={[11]}
        onToggleTab={vi.fn()}
      />
    );

    const triggerButton = screen.getByTitle('Baidu');
    const triggerImage = triggerButton.querySelector('img');
    expect(triggerImage).toBeNull();
    expect(screen.getByText('B')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('已选标签页 Baidu，共 1 个'));
    const menu = await screen.findByRole('menu');
    expect(menu).toBeTruthy();
    const menuImage = menu.querySelector('img');
    expect(menuImage).toBeTruthy();
    fireEvent.error(menuImage as HTMLImageElement);
    expect(screen.getAllByText('B').length).toBeGreaterThanOrEqual(2);
  });

  it('clears all selected tabs from the hover list header action', async () => {
    const onClearSelection = vi.fn();
    render(
      <SessionTabStrip
        tabs={[{ tabId: 11, title: 'Baidu', url: 'https://www.baidu.com', active: true }]}
        selectedTabIds={[11]}
        onToggleTab={vi.fn()}
        onClearSelection={onClearSelection}
      />
    );

    fireEvent.click(screen.getByLabelText('已选标签页 Baidu，共 1 个'));
    fireEvent.click(await screen.findByText('取消选中'));

    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('disables the trigger when disabled is true', () => {
    render(
      <SessionTabStrip
        tabs={[{ tabId: 11, title: 'Baidu', url: 'https://www.baidu.com', active: true }]}
        selectedTabIds={[11]}
        onToggleTab={vi.fn()}
        disabled={true}
      />
    );

    expect((screen.getByLabelText('已选标签页 Baidu，共 1 个') as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
