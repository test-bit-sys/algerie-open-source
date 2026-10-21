import { el, clear, append, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import {
  forecastByMonth, weightedPipeline, pipelineValue, stageSummary,
  winRate, avgSalesCycle, isTerminalStage, stageVelocity, isOpen,
  closeReasonBreakdown, winRateBy, avgClosedValue, goalProgress, pipelineCoverage,
} from '../lib/forecast.js';
import { formatMonth, formatMoney, compactMoney } from '../lib/util.js';
import { isRecurring } from '../lib/recurring.js';
import { monthlyFlows, winRateTrend, salesCycleTrend } from '../lib/trends.js';
import { funnelReport, FUNNEL_WINDOWS, matchesFunnelWindow } from '../lib/funnel.js';
import { pageHead, emptyState, statTile, section, stageBadge } from '../ui/bits.js';
import { forecastChart } from '../charts/forecast-chart.js';
import { flowsChart, miniTrend } from '../charts/trends-chart.js';
import { funnelChart } from '../charts/funnel-chart.js';
import { openDealForm } from '../ui/forms.js';

const HORIZON = 6;

/** One side of the why-deals-close comparison: reasons ranked by count. */
function reasonColumn(title, tone, breakdown, max, currency) {
  const total = breakdown.rows.reduce((n, r) => n + r.count, 0);
  return el('div.wl-col', {},
    el('h3.wl-col-title', {},
      el('span.stage-badge', { dataset: { stage: tone } },
        el('span.stage-dot', { 'aria-hidden': 'true' }), title),
      el('span.wl-col-count', {}, `${total} with a reason`)
    ),
    breakdown.rows.length
      ? el('div.stage-bars', {}, breakdown.rows.map((r) => el('div.wl-bar-row', {},
          el('span.wl-bar-label', {}, r.reason),
          el('div.stage-bar-track', {},
            el('div.stage-bar-fill', {
              className: `stage-bar-fill ${tone}`,
              style: { width: `${Math.max(4, (r.count / max) * 100)}%` },
            })),
          el('span.stage-bar-value', {}, String(r.count),
            el('span.stage-bar-sub', {}, ` · ${compactMoney(r.value, currency)}`))
        )))
      : el('p.card-empty.flush', {}, breakdown.unrecorded
          ? 'No reasons recorded yet.'
          : `Nothing ${tone} yet.`)
  );
}

/** Win rate for one grouping (lead source, industry…), most-closed first. */
function rateTable(label, rows, currency) {
  return el('div.wl-table', {},
    el('h3.wl-col-title', {}, label),
    el('div.table-wrap.flush', {},
      el('table.data-table', {},
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, label),
          el('th.num', { scope: 'col' }, 'Won'),
          el('th.num', { scope: 'col' }, 'Lost'),
          el('th.num', { scope: 'col' }, 'Win rate'),
          el('th.num', { scope: 'col' }, 'Won value')
        )),
        el('tbody', {}, rows.map((r) => el('tr', {},
          el('th', { scope: 'row' }, r.key),
          el('td.num', {}, String(r.won)),
          el('td.num', {}, String(r.lost)),
          el('td.num', {}, `${Math.round(r.rate * 100)}%`),
          el('td.num', {}, r.wonValue ? formatMoney(r.wonValue, currency) : '–')
        )))
      )
    )
  );
}

