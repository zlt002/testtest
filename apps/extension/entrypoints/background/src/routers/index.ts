import { pageCaptureRouter } from './pageCaptureRouter';
import { pageEditRouter } from './pageEditRouter';
import { pagePickerRouter } from './pagePickerRouter';
import { pageSelectionRouter } from './pageSelectionRouter';
import { t } from './router';
import { userScriptRouter } from './userScriptRouter';
import { windowTakeoverRouter } from './windowTakeoverRouter';

export const BGSWRouter = t.router({
  pageEdit: pageEditRouter,
  userScripts: userScriptRouter,
  pagePicker: pagePickerRouter,
  pageSelection: pageSelectionRouter,
  pageCapture: pageCaptureRouter,
  windowTakeover: windowTakeoverRouter,
});

export type BGSWRouterType = typeof BGSWRouter;
