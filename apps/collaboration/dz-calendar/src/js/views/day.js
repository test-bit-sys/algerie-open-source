import { toDate } from '../date-utils.js';
import { renderTimeGrid } from './timegrid.js';

export function renderDay(ctx) {
  return renderTimeGrid([toDate(ctx.cursor)], ctx);
}
