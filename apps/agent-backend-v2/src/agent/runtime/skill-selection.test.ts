import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCurrentPageCodebaseIntent,
  isManagedSystemContext,
  isWebEditSkillContext,
  isWebEditSkillIntent,
  isWebEditSheetIntent,
  isWebEditWordIntent,
  selectSessionSkillPlan,
  selectSessionSkills,
} from './skill-selection.ts';

test('识别 WebEdit 文档页上下文', () => {
  assert.equal(
    isWebEditSkillContext({
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
    }),
    true
  );
  assert.equal(
    isWebEditSkillContext({
      url: 'https://example.com/page',
    }),
    false
  );
});

test('区分文档与表格操作意图', () => {
  assert.equal(isWebEditSheetIntent('帮我生成一个项目任务表示例'), true);
  assert.equal(isWebEditSheetIntent('把 J13 单元格改成 OK'), true);
  assert.equal(isWebEditWordIntent('请总结当前文档并提炼 3 个要点'), true);
  assert.equal(isWebEditWordIntent('把当前选中文本润色成更正式的语气'), true);
  assert.equal(isWebEditSkillIntent('讲个笑话'), false);
});

test('识别自家系统上下文与当前页面联动分析意图', () => {
  assert.equal(
    isManagedSystemContext({
      url: 'https://an-uat.annto.com/order/detail?id=1',
    }),
    true
  );
  assert.equal(
    isManagedSystemContext({
      url: 'https://www.annto.com/dashboard',
    }),
    false
  );
  assert.equal(
    isManagedSystemContext({
      url: 'https://annto.com/dashboard',
    }),
    false
  );
  assert.equal(
    isManagedSystemContext({
      url: 'https://example.com/page',
    }),
    false
  );

  assert.equal(isCurrentPageCodebaseIntent('分析一下当前页面的功能逻辑'), true);
  assert.equal(isCurrentPageCodebaseIntent('分析一下这个页面的接口链路'), true);
  assert.equal(isCurrentPageCodebaseIntent('这个接口在哪一层组装的'), true);
  assert.equal(isCurrentPageCodebaseIntent('这个按钮对应的接口逻辑在哪'), true);
  assert.equal(isCurrentPageCodebaseIntent('这个页面怎么用'), false);
  assert.equal(isCurrentPageCodebaseIntent('这个功能怎么用'), false);
  assert.equal(isCurrentPageCodebaseIntent('这个按钮给用户怎么解释'), false);
  assert.equal(isCurrentPageCodebaseIntent('我要改这里'), false);
  assert.equal(isCurrentPageCodebaseIntent('给我讲个笑话'), false);
});

test('自家系统页面且围绕当前页面分析时选择 ewankb skill', () => {
  const plan = selectSessionSkillPlan({
    prompt: '我想改这里，帮我分析当前页面这个按钮和这个接口的逻辑',
    browserContext: {
      url: 'https://an-uat.annto.com/order/detail?id=1',
    },
  });

  assert.deepEqual(plan?.skills, ['/ewankb-server-query']);
  assert.equal(plan?.enabled, true);
  assert.equal(plan?.plugins, undefined);
});

test('非页面分析意图时不启用 current-page-codebase skill', () => {
  assert.equal(
    selectSessionSkillPlan({
      prompt: '帮我总结一下今天的工作安排',
      browserContext: {
        url: 'https://an-uat.annto.com/order/detail?id=1',
      },
    }),
    undefined
  );

  assert.equal(
    selectSessionSkillPlan({
      prompt: '这个功能怎么用',
      browserContext: {
        url: 'https://an-uat.annto.com/order/detail?id=1',
      },
    }),
    undefined
  );

  assert.equal(
    selectSessionSkillPlan({
      prompt: '这个按钮给用户怎么解释',
      browserContext: {
        url: 'https://an-uat.annto.com/order/detail?id=1',
      },
    }),
    undefined
  );

  assert.equal(
    selectSessionSkillPlan({
      prompt: '分析一下当前页面的代码逻辑',
      browserContext: {
        url: 'https://www.annto.com/dashboard',
      },
    }),
    undefined
  );
});

test('WebEdit 文档场景选择 office + word 内置技能', () => {
  const plan = selectSessionSkillPlan({
    prompt: '请总结当前文档并把选中段落润色一下',
    browserContext: {
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
    },
  });

  assert.deepEqual(plan?.skills, [
    'webedit-assistant:webedit-office',
    'webedit-assistant:webedit-word',
  ]);
  assert.equal(plan?.mode, 'word');
  assert.equal(plan?.plugins?.[0]?.type, 'local');
  assert.match(plan?.plugins?.[0]?.path || '', /builtin-plugins\/webedit-assistant$/);
  assert.equal(plan?.systemPrompt?.type, 'preset');
  assert.equal(plan?.systemPrompt?.preset, 'claude_code');
  assert.match(plan?.systemPrompt?.append || '', /WebEdit 扩展内置办公会话/);
});

test('WebEdit 表格场景选择 office + sheet 内置技能', () => {
  const plan = selectSessionSkillPlan({
    prompt: '帮我生成一个项目任务表示例',
    browserContext: {
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
    },
  });

  assert.deepEqual(plan?.skills, [
    'webedit-assistant:webedit-office',
    'webedit-assistant:webedit-sheet',
  ]);
  assert.equal(plan?.mode, 'sheet');
  assert.deepEqual(selectSessionSkills({
    prompt: '帮我生成一个项目任务表示例',
    browserContext: {
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
    },
  }), [
    'webedit-assistant:webedit-office',
    'webedit-assistant:webedit-sheet',
  ]);
});

test('WebEdit 泛办公场景仅选择 office 技能，非 WebEdit 不启用', () => {
  assert.deepEqual(
    selectSessionSkillPlan({
      prompt: '看看这个页面现在有哪些办公能力',
      browserContext: {
        url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
      },
    })?.skills,
    ['webedit-assistant:webedit-office']
  );

  assert.equal(
    selectSessionSkillPlan({
      prompt: '帮我生成一个项目任务表示例',
      browserContext: {
        url: 'https://example.com/page',
      },
    }),
    undefined
  );
});

test('WebEdit 选择优先级保持正确，不被当前页面代码分析逻辑污染', () => {
  const plan = selectSessionSkillPlan({
    prompt: '分析一下当前页面这个按钮的接口链路和代码逻辑',
    browserContext: {
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/2054164112972349441?id=1',
    },
  });

  assert.deepEqual(plan?.skills, ['webedit-assistant:webedit-office']);
  assert.equal(plan?.plugins?.length, 1);
  assert.match(plan?.plugins?.[0]?.path || '', /builtin-plugins\/webedit-assistant$/);
});
