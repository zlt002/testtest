import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';

const COLLAPSED_MAX_HEIGHT_PX = 420;

export function AssistantBubble({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [canCollapse, setCanCollapse] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    const update = () => {
      const nextCanCollapse = content.scrollHeight > COLLAPSED_MAX_HEIGHT_PX + 12;
      setCanCollapse(nextCanCollapse);
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
        >
          {children}
        </div>
      </div>
      {canCollapse ? (
        <div
          className={
            expanded
              ? 'mt-2 flex justify-center'
              : 'pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-card via-card/90 to-transparent pt-10'
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
