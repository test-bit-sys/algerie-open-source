import { h } from './lib/dom.js';
import { applyTheme, watchSystemTheme, prefs } from './ui/prefs.js';
import { openDb } from './data/idb.js';
import { Workspace } from './data/workspace.js';
import { moveGuestData } from './data/migrate.js';
import { CloudSync } from './data/sync.js';
import { SharedCollections } from './data/shared.js';
import { App } from './ui/app.js';
import { toast } from './ui/toast.js';
import { loadEditor } from './ui/code-editor.js';

const GUEST_DB = 'api-client-guest';
const MIGRATE_FLAG = 'api-client:move-guest-data';
const ALPHA_FLAG = 'api-client:alpha-notice';
const LAST_USER = 'api-client:last-user';

const root = document.getElementById('app');
applyTheme();
watchSystemTheme();

function splash(text) {
  root.setAttribute('aria-busy', 'true');
  root.replaceChildren(
    h('div.splash', { role: 'status' }, h('img.splash-logo', { src: './icon-192.png', alt: '', width: 48, height: 48 }), h('div.spinner', { 'aria-hidden': 'true' }), h('p.splash-sub', text)),
  );
}

/** Waits briefly for the Puter script (loaded with defer); the app works without it. */
async function waitForPuter(ms = 4000) {
  const start = Date.now();
  while (typeof window.puter === 'undefined' && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 50));
  return typeof window.puter === 'undefined' ? null : window.puter;
}

function readLastUser() {
  try {
    return JSON.parse(localStorage.getItem(LAST_USER) || 'null');
  } catch {
    return null;
  }
}

async function session(puter) {
  if (!puter) return { puter: null, env: 'web', signedIn: false, user: null };
  const env = puter.env || 'web';
  const signedIn = env === 'app' || !!puter.auth?.isSignedIn?.();
  if (!signedIn) return { puter, env, signedIn: false, user: null };
  try {
    const user = await puter.auth.getUser();
    const slim = { uuid: user.uuid, username: user.username, isTemp: !!user.is_temp };
    try {
      localStorage.setItem(LAST_USER, JSON.stringify(slim));
    } catch {}
    return { puter, env, signedIn: true, user: slim };
  } catch {
    // Offline or the token expired: open the last account's local copy if we know it.
    const last = readLastUser();
    return last ? { puter, env, signedIn: true, user: last, offline: true } : { puter, env, signedIn: false, user: null };
  }
}

async function boot() {
  splash('Opening API Client...');
  loadEditor().catch(() => {}); // warm the editor chunk while we load data
  const puter = await waitForPuter();
  const s = await session(puter);
  const dbName = s.signedIn ? `api-client-u-${s.user.uuid}` : GUEST_DB;
  let db;
  try {
    // Signed out here and signed in in another tab: reopen as that account, which now holds this work.
    db = await openDb(dbName, { onVersionChange: () => location.reload() });
  } catch (err) {
    console.error(err);
    root.replaceChildren(
      h('main.splash', h('h1', { style: { fontSize: '18px', margin: 0 } }, 'Storage is unavailable'), h('p.splash-sub', 'This browser blocked local storage (private mode can do this). Allow site data and reload.')),
    );
    return;
  }
  const ws = new Workspace(db);
  await ws.load();

  let moved = { count: 0 };
  let moveFailed = false;
  if (s.signedIn && localStorage.getItem(MIGRATE_FLAG)) {
    // Cleared first so a failure part way never copies the same items twice.
    localStorage.removeItem(MIGRATE_FLAG);
    moved = await moveGuestData(ws, GUEST_DB).catch((err) => {
      console.error('Could not move signed-out work', err);
      moveFailed = true;
      return { count: 0 };
    });
  }

  const sync = s.signedIn && puter ? new CloudSync({ ws, db, fs: puter.fs }) : null;
  // Sync was not listening while guest work moved in; merge these on the first pull.
  if (sync && moved.globals) await sync.forget('globals', 'globals');
  if (sync && moved.history) await sync.forget('history', null);
  const shared = s.signedIn && puter ? new SharedCollections({ ws, fs: puter.fs, sync, self: s.user.username }) : null;
  const app = new App(root, {
    ws,
    sync,
    shared,
    session: s,
    onSignIn: async () => {
      await puter.auth.signIn();
      try {
        localStorage.setItem(MIGRATE_FLAG, '1');
      } catch {}
      location.reload();
    },
    onSignOut: async () => {
      await sync?.flush();
      await shared?.flush();
      puter.auth.signOut();
      try {
        localStorage.removeItem(LAST_USER);
      } catch {}
      location.reload();
    },
  });
  window.apiClient = app;
  root.removeAttribute('aria-busy');
  await app.start();
  if (moved.count) toast({ kind: 'success', title: 'Your work moved to your account', text: `${moved.count} item${moved.count > 1 ? 's' : ''} from this browser now sync with Puter.` });
  if (moveFailed) toast({ kind: 'error', title: 'Some work could not be moved to your account', text: 'Work done while signed out is still in this browser. Sign out to see it.' });
  if (s.offline) toast({ kind: 'warning', title: 'Working offline', text: 'Changes are saved on this device and will sync when you are back online.' });
  sync
    ?.start()
    .catch((err) => console.warn('Sync failed to start', err))
    .finally(() => shared?.refresh());

  let seen = false;
  try {
    seen = !!localStorage.getItem(ALPHA_FLAG);
    localStorage.setItem(ALPHA_FLAG, String(Date.now()));
  } catch {}
  if (!seen) {
    toast({
      kind: 'info',
      title: 'Early preview',
      text: 'API Client is in alpha. Features may change and data could be lost, so please do not rely on it for important work yet.',
      duration: 0,
    });
  }
  prefs.set('lastOpened', Date.now());
}

boot();
