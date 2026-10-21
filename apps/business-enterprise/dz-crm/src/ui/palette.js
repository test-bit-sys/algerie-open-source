/**
 * Global search / command palette (Cmd-K).
 *
 * One keystroke to any record in the CRM, ranked across contacts,
 * companies, deals, follow-ups, and logged activity, plus the actions the
 * FAB offers. Everything is already in memory, so this is a scan and a
 * sort - no index to keep in step with the data.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { store, activityTypeInfo } from '../lib/store.js';
import { matchScore, formatDate, timeAgo, sinceLabel } from '../lib/util.js';
import { rateText } from '../lib/recurring.js';
import { stageBadge, avatar } from './bits.js';
import { VIEW_KINDS, viewsOf } from '../lib/views.js';
import { openContactForm, openDealForm, openActivityForm, openTaskForm } from './forms.js';

/** Results past this stop helping and start scrolling. */
const MAX_PER_GROUP = 5;
const MAX_RECENT = 6;

let openPaletteModal = null;

/** The four things a founder starts from a blank prompt. */
function quickActions() {
  return [
    { id: 'new-deal', title: 'New deal', sub: 'An opportunity to move through the pipeline', icon: 'deal', run: () => openDealForm() },
    { id: 'new-lead', title: 'New lead', sub: 'A person you might sell to', icon: 'userPlus', run: () => openContactForm() },
    { id: 'log-activity', title: 'Log activity', sub: 'A meeting, call, email, or note', icon: 'video', run: () => openActivityForm() },
    { id: 'new-task', title: 'New follow-up', sub: 'A dated reminder to reach out', icon: 'followups', run: () => openTaskForm() },
    { id: 'go-pipeline', title: 'Go to Pipeline', sub: 'The board and the deal list', icon: 'pipeline', run: () => { location.hash = '#/pipeline'; } },
    { id: 'go-forecast', title: 'Go to Forecast', sub: 'Weighted pipeline and win/loss', icon: 'chart', run: () => { location.hash = '#/forecast'; } },
    { id: 'go-followups', title: 'Go to Follow-ups', sub: 'Everything you owe someone', icon: 'followups', run: () => { location.hash = '#/followups'; } },
    { id: 'go-settings', title: 'Go to Settings', sub: 'Stages, goal, reminders, and your data', icon: 'gear', run: () => { location.hash = '#/settings'; } },
  ];
}

const goTo = (hash) => () => { location.hash = hash; };

/** Best score across a record's searchable fields (-1 when nothing hits). */
function best(query, ...fields) {
  let top = -1;
  for (const f of fields) {
    const s = matchScore(f, query);
    if (s > top) top = s;
  }
  return top;
}

