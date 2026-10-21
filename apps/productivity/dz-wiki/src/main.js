import { h } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { applyTheme } from './ui/prefs.js';
import { Workspace } from './data/workspace.js';
import { puterBackend, puterKv, indexedDbBackend, localKv } from './data/backend.js';
import { indexedDbCache, memoryCache } from './data/cache.js';
import { App } from './ui/app.js';
import { call, deploy, refreshDeployment } from './collab/api.js';
import { parseLink } from './collab/protocol.js';

const root = document.getElementById('app');
applyTheme();

const logo = () => h('img.splash-logo', { src: './icon-192.png', alt: '', width: 48, height: 48 });

function screen(...children) {
  root.removeAttribute('aria-busy');
  root.replaceChildren(h('main.splash', { id: 'main' }, ...children));
}

function loading(text = 'Opening your wiki...') {
  root.setAttribute('aria-busy', 'true');
  root.replaceChildren(h('div.splash', { role: 'status' }, logo(), h('div.spinner', { 'aria-hidden': 'true' }), h('p.splash-sub', text)));
}

function errorScreen(title, message, retry) {
  screen(h('div.splash-icon', icon('cloudOff', 28)), h('h1.splash-title', title), h('p.splash-sub', message), retry ? h('button.btn.primary.splash-cta', { type: 'button', onclick: retry }, 'Try again') : null);
}

function signInScreen(onSignedIn, inviting) {
  const btn = h('button.btn.primary.splash-cta', { type: 'button' }, 'Sign in');
  const error = h('p.field-error', { role: 'alert' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Waiting for Puter...';
    error.textContent = '';
    try {
      await puter.auth.signIn();
      onSignedIn();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign in';
      if (err?.error === 'popup_blocked') error.textContent = 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
      else if (err?.error !== 'auth_window_closed') error.textContent = 'Could not sign in. Try again.';
    }
  });
  const feature = (ic, text) => h('li', icon(ic, 18), h('span', text));
  screen(
    logo(),
    h('h1.splash-title', inviting ? 'You are invited to a shared space' : 'Wiki'),
    h('p.splash-sub', inviting ? 'Sign in with Puter to open it.' : 'Docs, notes and databases for you and your team.'),
    inviting
      ? null
      : h(
          'ul.splash-features',
          feature('pencil', 'Write with blocks: headings, lists, to-dos, tables, code and images'),
          feature('database', 'Track anything with tables, boards, lists and calendars'),
          feature('users', 'Share pages and edit together in real time'),
          feature('cloud', 'Stored as files in your own Puter cloud'),
        ),
    btn,
    error,
  );
  btn.focus();
}

async function profilePicture() {
  try {
    return (await puter.auth.getProfilePicture?.()) || null;
  } catch {
    return null;
  }
}

async function start({ backend, kv, cache, user, env, collab, onSignOut, picture, link }) {
  loading();
  const ws = new Workspace({ backend, kv, cache, user, collab });
  try {
    await ws.start();
  } catch (err) {
    console.error(err);
    errorScreen('Could not open your wiki', 'Check your connection and try again.', () => location.reload());
    return;
  }
  const app = new App(root, { ws, user, env, onSignOut, picture: null, puter: typeof puter === 'undefined' ? null : puter });
  window.wikiApp = app;
  await app.start();
  Promise.resolve(picture).then((p) => p && app.setPicture(p));
  if (link) {
    history.replaceState(null, '', location.pathname + location.search);
    app.join(link);
  }
}

function inviteFromHash() {
  if (!/(^|[#&])space=/.test(location.hash)) return null;
  try {
    return parseLink(location.href);
  } catch {
    return null;
  }
}

async function boot() {
  const link = inviteFromHash();
  const params = new URLSearchParams(location.search);
  if (import.meta.env?.DEV && params.has('local')) {
    // Development sandbox: everything stays in this browser, no Puter account.
    // Sharing runs on a local copy of the collaboration service; add &as=<name>
    // in another tab to be someone else.
    const { localCollab, devUser } = await import('./dev/local-collab.js');
    const user = { ...devUser(params.get('as')), sandbox: true };
    const ns = user.username === 'you' ? '' : `-${user.username}`;
    const backend = await indexedDbBackend(`wiki-local${ns}`);
    start({ backend, kv: localKv(`wiki-local${ns}:`), cache: memoryCache(), user, env: 'web', collab: localCollab(user), onSignOut: null, picture: null, link });
    return;
  }
  let backend;
  let kv;
  let user = { username: 'algerie-citoyen', name: 'المستخدم الجزائري' };

  if (typeof puter !== 'undefined' && puter.fs && puter.kv) {
    backend = puterBackend(puter);
    kv = puterKv(puter);
    try {
      const u = await puter.auth.getUser();
      if (u) user = u;
    } catch {}
  } else {
    backend = await indexedDbBackend('dz-wiki-local');
    kv = localKv('dz-wiki-local:');
  }

  const collab = {
    request: async () => { throw new Error('وضع عدم الاتصال السيادي: التخزين محلي فقط'); },
    deploy: async () => {},
    refresh: async () => {},
    events: null,
    grantEvents: () => {},
  };

  start({
    backend,
    kv,
    cache: await indexedDbCache(),
    user,
    env: 'sovereign-dz',
    collab,
    onSignOut: null,
    picture: null,
    link,
  });
}

boot();
