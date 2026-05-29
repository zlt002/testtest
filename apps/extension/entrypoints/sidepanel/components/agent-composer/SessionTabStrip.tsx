import { GlobeIcon } from 'lucide-react';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import { Checkbox } from '@/entrypoints/sidepanel/components/ui/checkbox';
import type { SessionTabSummary } from '@/entrypoints/sidepanel/lib/session-tab-selection';
import { cn } from '@/entrypoints/sidepanel/lib/utils';

type SessionTabStripProps = {
  tabs: SessionTabSummary[];
  selectedTabIds: number[];
  onToggleTab: (tabId: number) => void;
  onClearSelection?: () => void;
  menuAnchorRef?: RefObject<HTMLElement | null>;
  disabled?: boolean;
};

function getTabDisplayName(tab: SessionTabSummary) {
  return tab.title?.trim() || tab.url?.trim() || `Tab ${tab.tabId}`;
}

function getTabFallbackCharacter(tab: SessionTabSummary) {
  const displayName = getTabDisplayName(tab);
  const match = displayName.match(/[A-Za-z0-9\u4e00-\u9fff]/u);
  return (match?.[0] || '?').toUpperCase();
}

function getTabIconCandidates(tab: SessionTabSummary): string[] {
  const candidates: string[] = [];

  if (tab.favIconUrl?.trim()) {
    candidates.push(tab.favIconUrl.trim());
  }

  if (tab.url?.trim()) {
    try {
      const parsedUrl = new URL(tab.url);
      if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
        candidates.push(new URL('/favicon.ico', parsedUrl.origin).toString());
      }
    } catch {
      // Ignore malformed URLs and fall through to text/icon fallback.
    }
  }

  return [...new Set(candidates)];
}

type TabIconProps = {
  tab: SessionTabSummary;
  className?: string;
};

function TabIcon({ tab, className }: TabIconProps) {
  const iconCandidates = useMemo(() => getTabIconCandidates(tab), [tab]);
  const [candidateIndex, setCandidateIndex] = useState(0);

  const currentIconSrc = iconCandidates[candidateIndex];
  if (currentIconSrc) {
    return (
      <img
        src={currentIconSrc}
        alt=""
        className={className}
        onError={() => {
          setCandidateIndex((current) =>
            current + 1 < iconCandidates.length ? current + 1 : iconCandidates.length
          );
        }}
      />
    );
  }

  if (tab.title || tab.url) {
    return <span aria-hidden="true">{getTabFallbackCharacter(tab)}</span>;
  }

  return <GlobeIcon className={cn('h-3.5 w-3.5', className)} aria-hidden="true" />;
}

export function SessionTabStrip({
  tabs,
  selectedTabIds,
  onToggleTab,
  onClearSelection,
  menuAnchorRef,
  disabled = false,
}: SessionTabStripProps) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{
    bottom: number;
    left: number;
    width: number;
  } | null>(null);
  const selectedIdSet = useMemo(() => new Set(selectedTabIds), [selectedTabIds]);
  const triggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedTabs = useMemo(
    () => tabs.filter((tab) => selectedIdSet.has(tab.tabId)),
    [selectedIdSet, tabs]
  );
  const triggerTab = selectedTabs[0] ?? tabs[0];
  const selectedCount = selectedTabs.length;

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open || !menuAnchorRef?.current) {
      return;
    }

    const updateMenuStyle = () => {
      const rect = menuAnchorRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setMenuStyle({
        left: rect.left,
        width: rect.width,
        bottom: window.innerHeight - rect.top + 8,
      });
    };

    updateMenuStyle();
    window.addEventListener('resize', updateMenuStyle);
    window.addEventListener('scroll', updateMenuStyle, true);

    return () => {
      window.removeEventListener('resize', updateMenuStyle);
      window.removeEventListener('scroll', updateMenuStyle, true);
    };
  }, [menuAnchorRef, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (triggerButtonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  if (tabs.length === 0) {
    return null;
  }

  const menuContent = (
    <div
      ref={menuRef}
      role="menu"
      className="flex max-h-[min(26rem,calc(100vh-12rem))] flex-col overflow-hidden rounded-lg border bg-popover p-2 shadow-lg"
    >
      <div className="flex items-center justify-between px-2 pb-1">
        <div className="text-[11px] font-medium text-muted-foreground">当前窗口标签页</div>
        <button
          type="button"
          className="text-[11px] font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-default disabled:opacity-40"
          onClick={() => onClearSelection?.()}
          disabled={disabled || selectedTabIds.length === 0}
        >
          取消选中
        </button>
      </div>
      <div className="min-h-0 space-y-1 overflow-y-auto pr-1">
        {tabs.map((tab) => {
          const checked = selectedIdSet.has(tab.tabId);
          const displayName = getTabDisplayName(tab);
          const description = tab.url?.trim();
          const checkboxId = `session-tab-${tab.tabId}`;

          return (
            <label
              key={tab.tabId}
              htmlFor={checkboxId}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm transition hover:bg-muted/60',
                checked && 'bg-primary/5'
              )}
            >
              <Checkbox
                id={checkboxId}
                checked={checked}
                aria-label={displayName}
                disabled={disabled}
                onCheckedChange={() => onToggleTab(tab.tabId)}
                className="mt-0.5"
              />
              <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border/60 bg-background text-[10px] font-medium">
                <TabIcon tab={tab} className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{displayName}</div>
                {description ? (
                  <div className="truncate text-xs text-muted-foreground">{description}</div>
                ) : null}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="relative">
      <div data-testid="session-tab-strip-trigger" className="flex items-center">
        <Button
          ref={triggerButtonRef}
          type="button"
          variant="outline"
          size="icon"
          aria-label={
            triggerTab
              ? `已选标签页 ${getTabDisplayName(triggerTab)}，共 ${selectedCount} 个`
              : `当前窗口标签页，共 ${tabs.length} 个`
          }
          className={cn(
            'relative h-6.5 w-6.5 rounded-full text-xs font-semibold',
            selectedCount > 0
              ? 'border-primary/60 bg-primary/5 text-primary hover:bg-primary/10'
              : 'border-border/70 text-muted-foreground hover:bg-muted/60'
          )}
          title={
            triggerTab
              ? `${getTabDisplayName(triggerTab)}${selectedCount > 1 ? ` 等 ${selectedCount} 个已选标签页` : ''}`
              : `当前窗口标签页（${tabs.length}）`
          }
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <span aria-hidden="true">{triggerTab ? getTabFallbackCharacter(triggerTab) : '?'}</span>
          <span
            className={cn(
              'absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none shadow-sm',
              selectedCount > 0
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {selectedCount}
          </span>
        </Button>
      </div>

      {open && menuAnchorRef?.current && menuStyle
        ? createPortal(
            <div
              className="fixed z-30"
              style={{
                left: menuStyle.left,
                width: menuStyle.width,
                bottom: menuStyle.bottom,
              }}
            >
              {menuContent}
            </div>,
            document.body
          )
        : null}
      {open && !menuAnchorRef?.current ? (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-72">{menuContent}</div>
      ) : null}
    </div>
  );
}
