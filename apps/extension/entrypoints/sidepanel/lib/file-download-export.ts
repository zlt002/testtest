import { Canvg } from 'canvg';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
} from 'docx';
import { toString as mdastToString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

type DownloadPayload = {
  fileName: string;
  mimeType: string;
  parts: BlobPart[];
};

type DownloadExportParams = {
  content: string;
  fileName: string;
};

type MarkdownNode = {
  type: string;
  depth?: number;
  ordered?: boolean;
  lang?: string;
  value?: string;
  children?: MarkdownNode[];
  url?: string;
};

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PRIMARY_BLUE = '1D4ED8';
const SECONDARY_BLUE = '2563EB';
const BODY_TEXT = '111827';
const MUTED_TEXT = '4B5563';
const CODE_BACKGROUND = '2B313C';
const CODE_BORDER = '394150';
const CODE_TEXT = 'E5E7EB';
const CODE_MUTED = '9CA3AF';
const QUOTE_BACKGROUND = 'F8FAFC';
const TABLE_BORDER = 'D1D5DB';
const TABLE_HEADER_FILL = 'EFF6FF';
const BODY_FONT = 'Microsoft YaHei';
const CODE_FONT = 'Courier New';
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlH0QAAAABJRU5ErkJggg==';
const DOCX_MAX_IMAGE_WIDTH = 620;
const CODE_BLOCK_IMAGE_WIDTH = 620;
const CODE_BLOCK_PADDING_X = 20;
const CODE_BLOCK_PADDING_Y = 18;
const CODE_BLOCK_LINE_HEIGHT = 24;
const CODE_BLOCK_FONT_SIZE = 14;
const CODE_BLOCK_RADIUS = 14;
const CODE_BLOCK_BORDER_WIDTH = 1;
const CODE_BLOCK_MAX_WRAP_COLUMNS = 90;
const MERMAID_RENDER_CONFIG = {
  startOnLoad: false,
  securityLevel: 'loose',
  theme: 'default',
  htmlLabels: false,
} as const;

let mermaidInitialized = false;

const looksLikeMermaidChart = (value: string) => {
  const firstLine = value.trimStart().split(/\r?\n/, 1)[0]?.trim().toLowerCase();

  return Boolean(
    firstLine &&
      /^(flowchart|graph|sequencediagram|classdiagram|statediagram|erdiagram|journey|gantt|pie|gitgraph|mindmap|timeline|quadrantchart|requirementdiagram|c4context|c4container|c4component|c4dynamic)\b/.test(
        firstLine
      )
  );
};

const replaceExtension = (fileName: string, extension: string): string => {
  const index = fileName.lastIndexOf('.');
  if (index <= 0) {
    return `${fileName}${extension}`;
  }

  return `${fileName.slice(0, index)}${extension}`;
};

const parseMarkdown = (content: string): MarkdownNode =>
  unified().use(remarkParse).use(remarkGfm).parse(content) as MarkdownNode;

const ensureMermaidInitialized = (mermaidApi: {
  initialize: (config: Record<string, unknown>) => void;
}) => {
  if (mermaidInitialized) {
    return;
  }

  mermaidApi.initialize(MERMAID_RENDER_CONFIG);
  mermaidInitialized = true;
};

const mapHeadingLevel = (depth: number | undefined) => {
  switch (depth) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
};

const createBodyTextRun = (text: string, options: Record<string, unknown> = {}) =>
  new TextRun({
    text,
    color: BODY_TEXT,
    font: BODY_FONT,
    size: 24,
    ...options,
  });

const inlineRunsFromNode = (
  node: MarkdownNode | null | undefined
): Array<TextRun | ExternalHyperlink> => {
  if (!node) {
    return [];
  }

  switch (node.type) {
    case 'text':
      return [createBodyTextRun(node.value ?? '')];
    case 'strong':
      return [
        createBodyTextRun(mdastToString(node), {
          text: mdastToString(node),
          bold: true,
        }),
      ];
    case 'emphasis':
      return [
        createBodyTextRun(mdastToString(node), {
          text: mdastToString(node),
          italics: true,
        }),
      ];
    case 'inlineCode':
      return [
        new TextRun({
          text: node.value ?? '',
          font: CODE_FONT,
          size: 22,
          color: BODY_TEXT,
          shading: {
            fill: 'EEF2FF',
          },
        }),
      ];
    case 'linkReference':
    case 'link':
      return [
        new ExternalHyperlink({
          link: node.url ?? '#',
          children: [
            createBodyTextRun(mdastToString(node), {
              color: SECONDARY_BLUE,
              underline: {
                type: UnderlineType.SINGLE,
              },
            }),
          ],
        }),
      ];
    case 'delete':
      return [
        createBodyTextRun(mdastToString(node), {
          text: mdastToString(node),
          strike: true,
        }),
      ];
    case 'break':
      return [new TextRun({ break: 1 })];
    default:
      return (node.children ?? []).flatMap((child) => inlineRunsFromNode(child));
  }
};

const createParagraph = (
  children: Array<TextRun | ExternalHyperlink>,
  options: Record<string, unknown> = {}
) =>
  new Paragraph({
    spacing: {
      before: 40,
      after: 140,
      line: 360,
    },
    ...options,
    children,
  });

const paragraphFromInlineNode = (node: MarkdownNode, options: Record<string, unknown> = {}) =>
  createParagraph(inlineRunsFromNode(node), options);

const getListItemContentBlocks = async (
  item: MarkdownNode,
  ordered: boolean,
  index: number,
  depth: number
): Promise<Array<Paragraph | Table>> => {
  const itemChildren = item.children ?? [];
  const firstBlock = itemChildren[0];
  const restBlocks = itemChildren.slice(1);
  const marker = ordered ? `${index + 1}. ` : '• ';
  const markerIndent = Math.max(1, depth + 1) * 360;

  const firstParagraph = (() => {
    if (!firstBlock) {
      return paragraphFromText(marker, {
        indent: {
          left: markerIndent,
          hanging: 220,
        },
      });
    }

    if (firstBlock.type === 'paragraph') {
      return createParagraph(
        [createBodyTextRun(marker, { bold: true }), ...inlineRunsFromNode(firstBlock)],
        {
          indent: {
            left: markerIndent,
            hanging: 220,
          },
          spacing: {
            before: 20,
            after: 80,
            line: 340,
          },
        }
      );
    }

    return paragraphFromText(`${marker}${mdastToString(firstBlock)}`, {
      indent: {
        left: markerIndent,
        hanging: 220,
      },
      spacing: {
        before: 20,
        after: 80,
      },
    });
  })();

  const trailingBlocks = restBlocks.length > 0 ? await blockNodesToDocx(restBlocks, depth + 1) : [];

  return [firstParagraph, ...trailingBlocks];
};

const paragraphFromText = (text: string, options: Record<string, unknown> = {}): Paragraph =>
  new Paragraph({
    ...options,
    children: [createBodyTextRun(text)],
  });

const tableCellParagraph = (cell: MarkdownNode, rowIndex: number) =>
  new Paragraph({
    spacing: {
      before: 60,
      after: 60,
      line: 320,
    },
    children:
      rowIndex === 0
        ? [
            createBodyTextRun(mdastToString(cell), {
              bold: true,
            }),
          ]
        : inlineRunsFromNode(cell),
  });

const DOCX_TABLE_TOTAL_WIDTH = 9000;
const DOCX_TABLE_MIN_COLUMN_WIDTH = 1800;

const tableColumnWidthsFromNode = (node: MarkdownNode): number[] => {
  const rows = node.children ?? [];
  const columnCount = Math.max(0, ...rows.map((row) => row.children?.length ?? 0));

  if (columnCount === 0) {
    return [];
  }

  const textWeights = new Array(columnCount).fill(1);

  rows.forEach((row) => {
    (row.children ?? []).forEach((cell, index) => {
      textWeights[index] = Math.max(textWeights[index], mdastToString(cell).trim().length);
    });
  });

  const totalWeight = textWeights.reduce((sum, weight) => sum + weight, 0);
  const minWidthBudget = DOCX_TABLE_MIN_COLUMN_WIDTH * columnCount;

  if (minWidthBudget >= DOCX_TABLE_TOTAL_WIDTH) {
    const evenWidth = Math.floor(DOCX_TABLE_TOTAL_WIDTH / columnCount);
    const widths = new Array(columnCount).fill(evenWidth);
    widths[columnCount - 1] += DOCX_TABLE_TOTAL_WIDTH - evenWidth * columnCount;
    return widths;
  }

  const flexibleWidth = DOCX_TABLE_TOTAL_WIDTH - minWidthBudget;
  const widths = textWeights.map(
    (weight) => DOCX_TABLE_MIN_COLUMN_WIDTH + Math.floor((weight / totalWeight) * flexibleWidth)
  );
  const usedWidth = widths.reduce((sum, width) => sum + width, 0);
  widths[widths.length - 1] += DOCX_TABLE_TOTAL_WIDTH - usedWidth;

  return widths;
};

const tableFromNode = (node: MarkdownNode): Table => {
  const columnWidths = tableColumnWidthsFromNode(node);
  const rows = (node.children ?? []).map(
    (row, rowIndex) =>
      new TableRow({
        tableHeader: rowIndex === 0,
        children: (row.children ?? []).map(
          (cell) =>
            new TableCell({
              shading:
                rowIndex === 0
                  ? {
                      fill: TABLE_HEADER_FILL,
                    }
                  : undefined,
              margins: {
                top: 90,
                bottom: 90,
                left: 120,
                right: 120,
              },
              children: [tableCellParagraph(cell, rowIndex)],
            })
        ),
      })
  );

  return new Table({
    rows,
    width: {
      size: 100,
      type: WidthType.PERCENTAGE,
    },
    columnWidths,
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    margins: {
      top: 60,
      bottom: 60,
      left: 0,
      right: 0,
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER },
      left: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER },
      right: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: TABLE_BORDER },
    },
  });
};

