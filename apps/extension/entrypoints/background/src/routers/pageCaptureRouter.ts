import { z } from 'zod';
import { capturePageToCurrentWorkspace } from '../services/page-capture';
import { t } from './router';

const pickedElementContextSchema = z.object({
  url: z.string(),
  selector: z.string().nullable(),
  xpath: z.string().nullable(),
  tagName: z.string(),
  id: z.string().nullable(),
  classList: z.array(z.string()),
  dataAttributes: z.record(z.string()),
  text: z.string().nullable(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  outerHTMLSnippet: z.string().nullable(),
  ancestors: z.array(
    z.object({
      tagName: z.string(),
      id: z.string().nullable(),
      classList: z.array(z.string()),
    })
  ),
  siblings: z.object({
    previous: z.string().nullable(),
    next: z.string().nullable(),
  }),
});

export const pageCaptureRouter = t.router({
  capture: t.procedure
    .input(
      z.object({
        mode: z.enum(['page', 'element']),
        projectPath: z.string().trim().min(1).optional(),
        target: pickedElementContextSchema.optional(),
      }).superRefine((value, ctx) => {
        if (value.mode === 'element' && !value.target) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['target'],
            message: 'element 模式必须提供目标元素',
          });
        }
      })
    )
    .mutation(({ input }) => capturePageToCurrentWorkspace(input)),
});
