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
}: {
  card: DomAnalysisCard;
  suggestedCommand: string | null;
  onInsertCommand: (command: string) => void;
}) {
  return (
    <div
      data-testid="dom-analysis-suggestion-card"
      className="mx-3 mt-2 rounded-lg border bg-card/90 px-3 py-3 text-sm shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">页面分析建议</div>
          <div className="mt-1 text-xs text-muted-foreground">
            围绕 `/ewankb-server-query` 生成了更适合查询知识库的证据摘要。
          </div>
        </div>
        <Badge variant="outline" className="shrink-0">
          {CONFIDENCE_LABELS[card.confidence]}
        </Badge>
      </div>

      <div className="mt-3 space-y-2 text-xs leading-5">
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

      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            if (suggestedCommand) {
              onInsertCommand(suggestedCommand);
            }
          }}
          disabled={!suggestedCommand}
        >
          插入命令
        </Button>
      </div>
    </div>
  );
}
