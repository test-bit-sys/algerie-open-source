/**
 * Being honest about where the data is.
 *
 * The outbox keeps a write nobody could deliver (lib/outbox.js); this is
 * the part that says so out loud: an indicator in the shell, one plain
 * message when a save lands locally instead of remotely, and - when a
 * queued write can't be replayed because another device wrote first - a
 * choice, rather than a quiet overwrite either way.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { timeAgo } from '../lib/util.js';

/** The collections, in the words the user knows them by. */
const KV_LABELS = {
  'crm:settings:v1': 'Settings',
  'crm:companies:v1': 'Companies',
  'crm:contacts:v1': 'Leads',
  'crm:deals:v1': 'Deals',
  'crm:activities:v1': 'Activity',
  'crm:tasks:v1': 'Follow-ups',
  'crm:templates:v1': 'Email templates',
  'crm:attachments:v1': 'Files',
  'crm:trash:v1': 'Recently deleted',
  'crm:backup:v1': 'Safety snapshot',
};

export const kvLabel = (key) => KV_LABELS[key] || key;

/** Is the browser telling us there is no network? */
const browserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * The shell pill: offline, or the queue that is still owed. Nothing at all
 * when everything is where it should be - this is a status line, not a
 * badge to be worn.
 */
export function offlineIndicator() {
  const node = el('div.offline-slot');

  function render() {
    clear(node);
    const { offline, queued, conflicts } = store.offline;
    const off = offline || browserOffline();
    if (!off && !queued) return;
    const label = conflicts
      ? `${conflicts} to review`
      : queued
        ? `${queued} waiting to sync`
        : 'Offline';
    node.append(el('button.offline-pill', {
      type: 'button',
      className: `offline-pill${conflicts ? ' conflict' : off ? ' off' : ''}`,
      'aria-haspopup': 'dialog',
      title: off ? 'Working offline - changes are saved on this device' : 'Changes waiting to reach your cloud',
      onclick: openOfflineSheet,
    },
      el('span', { html: icon(conflicts ? 'alert' : 'wifiOff', 14, 2.2), 'aria-hidden': 'true' }),
      el('span.offline-label', {}, label)
    ));
  }

  store.addEventListener('offline', render);
  window.addEventListener('online', render);
  window.addEventListener('offline', render);
  render();
  return node;
}

/** What the pill opens: what is waiting, and what to do about it. */
export async function openOfflineSheet() {
  const pending = await store.pendingWrites().catch(() => []);
  const body = el('div');

  const syncBtn = el('button.btn.btn-primary', { type: 'button' }, 'Try again now');
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    const result = await store.syncNow();
    modal.close();
    reportSync(result);
  });

  /* A conflicted write is not on its way anywhere: it is held back until
     the user says which version stands. Promising it would go "as soon as
     the cloud answers" contradicted the row right underneath it, which
     says the cloud has already answered and a decision is what's missing. */
  const blocked = pending.filter((row) => row.conflict).length;
  const note = () => {
    if (!pending.length) {
      return 'Everything is in your Puter cloud. Anything you change while offline is kept here and sent when you are back.';
    }
    if (!blocked) {
      return 'These changes are saved on this device and will go to your Puter cloud as soon as it answers.';
    }
    if (blocked === pending.length) {
      return pending.length === 1
        ? 'This change is saved on this device, and it is waiting on you: the cloud moved on while you were offline, so only one version of it can stand.'
        : 'These changes are saved on this device, and each is waiting on you: the cloud moved on while you were offline, so only one version of each can stand.';
    }
    return 'These changes are saved on this device. Most go to your Puter cloud as soon as it answers - the ones marked below need a decision from you first.';
  };

  body.append(
    el('p.settings-note.sheet-note', {}, note()),
    pending.length > 0 && el('div.settings-list', {}, pending.map((row) => el('div.settings-row.static', {},
      el('span.row-ic', { html: icon(row.conflict ? 'alert' : 'wifiOff', 20, 1.8) }),
      el('div.grow.min0', {},
        el('div.title', {}, kvLabel(row.key)),
        el('div.sub', {}, row.conflict
          ? 'Another device changed this too - needs a decision'
          : `Saved here ${timeAgo(row.at)}`)
      ),
      row.conflict && el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        onclick: () => { modal.close(); setTimeout(() => openConflictDialog(row.key), 120); },
      }, ' Review')
    ))),
    el('div.form-actions', {},
      el('div.grow'),
      el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Close'),
      pending.length > 0 && syncBtn
    )
  );

  const modal = openModal({
    title: pending.length ? 'Waiting to sync' : 'Everything is synced',
    content: body,
  });
  return modal;
}

