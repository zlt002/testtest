import type { CaptureCoreWarning } from '../types';
import type { StyleSource } from './collect';

function wrapMedia(content: string, media?: string): string {
  if (!media) {
    return content;
  }

  return `@media ${media} {\n${content}\n}`;
}

export function mergeStyleSources(sources: StyleSource[], _warnings: CaptureCoreWarning[]): string {
  const chunks = sources
    .map((source) => {
      const content = source.content.trim();
      if (!content) {
        return '';
      }

      return [`/* source: ${source.sourceUrl} */`, wrapMedia(content, source.media)].join('\n');
    })
    .filter(Boolean);

  chunks.push(
    '/* source: webmcp-placeholder */\n[data-webmcp-placeholder="resource"] { max-width: 100%; }'
  );

  return `${chunks.join('\n\n')}\n`;
}
