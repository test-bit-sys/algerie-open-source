/**
 * Sharing. A private page is shared by moving it (with its subpages) into a
 * shared space on the owner's collaboration server; then the owner invites
 * people with a link that grants a role, opens the space to anyone signed
 * in with the link, changes roles and removes people. This follows the
 * Whiteboard app's sharing flow.
 */
import { h } from '../lib/dom.js';
import { icon, pageIcon } from '../lib/icons.js';
import { getPage, displayTitle, childrenOf } from '../data/tree.js';
import { ROLE_LABELS } from '../data/space.js';
import { shareLink } from '../collab/protocol.js';
import { openDialog, confirmDialog } from './dialog.js';
import { personAvatar } from './avatar.js';

const INVITE_KEY = 'wiki:invites';

function savedInvites() {
  try {
    return JSON.parse(localStorage.getItem(INVITE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveInvite(room, role, value) {
  const all = savedInvites();
  all[room] = { ...(all[room] || {}), [role]: value };
  try {
    localStorage.setItem(INVITE_KEY, JSON.stringify(all));
  } catch {
    /* not kept; a new link is made next time */
  }
}

function forgetInvites(room) {
  const all = savedInvites();
  delete all[room];
  try {
    localStorage.setItem(INVITE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function openShare(app, anchor, space, pageId) {
  const body = h('div.share');
  const dlg = openDialog({ title: 'Share', body, className: 'share-dialog' });
  if (space.kind === 'personal') renderPrivate(app, dlg, body, space, pageId);
  else renderShared(app, dlg, body, space, pageId);
}

function renderPrivate(app, dlg, body, space, pageId) {
  let page = getPage(space.tree, pageId);
  // A database row is shared with its database.
  if (page?.row && page.parent) {
    pageId = page.parent;
    page = getPage(space.tree, pageId);
  }
  if (!app.ws.canShare) {
    body.replaceChildren(h('div.share-intro', h('span.share-badge', icon('users', 20)), h('p', 'Sharing needs a Puter account. Sign in with Puter to invite people.')));
    return;
  }
  const status = h('p.share-progress', { role: 'status', 'aria-live': 'polite' });
  const go = h('button.btn.primary', { type: 'button' }, icon('users', 16), 'Share this page');
  go.addEventListener('click', async () => {
    go.disabled = true;
    dlg.error('');
    try {
      const shared = await app.ws.sharePage(pageId, (msg) => (status.textContent = msg));
      app.open(shared, pageId);
      app.toast(`${displayTitle(page)} is now shared`, { kind: 'success' });
      renderShared(app, dlg, body, shared, pageId, { fresh: true });
    } catch (err) {
      go.disabled = false;
      status.textContent = '';
      dlg.error(err.message || 'This page could not be shared. Try again.');
    }
  });
  const subpages = childrenOf(space.tree, pageId).length;
  body.replaceChildren(
    h('div.share-intro', h('span.share-badge', pageIcon(page, 22)), h('div', h('h3', displayTitle(page)), h('p', 'Private: only you can see this page.'))),
    h('p.share-text', `Sharing lets people you invite view, comment on or edit this page${subpages ? ` and its ${subpages} subpage${subpages === 1 ? '' : 's'}` : ''}. It moves to Shared in your sidebar and stays stored in your Puter account.`),
    h('div.share-actions', go),
    status,
  );
  go.focus();
}

async function renderShared(app, dlg, body, space, pageId, { fresh = false } = {}) {
  const page = getPage(space.tree, pageId);
  const root = childrenOf(space.tree)[0];
  const intro = h('div.share-intro', h('span.share-badge', pageIcon(root || page, 22)), h('div', h('h3', space.title || displayTitle(root)), h('p', space.canManage ? 'Shared by you. Everyone you invite sees every page in it.' : `Shared by ${space.owner || 'someone'}. You ${ROLE_LABELS[space.role]?.toLowerCase() || 'can view'}.`)));
  if (!space.canManage) {
    const copy = h('button.btn', { type: 'button' }, icon('link', 16), 'Copy link');
    copy.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(shareLink(space.server, space.room, null, pageId)).catch(() => {});
      app.toast('Link copied. It opens for people who already have access.');
    });
    const leave = h('button.btn.ghost.danger', { type: 'button' }, icon('logOut', 16), 'Leave');
    leave.addEventListener('click', async () => {
      dlg.close();
      await app.leaveSpace(space);
    });
    body.replaceChildren(intro, h('div.share-actions', copy, leave));
    return;
  }
  // Invitation link
  const roleSel = h('select.field', { 'aria-label': 'People with the invitation link' }, ...['editor', 'commenter', 'viewer'].map((r) => h('option', { value: r }, ROLE_LABELS[r])));
  const linkField = h('input.field.link-field', { type: 'text', readOnly: true, 'aria-label': 'Invitation link', placeholder: 'Create a link to invite people' });
  const copy = h('button.btn.primary', { type: 'button' }, icon('link', 16), 'Copy invite link');
  const reset = h('button.btn.small.ghost', { type: 'button' }, 'Reset links');
  let grantAsked = false;
  const linkFor = async (role) => {
    const saved = savedInvites()[space.room]?.[role];
    if (saved?.token && saved.expires > Date.now() + 3600_000) {
      const res = await space.request('invite-status', { token: saved.token, role }).catch(() => null);
      if (res?.valid) return saved.token;
    }
    const res = await space.request('invite', { role });
    saveInvite(space.room, role, { token: res.token, expires: res.expires });
    return res.token;
  };
  const makeLink = async () => {
    linkField.value = '';
    const token = await linkFor(roleSel.value);
    linkField.value = shareLink(space.server, space.room, token, pageId);
    return linkField.value;
  };
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    dlg.error('');
    try {
      const link = linkField.value || (await makeLink());
      // Live updates for the people you invite need a one-time permission.
      if (!grantAsked) {
        grantAsked = true;
        app.ws.collab?.grantEvents?.(space);
      }
      try {
        await navigator.clipboard.writeText(link);
        app.toast(`Invite link copied. People who open it ${ROLE_LABELS[roleSel.value].toLowerCase()}.`, { kind: 'success' });
      } catch {
        linkField.focus();
        linkField.select();
        app.toast('Copy the selected link.');
      }
    } catch (err) {
      dlg.error(err.message);
    } finally {
      copy.disabled = false;
    }
  });
  roleSel.addEventListener('change', () => (linkField.value = ''));
  reset.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Reset invitation links?', message: 'Links you already sent stop working. People who joined keep their access.', confirm: 'Reset links', danger: true });
    if (!ok) return;
    await space.request('revoke-invites').catch((err) => dlg.error(err.message));
    forgetInvites(space.room);
    linkField.value = '';
    app.toast('Invitation links reset');
  });
  // General access
  const access = h('select.field', { 'aria-label': 'General access' }, h('option', { value: 'private' }, 'Only people invited'), h('option', { value: 'link' }, 'Anyone signed in with the link'));
  const linkRole = h('select.field', { 'aria-label': 'Role for anyone with the link' }, ...['viewer', 'commenter', 'editor'].map((r) => h('option', { value: r }, ROLE_LABELS[r])));
  const applySettings = async () => {
    try {
      const res = await space.request('settings', { visibility: access.value, linkRole: linkRole.value });
      space.settings = res.settings;
      linkRole.hidden = res.settings.visibility !== 'link';
      app.toast(res.settings.visibility === 'link' ? `Anyone signed in with the link ${ROLE_LABELS[res.settings.linkRole].toLowerCase()}` : 'Only invited people can open this space');
    } catch (err) {
      dlg.error(err.message);
    }
  };
  // Applied once the choice settles: arrowing through a closed select fires
  // a change per step on some systems.
  let settle = 0;
  const applySoon = () => {
    clearTimeout(settle);
    settle = setTimeout(applySettings, 700);
  };
  access.addEventListener('change', applySoon);
  linkRole.addEventListener('change', applySoon);
  access.addEventListener('blur', () => settle && (clearTimeout(settle), applySettings()));
  // People
  const people = h('ul.people', { 'aria-label': 'People with access' }, h('li.people-loading', 'Loading people...'));
  const loadPeople = async () => {
    try {
      const { members, settings } = await space.request('members');
      access.value = settings.visibility;
      linkRole.value = settings.linkRole;
      linkRole.hidden = settings.visibility !== 'link';
      members.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : (a.username || '').localeCompare(b.username || '')));
      people.replaceChildren(
        ...members.map((m) => {
          const me = m.uuid === app.user?.uuid;
          const label = `${m.username}${me ? ' (you)' : ''}`;
          let control;
          if (m.role === 'owner') control = h('span.people-role', 'Owner');
          else {
            control = h('select.field.small', { 'aria-label': `Access for ${m.username}` }, ...['editor', 'commenter', 'viewer'].map((r) => h('option', { value: r, selected: r === m.role }, ROLE_LABELS[r])), h('option', { value: 'removed' }, 'Remove'));
            let wait = 0;
            control.addEventListener('change', () => {
              clearTimeout(wait);
              wait = setTimeout(applyRole, 700);
            });
            const applyRole = async () => {
              if (control.value === m.role) return;
              if (control.value === 'removed') {
                const ok = await confirmDialog({ title: `Remove ${m.username}?`, message: 'They lose access to every page in this space right away.', confirm: 'Remove', danger: true });
                if (!ok) {
                  control.value = m.role;
                  return;
                }
              }
              try {
                await space.request('role', { uuid: m.uuid, role: control.value });
                app.toast(control.value === 'removed' ? `${m.username} was removed` : `${m.username} ${ROLE_LABELS[control.value].toLowerCase()}`);
                loadPeople();
              } catch (err) {
                dlg.error(err.message);
                control.value = m.role;
              }
            };
          }
          return h('li.person', personAvatar(m.username, { size: 30 }), h('span.person-name', label, m.via === 'link' ? h('span.person-via', 'Joined with the public link') : null), control);
        }),
      );
    } catch (err) {
      people.replaceChildren(h('li.picker-empty', err.message));
    }
  };
  const del = h('button.btn.small.ghost.danger', { type: 'button' }, icon('trash', 15), 'Delete shared space');
  del.addEventListener('click', () => {
    dlg.close();
    app.deleteSharedSpace(space);
  });
  body.replaceChildren(
    intro,
    h('section.share-section', h('h3.share-label', 'Invite people'), h('p.share-text', 'Anyone who opens the link and signs in with Puter joins with the access you pick. Links work for 14 days.'), h('div.share-row', roleSel, copy), h('div.share-row', linkField, reset)),
    h('section.share-section', h('h3.share-label', 'General access'), h('div.share-row', access, linkRole)),
    h('section.share-section', h('h3.share-label', 'People with access'), people),
    h('div.share-danger', del),
  );
  if (fresh) copy.focus();
  else roleSel.focus();
  loadPeople();
}
