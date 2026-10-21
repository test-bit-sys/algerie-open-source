import { el, clear } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { parseJoinHash, parseConfirmHash, parseManifest } from '../lib/collab.js';

/**
 * The two halves of the collaboration handshake:
 *  #/join?m=…    opened by an invitee from the owner's invite link
 *  #/approve?d=… opened by the owner from the invitee's confirmation link
 */

function card(...children) {
  return el('div.card', { style: { maxWidth: '560px', margin: '32px auto 0' } },
    el('div.empty', { style: { padding: '28px 22px' } }, ...children));
}

function stateCard({ iconName = 'users', accent = false, title, message }) {
  return card(
    el('div.empty-icon', {
      html: icon(iconName, 26),
      style: accent ? { background: 'var(--accent-wash)', color: 'var(--accent)' } : null,
    }),
    el('h3', {}, title),
    el('p', {}, message)
  );
}

function copyRow(link, label) {
  const input = el('input.input', {
    value: link, readonly: true, 'aria-label': label,
    onclick: (e) => e.target.select(),
  });
  return el('div.row', { style: { width: '100%', marginTop: '14px' } },
    input,
    el('button.icon-btn', {
      html: icon('copy', 17), 'aria-label': `Copy ${label}`,
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(link);
          toast('Link copied');
        } catch {
          input.select();
          toast('Press Ctrl+C to copy', { icon: 'copy' });
        }
      },
    })
  );
}

/**
 * The confirmation link from a join that just happened, kept outside the
 * view. joinCollab saves the list, which re-renders the whole view while
 * its network calls are still in flight — so the instance that started
 * the join is detached by the time it can paint, and the fresh one would
 * otherwise show "you're already in" and swallow the link the handshake
 * depends on.
 */
let justJoined = null;
/** A join still running, so a view remounted mid-flight can wait for it. */
let joinInFlight = null;

export function joinView({ navigate }) {
  const root = el('div');
  const url = parseJoinHash(location.hash);
  if (!url) {
    root.append(stateCard({
      iconName: 'link',
      title: 'This invite link is incomplete',
      message: 'Ask the list owner to send the invite again.',
    }));
    return root;
  }

  root.append(card(el('div.spinner', { role: 'status', 'aria-label': 'Loading invite' })));
  load();
  return root;

  async function load() {
    let manifest;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = parseManifest(await res.text());
    } catch (err) {
      console.error(err);
      clear(root);
      root.append(stateCard({
        iconName: 'link',
        title: 'This invite is no longer available',
        message: 'The owner may have stopped sharing, or the link expired. Ask for a fresh invite.',
      }));
      return;
    }

    // This view can be remounted in the middle of its own join (the save
    // inside joinCollab re-renders while its network calls are still
    // running). Pick the handshake back up rather than reporting the
    // half-finished state as "you're already in".
    if (joinInFlight?.url === url) {
      try {
        const { list, confirm } = await joinInFlight.promise;
        renderJoined(list, confirm, manifest);
      } catch {
        renderPreview(manifest); // the originating view showed the error
      }
      return;
    }
    const existing = store.listById(manifest.listId);
    // A join from this session that has not been approved yet: the
    // confirmation link is still the one thing the user has to act on.
    if (justJoined?.listId === manifest.listId && existing?.collab && !existing.collab.approved) {
      renderJoined(existing, justJoined.confirmUrl, manifest);
      return;
    }
    if (existing?.collab) {
      clear(root);
      root.append(card(
        el('div.empty-icon', { html: icon('checkBig', 26), style: { background: 'var(--accent-wash)', color: 'var(--accent)' } }),
        el('h3', {}, `You're already in "${existing.name}"`),
        el('p', {}, existing.collab.approved
          ? 'Your edits sync with everyone in the list.'
          : 'Waiting for the owner to approve you. You can send them your confirmation link again from the list’s share sheet.'),
        el('button.btn.btn-primary', {
          style: { marginTop: '16px' },
          onclick: () => navigate(`#/list/${existing.id}`),
        }, 'Open the list')
      ));
      return;
    }

    renderPreview(manifest);
  }

  function renderPreview(manifest) {
    const joinBtn = el('button.btn.btn-primary.btn-block', {
      style: { marginTop: '18px', padding: '12px' },
      onclick: async () => {
        joinBtn.disabled = true;
        const pending = store.joinCollab(url);
        joinInFlight = { url, promise: pending };
        try {
          const { list, confirm } = await pending;
          justJoined = { listId: list.id, confirmUrl: confirm };
          // A re-render may already have replaced this view; only the
          // mounted instance paints (the remount awaits the same promise).
          if (root.isConnected) renderJoined(list, confirm, manifest);
        } catch (err) {
          console.error(err);
          joinBtn.disabled = false;
          toast(err.message || 'Could not join. Check your connection', { icon: 'wifiOff' });
        } finally {
          if (joinInFlight?.promise === pending) joinInFlight = null;
        }
      },
    }, 'Join this list');

    clear(root);
    root.append(card(
      el('span.l-icon', {
        html: icon(manifest.icon, 24), 'aria-hidden': 'true',
        style: {
          width: '52px', height: '52px', marginBottom: '4px',
          background: `color-mix(in srgb, var(--slot-${manifest.slot}) 14%, transparent)`,
          color: `var(--slot-${manifest.slot})`,
        },
      }),
      el('h3', { style: { fontSize: '19px' } }, manifest.name),
      el('p', {}, `${manifest.owner.name} invited you to add and edit tasks together.`),
      el('p.small.muted', { style: { marginTop: '10px' } },
        'Joining gives you a confirmation link to send back. Once the owner opens it, your edits sync with everyone.'),
      joinBtn,
      el('button.btn.btn-ghost.btn-block', { style: { marginTop: '8px' }, onclick: () => navigate('#/') }, 'Not now')
    ));
  }

  function renderJoined(list, confirmUrl, manifest) {
    clear(root);
    root.append(card(
      el('div.empty-icon', { html: icon('checkBig', 26), style: { background: 'var(--accent-wash)', color: 'var(--accent)' } }),
      el('h3', {}, `You joined "${list.name}"`),
      el('p', {}, `One step left: send this confirmation link back to ${manifest.owner.name}. The same chat you got the invite in works, and when they open it your edits start syncing.`),
      copyRow(confirmUrl, 'confirmation link'),
      el('button.btn.btn-primary.btn-block', {
        style: { marginTop: '16px' },
        onclick: () => navigate(`#/list/${list.id}`),
      }, 'Open the list')
    ));
  }
}

