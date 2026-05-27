export const CAPABILITY_CATALOG_CHANGED_EVENT = 'capability-catalog-changed';
const CAPABILITY_CATALOG_CHANNEL = 'accr-ui-capability-catalog-changed';

export type CapabilityCatalogChangedDetail = {
  type: 'skill' | 'command';
  originId?: string;
};

function createCapabilityCatalogChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  return new BroadcastChannel(CAPABILITY_CATALOG_CHANNEL);
}

export function publishCapabilityCatalogChanged(detail: CapabilityCatalogChangedDetail) {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<CapabilityCatalogChangedDetail>(CAPABILITY_CATALOG_CHANGED_EVENT, { detail })
  );
  const channel = createCapabilityCatalogChannel();
  if (!channel) {
    return;
  }
  channel.postMessage(detail);
  channel.close();
}

export function subscribeCapabilityCatalogChanged(
  listener: (detail: CapabilityCatalogChangedDetail) => void
) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<CapabilityCatalogChangedDetail>;
    if (!customEvent.detail) {
      return;
    }
    listener(customEvent.detail);
  };

  window.addEventListener(CAPABILITY_CATALOG_CHANGED_EVENT, handleEvent as EventListener);
  const channel = createCapabilityCatalogChannel();
  const handleChannelMessage = (event: MessageEvent<CapabilityCatalogChangedDetail>) => {
    if (!event.data) {
      return;
    }
    listener(event.data);
  };
  channel?.addEventListener('message', handleChannelMessage);
  return () => {
    window.removeEventListener(CAPABILITY_CATALOG_CHANGED_EVENT, handleEvent as EventListener);
    channel?.removeEventListener('message', handleChannelMessage);
    channel?.close();
  };
}
