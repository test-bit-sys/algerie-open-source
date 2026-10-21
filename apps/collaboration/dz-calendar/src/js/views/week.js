import { getWeekDays } from '../date-utils.js';
import { renderTimeGrid } from './timegrid.js';

export function renderWeek(ctx) {
  const days = getWeekDays(ctx.cursor, ctx.settings.weekStartsOn);
  return renderTimeGrid(days, ctx);
}
