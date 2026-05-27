const VALID_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
]);

export function normalizePermissionMode(value: unknown): string {
  return typeof value === 'string' && VALID_PERMISSION_MODES.has(value) ? value : 'default';
}
