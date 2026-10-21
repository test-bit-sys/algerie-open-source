/**
 * Page history: earlier versions of a page, a read-only preview of each,
 * and restoring one (which replaces the page's blocks in a single edit
 * that can itself be undone and merges with everyone else's).
 */
import { h, announce } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { makeDoc, local } from '../data/ydoc.js';
import { listBlocks, insertBlocks, blocksOf } from '../data/page.js';
import { Editor } from '../editor/editor.js';
import { openDialog, confirmDialog } from './dialog.js';
import { getPage, displayTitle } from '../data/tree.js';

function label(at) {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? `Today, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Replaces a page's blocks with a version's blocks, as one edit. */
export function restoreBlocks(doc, version) {
  // Same block ids, so comments and links to blocks keep pointing at them.
  const blocks = listBlocks(version).map(({ order, ...rest }) => rest);
  local(doc, () => {
    for (const id of [...blocksOf(doc).keys()]) blocksOf(doc).delete(id);
    insertBlocks(doc, blocks);
  });
}

export async function openHistory(app, space, pageId) {
  const page = getPage(space.tree, pageId);
  const list = h('ul.history-list', { role: 'listbox', 'aria-label': 'Versions' });
  const preview = h('div.history-preview', h('p.history-empty', 'Loading versions...'));
  const restore = h('button.btn.primary', { type: 'button', disabled: true }, icon('rotateCcw', 15), 'Restore this version');
  let current = null;
  let editor = null;
  const dlg = openDialog({
    title: `History of ${displayTitle(page)}`,
    className: 'history-dialog',
    wide: true,
    body: h('div.history', list, h('div.history-side', preview, space.canEdit ? h('div.history-actions', restore) : null)),
    onClose: () => {
      closed = true;
      editor?.destroy();
    },
  });
  let request = 0;
  let closed = false;
  const show = async (v, item) => {
    const mine = ++request;
    for (const li of list.children) li.setAttribute('aria-selected', String(li === item));
    preview.replaceChildren(h('p.history-empty', 'Loading...'));
    restore.disabled = true;
    try {
      const state = await space.versionState(pageId, v);
      // Only the version picked last is shown (a slower earlier load is ignored).
      if (mine !== request || closed) return;
      editor?.destroy();
      current = makeDoc(state);
      const host = h('div.editor-host');
      preview.replaceChildren(host);
      editor = new Editor(host, current, { space, readOnly: true, tree: () => space.tree, navigate: () => {}, pageTitle: (id) => app.pageTitle(id, space), toast: () => {} });
      restore.disabled = false;
    } catch (err) {
      if (mine !== request || closed) return;
      preview.replaceChildren(h('p.history-empty', err.message || 'This version could not be opened.'));
      restore.disabled = true;
    }
  };
  restore.addEventListener('click', async () => {
    if (!current) return;
    const ok = await confirmDialog({ title: 'Restore this version?', message: 'The page goes back to how it looked then. You can undo this, and the current version stays in the history.', confirm: 'Restore' });
    if (!ok) return;
    restoreBlocks(await space.doc(pageId), current);
    dlg.close();
    app.toast('Version restored');
    announce('Version restored');
  });
  list.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('[role="option"]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      next?.focus();
      next?.click();
    }
  });
  let versions;
  try {
    versions = await space.listVersions(pageId);
  } catch (err) {
    preview.replaceChildren(h('p.history-empty', err.message || 'History could not be loaded.'));
    return;
  }
  if (!versions.length) {
    preview.replaceChildren(h('p.history-empty', 'No earlier versions yet. A version is saved as you work, at most every few minutes.'));
    return;
  }
  versions.forEach((v, i) => {
    const li = h('li.history-item', { role: 'option', tabindex: i === 0 ? '0' : '-1', 'aria-selected': 'false' }, h('span.history-when', label(v.at)), v.by ? h('span.history-by', v.by) : null);
    li.addEventListener('click', () => show(v, li));
    list.append(li);
  });
  list.firstChild.focus();
  list.firstChild.click();
}
