import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { HttpError } from '../shared/errors.ts';
import { resolveSafeProjectPath } from '../files/path-safety.ts';

type PreviewRecord = {
  id: string;
  projectRoot: string;
  projectPath: string;
  entryFilePath: string;
  entryAbsolutePath: string;
  watchRootAbsolutePath: string;
};

type PreviewAsset = {
  contentType: string;
  body: Buffer | string;
};

type PreviewEvent = { type: 'reload' };
type LivePreviewUpdateInput = {
  projectPath: string;
  entryFilePath: string;
  filePath: string;
  content: string;
  operation?: 'write' | 'edit';
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
  writeId: string;
};
type LivePreviewCompleteInput = {
  projectPath: string;
  entryFilePath: string;
  filePath: string;
  writeId: string;
  failed?: boolean;
};
type LivePreviewFileState = {
  baseContent: string;
  content: string;
  writeId: string;
};

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function normalizeRelativeFilePath(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) {
    throw new HttpError(400, 'Preview file path is required', 'preview_file_path_required');
  }
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) {
    throw new HttpError(400, 'Preview file path is invalid', 'preview_file_path_invalid');
  }
  return segments.join('/');
}

function previewIdFor(projectRoot: string, filePath: string) {
  return createHash('sha1').update(`${projectRoot}:${filePath}`).digest('hex').slice(0, 16);
}

