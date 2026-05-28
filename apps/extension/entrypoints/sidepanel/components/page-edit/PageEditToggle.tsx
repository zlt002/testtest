import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/entrypoints/sidepanel/components/ui/button';
import { getBrowserContext } from '@/entrypoints/sidepanel/lib/browser-context';
import {
  getPageEditActivationSuccessMessage,
  getPageEditCapabilityMessage,
  getPageEditModeTitle,
  getPageEditStatusMessage,
  getPageEditSuccessMessage,
  getPageEditToggleLabel,
  isPageEditActive,
  resolvePageEditTabId,
  type PageEditState,
} from '@/entrypoints/sidepanel/lib/page-edit';
import { trpc } from '@/entrypoints/sidepanel/lib/trpc_client';

export function PageEditToggle() {
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [isResolvingTab, setIsResolvingTab] = useState(true);
  const [stateOverride, setStateOverride] = useState<PageEditState | undefined>(undefined);
  const [isActionPending, setIsActionPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void resolvePageEditTabId(getBrowserContext)
      .then((tabId) => {
        if (cancelled) {
          return;
        }
        setCurrentTabId(tabId);
        setStateOverride(undefined);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolvingTab(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const stateQuery = trpc.pageEdit.getState.useQuery(
    { tabId: currentTabId ?? -1 },
    {
      enabled: currentTabId != null,
    }
  );
  const activateMutation = trpc.pageEdit.activate.useMutation();
  const deactivateMutation = trpc.pageEdit.deactivate.useMutation();

  const effectiveState = useMemo(() => {
    if (stateOverride !== undefined) {
      return stateOverride;
    }
    return (stateQuery.data as PageEditState | undefined) ?? null;
  }, [stateOverride, stateQuery.data]);

  const isPending =
    isResolvingTab ||
    stateQuery.isLoading ||
    isActionPending ||
    activateMutation.isPending ||
    deactivateMutation.isPending;

  const statusMessage = isResolvingTab
    ? '正在读取网页编辑状态...'
    : getPageEditCapabilityMessage(effectiveState) ?? getPageEditStatusMessage(effectiveState);
  const modeTitle = getPageEditModeTitle(effectiveState);

  const handleActivate = async () => {
    setFeedback(null);
    setErrorMessage(null);
    setIsActionPending(true);

    try {
      const nextState = await activateMutation.mutateAsync();
      setStateOverride(nextState as PageEditState);
      setFeedback(getPageEditActivationSuccessMessage(nextState as PageEditState));
      setIsActionPending(false);
      void stateQuery.refetch();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setIsActionPending(false);
    }
  };

  const handleDeactivate = async () => {
    const tabId = effectiveState?.tabId ?? currentTabId;
    if (tabId == null) {
      setErrorMessage('未找到当前页面');
      return;
    }

    setFeedback(null);
    setErrorMessage(null);
    setIsActionPending(true);
    const previousState = effectiveState;
    if (previousState) {
      setStateOverride({
        ...previousState,
        status: 'deactivating',
      });
    }

    try {
      await deactivateMutation.mutateAsync({ tabId });
      setStateOverride(null);
      setFeedback(getPageEditSuccessMessage(null));
      setIsActionPending(false);
      void stateQuery.refetch();
    } catch (error) {
      setStateOverride(previousState);
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setIsActionPending(false);
    }
  };

  return (
    <div className="mx-3 mb-2 rounded-md border bg-card/70 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">{modeTitle}</div>
          <div className="text-xs text-muted-foreground">{statusMessage}</div>
          {feedback ? <div className="mt-1 text-xs text-emerald-700">{feedback}</div> : null}
          {errorMessage ? <div className="mt-1 text-xs text-destructive">{errorMessage}</div> : null}
        </div>
        <Button
          size="sm"
          variant={isPageEditActive(effectiveState) ? 'secondary' : 'default'}
          className="h-7 px-2 text-xs"
          disabled={isPending}
          onClick={() => void (isPageEditActive(effectiveState) ? handleDeactivate() : handleActivate())}
        >
          {getPageEditToggleLabel(effectiveState)}
        </Button>
      </div>
    </div>
  );
}
