// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const toBlobMock = vi.fn(async (document: unknown) => new Blob([JSON.stringify(document)]));

vi.mock('docx', () => {
  class MockDocument {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  class MockParagraph {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  class MockTextRun {
    options: Record<string, unknown>;
    __type = 'TextRun';
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  class MockExternalHyperlink {
    options: Record<string, unknown>;
    __type = 'ExternalHyperlink';
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  class MockImageRun {
    options: Record<string, unknown>;
    __type = 'ImageRun';
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  class MockTable {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  class MockTableCell {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  class MockTableRow {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }

  return {
    AlignmentType: { CENTER: 'center', LEFT: 'left' },
    BorderStyle: { SINGLE: 'single' },
    Document: MockDocument,
    ExternalHyperlink: MockExternalHyperlink,
    HeadingLevel: {
      HEADING_1: 'heading-1',
      HEADING_2: 'heading-2',
      HEADING_3: 'heading-3',
      HEADING_4: 'heading-4',
      HEADING_5: 'heading-5',
      HEADING_6: 'heading-6',
    },
    ImageRun: MockImageRun,
    Packer: {
      toBlob: toBlobMock,
    },
    Paragraph: MockParagraph,
    Table: MockTable,
    TableCell: MockTableCell,
    TableLayoutType: { FIXED: 'fixed' },
    TableRow: MockTableRow,
    TextRun: MockTextRun,
    UnderlineType: { SINGLE: 'single' },
    WidthType: { DXA: 'dxa', PERCENTAGE: 'pct' },
  };
});

describe('file download export', () => {
  beforeEach(() => {
    toBlobMock.mockClear();
  });

  it('embeds markdown image assets into exported docx payloads', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:12306/api/preview/file?projectPath=%2Ftmp%2Fproject&filePath=docs%2Fassets%2Fdiagram.png'
      );
      return new Response(new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { buildDocxDownloadPayload } = await import('./file-download-export');

    const payload = await buildDocxDownloadPayload({
      content: '![流程图](assets/diagram.png)',
      fileName: 'PRD.md',
      projectPath: '/tmp/project',
      markdownFilePath: 'docs/PRD.md',
      backendBaseUrl: 'http://127.0.0.1:12306',
    } as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payload.fileName).toBe('PRD.docx');
    expect(toBlobMock).toHaveBeenCalledTimes(1);

    const document = toBlobMock.mock.calls[0][0] as {
      options: {
        sections: Array<{
          children: Array<{
            options: {
              children: Array<{ __type: string }>;
            };
          }>;
        }>;
      };
    };
    expect(document.options.sections[0].children[0].options.children[0].__type).toBe('ImageRun');
  });
});
