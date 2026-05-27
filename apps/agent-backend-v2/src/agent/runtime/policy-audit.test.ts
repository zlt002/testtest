import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractionPolicySession } from './interaction-policy-router.ts';
import { createPolicyAuditLog, detectBrowserContextMismatch } from './policy-audit.ts';

test('createPolicyAuditLog stores structured events with run id and category', () => {
  const audit = createPolicyAuditLog('run-1');

  audit.record({
    type: 'wrong_primary_tool_attempted',
    resourceKind: 'active_web_page',
    toolName: 'mcp__playwright__browser_navigate',
    detail: 'extension path not attempted',
  });

  const event = audit.events()[0];

  assert.equal(event?.runId, 'run-1');
  assert.equal(event?.type, 'wrong_primary_tool_attempted');
  assert.equal(event?.resourceKind, 'active_web_page');
  assert.equal(event?.toolName, 'mcp__playwright__browser_navigate');
  assert.equal(event?.detail, 'extension path not attempted');
  assert.equal(typeof event?.timestamp, 'string');
  assert.ok(event?.timestamp);
});

test('detectBrowserContextMismatch flags explicit tab mismatch', () => {
  const mismatch = detectBrowserContextMismatch(
    { tabId: 99, windowId: 5, url: 'https://www.qq.com/' },
    { tabId: 12, windowId: 5 },
  );

  assert.equal(mismatch?.type, 'browser_context_mismatch');
  assert.equal(mismatch?.detail, '当前标签页未获授权：允许 tabId=99，实际收到 tabId=12');
});

test('detectBrowserContextMismatch flags explicit window mismatch', () => {
  const mismatch = detectBrowserContextMismatch(
    { tabId: 99, windowId: 5, url: 'https://www.qq.com/' },
    { tabId: 99, windowId: 9 },
  );

  assert.equal(mismatch?.type, 'browser_context_mismatch');
  assert.equal(mismatch?.detail, '当前窗口上下文不一致：期望 windowId=5，实际收到 windowId=9');
});

test('detectBrowserContextMismatch flags missing tab id when exact context is required', () => {
  const mismatch = detectBrowserContextMismatch(
    { tabId: 99, windowId: 5, url: 'https://www.qq.com/' },
    { windowId: 5 },
    { requireExactContext: true },
  );

  assert.equal(mismatch?.type, 'browser_context_mismatch');
  assert.equal(mismatch?.detail, '当前标签页上下文字段无效：期望 tabId=99，实际收到 tabId=缺失');
});

test('interaction policy session blocks mismatched browser context with chinese message', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: {
      tabId: 99,
      windowId: 5,
      url: 'https://www.qq.com/',
    },
  });

  const decision = session.beforeToolUse('mcp__browser_extension__click', {
    tabId: 12,
    windowId: 5,
  });

  assert.equal(decision.behavior, 'block');
  assert.match(decision.message || '', /当前 browser_context 与工具输入不一致/);
  assert.match(decision.message || '', /当前标签页未获授权/);
});

test('interaction policy session blocks extension operate tools when tab id is missing', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: {
      tabId: 99,
      windowId: 5,
      url: 'https://www.qq.com/',
    },
  });

  const decision = session.beforeToolUse('mcp__browser_extension__click', { windowId: 5 });

  assert.equal(decision.behavior, 'block');
  assert.match(decision.message || '', /当前标签页上下文字段无效/);
});

test('interaction policy session blocks extension read tools when tab id is missing on active web pages', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: {
      tabId: 99,
      windowId: 5,
      url: 'https://www.qq.com/',
    },
  });

  const decision = session.beforeToolUse('mcp__browser_extension__read_current_page_content', {});

  assert.equal(decision.behavior, 'block');
  assert.match(decision.message || '', /当前标签页上下文字段无效/);
});

test('interaction policy session does not block when browser context fully matches tool input', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: {
      tabId: 99,
      windowId: 5,
      url: 'https://www.qq.com/',
    },
  });

  const decision = session.beforeToolUse('mcp__browser_extension__click', {
    tabId: 99,
    windowId: 5,
  });

  assert.equal(decision.behavior, 'allow');
  assert.doesNotMatch(decision.message || '', /browser_context 与工具输入不一致/);
});

test('interaction policy session uses read-specific message for rendered_read first hop', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: {
      tabId: 99,
      windowId: 5,
      url: 'https://www.qq.com/',
    },
  });

  const decision = session.beforeToolUse('mcp__playwright__browser_navigate', {
    tabId: 99,
    windowId: 5,
  });

  assert.equal(decision.behavior, 'deny');
  assert.match(decision.message || '', /当前浏览器扩展工具的读取工具/);
  assert.doesNotMatch(decision.message || '', /视觉检查/);
});

test('detectBrowserContextMismatch allows non-primary authorized tabs from allowedTabIds', () => {
  const mismatch = detectBrowserContextMismatch(
    {
      tabId: 99,
      windowId: 5,
      url: 'https://www.qq.com/',
      allowedTabIds: [99, 12],
      primaryTabId: 99,
    },
    { tabId: 12, windowId: 5 },
    { requireExactContext: true },
  );

  assert.equal(mismatch, null);
});

test('detectBrowserContextMismatch still flags unauthorized tabs outside allowedTabIds', () => {
  const mismatch = detectBrowserContextMismatch(
    {
      tabId: 99,
      windowId: 5,
      url: 'https://www.qq.com/',
      allowedTabIds: [99, 12],
      primaryTabId: 99,
    },
    { tabId: 18, windowId: 5 },
    { requireExactContext: true },
  );

  assert.equal(mismatch?.type, 'browser_context_mismatch');
  assert.match(mismatch?.detail || '', /tabId=18/);
});
