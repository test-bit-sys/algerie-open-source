/**
 * The files a document is being built from: a reorderable list with the page
 * count of each, shared by the new-document sheet and "add pages" in the
 * editor.
 *
 * Files are read and checked as they are added, so an unreadable one is caught
 * while it can still be removed, not at the end of a merge.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { formatBytes } from '../lib/util.js';
import { inspectPdf } from '../lib/pdfedit.js';

/** Per file. A phone photo is well under this; a scanned contract can be near it. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Rendering hundreds of pages in a browser is its own kind of broken. */
export const MAX_PAGES = 200;

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const isImage = (file) => /^image\//i.test(file.type) || /\.(png|jpe?g|heic|heif|webp|avif)$/i.test(file.name);

/**
 * fileList({ onChange }) -> element with .items, .add(files), .totalPages(),
 * .problem(). Items are { file, name, type, bytes, pages, error }.
 */
export function fileList({ onChange = () => {} } = {}) {
  const items = [];
  const wrap = el('div.file-list');

  function totalPages() {
    return items.reduce((sum, item) => sum + (item.pages || 0), 0);
  }

  /** The one thing stopping this from becoming a document, or ''. */
  function problem() {
    if (!items.length) return '';
    const bad = items.find((item) => item.error);
    if (bad) return bad.error;
    if (items.some((item) => item.pages === null)) return 'Still reading…';
    if (totalPages() > MAX_PAGES) {
      return `That is ${totalPages()} pages. The limit is ${MAX_PAGES} in one document.`;
    }
    return '';
  }

  function render() {
    clear(wrap);
    for (const [index, item] of items.entries()) {
      const meta = item.error
        ? item.error
        : [item.pages === null ? 'Reading…' : `${item.pages} page${item.pages === 1 ? '' : 's'}`,
          formatBytes(item.file.size)].filter(Boolean).join(' · ');
      wrap.append(el('div.file-row', { className: `file-row${item.error ? ' bad' : ''}` },
        el('span.file-icon', { html: icon(item.error ? 'triangleAlert' : (isPdf(item.file) ? 'fileText' : 'images'), 17) }),
        el('div.grow', {},
          el('div.file-name', { title: item.name }, item.name),
          el('div.file-meta', {}, meta)),
        items.length > 1 && el('div.order-arrows', {},
          el('button.icon-btn.order-up', {
            type: 'button', html: icon('chevD', 15), disabled: index === 0,
            title: 'Move up', 'aria-label': `Move ${item.name} earlier`,
            onclick: () => move(index, -1),
          }),
          el('button.icon-btn.order-down', {
            type: 'button', html: icon('chevD', 15), disabled: index === items.length - 1,
            title: 'Move down', 'aria-label': `Move ${item.name} later`,
            onclick: () => move(index, 1),
          })),
        el('button.icon-btn', {
          type: 'button', html: icon('x', 16),
          title: 'Remove', 'aria-label': `Remove ${item.name}`,
          onclick: () => {
            items.splice(index, 1);
            render();
            onChange();
          },
        })));
    }
    if (items.length > 1) {
      wrap.append(el('p.small.faint', { style: { marginTop: '8px' } },
        `Merged in this order into one document${totalPages() ? `, ${totalPages()} pages in all` : ''}.`));
    }
  }

  function move(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= items.length) return;
    const [moved] = items.splice(index, 1);
    items.splice(next, 0, moved);
    render();
    onChange();
    const rows = wrap.querySelectorAll('.file-row');
    const same = rows[next]?.querySelector(delta < 0 ? '.order-up' : '.order-down');
    const partner = rows[next]?.querySelector(delta < 0 ? '.order-down' : '.order-up');
    (same && !same.disabled ? same : partner)?.focus();
  }

  /** Add files, reading each one to learn whether it can be used at all. */
  async function add(files) {
    const fresh = [];
    for (const file of [...files]) {
      if (!isPdf(file) && !isImage(file)) {
        fresh.push({ file, name: file.name, type: file.type, bytes: null, pages: 0, error: 'Not a PDF or an image.' });
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        fresh.push({
          file, name: file.name, type: file.type, bytes: null, pages: 0,
          error: `${formatBytes(file.size)} is over the ${formatBytes(MAX_FILE_BYTES)} limit.`,
        });
        continue;
      }
      fresh.push({ file, name: file.name, type: file.type, bytes: null, pages: null, error: '' });
    }
    items.push(...fresh);
    render();
    onChange();

    for (const item of fresh) {
      if (item.error) continue;
      try {
        item.bytes = new Uint8Array(await item.file.arrayBuffer());
        // pdf-lib is the page counter AND the validity check: a file it cannot
        // parse is one signers could not be shown either.
        item.pages = isPdf(item.file) ? await inspectPdf(item.bytes) : 1;
        if (!item.pages) item.error = 'That PDF has no pages.';
      } catch {
        item.error = isPdf(item.file)
          ? 'Not a readable PDF.'
          : 'This image could not be read. Try a JPEG or PNG.';
        item.pages = 0;
      }
      render();
      onChange();
    }
  }

  render();
  wrap.items = items;
  wrap.add = add;
  wrap.totalPages = totalPages;
  wrap.problem = problem;
  wrap.ready = () => items.length > 0 && !problem();
  /** What mergeFiles() wants: name, type, bytes, and the File for transcoding. */
  wrap.payload = () => items.map(({ file, name, type, bytes }) => ({ file, name, type, bytes }));
  return wrap;
}
