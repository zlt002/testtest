export const MODEL_ACCESS_CHANGED_EVENT = 'model-access-changed';
const MODEL_ACCESS_CHANGED_CHANNEL = 'accr-ui-model-access-changed';

type ModelAccessChangedDetail = {
  eventId: string;
  sourceId: string;
};

const MODEL_ACCESS_EVENT_SOURCE_ID = `model-access-${Math.random().toString(36).slice(2, 10)}`;

function createModelAccessChangedChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  return new BroadcastChannel(MODEL_ACCESS_CHANGED_CHANNEL);
}

function createModelAccessChangedDetail(): ModelAccessChangedDetail {
  return {
    eventId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sourceId: MODEL_ACCESS_EVENT_SOURCE_ID,
  };
}

export function publishModelAccessChanged() {
  if (typeof window === 'undefined') {
    return;
  }

  const detail = createModelAccessChangedDetail();
  window.dispatchEvent(new window.CustomEvent<ModelAccessChangedDetail>(MODEL_ACCESS_CHANGED_EVENT, { detail }));
  const channel = createModelAccessChangedChannel();
  if (!channel) {
    return;
  }
  channel.postMessage(detail);
  channel.close();
}

export function subscribeModelAccessChanged(listener: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleEvent = () => {
    listener();
  };

  window.addEventListener(MODEL_ACCESS_CHANGED_EVENT, handleEvent);
  const channel = createModelAccessChangedChannel();
  const handleChannelMessage = (event: MessageEvent<ModelAccessChangedDetail>) => {
    if (!event.data || event.data.sourceId === MODEL_ACCESS_EVENT_SOURCE_ID) {
      return;
    }
    listener();
  };
  channel?.addEventListener('message', handleChannelMessage);

  return () => {
    window.removeEventListener(MODEL_ACCESS_CHANGED_EVENT, handleEvent);
    channel?.removeEventListener('message', handleChannelMessage);
    channel?.close();
  };
}