const headingSize = (depth: number | undefined): number => {
  switch (depth) {
    case 1:
      return 40;
    case 2:
      return 34;
    case 3:
      return 30;
    case 4:
      return 28;
    default:
      return 26;
  }
};

const headingSpacing = (depth: number | undefined) => ({
  before: depth === 1 ? 320 : depth === 2 ? 260 : 220,
  after: depth === 1 ? 180 : 120,
});

const renderThematicBreak = () =>
  new Paragraph({
    spacing: {
      before: 120,
      after: 120,
    },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 1,
        color: TABLE_BORDER,
      },
    },
  });

const createCodeBlockParagraph = (value: string): Paragraph =>
  new Paragraph({
    wordWrap: false,
    autoSpaceEastAsianText: false,
    shading: {
      fill: CODE_BACKGROUND,
    },
    border: {
      left: {
        style: BorderStyle.SINGLE,
        color: CODE_BORDER,
        size: 4,
      },
      top: {
        style: BorderStyle.SINGLE,
        color: CODE_BORDER,
        size: 1,
      },
      right: {
        style: BorderStyle.SINGLE,
        color: CODE_BORDER,
        size: 1,
      },
      bottom: {
        style: BorderStyle.SINGLE,
        color: CODE_BORDER,
        size: 1,
      },
    },
    spacing: {
      before: 140,
      after: 200,
      line: 300,
    },
    indent: {
      left: 120,
      right: 120,
    },
    children: [...createCodeBlockRuns(value)],
  });