function previewContentType(filePath: string) {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function encodePreviewAssetPath(filePath: string) {
  return filePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function injectReloadScript(html: string, previewId: string) {
  const script = `<script>(function(){function connect(){const source=new EventSource('/api/preview/events/${previewId}');source.onmessage=function(event){try{const payload=JSON.parse(event.data);if(payload&&payload.type==='reload'){setTimeout(function(){location.reload();},60);}}catch{}};source.onerror=function(){source.close();setTimeout(connect,1000);};}connect();})();</script>`;
  return html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : `${html}${script}`;
}

function looksLikeRawScriptOrStyleText(content: string) {
  const normalized = content.trim();
  if (!normalized || /</.test(normalized)) {
    return false;
  }
  return (
    /^(?:\(?function\b|async function\b|const\b|let\b|var\b|import\b|export\b)/.test(normalized) ||
    /(?:=>|\bEventSource\s*\(|\blocation\.reload\s*\(|\bdocument\.|\bwindow\.|\{[\s\S]*:[\s\S]*\}|[.#]?[\w-]+\s*\{)/.test(
      normalized
    )
  );
}

function hasRenderableHtmlBody(content: string) {
  const normalized = content.trim();
  if (!normalized) {
    return false;
  }
  if (!/<(?:!doctype|html|head|body)\b/i.test(normalized)) {
    if (looksLikeRawScriptOrStyleText(normalized)) {
      return false;
    }
    return true;
  }

  const bodyMatch = normalized.match(/<body\b[^>]*>([\s\S]*)$/i);
  if (bodyMatch) {
    const bodyTail = bodyMatch[1]
      .replace(/<script\b[\s\S]*$/i, '')
      .replace(/<\/body[\s\S]*$/i, '')
      .trim();
    return bodyTail.length > 0;
  }

  const afterHead = normalized.match(/<\/head>([\s\S]*)$/i);
  if (afterHead) {
    return afterHead[1].trim().length > 0;
  }

  return /<\/body>|<\/html>/i.test(normalized);
}

function buildPendingHtmlPreviewDocument(filePath: string) {
  const safeFilePath = filePath.replace(/[<>&"]/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return char;
    }
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>正在生成预览</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(circle at 20% 20%, rgba(121, 215, 255, 0.18), transparent 24%),
        radial-gradient(circle at 80% 20%, rgba(139, 133, 255, 0.2), transparent 24%),
        linear-gradient(135deg, #07111f, #0f1d38 52%, #1a2c54);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      color: #eef5ff;
      padding: 24px;
    }

    .panel {
      width: min(640px, 100%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 24px;
      padding: 28px;
      background: rgba(10, 19, 36, 0.72);
      backdrop-filter: blur(18px);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #d9e7ff;
      font-size: 14px;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #88f7c1;
      box-shadow: 0 0 0 8px rgba(136, 247, 193, 0.12);
      animation: pulse 1.4s ease-in-out infinite;
    }

    h1 {
      margin: 18px 0 10px;
      font-size: clamp(30px, 4vw, 42px);
      line-height: 1.12;
    }

    p {
      margin: 0;
      color: #a9bddf;
      line-height: 1.8;
    }

    code {
      display: inline-block;
      margin-top: 16px;
      padding: 8px 12px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #dbe9ff;
      word-break: break-all;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.15); opacity: 0.7; }
    }
  </style>
</head>
<body>
  <main class="panel">
    <div class="badge"><span class="dot"></span><span>AI 正在生成 HTML 预览</span></div>
    <h1>页面骨架还在流入，先别急着相信半截渲染。</h1>
    <p>当前已经打开实时预览页；等 HTML 主体继续写入到可渲染状态后，这里会自动刷新成真正页面。</p>
    <code>${safeFilePath}</code>
  </main>
</body>
</html>`;
}

function resolveProjectedContent(input: {
  baseContent: string;
  content: string;
  operation?: 'write' | 'edit';
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
}) {
  if (input.operation !== 'edit' || !input.oldString) {
    return input.content;
  }
  const replacement = input.newString ?? input.content;
  const editStart = input.baseContent.indexOf(input.oldString);
  if (editStart < 0) {
    return input.baseContent;
  }
  if (input.replaceAll) {
    return input.baseContent.split(input.oldString).join(replacement);
  }
  return `${input.baseContent.slice(0, editStart)}${replacement}${input.baseContent.slice(
    editStart + input.oldString.length
  )}`;
}

function resolveRenderableLiveContent(input: {
  filePath: string;
  baseContent: string;
  previousContent?: string;
  content: string;
  operation?: 'write' | 'edit';
  oldString?: string;
  newString?: string;
  replaceAll?: boolean;
}) {
  const projected = resolveProjectedContent(input);
  if (!/\.html?$/i.test(input.filePath)) {
    return projected;
  }
  if (input.operation === 'edit') {
    return projected;
  }
  if (hasRenderableHtmlBody(projected)) {
    return projected;
  }
  if (input.previousContent && hasRenderableHtmlBody(input.previousContent)) {
    return input.previousContent;
  }
  if (input.baseContent && hasRenderableHtmlBody(input.baseContent)) {
    return input.baseContent;
  }
  return buildPendingHtmlPreviewDocument(input.filePath);
}

async function resolveExistingWatchRoot(entryAbsolutePath: string, projectRoot: string) {
  let candidate = dirname(entryAbsolutePath);
  while (true) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) {
        return candidate;
      }
    } catch {
      // Keep walking upward until we hit an existing directory inside the project.
    }
    if (candidate === projectRoot) {
      return projectRoot;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      return projectRoot;
    }
    candidate = parent;
  }
}

export function createPreviewService() {
  const previews = new Map<string, PreviewRecord>();
  const subscribers = new Map<string, Set<(event: PreviewEvent) => void>>();
  const watchers = new Map<string, ReturnType<typeof watch>>();
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const liveFiles = new Map<string, Map<string, LivePreviewFileState>>();
  const liveClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function emitReload(previewId: string) {
    const listenerSet = subscribers.get(previewId);
    if (!listenerSet || listenerSet.size === 0) {
      return;
    }
    for (const listener of listenerSet) {
      listener({ type: 'reload' });
    }
  }

  function scheduleReload(previewId: string) {
    const existingTimer = debounceTimers.get(previewId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    debounceTimers.set(
      previewId,
      setTimeout(() => {
        debounceTimers.delete(previewId);
        emitReload(previewId);
      }, 250)
    );
  }

  function ensureWatcher(preview: PreviewRecord) {
    if (watchers.has(preview.id)) {
      return;
    }
    const watcher = watch(
      preview.watchRootAbsolutePath,
      { recursive: process.platform === 'win32' },
      () => {
        scheduleReload(preview.id);
      }
    );
    watcher.on('error', () => {
      watcher.close();
      watchers.delete(preview.id);
    });
    watchers.set(preview.id, watcher);
  }

  function releaseWatcher(previewId: string) {
    const timer = debounceTimers.get(previewId);
    if (timer) {
      clearTimeout(timer);
      debounceTimers.delete(previewId);
    }
    const watcher = watchers.get(previewId);
    if (watcher) {
      watcher.close();
      watchers.delete(previewId);
    }
  }

  function normalizePreviewScopedPath(preview: PreviewRecord, filePath: string) {
    const normalizedFilePath = normalizeRelativeFilePath(filePath);
    const absolutePath = resolve(preview.projectRoot, normalizedFilePath);
    const scoped = relative(preview.watchRootAbsolutePath, absolutePath).replace(/\\/g, '/');
    if (scoped.startsWith('../') || scoped === '..') {
      throw new HttpError(403, 'Preview live file must stay inside the preview directory', 'preview_live_outside_root');
    }
    return normalizedFilePath;
  }

  return {
    async createPreview(projectPath: string, filePath: string) {
      const normalizedFilePath = normalizeRelativeFilePath(filePath);
      const projectRoot = await resolveSafeProjectPath({
        projectPath,
        requestedPath: '.',
      });
      const entryAbsolutePath = await resolveSafeProjectPath({
        projectPath,
        requestedPath: normalizedFilePath,
      });
      try {
        const entryInfo = await stat(entryAbsolutePath);
        if (!entryInfo.isFile()) {
          throw new HttpError(400, 'Preview entry must be a file', 'preview_entry_invalid');
        }
      } catch (error) {
        if (!(error instanceof HttpError)) {
          // Allow previews for files that are still streaming and not on disk yet.
        } else {
          throw error;
        }
      }

      const previewId = previewIdFor(projectRoot, normalizedFilePath);
      previews.set(previewId, {
        id: previewId,
        projectRoot,
        projectPath,
        entryFilePath: normalizedFilePath,
        entryAbsolutePath,
        watchRootAbsolutePath: await resolveExistingWatchRoot(entryAbsolutePath, projectRoot),
      });
      return previewId;
    },

    getAssetPath(previewId: string, filePath: string) {
      const preview = previews.get(previewId);
      if (!preview) {
        throw new HttpError(404, 'Preview not found', 'preview_not_found');
      }
      return `/api/preview/assets/${previewId}/${encodePreviewAssetPath(preview.entryFilePath)}`;
    },

    async readAsset(previewId: string, relativePath: string): Promise<PreviewAsset> {
      const preview = previews.get(previewId);
      if (!preview) {
        throw new HttpError(404, 'Preview not found', 'preview_not_found');
      }

      const normalizedRelativePath = normalizeRelativeFilePath(relativePath);
      const absolutePath = await resolveSafeProjectPath({
        projectPath: preview.projectPath,
        requestedPath: normalizedRelativePath,
      });
      const contentType = previewContentType(normalizedRelativePath);
      const liveState = liveFiles.get(previewId)?.get(normalizedRelativePath);
      if (liveState) {
        if (!/\.html?$/i.test(normalizedRelativePath)) {
          return { contentType, body: Buffer.from(liveState.content, 'utf8') };
        }
        return {
          contentType,
          body: injectReloadScript(liveState.content, previewId),
        };
      }
      const info = await stat(absolutePath).catch((error: NodeJS.ErrnoException) => {
        if (
          error.code === 'ENOENT' &&
          /\.html?$/i.test(normalizedRelativePath) &&
          normalizedRelativePath === preview.entryFilePath
        ) {
          return null;
        }
        throw error;
      });
      if (!info) {
        return {
          contentType,
          body: injectReloadScript(buildPendingHtmlPreviewDocument(normalizedRelativePath), previewId),
        };
      }
      if (!info.isFile()) {
        throw new HttpError(404, 'Preview asset not found', 'preview_asset_not_found');
      }
      const buffer = await readFile(absolutePath);
      if (!/\.html?$/i.test(normalizedRelativePath)) {
        return { contentType, body: buffer };
      }

      return {
        contentType,
        body: injectReloadScript(buffer.toString('utf8'), previewId),
      };
    },

    subscribe(previewId: string, listener: (event: PreviewEvent) => void) {
      const preview = previews.get(previewId);
      if (!preview) {
        throw new HttpError(404, 'Preview not found', 'preview_not_found');
      }

      let listenerSet = subscribers.get(previewId);
      if (!listenerSet) {
        listenerSet = new Set();
        subscribers.set(previewId, listenerSet);
      }
      listenerSet.add(listener);
      ensureWatcher(preview);

      return () => {
        const currentSet = subscribers.get(previewId);
        if (!currentSet) {
          return;
        }
        currentSet.delete(listener);
        if (currentSet.size === 0) {
          subscribers.delete(previewId);
          releaseWatcher(previewId);
        }
      };
    },

    async updateLiveFile(input: LivePreviewUpdateInput) {
      const previewId = await this.createPreview(input.projectPath, input.entryFilePath);
      const preview = previews.get(previewId);
      if (!preview) {
        throw new HttpError(404, 'Preview not found', 'preview_not_found');
      }
      const normalizedFilePath = normalizePreviewScopedPath(preview, input.filePath);
      const clearTimerKey = `${previewId}:${normalizedFilePath}`;
      const existingClearTimer = liveClearTimers.get(clearTimerKey);
      if (existingClearTimer) {
        clearTimeout(existingClearTimer);
        liveClearTimers.delete(clearTimerKey);
      }

      let previewFiles = liveFiles.get(previewId);
      if (!previewFiles) {
        previewFiles = new Map();
        liveFiles.set(previewId, previewFiles);
      }
      const existing = previewFiles.get(normalizedFilePath);
      const baseContent =
        existing && existing.writeId === input.writeId
          ? existing.baseContent
          : await readFile(
              await resolveSafeProjectPath({
                projectPath: preview.projectPath,
                requestedPath: normalizedFilePath,
              }),
              'utf8'
            ).catch(() => '');

      previewFiles.set(normalizedFilePath, {
        baseContent,
        content: resolveRenderableLiveContent({
          filePath: normalizedFilePath,
          baseContent,
          previousContent: existing?.content,
          content: input.content,
          operation: input.operation,
          oldString: input.oldString,
          newString: input.newString,
          replaceAll: input.replaceAll,
        }),
        writeId: input.writeId,
      });
      scheduleReload(previewId);
      return { previewId };
    },

    async completeLiveFile(input: LivePreviewCompleteInput) {
      const previewId = await this.createPreview(input.projectPath, input.entryFilePath);
      const preview = previews.get(previewId);
      if (!preview) {
        throw new HttpError(404, 'Preview not found', 'preview_not_found');
      }
      const normalizedFilePath = normalizePreviewScopedPath(preview, input.filePath);
      const previewFiles = liveFiles.get(previewId);
      const current = previewFiles?.get(normalizedFilePath);
      if (!current || current.writeId !== input.writeId) {
        return { previewId };
      }

      const clear = () => {
        const nextFiles = liveFiles.get(previewId);
        nextFiles?.delete(normalizedFilePath);
        if (nextFiles && nextFiles.size === 0) {
          liveFiles.delete(previewId);
        }
        emitReload(previewId);
      };

      const clearTimerKey = `${previewId}:${normalizedFilePath}`;
      const existingClearTimer = liveClearTimers.get(clearTimerKey);
      if (existingClearTimer) {
        clearTimeout(existingClearTimer);
        liveClearTimers.delete(clearTimerKey);
      }

      if (input.failed) {
        clear();
        return { previewId };
      }

      liveClearTimers.set(
        clearTimerKey,
        setTimeout(() => {
          liveClearTimers.delete(clearTimerKey);
          clear();
        }, 400)
      );
      return { previewId };
    },
  };
}
