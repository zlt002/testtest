const CONFIG_ATTRIBUTE = 'data-webmcp-page-edit-config';

function isSupportedPageMode(value) {
  return value === 'live-page' || value === 'local-snapshot' || value === 'unsupported';
}

function detectPageModeFromLocation(location = globalThis.window?.location) {
  const protocol = location?.protocol;

  if (protocol === 'file:') {
    return 'local-snapshot';
  }

  if (protocol === 'http:' || protocol === 'https:') {
    return 'live-page';
  }

  return 'unsupported';
}

export function readPageEditRuntimeConfig(documentRef = globalThis.document) {
  const rawConfig = documentRef?.documentElement?.getAttribute?.(CONFIG_ATTRIBUTE);
  if (!rawConfig) {
    return null;
  }

  try {
    const config = JSON.parse(rawConfig);
    return config && typeof config === 'object' ? config : null;
  } catch (_) {
    return null;
  }
}

export function hasPageEditRuntimeConfig(documentRef = globalThis.document) {
  return readPageEditRuntimeConfig(documentRef) !== null;
}

export function getCurrentPageMode() {
  const configuredMode = readPageEditRuntimeConfig()?.pageMode;
  if (isSupportedPageMode(configuredMode)) {
    return configuredMode;
  }

  return detectPageModeFromLocation();
}

export function isLivePageMode(mode = getCurrentPageMode()) {
  return mode === 'live-page';
}

export function isLocalSnapshotMode(mode = getCurrentPageMode()) {
  return mode === 'local-snapshot';
}

export function isEditableWorkbenchMode(mode = getCurrentPageMode()) {
  return isLocalSnapshotMode(mode);
}