/* Each group knows how to find, describe, and open its own records. */
function searchGroups(query) {
  const companyName = (id) => store.companyById(id)?.name || '';
  const contactName = (id) => store.contactById(id)?.name || '';

  return [
    {
      key: 'leads',
      label: 'Leads',
      items: store.contacts
        .map((c) => ({
          score: best(query, c.name, c.email, c.phone, c.title, companyName(c.companyId),
            c.notes, ...(c.tags || [])),
          item: c,
        }))
        .filter((r) => r.score >= 0)
        .map(({ score, item: c }) => ({
          score,
          key: `lead-${c.id}`,
          title: c.name,
          sub: [c.title, companyName(c.companyId), c.email].filter(Boolean).join(' · ') || 'Lead',
          lead: avatar(c.name),
          run: goTo(`#/leads?id=${c.id}`),
        })),
    },
    {
      key: 'companies',
      label: 'Companies',
      items: store.companies
        .map((c) => ({
          score: best(query, c.name, c.industry, c.website, c.notes, ...(c.tags || [])),
          item: c,
        }))
        .filter((r) => r.score >= 0)
        .map(({ score, item: c }) => ({
          score,
          key: `company-${c.id}`,
          title: c.name,
          sub: [c.industry, c.size && `${c.size} people`].filter(Boolean).join(' · ') || 'Company',
          icon: 'building',
          run: goTo(`#/companies?id=${c.id}`),
        })),
    },
    {
      key: 'deals',
      label: 'Deals',
      items: store.deals
        .map((d) => ({
          score: best(query, d.name, companyName(d.companyId), contactName(d.contactId),
            d.notes, d.closeReason, ...(d.tags || [])),
          item: d,
        }))
        .filter((r) => r.score >= 0)
        .map(({ score, item: d }) => ({
          score,
          key: `deal-${d.id}`,
          title: d.name,
          sub: [rateText(d, store.settings.currency),
            companyName(d.companyId) || contactName(d.contactId)].filter(Boolean).join(' · '),
          trailing: stageBadge(d.stage),
          icon: 'deal',
          run: goTo(`#/pipeline?id=${d.id}`),
        })),
    },
    {
      key: 'views',
      label: 'Saved views',
      items: VIEW_KINDS.flatMap((kind) => viewsOf(store.settings, kind.key).map((view) => ({
        score: best(query, view.name, kind.label),
        item: { view, kind },
      })))
        .filter((r) => r.score >= 0)
        .map(({ score, item }) => ({
          score,
          key: `view-${item.view.id}`,
          title: item.view.name,
          sub: `${item.kind.label} · saved view`,
          icon: 'listChecks',
          // The list opens on the view rather than filtering itself after
          // arriving, so Back goes back to wherever the palette was opened.
          run: goTo(`${item.kind.hash}?view=${item.view.id}`),
        })),
    },
    {
      key: 'tasks',
      label: 'Follow-ups',
      items: store.tasks
        .map((t) => ({
          score: best(query, t.title, contactName(t.contactId), store.dealById(t.dealId)?.name),
          item: t,
        }))
        .filter((r) => r.score >= 0)
        .map(({ score, item: t }) => ({
          score,
          key: `task-${t.id}`,
          title: t.title,
          sub: [t.done ? 'Done' : `Due ${formatDate(t.due)}`,
            contactName(t.contactId), store.dealById(t.dealId)?.name].filter(Boolean).join(' · '),
          icon: t.done ? 'checkbox' : 'followups',
          run: () => openTaskForm(t),
        })),
    },
    {
      key: 'activities',
      label: 'Activity',
      items: store.activities
        .map((a) => ({
          score: best(query, a.summary, a.notes, contactName(a.contactId), companyName(a.companyId)),
          item: a,
        }))
        .filter((r) => r.score >= 0)
        .map(({ score, item: a }) => ({
          score,
          key: `activity-${a.id}`,
          title: a.summary || 'Untitled note',
          sub: [formatDate(a.date), contactName(a.contactId) || companyName(a.companyId)]
            .filter(Boolean).join(' · '),
          icon: activityTypeInfo(a.type).icon,
          run: () => openActivityForm(a),
        })),
    },
  ];
}

/** What to show before anything has been typed: actions, then what moved. */
function emptyStateGroups() {
  const recent = [
    ...store.deals.map((d) => ({ at: d.updatedAt, node: {
      key: `deal-${d.id}`,
      title: d.name,
      sub: [rateText(d, store.settings.currency), `updated ${timeAgo(d.updatedAt)}`].join(' · '),
      trailing: stageBadge(d.stage),
      icon: 'deal',
      run: goTo(`#/pipeline?id=${d.id}`),
    } })),
    ...store.contacts.map((c) => {
      const last = store.lastContactedAt(c.id);
      return {
        at: last ? new Date(`${last}T12:00:00`).getTime() : c.createdAt,
        node: {
          key: `lead-${c.id}`,
          title: c.name,
          sub: last ? `Last touch ${sinceLabel(last).text}` : 'No contact logged',
          lead: avatar(c.name),
          run: goTo(`#/leads?id=${c.id}`),
        },
      };
    }),
  ].sort((a, b) => b.at - a.at).slice(0, MAX_RECENT).map((r) => r.node);

  return [
    { key: 'actions', label: 'Actions', items: quickActions().slice(0, 4) },
    { key: 'recent', label: 'Recent', items: recent },
  ].filter((g) => g.items.length);
}

