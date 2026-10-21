/**
 * Possible-duplicates review and the merge flow.
 *
 * Review lists contact pairs matched by identical email, normalized name,
 * or phone, and company pairs by normalized name or website domain. Merge
 * picks a survivor, resolves conflicting fields one by one, re-points
 * every linked record, and drops the merged-away record in the trash so
 * the whole thing is undoable like a delete.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store, CONTACT_STATUSES } from '../lib/store.js';
import { contactDuplicates, companyDuplicates } from '../lib/dupes.js';
import { formatDate, todayISO } from '../lib/util.js';
import { avatar } from './bits.js';

const KINDS = {
  contact: {
    title: 'Merge leads',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'title', label: 'Job title' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'companyId', label: 'Company', display: (v) => store.companyById(v)?.name || '' },
      { key: 'source', label: 'Source' },
      { key: 'status', label: 'Status', display: (v) => CONTACT_STATUSES.find((s) => s.value === v)?.label || String(v || '') },
      { key: 'notes', label: 'Notes' },
    ],
    sub: (c) => [c.title, store.companyById(c.companyId)?.name, c.email].filter(Boolean).join(' · '),
    merge: (survivorId, mergedId, patch) => store.mergeContacts(survivorId, mergedId, patch),
  },
  company: {
    title: 'Merge companies',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'industry', label: 'Industry' },
      { key: 'website', label: 'Website' },
      { key: 'size', label: 'Company size' },
      { key: 'notes', label: 'Notes' },
    ],
    sub: (c) => [c.industry, c.website].filter(Boolean).join(' · '),
    merge: (survivorId, mergedId, patch) => store.mergeCompanies(survivorId, mergedId, patch),
  },
};

const REASON_LABELS = {
  email: 'same email', name: 'same name', phone: 'same phone', domain: 'same domain',
};

const addedOn = (r) => `Added ${formatDate(todayISO(new Date(r.createdAt || Date.now())), { year: 'always' })}`;

/* ---------- merge form ---------- */

