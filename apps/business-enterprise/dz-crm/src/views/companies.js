import { el, clear, append, keepingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { fuzzyIncludes, timeAgo, formatDate, todayISO } from '../lib/util.js';
import {
  pageHead, emptyState, avatar, searchBox, stageBadge,
  activityRow, moneyText, section, deletedToast,
} from '../ui/bits.js';
import { openCompanyForm, openContactForm, openDealForm, openActivityForm } from '../ui/forms.js';
import { confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { isOpen, pipelineValue } from '../lib/forecast.js';
import { rateText } from '../lib/recurring.js';
import { hasTag } from '../lib/tags.js';
import { tagFilterControl, tagVocabulary } from '../ui/tag-input.js';
import { customFilterControls, customFieldRows, fieldFilterLabel } from '../ui/custom-fields.js';
import { matchesCustomFilters, activeFieldFilters, fieldSignature } from '../lib/fields.js';
import { viewChips, startingFilters } from '../ui/views.js';
import {
  rowSelection, selectBox, selectableRow, bulkBar, openBulkTagSheet, confirmBulkDelete, bulkToast,
} from '../ui/bulk.js';
import { attachmentsSection } from '../ui/attachments.js';
import { exportRecords } from '../lib/csv.js';
import { exportContext } from '../ui/csv.js';
import { downloadFile } from '../ui/download.js';

export function companiesView({ params }) {
  const id = params.get('id');
  if (id) return companyDetail(id);
  return companiesList(params);
}

/* ---------- list ---------- */

function companiesList(params) {
  const root = el('div.view');
  const listWrap = el('div');
  const bulkWrap = el('div');
  const filters = el('div.filter-row');
  const viewRow = el('div');
  let query = '';
  let tagsFilter = [];
  /* Choice and yes/no custom fields narrow this list too. */
  let fieldFilters = {};

  const search = searchBox({
    placeholder: 'Search companies…',
    oninput: (e) => { query = e.target.value.trim(); renderList(); },
  });

  /* The filter set a saved view stores and restores. */
  const currentFilters = () => ({ query, tags: tagsFilter, fields: fieldFilters });
  function adoptFilters(f) {
    query = f.query;
    tagsFilter = f.tags;
    fieldFilters = f.fields;
    search.querySelector('input').value = query;
    renderFilters();
    renderList();
  }
  const start = startingFilters('companies', params);

  function renderViews() {
    clear(viewRow);
    append(viewRow, [viewChips({
      kind: 'companies',
      filters: currentFilters(),
      onApply: adoptFilters,
      onChanged: renderViews,
    })]);
  }

  /* A search box over "No companies yet" is a control with nothing to
     control. Held with the tag filter so an empty list can put both away,
     the way Leads and the board do. */
  const controls = el('div', {}, viewRow, search, filters);

  function clearFilters() {
    query = '';
    tagsFilter = [];
    fieldFilters = {};
    search.querySelector('input').value = '';
    renderFilters();
    renderList();
  }

  const selection = rowSelection(() => renderList());

  function bulkActions() {
    const ids = () => selection.ids();
    const fail = () => toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
    return [
      {
        icon: 'tag', label: 'Tag',
        onClick: () => openBulkTagSheet(async (tag) => {
          try {
            const n = await store.bulkTag('companies', ids(), tag);
            selection.clear();
            bulkToast(n, `Tagged “${tag}”`, 'tag');
          } catch { fail(); }
        }),
      },
      {
        icon: 'fileDown', label: 'Export',
        onClick: () => {
          const records = store.companies.filter((c) => selection.has(c.id));
          downloadFile(`crm-companies-selection-${todayISO()}.csv`,
            `﻿${exportRecords('companies', records, exportContext())}`, 'text/csv');
          toast(`${records.length} compan${records.length === 1 ? 'y' : 'ies'} exported`, { icon: 'fileDown' });
        },
      },
      {
        icon: 'trash', label: 'Delete', danger: true,
        onClick: async () => {
          if (!await confirmBulkDelete(selection.size, selection.size === 1 ? 'company' : 'companies')) return;
          try {
            const entries = await store.bulkDelete('companies', ids());
            selection.clear();
            toast(`${entries.length} compan${entries.length === 1 ? 'y' : 'ies'} deleted`, { icon: 'trash' });
          } catch { fail(); }
        },
      },
    ];
  }

  // Rebuilding the filter row drops the control the keyboard was on; hand
  // it back the way a store-driven render does.
  const refreshFilters = (apply) => keepingFocus((...args) => {
    apply(...args);
    renderFilters();
    renderList();
  });

  function renderFilters() {
    clear(filters);
    append(filters, [tagFilterControl(tagsFilter, refreshFilters((next) => {
      tagsFilter = next;
    }), 'companies')]);
    append(filters, customFilterControls('companies', fieldFilters, refreshFilters((next) => {
      fieldFilters = next;
    })));
    /* Unlike Leads and the board, this row has no chips of its own - both
       controls in it are optional, and an account with no company tags and
       no company fields has neither. The row still carries its padding and
       its margin, so it left a strip of nothing under the search box on
       the default setup. */
    filters.hidden = !filters.children.length;
  }

  function renderList() {
    clear(listWrap);
    clear(bulkWrap);
    renderViews();
    controls.hidden = !store.companies.length;
    if (!store.companies.length) {
      listWrap.append(emptyState({
        icon: 'company',
        title: 'No companies yet',
        message: 'Companies group your leads and deals by account, so you see everything happening with one customer in one place.',
        action: el('button.btn.btn-primary', { onclick: () => openCompanyForm() }, 'Add your first company'),
      }));
      return;
    }

    const fields = store.customFields('companies');
    const rows = [...store.companies]
      .filter((c) => !query || fuzzyIncludes(c.name, query) || fuzzyIncludes(c.industry, query))
      .filter((c) => tagsFilter.every((t) => hasTag(c.tags, t)))
      .filter((c) => matchesCustomFilters(c, fields, fieldFilters))
      .sort((a, b) => a.name.localeCompare(b.name));
    const activeFields = activeFieldFilters(fields, fieldFilters);

    selection.prune(store.companies.map((c) => c.id));
    const order = rows.map((c) => c.id);
    append(bulkWrap, [bulkBar(selection, { total: order.length, order, actions: bulkActions() })]);

    if (!rows.length) {
      // A tag filter empties this list as readily as the search box does,
      // and blaming a search the user hasn't typed sends them looking in
      // the wrong place. Name both, and offer the way out.
      listWrap.append(emptyState({
        icon: 'search',
        title: 'No matches',
        message: activeFields.length
          ? `No company matches ${activeFields.map((f) => fieldFilterLabel(f.field, f.value)).join(' and ')}${query || tagsFilter.length ? ' alongside the other filters' : ''}.`
          : tagsFilter.length && query
            ? 'Nothing matches that search inside the tags you picked.'
            : tagsFilter.length
              ? 'No company wears every tag you picked.'
              : 'Try a different search.',
        action: (query || tagsFilter.length || activeFields.length)
          && el('button.btn.btn-ghost', { onclick: clearFilters }, 'Clear filters'),
      }));
      return;
    }

    listWrap.append(el('div.card.list-card', {},
      rows.map((c) => {
        const people = store.contactsOf(c.id).length;
        const deals = store.dealsFor({ companyId: c.id });
        const open = pipelineValue(deals);
        return selectableRow(selectBox(selection, c.id, order, c.name),
          el('a.person-row', { href: `#/companies?id=${c.id}` },
          el('span.avatar.square', { 'aria-hidden': 'true', html: icon('building', 18, 1.8) }),
          el('div.grow.min0', {},
            el('div.person-name', {}, c.name),
            el('div.person-sub', {}, [
              c.industry,
              people ? `${people} ${people === 1 ? 'person' : 'people'}` : null,
            ].filter(Boolean).join(' · ') || 'No details yet')
          ),
          open > 0 && el('span.deal-row-value', {}, moneyText(open)),
          el('span.row-chev', { html: icon('chevR', 18) })
        ));
      })
    ));
  }

  renderFilters();
  if (start) {
    query = start.filters.query;
    tagsFilter = start.filters.tags;
    fieldFilters = start.filters.fields;
    search.querySelector('input').value = query;
    renderFilters();
  }
  renderList();
  let vocabulary = tagVocabulary('companies');
  let fieldsSig = fieldSignature(store.customFields('companies'));
  const rerender = () => {
    // A tag or custom field added while this list is open belongs in its
    // filter row; only a real change rebuilds the row.
    const next = tagVocabulary('companies');
    const nextFields = fieldSignature(store.customFields('companies'));
    if (next !== vocabulary || nextFields !== fieldsSig) {
      vocabulary = next;
      fieldsSig = nextFields;
      renderFilters();
    }
    renderList();
  };
  const rerenderOnChange = keepingFocus(rerender);
  store.addEventListener('change', rerenderOnChange);

  root.append(
    pageHead('Companies',
      el('button.btn.btn-primary', {
        html: icon('plus', 16, 2.2),
        onclick: () => openCompanyForm(),
      }, ' New company')),
    controls,
    listWrap,
    bulkWrap
  );
  root.destroy = () => store.removeEventListener('change', rerenderOnChange);
  return root;
}

/* ---------- detail ---------- */

function companyDetail(id) {
  const root = el('div.view');
  const body = el('div');

  function render() {
    clear(body);
    const company = store.companyById(id);
    if (!company) {
      body.append(emptyState({
        icon: 'company', title: 'Company not found',
        message: 'It may have been deleted.',
        action: el('a.btn.btn-ghost', { href: '#/companies' }, 'Back to companies'),
      }));
      return;
    }

    const people = store.contactsOf(id).sort((a, b) => a.name.localeCompare(b.name));
    const deals = store.dealsFor({ companyId: id }).sort((a, b) => b.updatedAt - a.updatedAt);
    const history = store.activitiesFor({ companyId: id });
    const openValue = pipelineValue(deals);

    const meta = [
      company.industry,
      company.size && `${company.size} people`,
    ].filter(Boolean).join(' · ');

    append(body, [
      el('div.detail-head.card', {},
        el('span.avatar.lg.square', { 'aria-hidden': 'true', html: icon('building', 24, 1.6) }),
        el('div.grow.min0', {},
          el('h1.detail-title', {}, company.name),
          el('p.detail-sub', {}, meta || 'No details yet'),
          el('div.chip-row', {},
            company.website && el('a.chip', {
              href: /^https?:/i.test(company.website) ? company.website : `https://${company.website}`,
              target: '_blank', rel: 'noopener',
            },
              el('span', { html: icon('globe', 13, 2) }),
              el('span.chip-label', {}, company.website)),
            openValue > 0 && el('span.chip.static', {},
              el('span', { html: icon('money', 13, 2) }), `${moneyText(openValue)} open`),
            (company.tags || []).map((t) => el('span.chip.static', {},
              el('span', { html: icon('tag', 13, 2) }), t))
          )
        ),
        el('div.detail-actions', {},
          el('button.btn.btn-ghost.btn-sm', {
            html: icon('pencil', 15, 2),
            onclick: () => openCompanyForm(company),
          }, ' Edit'),
          el('button.icon-btn', {
            html: icon('trash', 17, 2), 'aria-label': `Delete ${company.name}`,
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Delete this company?',
                message: 'People, deals, and history stay, but lose their link to this company. It goes to Recently deleted in Settings for 30 days.',
              });
              if (!ok) return;
              // Leave first - see the note on the deal delete: waiting out
              // the KV write here parks the user on "Company not found".
              location.hash = '#/companies';
              try {
                const entry = await store.deleteCompany(id);
                deletedToast('Company deleted', entry);
              } catch {
                toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
              }
            },
          })
        )
      ),

      (() => {
        const rows = customFieldRows('companies', company);
        return rows && section('Details', null, el('div.settings-body', {}, rows));
      })(),

      company.notes && el('section.card', {},
        el('div.settings-body', {}, el('p.detail-notes', {}, company.notes))
      ),

      section('People',
        el('button.btn.btn-ghost.btn-sm', {
          html: icon('userPlus', 14, 2),
          onclick: () => openContactForm(null, { presets: { companyId: id } }),
        }, ' Add'),
        people.length
          ? el('div.deal-list', {}, people.map((p) => el('a.person-row.inset', { href: `#/leads?id=${p.id}` },
              avatar(p.name),
              el('div.grow.min0', {},
                el('div.person-name', {}, p.name),
                el('div.person-sub', {}, p.title || p.email || '')
              ),
              el('span.row-chev', { html: icon('chevR', 18) })
            )))
          : el('p.card-empty', {}, 'No people at this company yet.')
      ),

      section('Deals',
        el('button.btn.btn-ghost.btn-sm', {
          html: icon('plus', 14, 2.2),
          onclick: () => openDealForm(null, { presets: { companyId: id } }),
        }, ' Add'),
        deals.length
          ? el('div.deal-list', {}, deals.map((d) => el('a.deal-row', { href: `#/pipeline?id=${d.id}` },
              el('div.grow.min0', {},
                el('div.deal-row-name', {}, d.name),
                el('div.person-sub', {}, d.expectedClose && isOpen(d)
                  ? `Expected ${formatDate(d.expectedClose)}` : `Updated ${timeAgo(d.updatedAt)}`)
              ),
              el('span.deal-row-value', {}, rateText(d, store.settings.currency)),
              stageBadge(d.stage)
            )))
          : el('p.card-empty', {}, 'No deals with this company yet.')
      ),

      section('History',
        el('button.btn.btn-ghost.btn-sm', {
          html: icon('plus', 14, 2.2),
          onclick: () => openActivityForm(null, { presets: { companyId: id } }),
        }, ' Log'),
        history.length
          ? el('div.activity-list', {}, history.map((a) =>
              activityRow(a, { context: { companyId: id }, onEdit: (act) => openActivityForm(act) })))
          : el('p.card-empty', {}, 'Meetings, calls, emails, and notes involving this company show up here.')
      ),

      attachmentsSection({ companyId: id }),
    ]);
  }

  const renderOnChange = keepingFocus(render);
  store.addEventListener('change', renderOnChange);
  render();

  root.append(
    el('a.back-link', { href: '#/companies', html: icon('chevL', 16, 2.2) }, 'Companies'),
    body
  );
  root.destroy = () => store.removeEventListener('change', renderOnChange);
  return root;
}
