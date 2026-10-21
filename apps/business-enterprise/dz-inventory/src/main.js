import './styles/index.css';
import { el } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { store } from './lib/store.js';
import { flushQueue, initSync, adoptAccount } from './lib/cloud.js';
import { applyTheme } from './ui/theme.js';
import { mountShell } from './ui/shell.js';
import { setupOfflineBanner } from './ui/offlinebanner.js';
import { shouldOnboard, openOnboarding } from './ui/onboarding.js';
import { authView } from './views/auth.js';
import { downloadFile } from './lib/util.js';

const appRoot = document.getElementById('app');
const landingLifecycle = new AbortController();
let landing;
function showLanding() {
  landing ||= authView({ onSignedIn: boot, signal: landingLifecycle.signal });
  if (!appRoot.contains(landing)) appRoot.replaceChildren(landing);
}

function showError(title, message, onRetry) {
  appRoot.replaceChildren(el('div.auth-view.auth-error', {},
    el('div.empty-icon', { html: icon('wifiOff', 30) }),
    el('h1.auth-title', { style: { fontSize: '22px' } }, title),
    el('p.auth-sub', {}, message),
    el('button.btn.btn-primary.auth-cta', { onclick: onRetry }, 'Try again')
  ));
}

async function start() {
  if (typeof puter === 'undefined') {
    showLanding();
    return;
  }

  let signedIn = false;
  try {
    signedIn = await Promise.resolve(puter.auth.isSignedIn());
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    showLanding();
    return;
  }
  await boot();
}

async function boot() {
  landingLifecycle.abort();
  landing = null;
  if (location.hash && !location.hash.startsWith('#/')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  appRoot.replaceChildren(el('div.boot-splash', { role: 'status', 'aria-label': 'Loading Inventory' },
    el('img.boot-mark', { src: './icon-192.png', width: 56, height: 56, alt: '' })));
  window.scrollTo(0, 0);
  try {
    /* The offline mirror and write queue belong to whoever used this
       browser last; a different account signing in must not read them
       or have them replayed into its data. Before any KV read. */
    const user = await puter.auth.getUser().catch(() => null);
    await adoptAccount(user?.uuid || user?.username);
    await initSync();
    await store.init();
  } catch (err) {
    console.error(err);
    showError('Couldn’t load your inventory', err.recovery ? err.message : 'Something went wrong talking to your Puter cloud. Check your connection and try again.', () => location.reload());
    if (err.recovery) appRoot.firstElementChild.append(el('button.btn', { onclick: () =>
      downloadFile('inventory-recovery.json', JSON.stringify(err.recovery, null, 2), 'application/json'),
    }, 'Download recovery data'));
    return;
  }

  /* Settings win over the pre-paint localStorage value (they sync across devices). */
  applyTheme(store.settings.theme || 'system');
  mountShell(appRoot);
  /* One data point a day, for the value-over-time report. */
  store.recordSnapshot().catch(() => {});
  /* First run on an empty dataset → guided start (or sample data). */
  if (shouldOnboard(store)) openOnboarding();
  setupOfflineBanner();
  /* Writes queued during an offline stretch (or a previous session)
     replay as soon as there's a connection to replay them into. */
  if (navigator.onLine) flushQueue().catch(() => {});
}


/* The built app works with no connection at all: the service worker
   keeps the shell, the data layer keeps a local mirror. Dev servers
   transform modules on the fly, so only production registers it. */
if (import.meta.env?.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.error('Service worker failed', err));
  });
}

/* Dev-only handle for the mock harness and console debugging. */
if (import.meta.env?.DEV) window.__inv = { store };

/* The importer invites dragging a CSV in, but its drop zone is one
   button: a drop that misses it by a finger's width would otherwise
   hit the browser default and navigate the whole app away to the file.
   Neutralize drops everywhere else; the zone's own handlers still run. */
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

start();
