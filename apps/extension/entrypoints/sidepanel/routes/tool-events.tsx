import { createFileRoute } from '@tanstack/react-router';
import { RefreshCwIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { UnifiedEmptyState } from '@/entrypoints/sidepanel/components/UnifiedEmptyState';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import { readToolEvents } from '../lib/agent-v2/storage';
import type { ToolDisplayRecord } from '../lib/agent-v2/types';

function readConversationId() {
  return new URL(window.location.href).searchParams.get('conversationId') || '';
}

function formatTime(value: number | string | null | undefined) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function stringifyValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolRecordCard({ tool }: { tool: ToolDisplayRecord }) {
  const resultText = stringifyValue(tool.result);
  const inputText = stringifyValue(tool.input);

  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{tool.toolName || 'tool'}</h2>
          <div className="mt-1 truncate text-xs text-muted-foreground">{tool.preview}</div>
        </div>
        <span className="shrink-0 rounded-md border px-2 py-1 text-[11px] text-muted-foreground">
          {tool.status}
        </span>
      </div>

      <div className="mt-3 grid gap-3">
        {inputText ? (
          <section>
            <div className="mb-1 text-xs font-medium text-muted-foreground">输入</div>
            <pre className="max-h-[280px] overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-5">
              {inputText}
            </pre>
          </section>
        ) : null}

        {resultText ? (
          <section>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {tool.isError ? '错误' : '结果'}
            </div>
            <pre
              className={`max-h-[360px] overflow-auto rounded-md p-3 text-xs leading-5 ${
                tool.isError ? 'bg-destructive/10 text-destructive' : 'bg-muted/40'
              }`}
            >
              {resultText}
            </pre>
          </section>
        ) : null}

        <div className="text-[11px] text-muted-foreground">
          {tool.startedAt ? `开始 ${formatTime(tool.startedAt)}` : ''}
          {tool.completedAt ? ` · 完成 ${formatTime(tool.completedAt)}` : ''}
        </div>
      </div>
    </div>
  );
}

function ToolEventsPage() {
  const conversationId = readConversationId();
  const [payload, setPayload] = useState(() => readToolEvents(conversationId));

  const refresh = useCallback(() => {
    setPayload(readToolEvents(conversationId));
  }, [conversationId]);

  useEffect(() => {
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">工具调用详情</h1>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              会话 {conversationId ? conversationId.slice(0, 8) : '未知'}
              {payload?.updatedAt ? ` · 更新于 ${formatTime(payload.updatedAt)}` : ''}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCwIcon className="h-4 w-4" />
            <span>刷新</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!payload || payload.tools.length === 0 ? (
          <UnifiedEmptyState
            title="还没有工具调用记录"
            description="等当前会话开始调用工具后，这里会持续记录每次调用详情。"
            className="rounded-lg border border-dashed bg-muted/20"
            minHeightClassName="min-h-[280px]"
          />
        ) : (
          <div className="space-y-3">
            {payload.tools.map((tool) => (
              <ToolRecordCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/tool-events')({
  component: ToolEventsPage,
});