function matchingActions(query) {
  return quickActions()
    .map((a) => ({ ...a, score: best(query, a.title, a.sub) }))
    .filter((a) => a.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

export function openPalette() {
  if (openPaletteModal) return openPaletteModal;

  let items = [];       // flat, selectable
  let selected = 0;

  // The combobox pattern: without the role and aria-expanded, a screen
  // reader reads this as a plain text field and never announces the
  // active option that aria-activedescendant points at.
  const input = el('input.input.palette-input', {
    type: 'text',
    placeholder: 'Search leads, companies, deals, follow-ups…',
    'aria-label': 'Search everything',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-autocomplete': 'list',
    'aria-controls': 'palette-results',
    autocomplete: 'off',
    spellcheck: false,
    oninput: () => render(),
  });

  const results = el('div.palette-results', {
    id: 'palette-results',
    role: 'listbox',
    'aria-label': 'Search results',
  });

  const head = el('div.palette-head', {},
    el('span.palette-icon', { html: icon('search', 18, 2), 'aria-hidden': 'true' }),
    input,
    el('button.icon-btn', { html: icon('x', 18), 'aria-label': 'Close search', onclick: () => modal.close() })
  );

  function groupsFor(query) {
    if (!query) return emptyStateGroups();
    const actions = matchingActions(query);
    const found = searchGroups(query)
      .map((g) => ({
        ...g,
        items: g.items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
          .slice(0, MAX_PER_GROUP),
      }))
      .filter((g) => g.items.length);
    // Records first: a query is far more often a name than a command.
    return actions.length ? [...found, { key: 'actions', label: 'Actions', items: actions }] : found;
  }

  function render() {
    const query = input.value.trim();
    const groups = groupsFor(query);
    items = groups.flatMap((g) => g.items);
    selected = 0;
    clear(results);
    input.setAttribute('aria-expanded', String(items.length > 0));

    if (!items.length) {
      input.removeAttribute('aria-activedescendant');
      results.append(el('div.palette-empty', {},
        el('span', { html: icon('search', 22, 1.8), 'aria-hidden': 'true' }),
        el('p', {}, `Nothing matches “${query}”`),
        el('p.palette-empty-sub', {}, 'Try a name, a company, or part of a note.')
      ));
      return;
    }

    let index = 0;
    for (const group of groups) {
      // A listbox may only contain options and groups, so the heading rides
      // inside a labelled group rather than sitting loose between options.
      const box = el('div', { role: 'group', 'aria-label': group.label },
        el('div.palette-group', { 'aria-hidden': 'true' }, group.label));
      for (const item of group.items) {
        const i = index++;
        box.append(el('button.palette-row', {
          type: 'button',
          role: 'option',
          id: `palette-item-${i}`,
          'aria-selected': 'false',
          // The field keeps the keyboard and points at the active row with
          // aria-activedescendant, so the rows must not be tab stops of
          // their own. As buttons they were: Tab walked into the list one
          // result at a time, and the arrow handler lives on the head - so
          // the moment Tab left the field, Up and Down went dead and the
          // highlight could no longer be moved at all.
          tabindex: -1,
          onclick: () => choose(i),
          onmousemove: (e) => hoverSelect(i, e),
        },
          item.lead || el('span.palette-row-ic', { html: icon(item.icon || 'inbox', 17, 2) }),
          el('span.grow.min0', {},
            el('span.palette-row-title', {}, item.title),
            item.sub && el('span.palette-row-sub', {}, item.sub)
          ),
          item.trailing || null
        ));
      }
      results.append(box);
    }
    select(0);
  }

  function rows() {
    return results.querySelectorAll('.palette-row');
  }

  function select(i, { scroll = true } = {}) {
    const all = rows();
    if (!all.length) return;
    selected = (i + all.length) % all.length;
    all.forEach((row, n) => {
      const on = n === selected;
      row.classList.toggle('active', on);
      row.setAttribute('aria-selected', String(on));
    });
    input.setAttribute('aria-activedescendant', `palette-item-${selected}`);
    // Only the keyboard scrolls the list. Doing it on hover would move the
    // rows out from under a pointer that is merely passing over them.
    if (scroll) all[selected].scrollIntoView({ block: 'nearest' });
  }

  /* Hovering picks a row - but only when the pointer really moved.
     Arrowing down scrolls the list, which slides a new row under a
     stationary cursor, and the browser answers that with a mousemove
     carrying the same coordinates as the last real one. Acting on it
     snatched the selection back to wherever the mouse happened to rest,
     so holding ArrowDown went nowhere. */
  let pointerAt = null;
  let keyboardMoved = false;

  function hoverSelect(i, e) {
    if (pointerAt && e.clientX === pointerAt.x && e.clientY === pointerAt.y) return;
    pointerAt = { x: e.clientX, y: e.clientY };
    // The first move after a keyboard jump only re-establishes where the
    // pointer is; the next one is the user genuinely taking over.
    if (keyboardMoved) {
      keyboardMoved = false;
      return;
    }
    select(i, { scroll: false });
  }

  function choose(i) {
    const item = items[i];
    if (!item) return;
    modal.close();
    // Let the dialog finish closing before a form stacks on top of it.
    setTimeout(() => item.run(), 120);
  }

  head.addEventListener('keydown', (e) => {
    // Keys pressed mid-IME-composition belong to the composition: Enter
    // confirms the candidate text, arrows move through candidates. Acting
    // on them would open a row the user never picked.
    if (e.isComposing) return;
    const byKeyboard = (i) => { keyboardMoved = true; select(i); };
    if (e.key === 'ArrowDown') { e.preventDefault(); byKeyboard(selected + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); byKeyboard(selected - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(selected); }
    // Home/End belong to the text caret while there is text to move it
    // through (the combobox pattern); they only jump the list when the
    // input is empty and there is nothing else for them to do.
    else if (e.key === 'Home' && !input.value && items.length) { e.preventDefault(); byKeyboard(0); }
    else if (e.key === 'End' && !input.value && items.length) { e.preventDefault(); byKeyboard(items.length - 1); }
  });

  const modal = openModal({
    title: 'Search',
    head,
    content: results,
    variant: 'palette',
    focusFirst: true,
    onClose: () => { openPaletteModal = null; },
  });
  openPaletteModal = modal;
  render();
  return modal;
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const isTyping = (node) => !!node
  && (TYPING.has(node.tagName) || node.isContentEditable);

/**
 * Cmd/Ctrl-K anywhere, and "/" when the user isn't already typing.
 * Also answers the in-app search buttons, which dispatch `crm:search`
 * rather than importing this module (and its forms) into every view.
 */
export function installPaletteShortcut() {
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      if (openPaletteModal) {
        e.preventDefault();
        openPaletteModal.close();
        return;
      }
      // Not over another dialog: search would stack on top of it, and
      // picking a result navigates the page underneath while that dialog
      // stays - leaving a form for a record the user can no longer see.
      // The same rule "/" already follows.
      if (document.querySelector('.modal-root:not(.closing)')) return;
      e.preventDefault();
      openPalette();
      return;
    }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !isTyping(e.target) && !openPaletteModal
        && !document.querySelector('.modal-root:not(.closing)')) {
      e.preventDefault();
      openPalette();
    }
  });
  document.addEventListener('crm:search', () => {
    if (!openPaletteModal) openPalette();
  });
}