export const createCodeBlockRuns = (value: string): TextRun[] =>
  value.split('\n').map(
    (line, index) =>
      new TextRun({
        text: line,
        break: index === 0 ? undefined : 1,
        font: CODE_FONT,
        size: 21,
        color: CODE_TEXT,
        snapToGrid: false,
      })
  );

export const layoutCodeBlockLines = (
  value: string,
  maxColumns = CODE_BLOCK_MAX_WRAP_COLUMNS
): string[] =>
  value.split('\n').flatMap((line) => {
    if (line.length === 0) {
      return [''];
    }

    if (line.length <= maxColumns) {
      return [line];
    }

    const wrapped: string[] = [];
    for (let index = 0; index < line.length; index += maxColumns) {
      wrapped.push(line.slice(index, index + maxColumns));
    }
    return wrapped;
  });

const drawRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
};

const measureCodeBlockWrapColumns = (context: CanvasRenderingContext2D, availableWidth: number) => {
  const sampleWidth = context.measureText('M').width || 8;
  return Math.max(
    12,
    Math.min(CODE_BLOCK_MAX_WRAP_COLUMNS, Math.floor(availableWidth / sampleWidth))
  );
};

const canvasToPngData = (canvas: HTMLCanvasElement): Uint8Array => {
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1] ?? '';
  return base64ToUint8Array(base64);
};

