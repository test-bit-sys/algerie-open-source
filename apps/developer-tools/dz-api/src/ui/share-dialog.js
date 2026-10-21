/**
 * Share a collection with other Puter users, and see or remove who has access.
 */
import { h, fill, domId, announce } from '../lib/dom.js';
import { icon } from './icons.js';
import { openDialog } from './dialog.js';
import { toast } from './toast.js';
import { countSecrets } from '../core/model.js';

const ROLE_LABEL = { read: 'Can view', write: 'Can edit', manage: 'Can edit and share' };

function friendlyError(err) {
  const code = err?.code || err?.error?.code || '';
  const map = {
    user_does_not_exist: 'There is no Puter user with that name.',
    cannot_share_with_self: 'This is your own collection.',
    recipient_not_accepting_shares: 'That person is not accepting shares.',
    email_not_allowed: 'Sharing by email is not available here. Use their Puter username.',
    share_daily_limit_reached: 'You reached the daily sharing limit. Try again tomorrow.',
    subscription_required: 'Your Puter plan does not allow sharing this way.',
    phone_verification_required: 'Verify your Puter account to share.',
    card_verification_required: 'Verify your Puter account to share.',
  };
  return map[code] || err?.message || 'Could not share the collection.';
}

export function openShareDialog(app, collectionId) {
  const shared = app.shared;
  const c = app.ws.getCollection(collectionId);
  if (!c) return;
  const inputId = domId('share');
  const who = h('input.input', { id: inputId, type: 'text', placeholder: 'Puter username or email', autocomplete: 'off', spellcheck: false });
  const role = h('select.select', { 'aria-label': 'Access' }, h('option', { value: 'read' }, ROLE_LABEL.read), h('option', { value: 'write' }, ROLE_LABEL.write));
  const invite = h('button.btn.primary', { type: 'submit' }, icon('userPlus', 15), 'Share');
  const error = h('p.field-error', { role: 'alert' });
  const list = h('ul.share-list', { 'aria-label': 'People with access' });

  const render = async () => {
    fill(list, h('li.share-loading', h('div.spinner', { 'aria-hidden': 'true' }), h('span', 'Loading people with access...')));
    try {
      const rows = (await shared.shares(collectionId)).filter((s) => !s.anyone);
      fill(
        list,
        rows.length
          ? rows.map((s) => {
              const name = s.holder?.username || s.recipientEmail || s.holder || 'Unknown';
              const label = typeof name === 'string' ? name : 'Unknown';
              return h(
                'li.share-row',
                h('span.avatar', label.slice(0, 1).toUpperCase()),
                h('span.share-name', label, s.pending ? h('span.badge', 'Invited') : null),
                h('span.share-role', ROLE_LABEL[s.mode] || s.mode),
                h(
                  'button.icon-btn.sm',
                  {
                    type: 'button',
                    'aria-label': `Remove access for ${label}`,
                    onclick: async (e) => {
                      const btn = e.currentTarget;
                      btn.disabled = true;
                      try {
                        await shared.unshare(collectionId, s.holder?.username || s.recipientEmail || label);
                        announce(`Removed ${label}`);
                        // The row and its button go away; keep focus in the dialog.
                        who.focus();
                        await render();
                      } catch (err) {
                        btn.disabled = false;
                        toast({ kind: 'error', title: 'Could not remove access', text: friendlyError(err) });
                      }
                    },
                  },
                  icon('x', 14),
                ),
              );
            })
          : h('li.share-empty', 'Only you can see this collection.'),
      );
    } catch {
      fill(list, h('li.share-empty', 'Could not load who has access. Check your connection.'));
    }
  };

  const form = h(
    'form.share-form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        const recipient = who.value.trim().replace(/^@/, '');
        if (!recipient) {
          error.textContent = 'Enter a Puter username or email.';
          who.focus();
          return;
        }
        invite.disabled = true;
        error.textContent = '';
        try {
          await shared.share(collectionId, recipient, role.value);
          who.value = '';
          toast({ kind: 'success', title: 'Collection shared', text: `${recipient} ${role.value === 'write' ? 'can now edit' : 'can now view'} "${c.name}".` });
          render();
        } catch (err) {
          error.textContent = friendlyError(err);
        } finally {
          invite.disabled = false;
        }
      },
    },
    h('label.field-label', { for: inputId }, 'Invite people'),
    h('div.share-invite', who, role, invite),
    error,
  );

  // Everyone it is shared with gets the collection as it is, secrets included, even people who can only view.
  const secrets = countSecrets(c);
  const secretNote = secrets
    ? h(
        'div.callout',
        { dataset: { kind: 'warning' } },
        icon('warning', 16),
        h('div', `People you share this with can see its ${secrets === 1 ? 'secret value' : `${secrets} secret values`} (secret variables, and tokens, passwords or keys in auth), even if they can only view. To keep ${secrets === 1 ? 'it' : 'them'} private, move ${secrets === 1 ? 'it' : 'them'} to an environment.`),
      )
    : null;

  let dlg;
  dlg = openDialog({
    title: `Share "${c.name}"`,
    body: [
      secretNote,
      form,
      h('div.field', h('span.field-label', 'People with access'), list),
      h(
        'p.field-hint.share-note',
        icon('info', 13),
        h('span', 'They will find it under "Shared with you" when they open API Client signed in to Puter. People who can edit change the same collection you see. Environments and files attached to requests are not shared.'),
      ),
    ],
    footer: [h('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Done')],
    initialFocus: who,
  });
  render();
  return dlg;
}
