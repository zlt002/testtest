import { z } from 'zod';

import { windowTakeoverService } from '../services/window-takeover';
import { t } from './router';

const startTakeoverSchema = z.object({
  sessionId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  windowId: z.number().int(),
  lockedTabId: z.number().int(),
  lockedUrl: z.string().trim().min(1).optional(),
});

const allowedNavigationSchema = z.object({
  windowId: z.number().int(),
  fromTabId: z.number().int().optional(),
  toTabId: z.number().int().optional(),
  reason: z.enum(['ai-tab-switch', 'ai-navigation', 'ai-refresh', 'ai-close']),
  expiresAt: z.number(),
});

const leaveDecisionSchema = z.object({
  decision: z.enum(['stay', 'leave']),
  attemptedTabId: z.number().int(),
});

export const windowTakeoverRouter = t.router({
  start: t.procedure.input(startTakeoverSchema).mutation(({ input }) => windowTakeoverService.start(input)),
  stop: t.procedure.mutation(() => windowTakeoverService.stop()),
  getState: t.procedure.query(() => windowTakeoverService.getState()),
  allowNavigation: t.procedure
    .input(allowedNavigationSchema)
    .mutation(({ input }) => windowTakeoverService.allowNavigation(input)),
  resolveLeaveDecision: t.procedure
    .input(leaveDecisionSchema)
    .mutation(({ input }) => windowTakeoverService.resolveLeaveDecision(input)),
});