const rasterizeCodeBlockToPngData = async (
  value: string,
  language?: string
): Promise<Uint8Array> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return getTransparentPngFallbackData();
  }

  const canvas = document.createElement('canvas');
  const scale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  const cssWidth = CODE_BLOCK_IMAGE_WIDTH;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas context unavailable for code block export');
  }

  context.font = `${CODE_BLOCK_FONT_SIZE}px ${CODE_FONT}, ${BODY_FONT}, monospace`;
  const contentWidth = cssWidth - CODE_BLOCK_PADDING_X * 2;
  const maxColumns = measureCodeBlockWrapColumns(context, contentWidth);
  const lines = layoutCodeBlockLines(value, maxColumns);
  const label = language ? language.toUpperCase() : '';
  const labelHeight = label ? 18 : 0;
  const cssHeight = Math.max(
    88,
    CODE_BLOCK_PADDING_Y * 2 + labelHeight + lines.length * CODE_BLOCK_LINE_HEIGHT
  );

  canvas.width = cssWidth * scale;
  canvas.height = cssHeight * scale;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  context.scale(scale, scale);

  drawRoundedRect(context, 0.5, 0.5, cssWidth - 1, cssHeight - 1, CODE_BLOCK_RADIUS);
  context.fillStyle = `#${CODE_BACKGROUND}`;
  context.fill();
  context.lineWidth = CODE_BLOCK_BORDER_WIDTH;
  context.strokeStyle = `#${CODE_BORDER}`;
  context.stroke();

  let currentY = CODE_BLOCK_PADDING_Y;

  if (label) {
    context.font = `600 11px ${BODY_FONT}, sans-serif`;
    context.fillStyle = `#${CODE_MUTED}`;
    context.fillText(label, CODE_BLOCK_PADDING_X, currentY + 10);
    currentY += labelHeight;
  }

  context.font = `${CODE_BLOCK_FONT_SIZE}px ${CODE_FONT}, ${BODY_FONT}, monospace`;
  context.fillStyle = `#${CODE_TEXT}`;
  context.textBaseline = 'top';

  lines.forEach((line, index) => {
    context.fillText(line || ' ', CODE_BLOCK_PADDING_X, currentY + index * CODE_BLOCK_LINE_HEIGHT);
  });

  return canvasToPngData(canvas);
};

const renderCodeBlockImageRun = async (value: string, language?: string): Promise<Paragraph> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return createCodeBlockParagraph(value);
  }

  const pngData = await rasterizeCodeBlockToPngData(value, language);
  const previewCanvas = document.createElement('canvas');
  const context = previewCanvas.getContext('2d');
  const maxColumns = context
    ? (() => {
        context.font = `${CODE_BLOCK_FONT_SIZE}px ${CODE_FONT}, ${BODY_FONT}, monospace`;
        return measureCodeBlockWrapColumns(
          context,
          CODE_BLOCK_IMAGE_WIDTH - CODE_BLOCK_PADDING_X * 2
        );
      })()
    : CODE_BLOCK_MAX_WRAP_COLUMNS;
  const lines = layoutCodeBlockLines(value, maxColumns);
  const labelHeight = language ? 18 : 0;
  const height = Math.max(
    88,
    CODE_BLOCK_PADDING_Y * 2 + labelHeight + lines.length * CODE_BLOCK_LINE_HEIGHT
  );

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: {
      before: 140,
      after: 220,
    },
    children: [
      new ImageRun({
        type: 'png',
        data: pngData,
        transformation: {
          width: CODE_BLOCK_IMAGE_WIDTH,
          height,
        },
      }),
    ],
  });
};

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const getTransparentPngFallbackData = (): Uint8Array => base64ToUint8Array(TRANSPARENT_PNG_BASE64);

export const encodeSvgMarkup = (svgMarkup: string): Uint8Array =>
  new TextEncoder().encode(svgMarkup);

const rasterizeSvgToPngData = async (svgMarkup: string): Promise<Uint8Array> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return getTransparentPngFallbackData();
  }

  const viewBoxMatch = svgMarkup.match(/viewBox="[^"]*?\s(\d+(?:\.\d+)?)\s(\d+(?:\.\d+)?)"/i);
  const width = Math.max(1, Math.ceil(Number(viewBoxMatch?.[1] ?? 800)));
  const height = Math.max(1, Math.ceil(Number(viewBoxMatch?.[2] ?? 480)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas context unavailable for Mermaid PNG fallback');
  }

  const canvg = Canvg.fromString(context, svgMarkup, {
    ignoreAnimation: true,
    ignoreMouse: true,
    ignoreDimensions: true,
  });
  await canvg.render();

  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.split(',')[1] ?? '';
  return base64ToUint8Array(base64);
};

export const resolveMermaidPngFallbackData = async (
  rasterize: () => Promise<Uint8Array>
): Promise<Uint8Array> => {
  try {
    return await rasterize();
  } catch {
    return getTransparentPngFallbackData();
  }
};

