import { el, clear, append, keepingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import {
  isOpen, probabilityOf, daysInStage, isStalled, stageEnteredAt,
  isTerminalStage, matchesCloseWindow, CLOSE_WINDOWS, confidenceLabel,
} from '../lib/forecast.js';
import {
  compactMoney, formatDate, dueLabel, timeAgo, todayISO, fuzzyIncludes, sinceLabel,
} from '../lib/util.js';
import {
  contractValue, isRecurring, rateText, contractText, termText, billingLabel,
} from '../lib/recurring.js';
import {
  dealContactIds, roleLabel, roleOf, hasDecisionMaker, DECIDER_ROLE,
} from '../lib/deal-contacts.js';
import {
  pageHead, emptyState, stageBadge, contactChip, companyChip, searchBox,
  activityRow, taskRow, moneyText, section, deletedToast, avatar,
} from '../ui/bits.js';
import { openDealForm, openActivityForm, openTaskForm } from '../ui/forms.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { maybeNudgeNextStep } from '../ui/nudge.js';
import { openCloseReasonForm, closeReasonChip } from '../ui/close-reason.js';
import { hasTag } from '../lib/tags.js';
import { tagFilterControl, tagVocabulary } from '../ui/tag-input.js';
import { customFilterControls, customFieldRows, fieldFilterLabel } from '../ui/custom-fields.js';
import { matchesCustomFilters, activeFieldFilters, fieldSignature } from '../lib/fields.js';
import { viewChips, startingFilters } from '../ui/views.js';
import { DEFAULT_DEAL_SORT, dealSortLabel } from '../lib/views.js';
import {
  rowSelection, selectBox, bulkBar, pickSheet, openBulkTagSheet,
  confirmBulkDelete, bulkToast,
} from '../ui/bulk.js';
import { exportRecords } from '../lib/csv.js';
import { exportContext } from '../ui/csv.js';
import { downloadFile } from '../ui/download.js';
import { openEmailFlow } from '../ui/email.js';
import { playbookButton, maybeOfferPlaybook } from '../ui/playbooks.js';
import { catchUpButton } from '../ui/ai.js';
import { attachmentsSection } from '../ui/attachments.js';

export function pipelineView({ params }) {
  const id = params.get('id');
  if (id) return dealDetail(id);
  return dealsView(params);
}

async function moveDealTo(deal, stage) {
  if (deal.stage === stage) return;
  const from = deal.stage;
  try {
    await store.moveDeal(deal.id, stage);
  } catch {
    toast('Couldn’t save the move. Check your connection', { icon: 'wifiOff' });
    return;
  }
  const undo = () => store.moveDeal(deal.id, from)
    .catch(() => toast('Couldn’t undo. Check your connection', { icon: 'wifiOff' }));
  if (stage !== 'won' && stage !== 'lost') {
    // A stage change is a promise of momentum; if nothing is booked to
    // keep it, offer the follow-up while the move is still in hand. A
    // playbook waiting on this stage is the better offer where there is
    // one - it books the whole cadence instead of one step - so the nudge
    // stands down for it rather than stacking a second dialog.
    const label = stageLabelOf(stage, store.stages());
    const moved = store.dealById(deal.id) || deal;
    if (maybeOfferPlaybook(moved, stage)) return;
    if (maybeNudgeNextStep({
      dealId: moved.id, contactId: moved.contactId,
      lead: `Now in ${label}`,
    })) return;
    // Neither offer had anything to say - the deal already has its next
    // step booked, or nudges are off - and the move went through in
    // silence. Every other change in the app says it landed and hands
    // back a way out; a drag across a board is the easiest of them all to
    // do by accident, and this one had none.
    toast(`Moved to ${label}`, {
      icon: 'pipeline',
      action: { label: 'Undo', onClick: undo },
    });
    return;
  }
  const done = () => (stage === 'won'
    ? toast(`${deal.name} won`, { icon: 'trophy', action: { label: 'Undo', onClick: undo } })
    : toast('Marked as lost', { icon: 'circleX', action: { label: 'Undo', onClick: undo } }));
  // Ask why while it is still fresh; the Undo toast waits its turn so the
  // two never fight over the bottom of the screen - and it is the
  // confirmation for this whole move, so the sheet doesn't raise its own.
  openCloseReasonForm(store.dealById(deal.id) || deal, { onClose: done, confirm: false });
}

/** Keyboard/touch alternative to drag & drop: pick the stage from a sheet. */
function openMoveSheet(deal) {
  const modal = openModal({
    title: 'Move deal',
    content: el('div.settings-list', {},
      store.stages().map((s) => el('button.settings-row', {
        type: 'button',
        'aria-current': deal.stage === s.id ? 'true' : null,
        onclick: async () => { modal.close(); await moveDealTo(deal, s.id); },
      },
        stageBadge(s.id),
        el('div.grow'),
        deal.stage === s.id && el('span.row-ic', { html: icon('check', 18, 2.2) })
      ))
    ),
  });
}

/* ---------- deals: board and list over one set of filters ---------- */

/** The name shown in the Company / contact column, or '' for the dash. */
const linkNameOf = (d) => store.companyById(d.companyId)?.name
  || store.contactById(d.contactId)?.name || '';

/* Sortable list columns. `get` feeds the comparator; `num`/`hide` shape the
   table so a phone shows the four columns that matter and a desktop all
   of them. `empty` marks a row the column has nothing to say about - see
   the comparator.

   The headings come from lib/views.js, which is also where a saved view
   looks up the name of the sort it stored - one list of words, so a view
   can never describe itself by a column heading this table doesn't use. */
const COLUMNS = [
  { key: 'name', get: (d) => d.name.toLowerCase(), text: true },
  { key: 'link', cls: 'col-link', text: true,
    get: (d) => linkNameOf(d).toLowerCase(), empty: (d) => !linkNameOf(d) },
  { key: 'stage', cls: 'col-stage',
    get: (d) => store.stages().findIndex((s) => s.id === d.stage) },
  // Contract value, so a $2k/mo subscription and a $10k one-off sort
  // against each other by what they are actually worth.
  { key: 'value', num: true, get: (d) => contractValue(d) },
  { key: 'expectedClose', cls: 'col-close', text: true,
    get: (d) => d.expectedClose || '', empty: (d) => !d.expectedClose },
  { key: 'updatedAt', cls: 'col-updated', num: true, get: (d) => d.updatedAt },
].map((c) => ({ ...c, label: dealSortLabel(c.key) }));

function dealsView(params) {
  const root = el('div.view');
  const controls = el('div');
  const viewRow = el('div');
  const body = el('div');
  const bulkWrap = el('div');

  let query = '';
  let stageFilter = 'open';         // 'all' | 'open' | a stage id
  let closeWindow = 'any';
  let tagsFilter = [];
  /* Choice and yes/no custom fields, ANDed with the rest: { [fieldId]: value }. */
  let fieldFilters = {};
  let sort = { ...DEFAULT_DEAL_SORT };
  let mode = store.settings.dealView === 'list' ? 'list' : 'board';
  // Closed columns stay collapsed while the board is focused on open work,
  // until the user asks to see one.
  const expanded = new Set();

  /* Search, close window, and tags narrow the deals; the stage chip decides
     which columns the board shows, so it is kept separate. */
  const matchesSearch = (d) => matchesCloseWindow(d, closeWindow)
    && tagsFilter.every((t) => hasTag(d.tags, t))
    && matchesCustomFilters(d, store.customFields('deals'), fieldFilters)
    && (!query
      || fuzzyIncludes(d.name, query)
      || fuzzyIncludes(store.companyById(d.companyId)?.name, query)
      // Any of the deal's people, not only the one who leads it: looking
      // for "the Priya deal" has to find it whoever is primary.
      || dealContactIds(d).some((id) => fuzzyIncludes(store.contactById(id)?.name, query))
      || fuzzyIncludes(d.notes, query));

  const matchesStage = (d) => stageFilter === 'all'
    || (stageFilter === 'open' ? isOpen(d) : d.stage === stageFilter);

  const filtered = () => store.deals.filter((d) => matchesStage(d) && matchesSearch(d));
  const activeFields = () => activeFieldFilters(store.customFields('deals'), fieldFilters);
  const filtersActive = () => query !== '' || closeWindow !== 'any' || stageFilter !== 'open'
    || tagsFilter.length > 0 || activeFields().length > 0;

  function clearFilters() {
    query = '';
    stageFilter = 'open';
    closeWindow = 'any';
    tagsFilter = [];
    fieldFilters = {};
    renderControls();
    render();
  }

  /* Everything a saved view remembers about this list, including the sort -
     "deals closing this month, biggest first" is one thought. */
  const currentFilters = () => ({
    query, stage: stageFilter, closeWindow, tags: tagsFilter, fields: fieldFilters, sort,
  });
  function adoptFilters(f) {
    query = f.query;
    stageFilter = f.stage;
    closeWindow = f.closeWindow;
    tagsFilter = f.tags;
    fieldFilters = f.fields;
    if (f.sort) sort = { ...f.sort };
    renderControls();
    render();
  }
  const start = startingFilters('deals', params);

  function renderViews() {
    clear(viewRow);
    append(viewRow, [viewChips({
      kind: 'deals',
      filters: currentFilters(),
      onApply: adoptFilters,
      onChanged: renderViews,
    })]);
  }

  /* ----- bulk selection (list view) ----- */

  const selection = rowSelection(() => render());

  function bulkActions() {
    const ids = () => selection.ids();
    const fail = () => toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
    return [
      {
        icon: 'pipeline', label: 'Stage',
        onClick: () => pickSheet('Move to stage',
          store.stages().map((s) => ({ value: s.id, node: stageBadge(s.id) })),
          async (v) => {
            try {
              const n = await store.bulkMoveDeals(ids(), v);
              selection.clear();
              bulkToast(n, 'Stage set', 'pipeline');
            } catch { fail(); }
          }),
      },
      {
        icon: 'tag', label: 'Tag',
        onClick: () => openBulkTagSheet(async (tag) => {
          try {
            const n = await store.bulkTag('deals', ids(), tag);
            selection.clear();
            bulkToast(n, `Tagged “${tag}”`, 'tag');
          } catch { fail(); }
        }),
      },
      {
        icon: 'fileDown', label: 'Export',
        onClick: () => {
          const records = store.deals.filter((d) => selection.has(d.id));
          downloadFile(`crm-deals-selection-${todayISO()}.csv`,
            `﻿${exportRecords('deals', records, exportContext())}`, 'text/csv');
          toast(`${records.length} deal${records.length === 1 ? '' : 's'} exported`, { icon: 'fileDown' });
        },
      },
      {
        icon: 'trash', label: 'Delete', danger: true,
        onClick: async () => {
          if (!await confirmBulkDelete(selection.size, selection.size === 1 ? 'deal' : 'deals')) return;
          try {
            const entries = await store.bulkDelete('deals', ids());
            selection.clear();
            toast(`${entries.length} deal${entries.length === 1 ? '' : 's'} deleted`, { icon: 'trash' });
          } catch { fail(); }
        },
      },
    ];
  }

  /* ----- controls: view toggle, search, close window, stage chips ----- */

  /**
   * A control that rebuilds the row it lives in needs the keyboard handed
   * back afterwards, the same way a store change does - a chip or a sort
   * header found again by the focus key its rebuilt copy still carries.
   */
  const refresh = (apply) => keepingFocus((...args) => { apply(...args); render(); });
  const refreshControls = (apply) => keepingFocus((...args) => {
    apply(...args);
    renderControls();
    render();
  });

  function renderControls() {
    clear(controls);
    const stages = store.stages();
    const chips = [
      { value: 'open', label: 'Open' },
      { value: 'all', label: 'All' },
      ...stages.map((s) => ({ value: s.id, label: s.label })),
    ];

    const search = searchBox({
      placeholder: 'Search deals, companies, notes…',
      value: query,
      oninput: (e) => { query = e.target.value.trim(); render(); },
    });

    const windowSelect = el('select.select', {
      'aria-label': 'Filter by expected close date',
      onchange: (e) => { closeWindow = e.target.value; render(); },
    }, CLOSE_WINDOWS.map((w) =>
      el('option', { value: w.value, selected: w.value === closeWindow }, w.label)));

    const filters = el('div.filter-row', { role: 'group', 'aria-label': 'Filter deals by stage' },
      chips.map((c) => el('button.filter-chip', {
        type: 'button',
        className: `filter-chip${stageFilter === c.value ? ' active' : ''}`,
        'aria-pressed': String(stageFilter === c.value),
        dataset: { focusKey: `stage-filter-${c.value}` },
        onclick: refreshControls(() => { stageFilter = c.value; }),
      }, c.label)));

    controls.append(
      el('div.deal-controls', {}, search, el('div.select-wrap.close-window', {}, windowSelect)),
      filters
    );
    append(filters, [tagFilterControl(tagsFilter, refreshControls((next) => {
      tagsFilter = next;
    }), 'deals')]);
    append(filters, customFilterControls('deals', fieldFilters, refreshControls((next) => {
      fieldFilters = next;
    })));
  }

  /* ----- board ----- */

  function boardEl() {
    const stages = store.stages();
    const rows = store.deals.filter(matchesSearch);
    const shown = stageFilter === 'all' || stageFilter === 'open'
      ? stages
      : stages.filter((s) => s.id === stageFilter);
    // Won and Lost shrink to a total while the board is focused on open
    // deals, so a year of history stops burying this quarter's work.
    const isCollapsed = (s) => stageFilter === 'open'
      && isTerminalStage(s.id) && !expanded.has(s.id);

    const board = el('div.board', { role: 'list', 'aria-label': 'Pipeline stages' });
    board.style.gridTemplateColumns = shown
      .map((s) => (isCollapsed(s) ? 'minmax(124px, 0.4fr)' : 'minmax(248px, 1fr)')).join(' ');

    for (const s of shown) {
      const deals = rows
        .filter((d) => d.stage === s.id)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const total = deals.reduce((sum, d) => sum + contractValue(d), 0);
      const money = compactMoney(total, store.settings.currency);

      const col = el('section.board-col', {
        role: 'listitem',
        dataset: { stage: s.id },
        'aria-label': `${s.label}: ${deals.length} deal${deals.length === 1 ? '' : 's'}`,
      });

      // Folding a terminal column swaps one control for the other, and the
      // board is rebuilt around them - so the keyboard needs handing back
      // the way a filter chip's does. They share a focus key, because the
      // control that answers for this column after the render is the
      // opposite one: expand from the summary, collapse from the header.
      const foldKey = `stage-fold-${s.id}`;

      if (isCollapsed(s)) {
        col.classList.add('collapsed');
        col.append(el('button.col-collapsed', {
          type: 'button',
          'aria-expanded': 'false',
          dataset: { focusKey: foldKey },
          onclick: refresh(() => { expanded.add(s.id); }),
        },
          el('div.col-collapsed-head', {},
            stageBadge(s.id),
            el('span.row-chev', { html: icon('chevD', 16, 2.2) })
          ),
          el('div.col-collapsed-sum', {},
            `${deals.length} deal${deals.length === 1 ? '' : 's'}`,
            total > 0 && el('span.col-total', {}, money)
          )
        ));
      } else {
        const cards = el('div.col-cards');
        for (const d of deals) cards.append(dealCard(d));
        if (!deals.length) {
          cards.append(el('div.col-empty', {}, filtersActive() ? 'No matches' : 'No deals'));
        }
        col.append(
          el('header.col-head', {},
            stageBadge(s.id),
            el('span.col-count', {}, String(deals.length)),
            el('div.grow'),
            total > 0 && el('span.col-total', {}, money),
            stageFilter === 'open' && isTerminalStage(s.id) && el('button.icon-btn.col-fold', {
              html: icon('chevU', 15, 2.2),
              'aria-label': `Collapse ${s.label}`,
              'aria-expanded': 'true',
              dataset: { focusKey: foldKey },
              onclick: refresh(() => { expanded.delete(s.id); }),
            })
          ),
          cards
        );
      }

      // Dropzone: highlight while a card hovers, move on drop.
      col.addEventListener('dragover', (e) => {
        if (![...e.dataTransfer.types].includes('text/deal-id')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drop-target');
      });
      col.addEventListener('dragleave', (e) => {
        if (!col.contains(e.relatedTarget)) col.classList.remove('drop-target');
      });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drop-target');
        const deal = store.dealById(e.dataTransfer.getData('text/deal-id'));
        if (deal) await moveDealTo(deal, s.id);
      });

      board.append(col);
    }
    return board;
  }

  function dealCard(d) {
    const company = store.companyById(d.companyId);
    const contact = store.contactById(d.contactId);
    const due = d.expectedClose && isOpen(d) ? dueLabel(d.expectedClose) : null;
    const stalled = isStalled(d, store.settings.staleDays);
    const confidence = isOpen(d) ? confidenceLabel(d.confidence) : null;

    const card = el('article.deal-card', { draggable: 'true' },
      el('a.deal-card-link', { href: `#/pipeline?id=${d.id}` },
        el('div.deal-card-name', {}, d.name),
        // A recurring deal leads with its rate and says what the contract
        // comes to - "$2,000/mo · $24K total" - because either number
        // alone is a different deal.
        el('div.deal-card-value', {}, rateText(d, store.settings.currency),
          isRecurring(d) && el('span.deal-card-term', {},
            ` · ${compactMoney(contractValue(d), store.settings.currency)} total`)),
        (company || contact) && el('div.deal-card-sub', {}, company?.name || contact?.name),
        el('div.deal-card-pills', {},
          due && el('span.due-pill', { dataset: { status: due.status === 'overdue' ? 'overdue' : 'later' } },
            due.status === 'overdue' && el('span', { html: icon('alert', 12, 2.2) }),
            due.status === 'overdue' ? `Close date ${due.text}`
              : due.status === 'later' ? `Close ${due.text}` : `Close ${due.text.toLowerCase()}`),
          // Only once it crosses the threshold: an age badge on every card
          // would be noise, and "stuck" is the signal worth surfacing.
          stalled && el('span.age-pill', {
            dataset: { tone: 'stalled' },
            title: `No stage change since ${formatDate(todayISO(new Date(stageEnteredAt(d))), { year: 'always' })}`,
          },
            el('span', { html: icon('clock', 12, 2.2), 'aria-hidden': 'true' }),
            `${daysInStage(d)}d in stage`),
          // The board should explain the forecast: a card whose weight is
          // the founder's own call says so.
          confidence && el('span.age-pill.conf-pill', {
            title: 'Forecast confidence set on this deal, overriding the stage weight',
          },
            el('span', { html: icon('target', 12, 2.2), 'aria-hidden': 'true' }),
            confidence)
        )
      ),
      el('button.icon-btn.deal-card-move', {
        html: icon('more', 16, 2),
        'aria-label': `Move ${d.name} to another stage`,
        'aria-haspopup': 'dialog',
        onclick: () => openMoveSheet(d),
      })
    );

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/deal-id', d.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    return card;
  }

  /* ----- list ----- */

  function listEl() {
    const stages = store.stages();
    const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[0];
    const dir = sort.dir === 'asc' ? 1 : -1;
    const rows = filtered().sort((a, b) => {
      // A deal with nothing in the sorted column sinks to the bottom in
      // both directions: no expected close is not "closing in 1970", and
      // it is not the furthest-out date either.
      const aEmpty = col.empty?.(a) ?? false;
      const bEmpty = col.empty?.(b) ?? false;
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      const av = col.get(a);
      const bv = col.get(b);
      const diff = col.text ? String(av).localeCompare(String(bv)) : av - bv;
      // Name is the stable tiebreaker, so equal values never shuffle.
      return (diff || a.name.localeCompare(b.name)) * dir;
    });

    // The bar rides the selection, not the rows: a filter that matches
    // nothing must not hide "3 selected" with its only way to clear.
    const order = rows.map((d) => d.id);
    append(bulkWrap, [bulkBar(selection, { total: order.length, order, actions: bulkActions() })]);

    // An empty list with nothing filtering it isn't a search that missed:
    // the default view is the open stages, so it means every deal on the
    // book has closed. Saying "try a different search" there, over a Clear
    // filters button that resets what is already at its default and changes
    // nothing on screen, was a dead end - name what happened and offer the
    // two ways out instead.
    if (!rows.length && !filtersActive()) {
      return emptyState({
        icon: 'pipeline',
        title: 'No open deals',
        message: 'Every deal on your board is won or lost. Start the next one, or show all to look back over what closed.',
        action: el('div.empty-actions', {},
          el('button.btn.btn-primary', { onclick: () => openDealForm() }, 'New deal'),
          el('button.btn.btn-ghost', {
            onclick: refreshControls(() => { stageFilter = 'all'; }),
          }, 'Show all deals')
        ),
      });
    }

    if (!rows.length) {
      const fieldsOn = activeFields();
      return emptyState({
        icon: 'search', title: 'No deals match',
        message: fieldsOn.length
          ? `Nothing matches ${fieldsOn.map((f) => fieldFilterLabel(f.field, f.value)).join(' and ')} with the filters you have on.`
          : 'Try a different search, stage, or close-date window.',
        action: el('button.btn.btn-ghost', { onclick: clearFilters }, 'Clear filters'),
      });
    }

    const total = rows.reduce((sum, d) => sum + contractValue(d), 0);

    const head = el('tr', {}, el('th.col-select', { scope: 'col' },
      el('span.sr-only', {}, 'Select')), COLUMNS.map((c) => {
      const active = sort.key === c.key;
      return el(`th${c.num ? '.num' : ''}${c.cls ? `.${c.cls}` : ''}`, {
        scope: 'col',
        'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
      },
        el('button.th-sort', {
          type: 'button',
          className: `th-sort${active ? ' active' : ''}`,
          dataset: { focusKey: `sort-${c.key}` },
          onclick: refresh(() => {
            // Re-picking a column flips it; a new column starts in the
            // direction that column is usually read (money biggest first).
            sort = active
              ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
              : { key: c.key, dir: c.num ? 'desc' : 'asc' };
          }),
        },
          c.label,
          el('span.th-arrow', {
            'aria-hidden': 'true',
            html: active ? icon(sort.dir === 'asc' ? 'chevU' : 'chevD', 13, 2.6) : '',
          })
        )
      );
    }).concat(el('th.col-menu', { scope: 'col' },
      el('span.sr-only', {}, 'Actions'))));

    const table = el('table.data-table.deal-table', {},
      el('thead', {}, head),
      el('tbody', {}, rows.map((d) => dealRow(d, stages, order)))
    );

    return el('div.card', {},
      el('div.list-summary', {},
        el('span', {}, `${rows.length} deal${rows.length === 1 ? '' : 's'}`),
        el('span.list-summary-value', {}, moneyText(total)),
        filtersActive() && el('button.btn-inline', { onclick: clearFilters }, 'Clear filters')
      ),
      el('div.table-wrap', {}, table)
    );
  }

  function dealRow(d, stages, order) {
    const link = store.companyById(d.companyId) || store.contactById(d.contactId);
    const href = `#/pipeline?id=${d.id}`;
    const due = d.expectedClose && isOpen(d) ? dueLabel(d.expectedClose) : null;

    const row = el('tr.deal-tr', {},
      el('td.col-select', {}, selectBox(selection, d.id, order, d.name)),
      el('th', { scope: 'row' },
        el('a.deal-tr-name', { href }, d.name),
        isStalled(d, store.settings.staleDays) && el('span.age-pill', { dataset: { tone: 'stalled' } },
          `${daysInStage(d)}d in stage`)
      ),
      el('td.col-link', {}, link?.name || '–'),
      el('td.col-stage', {}, stageBadge(d.stage, stages)),
      el('td.num', {},
        moneyText(contractValue(d)),
        isRecurring(d) && el('span.cell-sub', {}, rateText(d, store.settings.currency))),
      el('td.col-close', {},
        d.expectedClose
          ? el('span', { className: due?.status === 'overdue' ? 'text-critical' : '' },
              formatDate(d.expectedClose))
          : '–'),
      el('td.num.col-updated', {}, timeAgo(d.updatedAt)),
      el('td.col-menu', {},
        el('button.icon-btn', {
          html: icon('more', 16, 2),
          'aria-label': `Move ${d.name} to another stage`,
          'aria-haspopup': 'dialog',
          onclick: (e) => { e.stopPropagation(); openMoveSheet(d); },
        }))
    );
    // The name is a real link for keyboard and middle-click; the rest of
    // the row is a convenience target for the mouse.
    row.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;
      location.hash = href;
    });
    return row;
  }

  /* ----- shell ----- */

  function render() {
    const prevScroll = body.querySelector('.board')?.scrollLeft ?? 0;
    clear(body);
    clear(bulkWrap);
    renderViews();
    selection.prune(store.deals.map((d) => d.id));

    if (!store.deals.length) {
      controls.hidden = true;
      viewRow.hidden = true;
      body.append(emptyState({
        icon: 'pipeline',
        title: 'Your pipeline is empty',
        message: 'A deal is one opportunity with one buyer. Add the conversations you’re having right now and drag them through the stages as they progress.',
        action: el('button.btn.btn-primary', { onclick: () => openDealForm() }, 'Add your first deal'),
      }));
      return;
    }
    controls.hidden = false;
    viewRow.hidden = false;

    if (mode === 'list') {
      body.append(listEl());
      return;
    }
    const board = boardEl();
    body.append(board);
    board.scrollLeft = prevScroll;
  }

  const viewToggle = el('div.seg-group.view-toggle', { role: 'group', 'aria-label': 'Deal layout' },
    [['board', 'Board', 'pipeline'], ['list', 'List', 'listChecks']].map(([value, label, ic]) =>
      el('button.seg', {
        type: 'button',
        className: `seg${mode === value ? ' active' : ''}`,
        'aria-pressed': String(mode === value),
        html: icon(ic, 15, 2),
        onclick: (e) => {
          if (mode === value) return;
          mode = value;
          // The board has no selection UI, so a lingering selection would
          // be invisible state; drop it at the door.
          selection.reset();
          for (const b of e.currentTarget.parentElement.children) {
            const on = b === e.currentTarget;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
          }
          store.updateSettings({ dealView: value }).catch(() => {});
          render();
        },
      }, ` ${label}`)));

  renderControls();
  if (start) {
    query = start.filters.query;
    stageFilter = start.filters.stage;
    closeWindow = start.filters.closeWindow;
    tagsFilter = start.filters.tags;
    fieldFilters = start.filters.fields;
    if (start.filters.sort) sort = { ...start.filters.sort };
    renderControls();
  }
  render();
  let vocabulary = tagVocabulary('deals');
  let fieldsSig = fieldSignature(store.customFields('deals'));
  const renderOnChange = keepingFocus(() => {
    // A tag or a custom field added while this board is open belongs in its
    // filter row. Only a real change rebuilds the controls, so the search
    // box isn't replaced under the caret on every unrelated save.
    const next = tagVocabulary('deals');
    const nextFields = fieldSignature(store.customFields('deals'));
    if (next !== vocabulary || nextFields !== fieldsSig) {
      vocabulary = next;
      fieldsSig = nextFields;
      renderControls();
    }
    render();
  });
  store.addEventListener('change', renderOnChange);

  root.append(
    pageHead('Pipeline',
      viewToggle,
      // label-hide-sm: with the view toggle also in this header, the label
      // is what pushes "Pipeline" into an ellipsis on phone widths.
      el('button.btn.btn-primary.label-hide-sm', {
        html: icon('plus', 16, 2.2),
        onclick: () => openDealForm(),
      }, ' New deal')),
    viewRow,
    controls,
    body,
    bulkWrap
  );
  root.destroy = () => store.removeEventListener('change', renderOnChange);
  return root;
}