/**
 * The one decision this feature can't make for the user: a queued write
 * whose collection was also changed somewhere else. Whole-collection
 * writes mean one of the two versions wins, so it says which is which and
 * asks - never silently.
 */
export function openConflictDialog(key) {
  const modal = openModal({
    title: `${kvLabel(key)} changed in two places`,
    content: el('div', {},
      el('p.confirm-message', {},
        `While this device was offline, ${kvLabel(key).toLowerCase()} also changed somewhere else - `
        + 'another tab, another device. Only one version can stand.'),
      el('div.settings-list', {},
        el('button.settings-row', {
          type: 'button',
          onclick: () => decide(key, 'mine', modal),
        },
          el('span.row-ic', { html: icon('upload', 20, 1.8) }),
          el('div.grow.min0', {},
            el('div.title', {}, 'Keep what is on this device'),
            el('div.sub', {}, 'Your offline changes are sent, replacing the other version')
          ),
          el('span.row-chev', { html: icon('chevR', 18) })
        ),
        el('button.settings-row', {
          type: 'button',
          onclick: () => decide(key, 'theirs', modal),
        },
          el('span.row-ic', { html: icon('download', 20, 1.8) }),
          el('div.grow.min0', {},
            el('div.title', {}, 'Take the other version'),
            el('div.sub', {}, 'Your offline changes to this are discarded')
          ),
          el('span.row-chev', { html: icon('chevR', 18) })
        )
      )
    ),
  });
  return modal;
}

async function decide(key, choice, modal) {
  modal.close();
  const done = await store.resolveConflict(key, choice);
  if (!done) {
    toast('Couldn’t reach your cloud. It is still waiting', { icon: 'wifiOff' });
    return;
  }
  toast(choice === 'mine'
    ? `${kvLabel(key)} on this device is now the version in your cloud`
    : `${kvLabel(key)} taken from your cloud`, { icon: 'check' });
}

/** After a replay attempt: say what happened, once. */
export function reportSync(result) {
  if (result.conflicts.length) {
    const key = result.conflicts[0];
    toast(`${kvLabel(key)} changed in two places while you were offline`, {
      icon: 'alert',
      duration: 10000,
      action: { label: 'Review', onClick: () => openConflictDialog(key) },
    });
    return;
  }
  if (result.failed.length) {
    toast('Still no connection. Your changes are safe on this device', { icon: 'wifiOff' });
    return;
  }
  if (result.synced.length) toast('Everything is synced', { icon: 'check' });
}

/**
 * Watch the connection for the whole session: replay when the browser says
 * it is back, and say the honest thing the first time a save lands locally
 * instead of remotely.
 */
export function startOfflineSync() {
  let told = false;

  store.addEventListener('offline', () => {
    const { queued, conflicts } = store.offline;
    if (!queued) { told = false; return; }
    if (told || conflicts) return;
    told = true;
    toast('Saved on this device · will sync when you’re back', {
      icon: 'wifiOff',
      duration: 8000,
      action: { label: 'Details', onClick: openOfflineSheet },
    });
  });

  const trySync = async () => {
    if (!store.offline.queued) return;
    const result = await store.syncNow().catch(() => null);
    if (!result) return;
    if (result.synced.length || result.conflicts.length) reportSync(result);
  };

  window.addEventListener('online', trySync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) trySync(); });
  // A session that starts with something already queued (the tab was
  // closed offline) tries once, quietly.
  store.syncNow().then((result) => {
    if (result.conflicts.length) reportSync(result);
  }).catch(() => {});
}
