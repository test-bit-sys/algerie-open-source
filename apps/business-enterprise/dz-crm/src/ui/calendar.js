/**
 * Calendar exports: one follow-up, or everything still open.
 * The .ics file is the reminder path that survives the app being closed.
 */

import { store } from '../lib/store.js';
import { rateText } from '../lib/recurring.js';
import { buildCalendar, taskEvent, dealEvent } from '../lib/ics.js';
import { isOpen } from '../lib/forecast.js';
import { todayISO } from '../lib/util.js';
import { downloadFile } from './download.js';
import { toast } from './toast.js';

const slug = (text) => String(text).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 40) || 'follow-up';

/** Context lines so the event means something outside the CRM. */
function taskContext(task) {
  return {
    contactName: store.contactById(task.contactId)?.name || '',
    dealName: store.dealById(task.dealId)?.name || '',
  };
}

export function downloadTaskICS(task) {
  downloadFile(`${slug(task.title)}.ics`,
    buildCalendar([taskEvent(task, taskContext(task))]), 'text/calendar');
  toast('Calendar event downloaded', { icon: 'calendar' });
}

/**
 * Every open follow-up, plus the expected close of every open deal that
 * has one - the two dates a founder wants on their calendar.
 */
export function downloadOpenICS() {
  const events = store.openTasks().map((t) => taskEvent(t, taskContext(t)));
  for (const deal of store.deals) {
    if (!isOpen(deal) || !deal.expectedClose) continue;
    events.push(dealEvent(deal, {
      companyName: store.companyById(deal.companyId)?.name || '',
      // A recurring deal names its rate ("$2,000/mo") - the number in a
      // calendar entry should read the way the deal page reads.
      value: deal.value ? rateText(deal, store.settings.currency) : '',
    }));
  }
  if (!events.length) {
    toast('Nothing open to export', { icon: 'calendar' });
    return;
  }
  downloadFile(`crm-followups-${todayISO()}.ics`, buildCalendar(events), 'text/calendar');
  toast(`${events.length} event${events.length === 1 ? '' : 's'} downloaded`, { icon: 'calendar' });
}