export function openMergeForm(kind, a, b) {
  const spec = KINDS[kind];
  let survivor = a;                 // the older record is the natural keeper
  let merged = b;
  const picks = {};                 // field key → chosen raw value (conflicts only)

  const body = el('div');
  const modal = openModal({ title: spec.title, content: body, wide: true });

  const valueText = (field, record) => {
    const raw = record[field.key];
    const text = field.display ? field.display(raw) : String(raw ?? '');
    return text.trim();
  };

  function conflicts() {
    return spec.fields.filter((f) => {
      const va = valueText(f, survivor);
      const vb = valueText(f, merged);
      return va && vb && va !== vb;
    });
  }

  function render() {
    // Picking a survivor or settling a conflict rebuilds this whole body,
    // which tears the pressed button out from under the keyboard - find
    // its rebuilt twin afterwards and hand focus back, the same bargain
    // keepingFocus strikes for the views.
    const focusKey = body.contains(document.activeElement)
      ? document.activeElement.dataset?.focusKey : null;
    clear(body);

    const card = (record, other) => el('button.merge-record', {
      type: 'button',
      className: `merge-record${record === survivor ? ' active' : ''}`,
      'aria-pressed': String(record === survivor),
      dataset: { focusKey: `record-${record.id}` },
      onclick: () => {
        if (record === survivor) return;
        survivor = record;
        merged = other;
        for (const k of Object.keys(picks)) delete picks[k];
        render();
      },
    },
      kind === 'contact'
        ? avatar(record.name)
        : el('span.avatar.square', { 'aria-hidden': 'true', html: icon('building', 18, 1.8) }),
      el('div.grow.min0', {},
        el('div.title', {}, record.name || 'Untitled'),
        el('div.sub', {}, spec.sub(record) || addedOn(record)),
        el('div.merge-keep', {}, record === survivor ? 'Kept · links move here' : 'Merged away · goes to trash')
      )
    );

    const rows = conflicts().map((f) => {
      const option = (record) => {
        const active = (picks[f.key] ?? survivor[f.key]) === record[f.key];
        return el('button.merge-option', {
          type: 'button',
          className: `merge-option${active ? ' active' : ''}`,
          'aria-pressed': String(active),
          dataset: { focusKey: `option-${f.key}-${record.id}` },
          onclick: () => { picks[f.key] = record[f.key]; render(); },
        }, valueText(f, record));
      };
      return el('div.merge-field', {},
        el('span.field-label', {}, f.label),
        el('div.merge-options', {}, option(survivor), option(merged))
      );
    });

    body.append(
      el('p.settings-note.sheet-note', {},
        'Pick the record to keep. Deals, activities, and follow-ups from the other one move to it; the other record goes to Recently deleted for 30 days.'),
      el('div.merge-records', {}, card(a, b), card(b, a)),
      rows.length
        ? el('div.merge-conflicts', {},
            el('h3.csv-preview-title', {}, 'Where they differ'),
            rows)
        : el('p.settings-note', {}, 'No conflicting fields. Anything one record is missing fills in from the other.'),
      el('div.form-actions', {},
        el('button.btn.btn-ghost', { type: 'button', onclick: () => modal.close() }, 'Cancel'),
        el('div.grow'),
        el('button.btn.btn-primary', {
          type: 'button',
          onclick: async (e) => {
            const patch = {};
            // Conflicts take the chosen side; gaps fill from the merged record.
            for (const f of conflicts()) {
              const v = picks[f.key] ?? survivor[f.key];
              if (v !== survivor[f.key]) patch[f.key] = v;
            }
            for (const f of spec.fields) {
              if (!valueText(f, survivor) && valueText(f, merged)) patch[f.key] = merged[f.key];
            }
            // One merge per click: a double-click's second call would find
            // the merged record already gone and put up a second toast -
            // the one without the Undo.
            const btn = e.currentTarget;
            btn.disabled = true;
            let entry;
            try {
              entry = await spec.merge(survivor.id, merged.id, patch);
            } catch {
              btn.disabled = false;
              toast('Couldn’t merge. Check your connection', { icon: 'wifiOff' });
              return;
            }
            modal.close();
            toast(`Merged into ${survivor.name}`, {
              icon: 'merge',
              action: entry && {
                label: 'Undo',
                onClick: () => store.restoreTrash(entry.id)
                  .catch(() => toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' })),
              },
            });
          },
        }, 'Merge records')
      )
    );

    if (focusKey) {
      body.querySelector(`[data-focus-key=${CSS.escape(focusKey)}]`)?.focus();
    }
  }

  render();
  return modal;
}

/* ---------- review ---------- */

export function openDuplicatesReview() {
  const body = el('div');

  function pairRow(kind, pair) {
    const spec = KINDS[kind];
    const line = (r) => el('div.dupe-line', {},
      kind === 'contact' ? avatar(r.name) : el('span.avatar.square', { 'aria-hidden': 'true', html: icon('building', 16, 1.8) }),
      el('div.grow.min0', {},
        el('div.title', {}, r.name || 'Untitled'),
        el('div.sub', {}, spec.sub(r) || addedOn(r))
      )
    );
    return el('div.dupe-pair', {},
      el('div.grow.min0', {},
        line(pair.a),
        line(pair.b),
        el('div.chip-row.dupe-reasons', {}, pair.reasons.map((r) =>
          el('span.chip.static', {}, REASON_LABELS[r] || r)))
      ),
      el('button.btn.btn-ghost.btn-sm', {
        html: icon('merge', 14, 2),
        dataset: { focusKey: `merge-${pair.a.id}-${pair.b.id}` },
        onclick: () => openMergeForm(kind, pair.a, pair.b),
      }, ' Merge…')
    );
  }

  function render() {
    // The list is rebuilt under whatever the keyboard was on; a pair that
    // survives the change keeps its row, so hand it back - the same
    // bargain the merge form above strikes.
    const focusKey = body.contains(document.activeElement)
      ? document.activeElement.dataset?.focusKey : null;
    clear(body);
    const contactPairs = contactDuplicates(store.contacts);
    const companyPairs = companyDuplicates(store.companies);
    const restoreFocus = () => {
      if (focusKey) body.querySelector(`[data-focus-key=${CSS.escape(focusKey)}]`)?.focus();
    };

    if (!contactPairs.length && !companyPairs.length) {
      body.append(el('div.all-clear', { html: icon('check', 18, 2.4) },
        el('span', {}, 'No possible duplicates. Every contact and company looks unique.')));
      return;
    }
    if (contactPairs.length) {
      body.append(
        el('h3.csv-preview-title', {}, `Leads (${contactPairs.length})`),
        el('div.dupe-list', {}, contactPairs.map((p) => pairRow('contact', p)))
      );
    }
    if (companyPairs.length) {
      body.append(
        el('h3.csv-preview-title', {}, `Companies (${companyPairs.length})`),
        el('div.dupe-list', {}, companyPairs.map((p) => pairRow('company', p)))
      );
    }
    restoreFocus();
  }

  render();
  /* The review is a reading of the data, so it follows the data rather
     than only the merges it starts itself. A merge undone from its toast
     puts the pair back while this is still open, and the list said "No
     possible duplicates" over a leads page that plainly said otherwise -
     with no way to ask again short of closing and reopening. */
  const onChange = () => render();
  store.addEventListener('change', onChange);
  return openModal({
    title: 'Possible duplicates',
    wide: true,
    onClose: () => store.removeEventListener('change', onChange),
    content: el('div', {},
      el('p.settings-note.sheet-note', {},
        'Matched by identical email, name, or phone (leads) and name or website domain (companies), after normalizing case and punctuation.'),
      body
    ),
  });
}
