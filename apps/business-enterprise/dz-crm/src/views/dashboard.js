import { el, clear, append, keepingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import {
  weightedPipeline, pipelineValue, wonInMonth, winRate, stageSummary, isTerminalStage,
  stalledDeals, daysInStage, goalProgress,
} from '../lib/forecast.js';
import { recurringSummary, pipelineMRR } from '../lib/recurring.js';
import { touchProgress } from '../lib/activity.js';
import { goingCold, noNextStep, noDecisionMaker } from '../lib/attention.js';
import {
  todayISO, monthKey, shiftMonthKey, compactMoney, formatMonth, sinceLabel,
} from '../lib/util.js';
import {
  pageHead, emptyState, statTile, taskRow, activityRow, section, stageBadge, avatar,
} from '../ui/bits.js';
import { openContactForm, openDealForm, openTaskForm, openActivityForm } from '../ui/forms.js';
import { openOnboarding } from '../ui/onboarding.js';

/** Rows the attention list shows before it says how many it is holding back. */
const ATTENTION_MAX = 6;

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** One drifting lead, with the two actions that revive it. */
function coldRow({ contact, lastAt }) {
  return el('div.cold-row', {},
    avatar(contact.name),
    el('a.grow.min0', { href: `#/leads?id=${contact.id}` },
      el('div.person-name', {}, contact.name),
      el('div.person-sub', {}, lastAt
        ? `Last touch ${sinceLabel(lastAt).text}`
        : `No contact logged · added ${sinceLabel(todayISO(new Date(contact.createdAt))).text}`)
    ),
    el('button.icon-btn', {
      html: icon('video', 17, 2),
      'aria-label': `Log an activity with ${contact.name}`,
      title: 'Log activity',
      onclick: () => openActivityForm(null, {
        presets: { contactId: contact.id, companyId: contact.companyId },
      }),
    }),
    el('button.icon-btn', {
      html: icon('followups', 17, 2),
      'aria-label': `Add a follow-up for ${contact.name}`,
      title: 'Add follow-up',
      onclick: () => openTaskForm(null, { presets: { contactId: contact.id } }),
    })
  );
}

export function dashboardView() {
  const root = el('div.view');
  const body = el('div');

  function render() {
    clear(body);
    const { currency, stageProbabilities: overrides } = store.settings;
    const stageList = store.stages();

    const hasAnything = store.deals.length || store.contacts.length || store.companies.length;
    if (!hasAnything) {
      body.append(emptyState({
        icon: 'dashboard',
        title: 'Let’s get you selling',
        message: 'Add the people you’re talking to and the deals in play, and this page becomes your morning briefing: what’s due, what moved, and what the pipeline is worth.',
        action: el('div.empty-actions', {},
          el('button.btn.btn-primary', { onclick: () => openContactForm() }, 'Add a lead'),
          el('button.btn.btn-ghost', { onclick: openOnboarding }, 'Show me around')
        ),
      }));
      return;
    }

    const today = todayISO();
    const thisMonth = monthKey();
    const open = store.deals.filter((d) => !isTerminalStage(d.stage));
    const prevMonth = shiftMonthKey(thisMonth, -1);
    const wonNow = wonInMonth(store.deals, thisMonth);
    const wonPrev = wonInMonth(store.deals, prevMonth);
    const rate = winRate(store.deals);
    const goal = goalProgress(store.deals, store.settings.revenueGoal, thisMonth);
    /* Recurring revenue: committed MRR from won contracts still inside
       their term, plus what is still in play. The tile only appears once
       there is a subscription to report - a book of one-time deals has
       nothing to say here and doesn't need a fifth empty number. */
    const recurring = recurringSummary(store.deals, thisMonth);
    const openRecurring = pipelineMRR(store.deals);
    const showRecurring = recurring.count > 0 || openRecurring.count > 0;
    /* Touches this week against the weekly target - the number a founder
       can still do something about today. Only with a target set: without
       one the count is a fact, not progress. */
    const touches = touchProgress(store.activities, store.settings.touchTargets, today);

    const openTasks = store.openTasks();
    const needsAttention = openTasks.filter((t) => t.due <= today);
    const upcoming = openTasks.filter((t) => t.due > today).slice(0, 3);
    const stalled = stalledDeals(store.deals, store.settings.staleDays).slice(0, 3);
    const coldDays = store.settings.coldDays;
    const cold = goingCold(store.contacts, (id) => store.lastContactedAt(id), { coldDays }).slice(0, 4);
    const nextless = noNextStep(store.deals, {
      lastTouchOf: (d) => store.lastTouchedDeal(d),
      hasOpenTask: (id) => store.hasOpenTask(id),
      coldDays,
    }).slice(0, 3);
    /* Deals with nobody named as the person who signs. Only worth raising
       once the book has people on its deals at all - on a fresh account
       every deal would qualify, which is noise, not attention. */
    const anyRole = store.deals.some((d) => (d.contacts || []).some((e) => e.role));
    const undecided = anyRole ? noDecisionMaker(store.deals).slice(0, 3) : [];

    /* Won delta vs last month - only when last month had something to compare
       to. The month is named the way the tile's own label names this one:
       "vs Jul", not "vs Jul 2026" beside "Won in Aug". The year comes back in
       January, where last month really is a different one - and dropping it
       the rest of the time keeps the line off a second row on a phone. */
    const delta = wonPrev > 0
      ? { good: wonNow >= wonPrev, text: `${wonNow >= wonPrev ? '+' : '-'}${compactMoney(Math.abs(wonNow - wonPrev), currency)} vs ${formatMonth(prevMonth, { year: 'auto' })}` }
      : null;

    const stages = stageSummary(open, overrides, stageList).filter((s) => !isTerminalStage(s.stage));
    const maxStage = Math.max(...stages.map((s) => s.value), 1);

    append(body, [
      el('div.stat-grid', {
        className: `stat-grid${showRecurring || touches.pace ? ' wide' : ''}`,
      },
        statTile({
          label: 'Open pipeline',
          value: compactMoney(pipelineValue(store.deals), currency),
          sub: `${open.length} deal${open.length === 1 ? '' : 's'} in play`,
        }),
        // The unit lives in the label, not the value: a "/mo" suffix on the
        // number is the character that tipped "$3,000/mo" into an ellipsis
        // in a phone-width tile.
        showRecurring && statTile({
          label: 'MRR',
          value: compactMoney(recurring.mrr, currency),
          sub: recurring.count
            ? `${compactMoney(recurring.arr, currency)} ARR · ${recurring.count} contract${recurring.count === 1 ? '' : 's'}`
            : `${compactMoney(openRecurring.mrr, currency)}/mo still in open deals`,
        }),
        statTile({
          label: 'Weighted forecast',
          value: compactMoney(weightedPipeline(store.deals, overrides, stageList), currency),
          sub: 'probability-adjusted',
        }),
        goal.pace
          // With a goal set, the won tile answers "against what?" - amount,
          // share of target, and whether that share is ahead of the calendar.
          ? statTile({
              label: `Won in ${formatMonth(thisMonth, { year: 'auto' })}`,
              value: compactMoney(wonNow, currency),
              progress: {
                pct: goal.pct,
                tone: goal.pace === 'met' ? 'good' : goal.pace === 'behind' ? 'warn' : '',
                label: `${Math.round(goal.pct * 100)}% of the ${compactMoney(goal.goal, currency)} goal`,
              },
              sub: el('span', {},
                `${Math.round(goal.pct * 100)}% of ${compactMoney(goal.goal, currency)} · `,
                el('span', {
                  className: `stat-pace ${goal.pace === 'behind' ? 'warn' : 'good'}`,
                }, goal.pace === 'met' ? 'goal met'
                  : goal.pace === 'on-track' ? 'on track'
                  : `${compactMoney(goal.gap, currency)} behind pace`)
              ),
            })
          : statTile({
              label: `Won in ${formatMonth(thisMonth, { year: 'auto' })}`,
              value: compactMoney(wonNow, currency),
              delta,
              sub: delta ? null : 'closed this month',
            }),
        statTile({
          label: 'Win rate',
          value: rate.rate === null ? 'n/a' : `${Math.round(rate.rate * 100)}%`,
          sub: rate.rate === null ? 'no closed deals yet' : `over ${rate.won + rate.lost} closed`,
        }),
        touches.pace && statTile({
          label: 'Touches this week',
          value: `${touches.logged} of ${touches.target}`,
          progress: {
            pct: touches.pct,
            tone: touches.pace === 'met' ? 'good' : touches.pace === 'behind' ? 'warn' : '',
            label: `${touches.logged} of ${touches.target} logged`,
          },
          // No link in the sub: at six tiles the line is narrow, and
          // "activity log" wrapped onto a row of its own for a
          // destination the nav already offers.
          sub: el('span', {
            className: `stat-pace ${touches.pace === 'behind' ? 'warn' : 'good'}`,
          }, touches.pace === 'met' ? 'target met'
            : touches.pace === 'on-track' ? 'on track'
            : `${touches.gap} behind pace`),
        })
      ),

      section('Needs attention',
        el('a.btn.btn-ghost.btn-sm', { href: '#/followups' }, 'All follow-ups'),
        needsAttention.length
          ? el('div.task-list', {}, needsAttention.slice(0, ATTENTION_MAX).map((t) =>
              taskRow(t, { onEdit: (task) => openTaskForm(task) })))
          : el('div.all-clear', { html: icon('check', 18, 2.4) },
              el('span', {}, 'Nothing overdue or due today.')),
        // The cap keeps this page scannable, but it must not read as the
        // whole answer. Follow-ups come soonest-first, so a founder ten
        // days behind saw the ten oldest and nothing else - today's work
        // included - under a heading that claims to be what needs them now.
        needsAttention.length > ATTENTION_MAX && el('div.list-more-note', {},
          `${needsAttention.length - ATTENTION_MAX} more overdue or due today`),
        upcoming.length > 0 && el('div.upnext', {},
          el('span.upnext-label', {}, 'Up next'),
          el('div.task-list', {}, upcoming.map((t) => taskRow(t, { onEdit: (task) => openTaskForm(task) })))
        ),
        /* Deals nobody has moved in a while: the other half of "what needs
           me today", and invisible until now. */
        /* Who signs? A deal can look busy - calls logged, follow-ups
           booked - while nobody has named the person who can say yes. */
        undecided.length > 0 && el('div.upnext', {},
          el('span.upnext-label', {}, 'No decision maker named'),
          el('div.deal-list.flush', {}, undecided.map(({ deal }) =>
            el('div.deal-row', {},
              el('a.grow.min0', { href: `#/pipeline?id=${deal.id}` },
                el('div.deal-row-name', {}, deal.name),
                el('div.person-sub', {},
                  store.companyById(deal.companyId)?.name
                  || store.contactById(deal.contactId)?.name || 'No linked record')
              ),
              el('button.btn.btn-ghost.btn-sm', {
                html: icon('userPlus', 14, 2),
                onclick: () => openDealForm(deal),
              }, ' Add')
            )))
        ),
        stalled.length > 0 && el('div.upnext', {},
          el('span.upnext-label', {}, 'Stalled deals'),
          el('div.deal-list.flush', {}, stalled.map((d) =>
            el('a.deal-row', { href: `#/pipeline?id=${d.id}` },
              el('div.grow.min0', {},
                el('div.deal-row-name', {}, d.name),
                el('div.person-sub', {},
                  store.companyById(d.companyId)?.name
                  || store.contactById(d.contactId)?.name || 'No linked record')
              ),
              el('span.age-pill', { dataset: { tone: 'stalled' } },
                el('span', { html: icon('clock', 12, 2.2), 'aria-hidden': 'true' }),
                `${daysInStage(d)}d in ${stageList.find((s) => s.id === d.stage)?.label || d.stage}`)
            )))
        )
      ),

      /* Going cold: the risk nobody scheduled. Needs attention covers what
         you promised to do; this covers what you forgot to. */
      (cold.length > 0 || nextless.length > 0) && section('Going cold',
        el('a.btn.btn-ghost.btn-sm', { href: '#/leads' }, 'All leads'),
        cold.length > 0 && el('div.cold-list', {}, cold.map((r) => coldRow(r))),
        nextless.length > 0 && el('div.upnext', {},
          el('span.upnext-label', {}, 'Open deals with no next step'),
          el('div.deal-list.flush', {}, nextless.map((r) =>
            el('div.deal-row', {},
              el('a.grow.min0', { href: `#/pipeline?id=${r.deal.id}` },
                el('div.deal-row-name', {}, r.deal.name),
                el('div.person-sub', {}, r.lastAt
                  ? `Last touch ${sinceLabel(r.lastAt).text} · no follow-up scheduled`
                  : 'Nothing logged, nothing scheduled')
              ),
              el('button.btn.btn-ghost.btn-sm', {
                html: icon('followups', 14, 2),
                onclick: () => openTaskForm(null, {
                  presets: { dealId: r.deal.id, contactId: r.deal.contactId },
                }),
              }, ' Follow up')
            )))
        )
      ),

      el('div.two-col', {},
        section('Pipeline at a glance',
          el('a.btn.btn-ghost.btn-sm', { href: '#/pipeline' }, 'Open board'),
          open.length
            ? el('div.stage-bars', {}, stages.map((s) => el('div.stage-bar-row', {},
                stageBadge(s.stage),
                el('div.stage-bar-track', {},
                  el('div.stage-bar-fill', {
                    style: { width: `${s.count ? Math.max(2, (s.value / maxStage) * 100) : 0}%` },
                  })),
                el('span.stage-bar-value', {},
                  s.count ? compactMoney(s.value, currency) : '–',
                  el('span.stage-bar-sub', {}, ` · ${s.count}`))
              )))
            : el('p.card-empty', {}, 'No open deals. ',
                el('button.btn-inline', { onclick: () => openDealForm() }, 'Add one'), '.')
        ),
        section('Recent activity',
          el('button.btn.btn-ghost.btn-sm', {
            html: icon('plus', 14, 2.2),
            onclick: () => openActivityForm(),
          }, ' Log'),
          store.activities.length
            ? el('div.activity-list', {}, store.recentActivities(5).map((a) =>
                activityRow(a, { onEdit: (act) => openActivityForm(act) })))
            : el('p.card-empty', {}, 'Meetings, calls, and notes you log show up here.')
        )
      ),
    ]);
  }

  const renderOnChange = keepingFocus(render);
  store.addEventListener('change', renderOnChange);
  render();

  const username = store.user?.username;
  root.append(
    pageHead(username ? `${greeting()}, ${username}` : greeting()),
    body
  );
  root.destroy = () => store.removeEventListener('change', renderOnChange);
  return root;
}
