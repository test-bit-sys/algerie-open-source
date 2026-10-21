import './styles/index.css';
import { el } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { store } from './lib/store.js';
import { shouldOnboard, openOnboarding } from './ui/onboarding.js';
import { applyTheme } from './ui/theme.js';
import { mountShell } from './ui/shell.js';
import { startReminders } from './lib/reminders.js';
import { runBackupIfDue } from './lib/backups.js';
import { authView } from './views/auth.js';
import { startOfflineSync } from './ui/offline.js';

const appRoot = document.getElementById('app');

function showError(title, message, onRetry) {
  appRoot.replaceChildren(el('div.auth-view', {},
    el('div.empty-icon', { html: icon('wifiOff', 30) }),
    el('h1.auth-title.auth-title-sm', {}, title),
    el('p.auth-sub', {}, message),
    el('button.btn.btn-primary.auth-cta', { onclick: onRetry }, 'Try again')
  ));
}

async function start() {
  // Before the sign-in check, not after: the shell has to be cached whether
  // or not this session gets as far as the app, or an install that first
  // opened on the sign-in screen would never have a shell to launch.
  registerWorker();
  if (typeof puter === 'undefined') {
    showError('Couldn’t reach Puter', 'The Puter SDK failed to load. Check your connection and try again.', () => location.reload());
    return;
  }

  let signedIn = false;
  let asked = true;
  try {
    signedIn = await Promise.resolve(puter.auth.isSignedIn());
  } catch {
    // Offline: the platform can't answer. A sign-in screen would be the
    // wrong answer - the user is signed in, they just have no network - so
    // boot from the local copy if there is one to boot from.
    asked = false;
    signedIn = false;
  }

  if (!signedIn) {
    if (!asked && await store.outbox().hasLocalData().catch(() => false)) {
      await boot();
      return;
    }
    appRoot.replaceChildren(authView({ onSignedIn: boot }));
    return;
  }
  await boot();
}

/**
 * The app shell, cached so an installed copy launches with no network. Not
 * in dev: a worker in front of the dev server serves yesterday's modules.
 */
function registerWorker() {
  if (import.meta.env?.DEV) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

async function boot() {
  try {
    await store.init();
  } catch (err) {
    console.error(err);
    showError('Couldn’t load your data', 'Something went wrong talking to your Puter cloud.', () => location.reload());
    return;
  }

  // Settings win over the pre-paint localStorage value (they sync across devices).
  applyTheme(store.settings.theme || 'system');
  mountShell(appRoot);
  // Catch up with what other sessions wrote whenever this tab comes back
  // to the foreground - otherwise a stale tab's first edit writes last
  // week's collections over the phone's. The store skips the swap when
  // anything local could be lost. Both events, because a window can gain
  // focus without a visibility change (two side by side) and vice versa.
  const catchUp = () => { store.refresh().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) catchUp(); });
  window.addEventListener('focus', catchUp);
  // Reminders run for as long as a tab is open.
  startReminders(store);
  // Anything the network wouldn't take is replayed as soon as it will.
  startOfflineSync();
  // A weekly safety copy in the user's own cloud, written quietly at
  // boot when the newest one has aged out. Never blocks the app.
  runBackupIfDue(store).catch(() => {});
  // First run on an empty dataset → guided start (or sample data).
  if (shouldOnboard(store)) openOnboarding();
}

// Dev-only handle for console debugging.
if (import.meta.env?.DEV) window.__crm = { store };

start();
