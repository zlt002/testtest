import { z } from 'zod';
import { readCurrentPageSelection } from '../services/page-selection';
import { readCurrentPageContent } from '../services/read-current-page-content';
import { t } from './router';

export const pageSelectionRouter = t.router({
  readCurrentSelection: t.procedure.mutation(() => readCurrentPageSelection()),
  readPageContent: t.procedure
    .input(
      z.object({
        tabId: z.number().int().positive().optional(),
        windowId: z.number().int().positive().optional(),
        maxChars: z.number().int().positive().optional(),
        includeFrames: z.boolean().optional(),
        maxFrames: z.number().int().positive().optional(),
        frameStrategy: z.enum(['main-only', 'all-accessible', 'wps-priority']).optional(),
        includeFrameAnalysis: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => readCurrentPageContent(input)),
});