/* ---------- deal detail ---------- */

const DAY = 86400000;
const daysText = (n) => `${n} day${n === 1 ? '' : 's'}`;

function stageLabelOf(stageId, stages) {
  return stages.find((s) => s.id === stageId)?.label ?? stageId;
}

/** "In Proposal for 12 days" - the question the board can't answer. */
function timeInStageText(deal, stages) {
  const days = daysInStage(deal);
  const label = stageLabelOf(deal.stage, stages);
  return days === 0 ? `Entered ${label} today` : `In ${label} for ${daysText(days)}`;
}

/**
 * One person on a deal: who they are, what they do here, and when they
 * were last spoken to - the three things that decide who to call next.
 */
function personRow(deal, contactId) {
  const contact = store.contactById(contactId);
  if (!contact) return null;
  const role = roleOf(deal, contactId);
  const lastAt = store.lastContactedAt(contactId);
  const primary = deal.contactId === contactId;
  return el('a.person-row.deal-person-row', { href: `#/leads?id=${contact.id}` },
    avatar(contact.name),
    el('div.grow.min0', {},
      el('div.person-name', {}, contact.name),
      el('div.person-sub', {},
        [contact.title, primary ? 'Primary contact' : null].filter(Boolean).join(' · ')
        || 'No title yet')
    ),
    role && el('span.role-badge', {
      dataset: { role },
      title: role === DECIDER_ROLE ? 'Signs the deal off' : null,
    }, roleLabel(role)),
    el('span.mini-note', {}, lastAt ? sinceLabel(lastAt).text : 'no contact'),
    el('span.row-chev', { html: icon('chevR', 18) })
  );
}

