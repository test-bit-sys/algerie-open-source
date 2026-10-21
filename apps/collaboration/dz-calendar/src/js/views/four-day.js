import { addDays, startOfDay } from '../date-utils.js';
import { renderTimeGrid } from './timegrid.js';

/** 4-day view: the shared time grid for four consecutive days from the cursor.
 *  (Week is 7 days, Day is 1 — renderTimeGrid already handles any day count.) */
export function renderFourDay(ctx) {
  const start = startOfDay(ctx.cursor);
  const days = Array.from({ length: 4 }, (_, i) => addDays(start, i));
  return renderTimeGrid(days, ctx);
}
