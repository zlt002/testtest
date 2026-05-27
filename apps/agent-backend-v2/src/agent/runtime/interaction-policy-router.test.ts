import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractionPolicySession } from './interaction-policy-router.ts';

test('interaction policy session: file resources deny browser extension read on first hop and request file-first correction', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'local_file_url',
    intentKind: 'source_read',
    browserContext: { url: 'file:///Users/demo/index.html', tabId: 10, windowId: 1 },
  });

  const decision = session.beforeToolUse('mcp__browser_extension__read_current_page_content', {});

  assert.equal(decision.behavior, 'deny');
  assert.match(String(decision.message), /file:\/\/ /);
});

test('interaction policy session: active web pages block external browser tools', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: { url: 'https://www.qq.com/', tabId: 10, windowId: 1 },
  });

  const decision = session.beforeToolUse('mcp__playwright__browser_navigate', {});

  assert.equal(decision.behavior, 'block');
  assert.match(String(decision.message), /始终禁止外部浏览器自动化/);
});

test('interaction policy session: plugin playwright snapshot is blocked as external browser', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: { url: 'https://www.qq.com/', tabId: 10, windowId: 1 },
  });

  const decision = session.beforeToolUse(
    'mcp__plugin_playwright_playwright__browser_snapshot',
    {},
  );

  assert.equal(decision.behavior, 'block');
  assert.match(String(decision.message), /始终禁止外部浏览器自动化/);
});

test('interaction policy session: repeated external browser attempts stay blocked', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: { url: 'https://www.qq.com/', tabId: 10, windowId: 1 },
  });

  session.beforeToolUse('mcp__playwright__browser_navigate', {});
  const second = session.beforeToolUse('mcp__playwright__browser_navigate', {});

  assert.equal(second.behavior, 'block');
  assert.match(String(second.message), /始终禁止外部浏览器自动化/);
});

test('interaction policy session: extension read error does not unlock external browser fallback', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: { url: 'https://www.qq.com/', tabId: 10, windowId: 1 },
  });

  session.recordToolOutcome({
    toolName: 'mcp__browser_extension__read_current_page_content',
    isError: true,
    result: { error: 'content unavailable' },
  });

  const decision = session.beforeToolUse('mcp__playwright__browser_navigate', {});

  assert.equal(decision.behavior, 'block');
  assert.match(String(decision.message), /始终禁止外部浏览器自动化/);
});

test('interaction policy session: visual inspect still blocks external browser tools', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'visual_inspect',
    browserContext: { url: 'https://www.qq.com/', tabId: 10, windowId: 1 },
  });

  const decision = session.beforeToolUse('mcp__playwright__browser_navigate', {});

  assert.equal(decision.behavior, 'block');
  assert.match(String(decision.message), /始终禁止外部浏览器自动化/);
});

test('interaction policy session: allows browser extension tools on authorized non-primary selected tabs', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: {
      url: 'https://www.qq.com/',
      tabId: 10,
      windowId: 1,
      primaryTabId: 10,
      allowedTabIds: [10, 12],
    },
  });

  const decision = session.beforeToolUse('mcp__browser_extension__click', {
    tabId: 12,
    windowId: 1,
  });

  assert.equal(decision.behavior, 'allow');
});

test('interaction policy session: blocks browser extension tools on unauthorized tabs outside allowedTabIds', () => {
  const session = createInteractionPolicySession({
    resourceKind: 'active_web_page',
    intentKind: 'rendered_read',
    browserContext: {
      url: 'https://www.qq.com/',
      tabId: 10,
      windowId: 1,
      primaryTabId: 10,
      allowedTabIds: [10, 12],
    },
  });

  const decision = session.beforeToolUse('mcp__browser_extension__click', {
    tabId: 18,
    windowId: 1,
  });

  assert.equal(decision.behavior, 'block');
  assert.match(String(decision.message || ''), /browser_context/);
  assert.match(String(decision.message || ''), /tabId=18/);
});