/** Last conversation touching this deal - its own history or its contact's. */
function dealTouchChip(deal) {
  const lastAt = store.lastTouchedDeal(deal);
  const coldDays = store.settings.coldDays;
  const since = lastAt || todayISO(new Date(deal.createdAt));
  const { text, days } = sinceLabel(since);
  const cold = coldDays > 0 && days >= coldDays;
  return el('span.chip.static', { dataset: cold ? { tone: 'stalled' } : {} },
    el('span', { html: icon('video', 13, 2) }),
    lastAt ? `Last touch ${text}` : 'No activity logged'
  );
}

/** The deal's journey: one row per stage it has sat in, with how long. */
function stageTimeline(deal, stages, now = Date.now()) {
  const hist = deal.stageHistory || [];
  return el('ol.stage-timeline', {}, hist.map((entry, i) => {
    const until = hist[i + 1]?.at ?? now;
    const days = Math.max(0, Math.floor((until - entry.at) / DAY));
    const current = i === hist.length - 1;
    return el('li.stage-timeline-row', { className: `stage-timeline-row${current ? ' current' : ''}` },
      stageBadge(entry.stage, stages),
      el('span.stage-timeline-date', {},
        formatDate(todayISO(new Date(entry.at)), { year: 'always' })),
      el('span.stage-timeline-days', {},
        current && isOpen(deal) ? `${daysText(days)} · now` : daysText(days))
    );
  }));
}