export function approveView({ navigate }) {
  const root = el('div');
  const payload = parseConfirmHash(location.hash);

  if (!payload) {
    root.append(stateCard({
      iconName: 'link',
      title: 'This confirmation link is incomplete',
      message: 'Ask the person joining to send their link again.',
    }));
    return root;
  }

  const list = store.listById(payload.listId);
  if (!list || list.collab?.role !== 'owner') {
    root.append(stateCard({
      iconName: 'users',
      title: 'Nothing to approve here',
      message: 'This link approves a member of a shared list, and only the list’s owner can open it. Make sure you are signed in to the right account.',
    }));
    return root;
  }

  const approveBtn = el('button.btn.btn-primary.btn-block', {
    style: { marginTop: '18px', padding: '12px' },
    onclick: async () => {
      approveBtn.disabled = true;
      try {
        await store.approveMember(payload.listId, payload.member);
      } catch (err) {
        console.error(err);
        approveBtn.disabled = false;
        toast(err.message || 'Could not approve. Check your connection', { icon: 'wifiOff' });
        return;
      }
      clear(root);
      root.append(card(
        el('div.empty-icon', { html: icon('checkBig', 26), style: { background: 'var(--accent-wash)', color: 'var(--accent)' } }),
        el('h3', {}, `${payload.member.name} can now edit`),
        el('p', {}, `Their changes to "${list.name}" sync with everyone in the list.`),
        el('button.btn.btn-primary', {
          style: { marginTop: '16px' },
          onclick: () => navigate(`#/list/${list.id}`),
        }, 'Open the list')
      ));
    },
  }, 'Allow editing');

  root.append(card(
    el('div.empty-icon', { html: icon('users', 26), style: { background: 'var(--accent-wash)', color: 'var(--accent)' } }),
    el('h3', {}, `Let ${payload.member.name} edit "${list.name}"?`),
    el('p', {}, 'They will see every task in this list and can add, edit, and complete tasks. You can remove them at any time from the share sheet.'),
    approveBtn,
    el('button.btn.btn-ghost.btn-block', { style: { marginTop: '8px' }, onclick: () => navigate(`#/list/${list.id}`) }, 'Not now')
  ));
  return root;
}
