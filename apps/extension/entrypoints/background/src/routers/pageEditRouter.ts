import { z } from 'zod';

import { pageEditService } from '../services/page-edit';
import { t } from './router';

export const pageEditRouter = t.router({
  activate: t.procedure.mutation(() => pageEditService.activateForActiveTab()),
  toggle: t.procedure.mutation(() => pageEditService.toggleForActiveTab()),
  deactivate: t.procedure
    .input(
      z.object({
        tabId: z.number().int(),
      })
    )
    .mutation(({ input }) => pageEditService.deactivateForTab(input.tabId)),
  getState: t.procedure
    .input(
      z.object({
        tabId: z.number().int(),
      })
    )
    .query(({ input }) => pageEditService.getStateForTab(input.tabId)),
});
