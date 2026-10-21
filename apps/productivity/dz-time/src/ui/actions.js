/**
 * Running the URL actions parsed in lib/urlaction.js: the app addressed
 * from outside itself (an installed-icon shortcut, a launcher, a link the
 * user wired up). Every verb either does the one thing it names or says
 * plainly why it could not, in the wording the app already uses.
 */

import { toast } from './toast.js';
import { openEntryForm } from './entryform.js';
import { store } from '../lib/store.js';
import { parseAction, withoutAction } from '../lib/urlaction.js';
import { fmtClock } from '../lib/time.js';

/**
 * Act on the action in the current URL, if any. The URL is cleaned before
 * anything happens, so a reload (or a back gesture) can never fire the
 * same action twice, and a sheet opened by it records the clean route it
 * belongs to rather than closing on its own cleanup.
 */
export async function runUrlAction() {
  const req = parseAction(location.hash);
  if (!req) return;
  const clean = withoutAction(location.hash);
  history.replaceState(null, '', clean);

  if (req.action === 'log') {
    openEntryForm();
    return;
  }

  if (req.action === 'stop') {
    if (!store.running) {
      toast('No timer is running', { icon: 'timer' });
      return;
    }
    try {
      const entry = await store.stopTimer();
      toast(`Logged ${fmtClock(entry.seconds)}`, { icon: 'check' });
    } catch (err) {
      console.error(err);
      toast('Could not stop, check your connection', { icon: 'wifiOff' });
    }
    return;
  }

  // start
  if (store.running) {
    toast('A timer is already running', { icon: 'timer' });
    return;
  }
  if (!req.projectId) {
    toast('That link does not say which project to track', { icon: 'folders' });
    return;
  }
  const project = store.project(req.projectId);
  if (!project) {
    toast('That project no longer exists', { icon: 'folders' });
    return;
  }
  if (project.archived) {
    toast(`${project.name} is archived`, { icon: 'archive' });
    return;
  }
  try {
    await store.startTimer({ projectId: project.id, task: req.task, billable: project.billable });
    toast(`Tracking ${project.name}`, { icon: 'timer' });
  } catch (err) {
    console.error(err);
    toast('Could not start, check your connection', { icon: 'wifiOff' });
  }
}

/**
 * Watch for actions arriving while the app is already open: tapping an
 * app-icon shortcut focuses the running window and only changes the URL,
 * so without this the second tap of the day would do nothing.
 */
export function initUrlActions() {
  window.addEventListener('hashchange', () => {
    runUrlAction().catch(console.error);
  });
  runUrlAction().catch(console.error);
}
