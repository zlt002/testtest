import { beginPageElementPick } from '../services/page-picker';
import { t } from './router';

export const pagePickerRouter = t.router({
  pickElement: t.procedure.mutation(() => beginPageElementPick()),
});