function dealDetail(id) {
  const root = el('div.view');
  const body = el('div');

  function render() {
    clear(body);
    const deal = store.dealById(id);
    if (!deal) {
      body.append(emptyState({
        icon: 'deal', title: 'Deal not found',
        message: 'It may have been deleted.',
        action: el('a.btn.btn-ghost', { href: '#/pipeline' }, 'Back to pipeline'),
      }));
      return;
    }

    const stages = store.stages();
    const probability = Math.round(
      probabilityOf(deal, store.settings.stageProbabilities, stages) * 100);
    const tasks = store.tasksFor({ dealId: id });
    // Everyone's conversations, not just the ones filed against the deal.
    const history = store.dealActivities(deal);
    const people = dealContactIds(deal);
    const due = deal.expectedClose && isOpen(deal) ? dueLabel(deal.expectedClose) : null;

    /* Stage stepper: every stage a button, current one marked. */
    const stepper = el('div.stage-stepper', { role: 'group', 'aria-label': 'Deal stage' },
      stages.map((s) => el('button.stage-step', {
        type: 'button',
        className: `stage-step${deal.stage === s.id ? ' active' : ''}`,
        dataset: { stage: s.id },
        'aria-pressed': String(deal.stage === s.id),
        onclick: () => moveDealTo(deal, s.id),
      }, s.label))
    );

    append(body, [
      el('div.detail-head.card', {},
        el('div.grow.min0', {},
          el('div.detail-title-row', {},
            el('h1.detail-title', {}, deal.name),
            stageBadge(deal.stage)
          ),
          el('div.deal-figures', {},
            el('span.deal-detail-value', {}, rateText(deal, store.settings.currency)),
            isRecurring(deal) && el('span.deal-detail-contract', {},
              contractText(deal, store.settings.currency)),
            isOpen(deal) && el('span.deal-detail-prob', {},
              `${probability}% likely · ${moneyText(contractValue(deal) * probability / 100)} weighted`),
            isOpen(deal) && confidenceLabel(deal.confidence) && el('span.age-pill.conf-pill', {
              title: 'Your confidence override. The forecast uses this instead of the stage weight',
            },
              el('span', { html: icon('target', 12, 2.2), 'aria-hidden': 'true' }),
              confidenceLabel(deal.confidence))
          ),
          el('div.chip-row', {},
            contactChip(deal.contactId),
            companyChip(deal.companyId),
            isRecurring(deal) && el('span.chip.static', {},
              el('span', { html: icon('repeat', 13, 2) }),
              `${billingLabel(deal)} · ${termText(deal)}`),
            deal.expectedClose && isOpen(deal) && el('span.chip.static', {
              dataset: due?.status === 'overdue' ? { tone: 'overdue' } : {},
            },
              el('span', { html: icon('calendar', 13, 2) }),
              due?.status === 'overdue' ? `Close date ${due.text}` : `Closes ${formatDate(deal.expectedClose)}`),
            !isOpen(deal) && deal.closedAt && el('span.chip.static', {},
              el('span', { html: icon(deal.stage === 'won' ? 'trophy' : 'circleX', 13, 2) }),
              `Closed ${timeAgo(deal.closedAt)}`),
            isOpen(deal) && el('span.chip.static', {
              dataset: isStalled(deal, store.settings.staleDays) ? { tone: 'stalled' } : {},
            },
              el('span', { html: icon('clock', 13, 2) }),
              timeInStageText(deal, stages)),
            isOpen(deal) && dealTouchChip(deal),
            (deal.tags || []).map((t) => el('span.chip.static', {},
              el('span', { html: icon('tag', 13, 2) }), t))
          )
        ),
        el('div.detail-actions', {},
          store.contactById(deal.contactId)?.email && el('button.btn.btn-ghost.btn-sm', {
            html: icon('mail', 15, 2),
            onclick: () => openEmailFlow({ contact: store.contactById(deal.contactId), deal }),
          }, ' Email…'),
          el('button.btn.btn-ghost.btn-sm', {
            html: icon('pencil', 15, 2),
            onclick: () => openDealForm(deal),
          }, ' Edit'),
          el('button.icon-btn', {
            html: icon('trash', 17, 2), 'aria-label': `Delete ${deal.name}`,
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Delete this deal?',
                message: 'Its history and follow-ups stay, but lose the link to this deal. It goes to Recently deleted in Settings for 30 days.',
              });
              if (!ok) return;
              // Leave first: the store empties memory and emits before its
              // KV write settles, so staying parked here means staring at
              // "Deal not found" for the whole round trip.
              location.hash = '#/pipeline';
              try {
                const entry = await store.deleteDeal(id);
                deletedToast('Deal deleted', entry);
              } catch {
                toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
              }
            },
          })
        )
      ),

      el('section.card', {},
        el('div.settings-body', {}, stepper)
      ),

      section('People',
        el('button.btn.btn-ghost.btn-sm', {
          html: icon('userPlus', 14, 2),
          onclick: () => openDealForm(deal),
        }, people.length ? ' Edit' : ' Add'),
        people.length
          ? el('div', {},
              el('div.people-list', {}, people.map((contactId) => personRow(deal, contactId))),
              // The question that decides a B2B deal, asked where it can
              // be answered in one click.
              !hasDecisionMaker(deal) && isOpen(deal) && el('p.card-note', {},
                'Nobody here is marked as the decision maker - the person who actually signs.')
            )
          : el('p.card-empty', {}, 'No people on this deal yet. Add the champion, and the person who signs.')
      ),

      deal.notes && el('section.card', {},
        el('div.settings-body', {}, el('p.detail-notes', {}, deal.notes))
      ),

      (() => {
        const rows = customFieldRows('deals', deal);
        return rows && section('Details', null, el('div.settings-body', {}, rows));
      })(),

      /* Why it closed: captured at the transition, editable forever after. */
      !isOpen(deal) && section('Why it closed',
        el('button.btn.btn-ghost.btn-sm', {
          html: icon(deal.closeReason ? 'pencil' : 'plus', 14, 2.2),
          onclick: () => openCloseReasonForm(deal),
        }, deal.closeReason ? ' Edit' : ' Add reason'),
        deal.closeReason
          ? el('div.settings-body', {},
              el('div.chip-row', {}, closeReasonChip(deal)),
              deal.closeReasonNote && el('p.detail-notes.mt-sm', {}, deal.closeReasonNote)
            )
          : el('p.card-empty', {},
              'No reason recorded. Three months from now, this is the field that tells you why you win.')
      ),

      (deal.stageHistory?.length > 1) && section('Stage history', null,
        el('div.settings-body', {}, stageTimeline(deal, stages))
      ),

      section('Follow-ups',
        el('div.card-actions', {},
          playbookButton({ dealId: id, contactId: deal.contactId }),
          el('button.btn.btn-ghost.btn-sm', {
            html: icon('plus', 14, 2.2),
            onclick: () => openTaskForm(null, { presets: { dealId: id, contactId: deal.contactId } }),
          }, ' Add')
        ),
        tasks.length
          ? el('div.task-list', {}, tasks.map((t) =>
              taskRow(t, { context: { dealId: id }, onEdit: (task) => openTaskForm(task) })))
          : el('p.card-empty', {}, 'Nothing scheduled for this deal.')
      ),

      section('History',
        el('div.card-actions', {},
          catchUpButton({ deal }),
          el('button.btn.btn-ghost.btn-sm', {
            html: icon('plus', 14, 2.2),
            onclick: () => openActivityForm(null, { presets: { dealId: id, contactId: deal.contactId } }),
          }, ' Log')
        ),
        history.length
          ? el('div.activity-list', {}, history.map((a) =>
              activityRow(a, { context: { dealId: id }, onEdit: (act) => openActivityForm(act) })))
          : el('p.card-empty', {}, 'Meetings, calls, emails, and notes about this deal show up here.')
      ),

      attachmentsSection({ dealId: id }),
    ]);
  }

  const renderOnChange = keepingFocus(render);
  store.addEventListener('change', renderOnChange);
  render();

  root.append(
    el('a.back-link', { href: '#/pipeline', html: icon('chevL', 16, 2.2) }, 'Pipeline'),
    body
  );
  root.destroy = () => store.removeEventListener('change', renderOnChange);
  return root;
}
