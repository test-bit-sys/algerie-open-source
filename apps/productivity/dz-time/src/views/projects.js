/** Clients and their projects: rates, colors, archive. */

import { el, clear, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { colorDot } from '../ui/fields.js';
import { openClientForm, openProjectForm } from '../ui/projectforms.js';
import { store, rateAt } from '../lib/store.js';
import { fmtMoney } from '../lib/util.js';
import { fmtDuration, todayISO, daysApart } from '../lib/time.js';

export function projectsView() {
  const root = el('div.view');
  const body = el('div');
  let showArchived = false;

  /* Unbilled totals and budget progress load async (they scan month
     files); the view renders immediately and patches itself when the
     numbers arrive. */
  let unbilled = new Map();
  let budgets = new Map();
  let statsSeq = 0;
  async function refreshStats() {
    const seq = ++statsSeq;
    const [u, b] = await Promise.all([
      store.unbilledByClient().catch(() => null),
      (async () => {
        const m = new Map();
        for (const p of store.projects.filter((x) => x.budget && !x.archived)) {
          const prog = await store.budgetProgress(p).catch(() => null);
          if (prog) m.set(p.id, prog);
        }
        return m;
      })(),
    ]);
    if (seq !== statsSeq) return;
    if (u) unbilled = u;
    budgets = b;
    render();
  }

  root.append(
    el('div.page-head.page-head-split', {},
      el('div', {},
        el('h1.page-title', {}, 'Projects'),
        el('p.page-sub', {}, 'Clients, projects, and rates')
      ),
      el('button.btn.btn-primary.btn-slim', {
        html: icon('plus', 16, 2.2),
        onclick: () => openClientForm(),
      }, ' New client')
    ),
    body
  );

  /* Archiving rolls back in the store and emits nothing on failure, so
     the card simply stays as it was: without a word here the tap looks
     like the button is broken. Every other write in the app says so. */
  function archive(promise, { restoring }) {
    promise.catch((err) => {
      console.error(err);
      toast(restoring ? 'Could not restore, check your connection' : 'Could not archive, check your connection',
        { icon: 'wifiOff' });
    });
  }

  /* How old the oldest unbilled entry is, in the words the Invoices tab
     uses, and the threshold at which it is worth flagging. */
  const staleDays = () => Number(store.settings.unbilledAgeDays) || 30;
  function ageText(oldestISO) {
    const days = daysApart(oldestISO, todayISO());
    if (days <= 0) return 'today';
    if (days === 1) return '1 day old';
    return `${days} days old`;
  }

  /* Cards show the rate in effect today; history lives in the forms. */
  function rateText(rate, inheritedFrom, currency) {
    const current = rateAt(rate, todayISO());
    if (current != null) return `${fmtMoney(current, currency)}/h`;
    return inheritedFrom;
  }

  function render() {
    clear(body);
    const active = store.activeClients();
    const archived = store.clients.filter((c) => c.archived);

    if (!active.length && !archived.length) {
      body.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('users', 26) }),
        el('h3', {}, 'Who do you work for?'),
        el('p', {}, 'Add a client, give it projects, and every hour you track lands in the right invoice.'),
        el('button.btn.btn-primary', { onclick: () => openClientForm() }, 'Add your first client')
      ));
      return;
    }

    for (const client of active) body.append(clientCard(client));

    if (archived.length) {
      body.append(el('button.btn.btn-ghost.btn-slim.archive-toggle', {
        html: icon(showArchived ? 'chevD' : 'chevR', 15, 2),
        'aria-expanded': showArchived ? 'true' : 'false',
        onclick: () => { showArchived = !showArchived; keepFocus(body, render); },
      }, ` Archived clients (${archived.length})`));
      if (showArchived) {
        for (const client of archived) body.append(clientCard(client, { archived: true }));
      }
    }
  }

  function clientCard(client, { archived = false } = {}) {
    // All projects, active first: an archived project of an active client
    // must stay visible here, or there is no way to restore it.
    const projects = store.projectsOf(client.id, { includeArchived: true })
      .sort((a, b) => a.archived - b.archived);
    const card = el('section.card.client-card', { 'aria-label': client.name });

    // A client's money always renders in its own currency (or the
    // global default when it has none).
    const cur = client.currency || store.settings.currency;
    // A project without a rate of its own inherits the client rate, or the
    // global default when the client has none either; the row names the
    // level the rate really comes from.
    const inherited = rateAt(client.rate, todayISO()) != null ? 'Client rate' : 'Default rate';
    const u = unbilled.get(client.id);
    card.append(el('div.client-head', {},
      colorDot(client.slot, 12),
      el('div.grow', {},
        el('h2.client-name', {}, client.name),
        el('p.client-sub', {}, rateText(client.rate, `Default rate (${fmtMoney(rateAt(store.settings.defaultRate, todayISO()) || 0, cur)}/h)`, cur))
      ),
      // Unbilled money, and how long it has been waiting: the age is what
      // separates work about to be billed from work quietly going stale.
      !archived && u && u.seconds > 0 && el('div.client-unbilled', {},
        el('div.client-unbilled-amt', {}, fmtMoney(u.amount, cur)),
        el('div.client-unbilled-label', {},
          `Unbilled · ${fmtDuration(u.seconds)}`,
          u.oldest && el('span', {
            className: `client-unbilled-age${daysApart(u.oldest, todayISO()) >= staleDays() ? ' stale' : ''}`,
          }, ` · ${ageText(u.oldest)}`)
        )
      ),
      !archived && el('button.icon-btn', {
        html: icon('pencil', 17, 2), 'aria-label': `Edit ${client.name}`,
        onclick: () => openClientForm({ client }),
      }),
      el('button.icon-btn', {
        html: icon(archived ? 'unarchive' : 'archive', 17, 2),
        'aria-label': archived ? `Restore ${client.name}` : `Archive ${client.name}`,
        title: archived ? 'Restore client' : 'Archive client (history stays)',
        onclick: () => archive(store.archiveClient(client.id, !archived), { restoring: archived }),
      })
    ));

    if (projects.length) {
      card.append(el('div.project-list', {},
        projects.map((p) => el('div.project-row', {},
          el('div.grow', {},
            el('div.project-name', {},
              p.name,
              !p.billable && el('span.chip.chip-plain', {}, 'Non-billable'),
              p.archived && el('span.chip.chip-plain', {}, 'Archived')
            ),
            el('div.project-sub', {}, p.billable ? rateText(p.rate, inherited, cur) : 'Internal work'),
            budgets.has(p.id) && budgetLine(budgets.get(p.id), cur)
          ),
          // An archived client's projects are managed by restoring the
          // client (which restores them all); a project restored on its
          // own would belong to an archived client and appear nowhere.
          !archived && !p.archived && el('button.icon-btn', {
            html: icon('pencil', 16, 2), 'aria-label': `Edit ${p.name}`,
            onclick: () => openProjectForm({ project: p }),
          }),
          !archived && el('button.icon-btn', {
            html: icon(p.archived ? 'unarchive' : 'archive', 16, 2),
            'aria-label': p.archived ? `Restore ${p.name}` : `Archive ${p.name}`,
            title: p.archived ? 'Restore project' : 'Archive project (history stays)',
            onclick: () => archive(store.archiveProject(p.id, !p.archived), { restoring: p.archived }),
          })
        ))
      ));
    }

    if (!archived) {
      card.append(el('button.btn.btn-ghost.btn-slim.add-project', {
        html: icon('plus', 15, 2.2),
        onclick: () => openProjectForm({ clientId: client.id }),
      }, ' Add project'));
    }

    return card;
  }

  /* Budget bar with the words carrying the state (never color alone). */
  function budgetLine(prog, cur) {
    const pct = Math.round(prog.ratio * 100);
    const fmt = (v) => (prog.kind === 'hours' ? fmtDuration(v) : fmtMoney(v, cur));
    const status = prog.ratio >= 1 ? 'over' : prog.ratio >= 0.8 ? 'warn' : '';
    const statusText = status === 'over' ? ' · over budget' : status === 'warn' ? ' · close to budget' : '';
    return el('div.budget-line', {},
      el('div.budget-track', { 'aria-hidden': 'true' },
        el('div', {
          className: `budget-bar${status ? ` ${status}` : ''}`,
          style: { width: `${Math.min(100, Math.max(2, pct))}%` },
        })),
      el('div.budget-text', {},
        status && el('span.budget-flag', { className: `budget-flag ${status}`, html: icon('alert', 12, 2.6) }),
        `${fmt(prog.spent)} of ${fmt(prog.value)}${prog.period === 'monthly' ? ' this month' : ''} · ${pct}%${statusText}`
      )
    );
  }

  const onChange = () => {
    render();
    refreshStats();
  };
  store.addEventListener('change', onChange);
  render();
  refreshStats();

  root.destroy = () => store.removeEventListener('change', onChange);
  return root;
}