const renderMermaidImageRun = async (chart: string): Promise<Paragraph> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return createCodeBlockParagraph(chart);
  }

  const mermaidModule = await import('mermaid');
  const mermaidApi = mermaidModule.default;
  ensureMermaidInitialized(mermaidApi);
  const renderId = `docx-mermaid-${Math.random().toString(36).slice(2)}`;
  const { svg } = await mermaidApi.render(renderId, chart);

  const viewBoxMatch = svg.match(/viewBox="[^"]*?\s(\d+(?:\.\d+)?)\s(\d+(?:\.\d+)?)"/i);
  const sourceWidth = Math.max(320, Number(viewBoxMatch?.[1] ?? 800));
  const sourceHeight = Math.max(180, Number(viewBoxMatch?.[2] ?? 480));
  const width = Math.min(DOCX_MAX_IMAGE_WIDTH, Math.round(sourceWidth));
  const height = Math.max(180, Math.round(sourceHeight * (width / sourceWidth)));
  const pngData = await resolveMermaidPngFallbackData(() => rasterizeSvgToPngData(svg));

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: {
      before: 180,
      after: 240,
    },
    children: [
      new ImageRun({
        type: 'png',
        data: pngData,
        transformation: {
          width,
          height,
        },
      }),
    ],
  });
};

const blockNodesToDocx = async (
  nodes: MarkdownNode[],
  orderedListDepth = 0
): Promise<Array<Paragraph | Table>> => {
  const blocks = await Promise.all(
    nodes.map(async (node) => {
      switch (node.type) {
        case 'heading':
          return [
            new Paragraph({
              heading: mapHeadingLevel(node.depth),
              spacing: headingSpacing(node.depth),
              children: [
                createBodyTextRun(mdastToString(node), {
                  text: mdastToString(node),
                  bold: true,
                  color: node.depth === 1 ? PRIMARY_BLUE : SECONDARY_BLUE,
                  size: headingSize(node.depth),
                }),
              ],
            }),
          ];
        case 'paragraph':
          return [paragraphFromInlineNode(node)];
        case 'list':
          return (
            await Promise.all(
              (node.children ?? []).map((item, index) =>
                getListItemContentBlocks(item, Boolean(node.ordered), index, orderedListDepth)
              )
            )
          ).flat();
        case 'code':
          if (
            node.value?.trim() &&
            (node.lang?.toLowerCase() === 'mermaid' || looksLikeMermaidChart(node.value))
          ) {
            return [await renderMermaidImageRun(node.value.trim())];
          }

          return [await renderCodeBlockImageRun(node.value ?? '', node.lang)];
        case 'blockquote':
          return [
            new Paragraph({
              indent: {
                left: 480,
              },
              shading: {
                fill: QUOTE_BACKGROUND,
              },
              border: {
                left: {
                  style: BorderStyle.SINGLE,
                  color: SECONDARY_BLUE,
                  size: 4,
                },
              },
              spacing: {
                before: 80,
                after: 120,
                line: 340,
              },
              children: [
                createBodyTextRun(mdastToString(node), {
                  color: MUTED_TEXT,
                  italics: true,
                }),
              ],
            }),
          ];
        case 'table':
          return [tableFromNode(node)];
        case 'thematicBreak':
          return [renderThematicBreak()];
        default:
          if (!node.children?.length) {
            const text = mdastToString(node).trim();
            return text ? [paragraphFromText(text)] : [];
          }

          return blockNodesToDocx(node.children, orderedListDepth);
      }
    })
  );

  return blocks.flat();
};

export const buildMarkdownDownloadPayload = ({
  content,
  fileName,
}: DownloadExportParams): DownloadPayload => ({
  fileName,
  mimeType: 'text/markdown;charset=utf-8',
  parts: [content],
});

export const buildDocxDownloadPayload = async ({
  content,
  fileName,
}: DownloadExportParams): Promise<DownloadPayload> => {
  const tree = parseMarkdown(content);
  const children = await blockNodesToDocx(tree.children ?? []);
  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: BODY_FONT,
            size: 24,
            color: BODY_TEXT,
          },
          paragraph: {
            spacing: {
              line: 360,
            },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1080,
              right: 1080,
              bottom: 1080,
              left: 1080,
            },
          },
        },
        children: children.length > 0 ? children : [paragraphFromText('')],
      },
    ],
  });
  const blob = await Packer.toBlob(document);

  return {
    fileName: replaceExtension(fileName, '.docx'),
    mimeType: DOCX_MIME_TYPE,
    parts: [blob],
  };
};

export const triggerBrowserDownload = ({ fileName, mimeType, parts }: DownloadPayload): void => {
  const blob = new Blob(parts, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
};
