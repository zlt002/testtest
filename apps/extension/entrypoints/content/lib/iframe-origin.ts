export function getIframeTargetOrigin(src: string): string | null {
  if (!src.trim()) {
    return null;
  }

  try {
    const parsed = new URL(src);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

const WEBEDIT_IFRAME_HOST = 'webedit.midea.com';

export function isWebEditIframeCandidate(input: {
  id?: string | null;
  src?: string | null;
}): boolean {
  if (input.id === 'office-iframe') {
    return true;
  }

  const srcOrigin = getIframeTargetOrigin(input.src ?? '');
  if (!srcOrigin) {
    return false;
  }

  try {
    return new URL(srcOrigin).hostname.toLowerCase() === WEBEDIT_IFRAME_HOST;
  } catch {
    return false;
  }
}

export function shouldDelayWebEditIframeHandshake(input: {
  srcOrigin: string | null;
  runtimeOrigin: string | null;
}): boolean {
  if (!input.srcOrigin || !input.runtimeOrigin) {
    return false;
  }

  return input.srcOrigin !== input.runtimeOrigin;
}

export function shouldConnectToWebEditIframeTarget(input: {
  targetOrigin: string | null;
  runtimeOrigin: string | null;
}): boolean {
  if (!input.targetOrigin) {
    return false;
  }

  if (!input.runtimeOrigin) {
    return true;
  }

  return input.runtimeOrigin === input.targetOrigin;
}