export function forecastView() {
  const root = el('div.view');
  const body = el('div');
  /* The conversion cohort: which deals the funnel below is about. Kept on
     the view so switching it doesn't reset the page. */
  let cohort = 'all';

  function render() {
    clear(body);
    const { currency, stageProbabilities: overrides } = store.settings;
    const stageList = store.stages();
    const open = store.deals.filter((d) => !isTerminalStage(d.stage));

    if (!store.deals.length) {
      body.append(emptyState({
        icon: 'chart',
        title: 'Nothing to forecast yet',
        message: 'Give each deal a value and an expected close date, and this page turns your pipeline into a month-by-month revenue forecast.',
        action: el('button.btn.btn-primary', { onclick: () => openDealForm() }, 'Add a deal'),
      }));
      return;
    }

    const rows = forecastByMonth(store.deals, { months: HORIZON, overrides, stages: stageList });
    const weighted = weightedPipeline(store.deals, overrides, stageList);
    const goal = goalProgress(store.deals, store.settings.revenueGoal);
    const coverage = pipelineCoverage(weighted, goal.remaining);
    const rate = winRate(store.deals);
    const cycle = avgSalesCycle(store.deals);

    /* Per-stage contribution: how the weighted number is built. */
    const stages = stageSummary(open, overrides, stageList).filter((s) =>
      !isTerminalStage(s.stage) && s.count > 0);
    const maxStage = Math.max(...stages.map((s) => s.weighted), 1);

    const velocity = stageVelocity(store.deals, stageList);
    const maxVelocity = Math.max(...velocity.map((v) => v.days || 0), 1);

    /* Trajectory: everything derived at render time from createdAt,
       closedAt, and values - no snapshots, no new stored data. */
    const flows = monthlyFlows(store.deals);
    const anyFlow = flows.some((r) => r.added.count || r.won.count || r.lost.count);
    const rateTrend = winRateTrend(flows);
    const cycleTrend = salesCycleTrend(store.deals);

    /* Win/loss analysis over everything that has closed. */
    const closed = store.deals.filter((d) => !isOpen(d));
    const wonReasons = closeReasonBreakdown(closed, 'won');
    const lostReasons = closeReasonBreakdown(closed, 'lost');
    const maxReason = Math.max(
      ...wonReasons.rows.map((r) => r.count), ...lostReasons.rows.map((r) => r.count), 1);
    const averages = avgClosedValue(closed);
    const bySource = winRateBy(closed, (d) => store.contactById(d.contactId)?.source);
    const byIndustry = winRateBy(closed, (d) => store.companyById(d.companyId)?.industry);

    append(body, [
      el('div.stat-grid', { className: `stat-grid${coverage === null ? '' : ' wide'}` },
        statTile({
          label: 'Weighted pipeline',
          value: compactMoney(weighted, currency),
          sub: 'value × stage probability',
        }),
        coverage !== null && statTile({
          label: 'Goal coverage',
          value: `${coverage}×`,
          sub: `weighted vs ${compactMoney(goal.remaining, currency)} left this month`,
        }),
        statTile({
          label: 'Best case',
          value: compactMoney(pipelineValue(store.deals), currency),
          sub: `${open.length} open deal${open.length === 1 ? '' : 's'}`,
        }),
        statTile({
          label: 'Win rate',
          value: rate.rate === null ? 'n/a' : `${Math.round(rate.rate * 100)}%`,
          sub: rate.rate === null ? 'no closed deals yet' : `${rate.won} won · ${rate.lost} lost`,
        }),
        statTile({
          label: 'Sales cycle',
          value: cycle === null ? 'n/a' : `${cycle}d`,
          sub: cycle === null ? 'closes a deal to learn this' : 'average, created to won',
        })
      ),

      section(`Next ${HORIZON} months`, null,
        el('div.settings-body', {},
          forecastChart(rows, currency, { goal: goal.goal }),
          // Say it where the shape of the chart depends on it: a
          // subscription is not a spike in its close month.
          store.deals.some(isRecurring) && el('p.settings-note.mt-sm', {},
            'Recurring deals are spread across the months they bill, not booked whole in the month they close.')
        )
      ),

      section('Month by month', null,
        el('div.table-wrap', {},
          el('table.data-table', {},
            el('thead', {}, el('tr', {},
              el('th', { scope: 'col' }, 'Month'),
              el('th.num', { scope: 'col' }, 'Deals'),
              el('th.num', { scope: 'col' }, 'Best case'),
              el('th.num', { scope: 'col' }, 'Weighted'),
              el('th.num', { scope: 'col' }, 'Won')
            )),
            el('tbody', {}, rows.map((r) => el('tr', {},
              el('th', { scope: 'row' }, formatMonth(r.key)),
              el('td.num', {}, String(r.count)),
              el('td.num', {}, formatMoney(r.best, currency)),
              el('td.num', {}, formatMoney(r.weighted, currency)),
              el('td.num', {}, r.won ? formatMoney(r.won, currency) : '–')
            )))
          )
        )
      ),

      /* The trajectory: is the top of the funnel keeping up with the
         bottom? Visible months before it hits revenue. */
      anyFlow && section('Pipeline trends · last 12 months', null,
        el('div.settings-body', {},
          flowsChart(flows, currency),
          el('div.trend-minis', {},
            el('div', {},
              el('h3.wl-col-title', {}, 'Win rate by close month'),
              miniTrend(rateTrend.map((r) => ({
                key: r.key,
                value: r.rate === null ? null : Math.round(r.rate * 100),
              })), {
                format: (v) => `${v}%`,
                series: 'Win rate',
                ariaLabel: 'Win rate by close month',
              })
            ),
            el('div', {},
              el('h3.wl-col-title', {}, 'Sales cycle by close month'),
              miniTrend(cycleTrend.map((r) => ({ key: r.key, value: r.days })), {
                format: (v) => `${v}d`,
                series: 'Created → won, average',
                ariaLabel: 'Average sales cycle by close month',
              })
            )
          ),
          el('p.settings-note.mt-sm', {},
            'Added counts deals by the month they were created, whatever became of them; won, lost, win rate, and cycle length go by the month deals closed.')
        )
      ),

      /* Where deals leak. Win rate says how often you close; this says
         which step loses them, which is the number that changes how you
         sell. Everything here is derived from stageHistory at render
         time. */
      (() => {
        const cohortDeals = store.deals.filter((d) => matchesFunnelWindow(d, cohort));
        const funnel = funnelReport(cohortDeals, stageList);
        const worst = [...funnel.rows].sort((a, b) => b.lostHere - a.lostHere)[0];
        const anyJourney = funnel.rows.some((r) => r.entered > 0);

        const windowSelect = el('select.select', {
          'aria-label': 'Which deals the funnel covers',
          dataset: { focusKey: 'funnel-window' },
          onchange: keepingFocus((e) => { cohort = e.target.value; render(); }),
        }, FUNNEL_WINDOWS.map((w) =>
          el('option', { value: w.value, selected: w.value === cohort }, w.label)));

        return section('Conversion',
          el('div.select-wrap.close-window', {}, windowSelect),
          el('div.settings-body', {},
            anyJourney
              ? el('div', {},
                  el('div.funnel-summary', {},
                    el('div.funnel-summary-item', {},
                      el('span.stat-label', {}, 'Entry to won'),
                      el('span.funnel-summary-value', {},
                        funnel.totals.wonRate === null ? 'n/a'
                          : `${Math.round(funnel.totals.wonRate * 100)}%`),
                      el('span.stat-sub', {},
                        `${funnel.totals.won} of ${funnel.totals.deals} deal${funnel.totals.deals === 1 ? '' : 's'} that entered`
                        + (funnel.totals.open ? ` · ${funnel.totals.open} still open` : ''))
                    ),
                    worst?.lostHere > 0 && el('div.funnel-summary-item', {},
                      el('span.stat-label', {}, 'Most losses'),
                      el('span.funnel-summary-value', {}, worst.label),
                      el('span.stat-sub', {},
                        `${worst.lostHere} deal${worst.lostHere === 1 ? '' : 's'} died here`
                        + (worst.lossShare ? ` · ${Math.round(worst.lossShare * 100)}% of all losses` : ''))
                    )
                  ),
                  funnelChart(funnel.rows, stageList),
                  el('p.settings-note.mt-sm', {},
                    'A deal counts as reaching a stage only if it was actually in it, and as advancing only if it later went further. ',
                    funnel.untracked > 0
                      ? `${funnel.untracked} deal${funnel.untracked === 1 ? '' : 's'} closed before stage tracking began and ${funnel.untracked === 1 ? 'is' : 'are'} left out rather than counted as instant conversions.`
                      : 'Deals still in play are counted where they sit, not as losses.')
                )
              : el('p.card-empty.flush', {}, cohort === 'all'
                  ? 'No stage history yet. Move a deal through the board and this fills in.'
                  : 'No deal entered the funnel in that period. Try a wider one.')
          )
        );
      })(),

      /* How long each stage actually takes, from accumulated history. */
      velocity.some((v) => v.days !== null) && section('Time in each stage', null,
        el('div.settings-body', {},
          el('div.stage-bars', {}, velocity.map((v) => el('div.stage-bar-row', {},
            stageBadge(v.stage, stageList),
            el('div.stage-bar-track', {},
              v.days !== null && el('div.stage-bar-fill', {
                style: { width: `${Math.max(2, (v.days / maxVelocity) * 100)}%` },
              })),
            el('span.stage-bar-value', {},
              v.days === null ? '–' : `${v.days}d`,
              el('span.stage-bar-sub', {}, v.count
                ? ` · ${v.count} deal${v.count === 1 ? '' : 's'}`
                : ' · no data yet'))
          ))),
          el('p.settings-note.mt-sm', {},
            'Average days a deal spent in each stage before moving on. Deals still sitting in a stage aren’t counted until they move.')
        )
      ),

      /* Win/loss analysis: only worth a section once something has closed. */
      closed.length > 0 && section('Why deals close', null,
        el('div.settings-body', {},
          el('div.wl-cols', {},
            reasonColumn('Won', 'won', wonReasons, maxReason, currency),
            reasonColumn('Lost', 'lost', lostReasons, maxReason, currency)
          ),
          el('div.wl-averages', {},
            el('div.wl-average', {},
              el('span.stat-label', {}, 'Average won'),
              el('span.wl-average-value', {}, averages.won === null ? '–' : formatMoney(averages.won, currency))),
            el('div.wl-average', {},
              el('span.stat-label', {}, 'Average lost'),
              el('span.wl-average-value', {}, averages.lost === null ? '–' : formatMoney(averages.lost, currency)))
          ),
          (wonReasons.unrecorded + lostReasons.unrecorded) > 0 && el('p.settings-note.mt-sm', {},
            `${wonReasons.unrecorded + lostReasons.unrecorded} closed deal${wonReasons.unrecorded + lostReasons.unrecorded === 1 ? '' : 's'} with no reason recorded. Add one from the deal page to sharpen this.`)
        )
      ),

      (bySource.length > 0 || byIndustry.length > 0) && section('Where wins come from', null,
        el('div.settings-body', {},
          bySource.length > 0 && rateTable('Lead source', bySource, currency),
          byIndustry.length > 0 && rateTable('Company industry', byIndustry, currency)
        )
      ),

      stages.length > 0 && section('Where the weighted number comes from', null,
        el('div.settings-body', {},
          el('div.stage-bars', {}, stages.map((s) => el('div.stage-bar-row', {},
            stageBadge(s.stage, stageList),
            el('div.stage-bar-track', {},
              el('div.stage-bar-fill', { style: { width: `${Math.max(2, (s.weighted / maxStage) * 100)}%` } })),
            el('span.stage-bar-value', {},
              `${compactMoney(s.weighted, currency)}`,
              el('span.stage-bar-sub', {}, ` of ${compactMoney(s.value, currency)}`))
          ))),
          el('p.settings-note.mt-sm', {},
            'Weights per stage can be tuned in Settings as you learn your real conversion rates.')
        )
      ),
    ]);
  }

  const renderOnChange = keepingFocus(render);
  store.addEventListener('change', renderOnChange);
  render();

  root.append(pageHead('Forecast'), body);
  root.destroy = () => store.removeEventListener('change', renderOnChange);
  return root;
}
