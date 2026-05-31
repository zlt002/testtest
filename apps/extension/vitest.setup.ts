import { expect, vi } from 'vitest';

expect.extend({
  toBeDisabled(received: unknown) {
    const element = received as { disabled?: boolean } | null;
    const pass = Boolean(element && 'disabled' in element && element.disabled === true);

    return {
      pass,
      message: () =>
        pass ? 'expected element not to be disabled' : 'expected element to be disabled',
    };
  },
  toBeEnabled(received: unknown) {
    const element = received as { disabled?: boolean } | null;
    const pass = Boolean(element && (!('disabled' in element) || element.disabled !== true));

    return {
      pass,
      message: () =>
        pass ? 'expected element not to be enabled' : 'expected element to be enabled',
    };
  },
  toHaveValue(received: unknown, expected: unknown) {
    const actual = (received as { value?: unknown } | null)?.value;
    const pass = actual === expected;

    return {
      pass,
      message: () =>
        pass
          ? `expected element value not to be ${String(expected)}`
          : `expected element value to be ${String(expected)}, received ${String(actual)}`,
    };
  },
  toHaveClass(received: unknown, ...expectedClasses: string[]) {
    const actualClassName = String((received as { className?: unknown } | null)?.className || '');
    const actualClasses = new Set(actualClassName.split(/\s+/).filter(Boolean));
    const pass = expectedClasses.every((className) => actualClasses.has(className));

    return {
      pass,
      message: () =>
        pass
          ? `expected element not to contain classes: ${expectedClasses.join(', ')}`
          : `expected element to contain classes: ${expectedClasses.join(', ')}, received "${actualClassName}"`,
    };
  },
});

// Mock window.matchMedia
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
