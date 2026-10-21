import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import {
  docStatusMeta, signerProgress, signerColor, isSignerTurn, currentTurn, expiresInWords, isExpired,
} from '../lib/model.js';
import { relativeTime, initialsOf } from '../lib/util.js';
import { openNewDocModal } from '../ui/newdoc.js';
import {
  downloadOriginal, downloadSigned, deleteDocFlow, voidDocFlow, duplicateDocFlow,
} from '../ui/actions.js';
import { saveAsTemplateFlow } from '../ui/templates.js';
import { toast } from '../ui/toast.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'sent', label: 'Out for signature' },
  { id: 'waiting', label: 'Waiting for you' },
  { id: 'completed', label: 'Completed' },
  { id: 'closed', label: 'Closed' },
];

/** The three tiles above the list, each also a shortcut to its own filter. */
const STATS = [
  { id: 'sent', label: 'Out for signature', icon: 'send', count: (docs) => docs.filter((d) => d.status === 'sent').length },
  { id: 'waiting', label: 'Waiting for you', icon: 'penLine', count: (docs) => docs.filter(waitingForMe).length },
  { id: 'completed', label: 'Completed', icon: 'circleCheckBig', count: (docs) => docs.filter((d) => d.status === 'completed').length },
];

/**
 * Sent documents where my own signature is still outstanding AND it is my
 * turn: with sequential signing on, a document parked behind someone else is
 * not something I can act on yet.
 */
function waitingForMe(doc) {
  return doc.status === 'sent'
    && (doc.signers || []).some((s) => s.isMe && s.status !== 'signed' && s.status !== 'declined'
      && isSignerTurn(doc, s.id));
}

