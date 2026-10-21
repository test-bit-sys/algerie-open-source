import { el, clear } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { parseSharePayload, parseShareHash } from '../lib/share.js';
import { taskCard } from '../ui/taskrow.js';
import { fmtDay, todayISO } from '../lib/dates.js';
import { plural } from '../lib/util.js';

/**
 * Read-only viewer for a shared list. Works signed in or out: the data
 * comes from the owner's snapshot URL packed into the hash, not from the
 * viewer's own store.
 */
export function sharedView() {
  const root = el('div');
  const url = parseShareHash(location.hash);

  if (!url) {
    root.append(errorState('This share link is incomplete', 'Ask the list owner to send the link again.'));
    return root;
  }

  root.append(el('div.empty', { style: { paddingTop: '80px' } }, el('div.spinner', { style: { margin: '0 auto' }, role: 'status', 'aria-label': 'Loading shared list' })));
  load();
  return root;

  async function load() {
    let data;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = parseSharePayload(await res.text());
    } catch (err) {
      console.error(err);
      clear(root);
      root.append(errorState('Could not open this shared list',
        'The link may have expired, or sharing was turned off. Ask the owner for a fresh link.'));
      return;
    }
    try {
      render(data);
    } catch (err) {
      // render() clears the root before it appends, so an exception here
      // would otherwise leave a silently blank page.
      console.error(err);
      clear(root);
      root.append(errorState('Could not display this shared list',
        'The snapshot could not be shown. Ask the owner for a fresh link.'));
    }
  }

  function render(data) {
    // The snapshot ships the owner's manual order; the sort is stable, so
    // legacy snapshots without one (order 0 throughout) keep their
    // as-published order.
    const open = data.tasks.filter((t) => !t.done).sort((a, b) => (a.order || 0) - (b.order || 0));
    const done = data.tasks.filter((t) => t.done);

    clear(root);
    root.append(
      el('header.shared-head', {},
        el('span.l-icon', {
          html: icon(data.icon, 20), 'aria-hidden': 'true',
          style: {
            width: '42px', height: '42px',
            background: `color-mix(in srgb, var(--slot-${data.slot}) 14%, transparent)`, color: `var(--slot-${data.slot})`,
          },
        }),
        el('div.grow', {},
          el('h1.view-title', {}, data.name),
          el('p.shared-byline', {},
            data.owner ? `Shared by ${data.owner}` : 'Shared list',
            data.updatedAt ? ` · updated ${fmtDay(todayISO(new Date(data.updatedAt)))}` : '')
        )
      ),
      el('div.shared-banner', {},
        el('span', { html: icon('eye', 15, 2.2), style: { display: 'inline-flex', flexShrink: 0 } }),
        el('span.grow', {}, 'You are viewing a live, read-only copy. Reload to see the latest changes.')
      ),
      open.length
        ? el('div', { style: { marginTop: '16px' } }, taskCard(open, { readonly: true }))
        : el('div.card', { style: { marginTop: '16px' } }, el('div.empty', {},
          el('div.empty-icon', { html: icon('checkBig', 26) }),
          el('h3', {}, 'All done'),
          el('p', {}, 'No open tasks in this list right now.')
        )),
      done.length ? el('div', {},
        el('div.section-label', {}, 'Completed', el('span.count', {}, plural(done.length, 'task'))),
        taskCard(done, { readonly: true })
      ) : null,
      el('p.small.muted', { style: { margin: '26px 2px', textAlign: 'center' } },
        'Powered by Tasks on Puter')
    );
  }

  function errorState(title, message) {
    return el('div.card', { style: { marginTop: '40px' } }, el('div.empty', {},
      el('div.empty-icon', { html: icon('link', 26) }),
      el('h3', {}, title),
      el('p', {}, message)
    ));
  }
}
