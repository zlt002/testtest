import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DisplayMessage } from '@/entrypoints/sidepanel/lib/agent-v2/types';
import { summarizePromptForDisplay } from '../../../../../../shared/utils/src/prompt-metadata.ts';

const COLLAPSED_LINE_COUNT = 8;
const COLLAPSED_LINE_HEIGHT_REM = 1.5;
const COLLAPSED_MAX_HEIGHT_REM = COLLAPSED_LINE_COUNT * COLLAPSED_LINE_HEIGHT_REM;

const GENERATED_INPUT_CONTEXT_LABELS: Record<string, string> = {
  attachments: '附件元数据',
  browser_context: '浏览器上下文',
  language_instruction: '语言指令',
  interaction_policy: '交互策略',
  project_workspace: '项目工作区指令',
  webmcp_explicit_skill: '显式技能',
  webmcp_browser_tool_instruction: '浏览器工具指令',
};

type GeneratedInputContextBlock = {
  tag: string;
  label: string;
  content: string;
};

function splitGeneratedInputContext(text: string): {
  visibleText: string;
  contextBlocks: GeneratedInputContextBlock[];
} {
  const contextBlocks: GeneratedInputContextBlock[] = [];
  const visibleText = text
    .replace(
      /<webmcp_explicit_skill\b(?<attrs>[^>]*)>\s*[\s\S]*?<\/webmcp_explicit_skill>\s*/gi,
      (
        content: string,
        _attrs: string,
        _offset: number,
        _input: string,
        groups?: { attrs?: string }
      ) => {
        const commandName =
          groups?.attrs?.match(/\bname=(["'])(.*?)\1/i)?.[2]?.trim() || '（未命名技能）';
        contextBlocks.push({
          tag: 'webmcp_explicit_skill',
          label: GENERATED_INPUT_CONTEXT_LABELS.webmcp_explicit_skill,
          content: commandName,
        });
        return '\n';
      }
    )
    .replace(
      /<(?<tag>attachments|browser_context|language_instruction|interaction_policy|project_workspace|webmcp_browser_tool_instruction)>\s*[\s\S]*?<\/\k<tag>>\s*/gi,
      (
        content: string,
        _tag: string,
        _offset: number,
        _input: string,
        groups?: { tag?: string }
      ) => {
        const tag = groups?.tag?.toLowerCase() || 'context';
        contextBlocks.push({
          tag,
          label: GENERATED_INPUT_CONTEXT_LABELS[tag] || tag,
          content: content.trim(),
        });
        return '\n';
      }
    )
    .replace(/^\s*<\/?(用户原始请求|user_original_request)>\s*\n?/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { visibleText, contextBlocks };
}

export function UserBubble({ message }: { message: DisplayMessage }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [canCollapse, setCanCollapse] = useState(false);
  const images = message.images || [];
  const { visibleText, contextBlocks } = useMemo(
    () => splitGeneratedInputContext(message.text || ''),
    [message.text]
  );
  const summarizedMessageText = useMemo(
    () => summarizePromptForDisplay(message.text || ''),
    [message.text]
  );
  const displayText =
    visibleText ||
    summarizedMessageText ||
    (contextBlocks.length ? '（输入内容仅包含自动上下文）' : message.text);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const collapsedMaxHeightPx =
      COLLAPSED_MAX_HEIGHT_REM * (Number.isNaN(rootFontSize) ? 16 : rootFontSize);
    const update = () => {
      setCanCollapse(content.scrollHeight > collapsedMaxHeightPx + 4);
    };

    update();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex justify-end">
      <div className="min-w-0 max-w-[92%] break-words rounded-lg bg-primary px-3 py-2 text-sm leading-6 text-primary-foreground [overflow-wrap:anywhere]">
        {images.length ? (
          <div className="mb-2 flex max-w-full flex-wrap justify-end gap-2">
            {images.map((image, index) => (
              <div
                key={image.id}
                className="overflow-hidden rounded-md border border-primary-foreground/20 bg-primary-foreground/10"
              >
                <img
                  src={image.previewUrl || `data:${image.mimeType};base64,${image.data || ''}`}
                  alt={`附件 #${index + 1}`}
                  className="h-20 w-20 object-cover"
                />
              </div>
            ))}
          </div>
        ) : null}
        {contextBlocks.length ? (
          <div className="mb-2 overflow-hidden rounded-md border border-primary-foreground/20 bg-primary-foreground/10 text-xs">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-primary-foreground/90 hover:bg-primary-foreground/10"
              aria-expanded={contextExpanded}
              aria-label={contextExpanded ? '收起输入上下文' : '展开输入上下文'}
              onClick={() => setContextExpanded((value) => !value)}
            >
              <span className="min-w-0 truncate">输入上下文</span>
              {contextExpanded ? (
                <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
            </button>
            {contextExpanded ? (
              <div className="border-t border-primary-foreground/15 px-2.5 py-2">
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-black/20 px-2 py-2 font-mono text-[11px] leading-5 text-primary-foreground/85 [overflow-wrap:anywhere]">
                  {contextBlocks.map((block) => `${block.label}\n${block.content}`).join('\n\n')}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="relative min-w-0">
          <div
            ref={contentRef}
            className={`whitespace-pre-wrap ${canCollapse && !expanded ? 'overflow-hidden' : ''}`}
            style={
              canCollapse && !expanded ? { maxHeight: `${COLLAPSED_MAX_HEIGHT_REM}rem` } : undefined
            }
          >
            {displayText}
            {images.length ? (
              <span className="block text-xs text-primary-foreground/75">
                {images.map((_image, index) => `[image #${index + 1}]`).join(' ')}
              </span>
            ) : null}
          </div>
          {canCollapse ? (
            <div
              className={
                expanded
                  ? 'mt-1 flex justify-center'
                  : 'pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-primary via-primary/90 to-transparent pt-10'
              }
            >
              <button
                type="button"
                className="pointer-events-auto rounded-full border border-primary-foreground/20 bg-primary-foreground/15 px-2.5 py-0.5 text-xs text-primary-foreground/85 shadow-sm hover:bg-primary-foreground/25 hover:text-primary-foreground"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? '收起' : '展开'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