export function documentsView({ navigate }) {
  let filter = 'all';
  let query = '';
  let openMenuFor = null;

  const listWrap = el('div');
  // Filtering and search-as-you-type rewrite the list silently; this is the
  // only thing that tells a screen reader what came back.
  const resultsStatus = el('p.visually-hidden', { role: 'status', 'aria-live': 'polite' });
  const statsWrap = el('div.stats-row');
  const filterRow = el('div.filter-row', { role: 'group', 'aria-label': 'Filter documents' });

  const searchInput = el('input.input', {
    type: 'search',
    placeholder: 'Search by title or signer',
    'aria-label': 'Search documents',
    oninput: () => {
      query = searchInput.value.trim().toLowerCase();
      renderList();
    },
  });

  const root = el('div.main-inner', {},
    el('div.view-head', {},
      el('h1', {}, 'Documents'),
      el('button.btn.btn-primary', {
        type: 'button',
        html: icon('plus', 16, 2.4),
        onclick: () => openNewDocModal({ navigate }),
      }, ' New document')
    ),
    statsWrap,
    el('div.search-wrap', { html: icon('search', 17) }, searchInput),
    filterRow,
    resultsStatus,
    listWrap
  );

  function matches(doc) {
    if (filter === 'draft' && doc.status !== 'draft') return false;
    if (filter === 'sent' && doc.status !== 'sent') return false;
    if (filter === 'waiting' && !waitingForMe(doc)) return false;
    if (filter === 'completed' && doc.status !== 'completed') return false;
    if (filter === 'closed' && !['declined', 'voided', 'expired'].includes(doc.status)) return false;
    if (!query) return true;
    const haystack = [doc.title, ...(doc.signers || []).flatMap((s) => [s.name, s.email])]
      .join(' ').toLowerCase();
    return haystack.includes(query);
  }

  /**
   * The tiles and the chips are built ONCE and then only re-stated: rebuilding
   * them on every toggle destroyed the control that was just activated, which
   * dropped keyboard focus to the top of the page.
   */
  const statTiles = new Map();
  const filterChips = new Map();

  function buildStats() {
    clear(statsWrap);
    statTiles.clear();
    for (const s of STATS) {
      const tile = el('button.stat-tile', {
        type: 'button',
        onclick: () => setFilter(s.id),
      },
        el('div.num', {}, '0'),
        el('div.lbl', { html: icon(s.icon, 13, 2) }, el('span', {}, s.label))
      );
      statTiles.set(s.id, tile);
      statsWrap.append(tile);
    }
    syncStats();
    syncPressed();
  }

  function buildFilters() {
    clear(filterRow);
    filterChips.clear();
    for (const f of FILTERS) {
      const chip = el('button.filter-chip', { type: 'button', onclick: () => setFilter(f.id) }, f.label);
      filterChips.set(f.id, chip);
      filterRow.append(chip);
    }
    syncPressed();
  }

  /** The counts, which move as documents do. */
  function syncStats() {
    const docs = store.listDocs();
    for (const s of STATS) {
      const num = statTiles.get(s.id)?.querySelector('.num');
      if (num) num.textContent = String(s.count(docs));
    }
  }

  function syncPressed() {
    for (const [id, tile] of statTiles) {
      tile.setAttribute('aria-pressed', filter === id ? 'true' : 'false');
    }
    for (const [id, chip] of filterChips) {
      chip.setAttribute('aria-pressed', filter === id ? 'true' : 'false');
    }
  }

  function setFilter(next) {
    filter = next;
    syncPressed();
    renderList();
  }

  /* The list is rebuilt on every toggle, so focus has to be re-homed by
     hand: into the menu on open, back onto the (fresh) trigger on close. */
  function setMenu(docId) {
    openMenuFor = docId;
    renderList();
    if (!docId) return;
    const menu = listWrap.querySelector('.menu');
    if (menu) {
      // The last rows sit right above the mobile tab bar, so a menu that only
      // ever opens downward lands under it (or off the page). Flip it up when
      // the space below is not enough.
      const bar = document.querySelector('.tabbar');
      const floor = window.innerHeight - (bar?.getBoundingClientRect().height || 0) - 8;
      const rect = menu.getBoundingClientRect();
      const above = (menu.parentElement.querySelector('[data-menu-for]')?.getBoundingClientRect().top || 0) - 8;
      if (rect.bottom > floor && above > rect.height + 6) menu.classList.add('up');
    }
    menu?.querySelector('.menu-item')?.focus();
  }

  /* Closing removes just the menu node (no list rebuild), so focus moving
     out of it (Tab, or into a row) lands where the user sent it. */
  function closeMenu({ refocus = false } = {}) {
    if (!openMenuFor) return;
    const id = openMenuFor;
    openMenuFor = null;
    listWrap.querySelector('.menu')?.remove();
    const btn = listWrap.querySelector(`[data-menu-for="${id}"]`);
    btn?.setAttribute('aria-expanded', 'false');
    if (refocus) btn?.focus();
  }

  function kebabMenu(doc) {
    const wrap = el('div.menu-wrap');
    const btn = el('button.icon-btn', {
      type: 'button',
      html: icon('more', 18),
      dataset: { menuFor: doc.id },
      'aria-label': `Actions for ${doc.title}`,
      'aria-haspopup': 'menu',
      'aria-expanded': openMenuFor === doc.id ? 'true' : 'false',
      onclick: (e) => {
        e.stopPropagation();
        if (openMenuFor === doc.id) closeMenu({ refocus: true });
        else setMenu(doc.id);
      },
    });
    wrap.append(btn);
    wrap.addEventListener('keydown', (e) => {
      if (openMenuFor !== doc.id) return;
      const items = [...wrap.querySelectorAll('.menu-item')];
      const active = items.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu({ refocus: true });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(active + 1) % items.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(active - 1 + items.length) % items.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      }
    });
    // Tabbing out of the menu dismisses it, like clicking elsewhere does.
    wrap.addEventListener('focusout', (e) => {
      if (openMenuFor === doc.id && !wrap.contains(e.relatedTarget)) closeMenu();
    });
    if (openMenuFor === doc.id) {
      const item = (ic, label, onclick, danger = false) =>
        el(`button.menu-item${danger ? '.danger' : ''}`, {
          type: 'button', role: 'menuitem', html: icon(ic, 16, 2),
          onclick: (e) => {
            e.stopPropagation();
            // Home focus before the action: a dialog it opens returns focus
            // here when it closes.
            closeMenu({ refocus: true });
            onclick();
          },
        }, el('span', {}, label));
      // The same offers as the document page's action list: a progress copy
      // only once there is progress to show, and void for as long as the
      // page itself allows it (an expired document still has live records
      // an extension would reopen).
      const { signed } = signerProgress(doc);
      const menu = el('div.menu', { role: 'menu', 'aria-label': `Actions for ${doc.title}` },
        item('eye', 'Open', () => openDoc(doc)),
        (doc.status === 'completed' || (doc.status === 'sent' && signed > 0)) &&
          item('fileDown', doc.status === 'completed' ? 'Download signed copy' : 'Download progress copy',
            () => downloadSigned(doc).catch(() => toast('Could not build the download', { icon: 'triangleAlert' }))),
        item('download', 'Download original', () =>
          downloadOriginal(doc).catch(() => toast('Could not download the file', { icon: 'triangleAlert' }))),
        el('div.menu-sep'),
        item('copy', 'Duplicate', () => duplicateDocFlow(doc, { navigate })),
        item('template', 'Save as template', () => saveAsTemplateFlow(doc)),
        el('div.menu-sep'),
        (doc.status === 'sent' || doc.status === 'expired') && item('ban', 'Void', () => voidDocFlow(doc), true),
        item('trash', 'Delete', () => deleteDocFlow(doc), true)
      );
      wrap.append(menu);
    }
    return wrap;
  }

  function openDoc(doc) {
    navigate(doc.status === 'draft' ? `#/doc/${doc.id}/edit` : `#/doc/${doc.id}`);
  }

  function docRow(doc) {
    const meta = docStatusMeta(doc.status);
    const { signed, total } = signerProgress(doc);
    const parts = [];
    if (doc.status === 'draft') parts.push(`${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}`);
    else if (total) parts.push(`${signed} of ${total} signed`);
    // Sequential signing: whose move it is says more than the count alone.
    const turn = doc.status === 'sent' ? currentTurn(doc) : null;
    if (turn) parts.push(`waiting on ${turn.isMe ? 'you' : (turn.name || turn.email || 'the next signer')}`);
    // A deadline is only worth the space while it can still be met. The
    // status catches up with the clock on the next timer pass (and not at all
    // offline), so a sent document past its deadline reads "expired", not
    // "expires expired".
    if (doc.status === 'sent' && doc.expiresAt) {
      parts.push(isExpired(doc) ? 'expired' : `expires ${expiresInWords(doc)}`);
    }
    parts.push(`Updated ${relativeTime(doc.updatedAt)}`);

    const row = el('div.doc-row', {
      role: 'button', tabindex: 0,
      'aria-label': `${doc.title}, ${meta.label}`,
      onclick: () => openDoc(doc),
      onkeydown: (e) => {
        // Only the row's own keys. The action menu lives inside the row, so
        // Enter or Space on one of its items bubbles up here: claiming those
        // cancelled the button's activation (preventDefault stops the click a
        // key press would have produced) and opened the document instead, which
        // left the whole menu unusable by keyboard.
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDoc(doc);
        }
      },
    },
      el('span.doc-row-icon', { html: icon(doc.status === 'completed' ? 'fileCheck' : doc.status === 'draft' ? 'filePen' : 'fileText', 21) }),
      el('div.grow', {},
        el('div.doc-row-title', {}, doc.title),
        el('div.doc-row-meta', {}, parts.join(' · '))
      ),
      el('div.doc-row-side', {},
        total > 0 && el('span.avatar-stack', { 'aria-hidden': 'true' },
          doc.signers.slice(0, 4).map((s) =>
            el(`span.avatar.c${signerColor(s, doc.signers)}`, { title: s.name || s.email }, initialsOf(s.name || s.email)))),
        el(`span.chip.${meta.tone}`, { html: icon(meta.icon, 13, 2.2) }, el('span', {}, meta.label)),
        kebabMenu(doc)
      )
    );
    return row;
  }

  function renderList() {
    clear(listWrap);
    const docs = store.listDocs().filter(matches);
    resultsStatus.textContent = docs.length
      ? `${docs.length} document${docs.length === 1 ? '' : 's'}`
      : 'No documents match';
    if (!docs.length) {
      const isEmpty = store.listDocs().length === 0;
      listWrap.append(el('div.empty', {},
        el('div.empty-icon', { html: icon(isEmpty ? 'filePlus' : 'search', 26) }),
        el('h3', {}, isEmpty ? 'No documents yet' : 'Nothing matches'),
        el('p', {}, isEmpty
          ? 'Upload a PDF to place signature fields and send it out for signature.'
          : 'Try a different search or filter.'),
        isEmpty && el('button.btn.btn-primary', {
          type: 'button', style: { marginTop: '18px' },
          onclick: () => openNewDocModal({ navigate }),
        }, 'Upload a PDF')
      ));
      return;
    }
    const list = el('ul.doc-list');
    for (const doc of docs) list.append(el('li', {}, docRow(doc)));
    listWrap.append(list);
  }

  const onStoreChange = () => {
    syncStats();
    renderList();
  };
  store.addEventListener('change', onStoreChange);
  const closeMenus = (e) => {
    if (openMenuFor && !e.target.closest?.('.menu-wrap')) closeMenu();
  };
  document.addEventListener('click', closeMenus);

  buildStats();
  buildFilters();
  renderList();

  root.destroy = () => {
    store.removeEventListener('change', onStoreChange);
    document.removeEventListener('click', closeMenus);
  };
  return root;
}
