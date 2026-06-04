import { useEffect, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import { Badge } from '@/entrypoints/sidepanel/components/ui/badge';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import type { DomAnalysisCard } from '@/entrypoints/sidepanel/lib/dom-analysis/types';

const CONFIDENCE_LABELS: Record<DomAnalysisCard['confidence'], string> = {
  low: '低置信度',
  medium: '中置信度',
  high: '高置信度',
};

export function DomAnalysisSuggestionCard({
  card,
  suggestedCommand,
  onInsertCommand,
  onClose,
}: {
  card: DomAnalysisCard;
  suggestedCommand: string | null;
  onInsertCommand: () => void;
  onClose: () => void;
}) {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [showBottomFade, setShowBottomFade] = useState(false);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) {
      return;
    }

    const updateFadeVisibility = () => {
      const remainingScroll =
        scrollArea.scrollHeight - scrollArea.clientHeight - scrollArea.scrollTop;
      setShowBottomFade(remainingScroll > 6);
    };

    updateFadeVisibility();
    scrollArea.addEventListener('scroll', updateFadeVisibility, { passive: true });
    window.addEventListener('resize', updateFadeVisibility);

    return () => {
      scrollArea.removeEventListener('scroll', updateFadeVisibility);
      window.removeEventListener('resize', updateFadeVisibility);
    };
  }, [card, suggestedCommand]);

  return (
    <div
      ref={scrollAreaRef}
      data-testid="dom-analysis-suggestion-card"
      className="relative flex max-h-full min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border bg-popover px-3 py-3 text-sm shadow-lg overscroll-contain"
    >
      <div
        data-testid="dom-analysis-suggestion-header"
        className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 bg-popover pb-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="text-sm font-semibold text-foreground">页面分析建议</div>
          <Badge variant="outline" className="shrink-0">
            {CONFIDENCE_LABELS[card.confidence]}
          </Badge>
        </div>
        <div
          data-testid="dom-analysis-suggestion-header-actions"
          className="flex shrink-0 items-center gap-2"
        >
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (suggestedCommand) {
                onInsertCommand();
              }
            }}
            disabled={!suggestedCommand}
          >
            插入命令
          </Button>
          <button
            type="button"
            className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="关闭页面分析建议"
            onClick={onClose}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-2 pr-1 text-xs leading-5">
        {card.pageName ? (
          <div>
            <span className="text-muted-foreground">页面：</span>
            <span>{card.pageName}</span>
          </div>
        ) : null}
        {card.route ? (
          <div>
            <span className="text-muted-foreground">位置：</span>
            <code className="rounded bg-muted px-1 py-0.5">{card.route}</code>
          </div>
        ) : null}
        {card.targetAction ? (
          <div>
            <span className="text-muted-foreground">目标操作：</span>
            <span>{card.targetAction}</span>
          </div>
        ) : null}
        {card.actionType ? (
          <div>
            <span className="text-muted-foreground">推断意图：</span>
            <span>{card.actionType}</span>
          </div>
        ) : null}
        {card.tableHeaders.length > 0 ? (
          <div>
            <span className="text-muted-foreground">业务对象：</span>
            <span>{card.tableHeaders.join('、')}</span>
          </div>
        ) : null}
        {card.recommendedApi ? (
          <div>
            <span className="text-muted-foreground">候选接口：</span>
            <code className="break-all rounded bg-muted px-1 py-0.5">{card.recommendedApi}</code>
          </div>
        ) : null}
      </div>

      {suggestedCommand ? (
        <div className="mt-3 rounded-md bg-muted/50 p-2">
          <div className="mb-1 text-[11px] text-muted-foreground">建议命令</div>
          <code className="block whitespace-pre-wrap break-all text-[11px] leading-5">
            {suggestedCommand}
          </code>
        </div>
      ) : null}

      {showBottomFade ? (
        <div
          data-testid="dom-analysis-suggestion-bottom-fade"
          className="pointer-events-none sticky bottom-0 mt-auto h-10 shrink-0 bg-gradient-to-t from-popover via-popover/90 to-transparent"
        />
      ) : null}
    </div>
  );
}
