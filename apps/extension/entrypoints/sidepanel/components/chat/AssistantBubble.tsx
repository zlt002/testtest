import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';

const COLLAPSED_MAX_HEIGHT_PX = 420;

export function AssistantBubble({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [canCollapse, setCanCollapse] = useState(false);
  const [collapsedOffset, setCollapsedOffset] = useState(0);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    const update = () => {
      const nextCanCollapse = content.scrollHeight > COLLAPSED_MAX_HEIGHT_PX + 12;
      setCanCollapse(nextCanCollapse);
      setCollapsedOffset(
        nextCanCollapse ? Math.max(content.scrollHeight - COLLAPSED_MAX_HEIGHT_PX, 0) : 0
      );
    };

    update();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const isCollapsed = canCollapse && !expanded;

  return (
    <div className="relative min-w-0">
      <div
        data-testid="assistant-bubble-viewport"
        className={isCollapsed ? 'min-w-0 overflow-hidden' : 'min-w-0'}
        style={isCollapsed ? { maxHeight: COLLAPSED_MAX_HEIGHT_PX } : undefined}
      >
        <div
          ref={contentRef}
          className="min-w-0 break-words [overflow-wrap:anywhere]"
          style={
            isCollapsed && collapsedOffset > 0
              ? { transform: `translateY(-${collapsedOffset}px)` }
              : undefined
          }
        >
          {children}
        </div>
      </div>
      {canCollapse ? (
        <div
          className={
            expanded
              ? 'mt-2 flex justify-center'
              : 'pointer-events-none absolute inset-x-0 top-0 flex justify-center bg-gradient-to-b from-card via-card/90 to-transparent pb-12 pt-1'
          }
        >
          <button
            type="button"
            className="pointer-events-auto rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm hover:text-foreground"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起' : '展开'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
