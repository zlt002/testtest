import { DownloadCloud, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/entrypoints/sidepanel/components/ui/dialog';
import type {
  SystemUpdateInfo,
  SystemUpdateStartResponse,
} from '@/entrypoints/sidepanel/lib/agent-v2/types';

const EXTENSION_RELOAD_DELAY_MS = 1200;
const EXTENSION_RELOAD_MAX_ATTEMPTS = 10;
const PENDING_SIDE_PANEL_REOPEN_KEY = 'webmcp:pending-sidepanel-reopen';

type SystemUpdateNoticeProps = {
  info: SystemUpdateInfo | null;
  loading: boolean;
  onStartUpdate: () => Promise<SystemUpdateStartResponse>;
  onPollUpdateInfo?: () => Promise<SystemUpdateInfo>;
};

async function persistPendingSidepanelReopen() {
  try {
    const currentWindow = await chrome.windows?.getCurrent?.();
    if (!currentWindow?.id) {
      return;
    }
    await chrome.storage?.local?.set?.({
      [PENDING_SIDE_PANEL_REOPEN_KEY]: {
        windowId: currentWindow.id,
        requestedAt: Date.now(),
      },
    });
  } catch {
    // Ignore persistence failures and continue with reload.
  }
}

function reloadExtensionAndCloseCurrentSidepanel() {
  try {
    chrome.runtime?.reload?.();
  } catch {
    // Ignore reload failures and leave the success message visible.
  }

  try {
    window.close();
  } catch {
    // Ignore close failures when the current surface cannot be dismissed programmatically.
  }
}

function scheduleExtensionReload() {
  void persistPendingSidepanelReopen().finally(() => {
    window.setTimeout(() => {
      reloadExtensionAndCloseCurrentSidepanel();
    }, EXTENSION_RELOAD_DELAY_MS);
  });
}

function shouldReloadAfterUpdateStatus(status: SystemUpdateInfo, targetPackageId: string) {
  return status.currentPackageId === targetPackageId;
}

function scheduleExtensionReloadAfterUpdate({
  targetPackageId,
  onPollUpdateInfo,
}: {
  targetPackageId?: string | null;
  onPollUpdateInfo?: () => Promise<SystemUpdateInfo>;
}) {
  if (!targetPackageId || !onPollUpdateInfo) {
    scheduleExtensionReload();
    return;
  }

  void persistPendingSidepanelReopen().finally(() => {
    let attempts = 0;

    const poll = () => {
      window.setTimeout(async () => {
        attempts += 1;
        try {
          const status = await onPollUpdateInfo();
          if (shouldReloadAfterUpdateStatus(status, targetPackageId)) {
            reloadExtensionAndCloseCurrentSidepanel();
            return;
          }
        } catch {
          // Ignore polling failures and keep waiting for the updater to settle.
        }

        if (attempts >= EXTENSION_RELOAD_MAX_ATTEMPTS) {
          scheduleExtensionReload();
          return;
        }

        poll();
      }, EXTENSION_RELOAD_DELAY_MS);
    };

    poll();
  });
}

export function SystemUpdateNotice({
  info,
  loading,
  onStartUpdate,
  onPollUpdateInfo,
}: SystemUpdateNoticeProps) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading || !info?.updateAvailable) {
    return null;
  }

  async function handleStartUpdate() {
    setUpdating(true);
    setError(null);
    setMessage(null);
    try {
      const result = await onStartUpdate();
      if (result.success) {
        setMessage(result.message || '更新包已准备完成，扩展即将自动重载并应用更新。');
        scheduleExtensionReloadAfterUpdate({
          targetPackageId: info?.packageId,
          onPollUpdateInfo,
        });
      } else {
        setError(result.error || '启动更新失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动更新失败');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label="查看更新"
        className="h-7 shrink-0 gap-1.5 border-emerald-300 px-2.5 text-emerald-700 hover:bg-emerald-50"
        onClick={() => setOpen(true)}
      >
        <DownloadCloud className="h-3.5 w-3.5" />
        <span>发现新版本</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(92vw,520px)] p-4">
          <DialogHeader>
            <DialogTitle>accr Lite 更新可用</DialogTitle>
            <DialogDescription>
              点击立即更新后，扩展会尝试自动重载；如果侧边栏没有自动恢复，请在
              chrome://extensions/ 手动重载 accr-ui。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">更新包</div>
              <div className="mt-1 break-all font-mono text-xs">
                {info.packageId || 'unknown'}
              </div>
              {info.distribution ? (
                <div className="mt-2 text-xs text-muted-foreground">{info.distribution}</div>
              ) : null}
            </div>

            {info.packageUrl ? (
              <div className="break-all text-xs text-muted-foreground">{info.packageUrl}</div>
            ) : null}

            {info.projectUrl ? (
              <a
                href={info.projectUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary"
              >
                查看发布来源
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}

            {message ? (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-green-700">
                {message}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              稍后
            </Button>
            <Button
              type="button"
              onClick={() => void handleStartUpdate()}
              disabled={updating || Boolean(message)}
            >
              {updating ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <DownloadCloud className="h-4 w-4" />
              )}
              {updating ? '更新中...' : '立即更新'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
