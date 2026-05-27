// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  chooseBestCandidate,
  scoreFrameInspection,
  selectBestFrameInspection,
  type FrameContentInspection,
} from './read-current-page-content';

function createFrame(
  overrides: Partial<FrameContentInspection> & Pick<FrameContentInspection, 'frameId' | 'url'>
): FrameContentInspection {
  return {
    frameId: overrides.frameId,
    parentFrameId: overrides.parentFrameId ?? -1,
    url: overrides.url,
    title: overrides.title ?? '',
    bodyTextLen: overrides.bodyTextLen ?? 0,
    bodySample: overrides.bodySample ?? '',
    candidates: overrides.candidates ?? [],
    wpsSignals: overrides.wpsSignals ?? {
      hostMatched: false,
      runtimeDetected: false,
      editorContainerDetected: false,
    },
    selection: overrides.selection ?? null,
  };
}

describe('chooseBestCandidate', () => {
  it('prefers meaningful content candidates over shell candidates', () => {
    const candidate = chooseBestCandidate(
      createFrame({
        frameId: 0,
        url: 'https://example.com',
        bodyTextLen: 320,
        bodySample: '导航 分享 权限 设置',
        candidates: [
          {
            selector: '.menu',
            tag: 'div',
            id: '',
            className: 'menu',
            textLen: 40,
            sample: '导航 分享 权限 设置',
          },
          {
            selector: '.doc-content',
            tag: 'div',
            id: 'content',
            className: 'doc-content',
            textLen: 560,
            sample: '这里是真正文档内容，包含需求说明、背景、目标和验收标准。',
          },
        ],
      })
    );

    expect(candidate?.selector).toBe('.doc-content');
  });
});

describe('scoreFrameInspection', () => {
  it('heavily favors WPS runtime frames in wps-priority mode', () => {
    const shellFrame = createFrame({
      frameId: 0,
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/1',
      title: '未命名文档',
      bodyTextLen: 480,
      bodySample: '目录 分享 协作 更多设置 下载',
      candidates: [
        {
          selector: '.page-shell',
          tag: 'div',
          id: '',
          className: 'page-shell',
          textLen: 180,
          sample: '目录 分享 协作 更多设置 下载',
        },
      ],
      wpsSignals: {
        hostMatched: false,
        runtimeDetected: false,
        editorContainerDetected: false,
      },
    });
    const contentFrame = createFrame({
      frameId: 91,
      parentFrameId: 0,
      url: 'https://webedit.midea.com/moewebv7/document-cloud?editId=abc',
      title: '未命名文档',
      bodyTextLen: 4200,
      bodySample: '任务表示例 开始日期 截止日期 状态 进度 智能门锁升级 需求评审',
      candidates: [
        {
          selector: '#webDoc',
          tag: 'div',
          id: 'webDoc',
          className: 'h-full',
          textLen: 2100,
          sample: '任务表示例 开始日期 截止日期 状态 进度 智能门锁升级 需求评审',
        },
      ],
      wpsSignals: {
        hostMatched: true,
        runtimeDetected: true,
        editorContainerDetected: true,
      },
    });

    const shellScore = scoreFrameInspection(shellFrame, 'wps-priority');
    const contentScore = scoreFrameInspection(contentFrame, 'wps-priority');

    expect(contentScore.score).toBeGreaterThan(shellScore.score);
    expect(contentScore.reasons).toContain('wps_runtime_detected');
    expect(contentScore.role).toBe('wps-content');
  });
});

describe('selectBestFrameInspection', () => {
  it('selects the WPS content frame over the top-level shell frame', () => {
    const shellFrame = createFrame({
      frameId: 0,
      url: 'https://doc.midea.com/teamKnowledge/detail/docOnline/1',
      title: '未命名文档',
      bodyTextLen: 531,
      bodySample: '张龙腾 请输入关键词搜索 主页 目录 分享 协作',
      candidates: [
        {
          selector: 'body',
          tag: 'body',
          id: '',
          className: '',
          textLen: 531,
          sample: '张龙腾 请输入关键词搜索 主页 目录 分享 协作',
        },
      ],
    });

    const wpsFrame = createFrame({
      frameId: 91,
      parentFrameId: 0,
      url: 'https://webedit.midea.com/weboffice/office/s/123',
      title: '未命名文档',
      bodyTextLen: 5200,
      bodySample: '任务表示例 开始日期 截止日期 状态 进度 智能门锁升级 客服知识库改版',
      candidates: [
        {
          selector: '#webDoc',
          tag: 'div',
          id: 'webDoc',
          className: 'editor-root',
          textLen: 3200,
          sample: '任务表示例 开始日期 截止日期 状态 进度 智能门锁升级 客服知识库改版',
        },
      ],
      wpsSignals: {
        hostMatched: true,
        runtimeDetected: true,
        editorContainerDetected: true,
      },
      selection: {
        address: 'A1:C3',
        text: '任务表示例 开始日期 截止日期',
        rowsCount: 3,
        columnsCount: 3,
      },
    });

    const best = selectBestFrameInspection([shellFrame, wpsFrame], 'wps-priority');

    expect(best?.frameId).toBe(91);
    expect(best?.selection).toMatchObject({
      address: 'A1:C3',
      rowsCount: 3,
      columnsCount: 3,
    });
  });
});
