/**
 * Adding pages to a draft: the exhibit that arrived late, the rate sheet, the
 * photo of a page that already carries a wet signature.
 *
 * Appended to the end, where the fields already placed cannot be disturbed by
 * them. Drafts only: once links exist, signers have been served that file.
 */

import { el, append, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { bindDropzone } from './dropzone.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { formatBytes } from '../lib/util.js';
import { mergeFiles } from '../lib/pdfedit.js';
import { fileList, MAX_FILE_BYTES, MAX_PAGES } from './filelist.js';

export function openAddPages(doc, { onDone = () => {} } = {}) {
  if (doc.status !== 'draft') {
    toast('Only a draft can take new pages', { icon: 'info' });
    return;
  }

  const fileInput = el('input', {
    type: 'file', accept: 'application/pdf,.pdf,image/*', multiple: true,
    className: 'visually-hidden',
    onchange: () => {
      if (fileInput.files?.length) files.add(fileInput.files);
      fileInput.value = '';
    },
  });

  const files = fileList({ onChange: () => renderState() });

  const zone = el('button.dropzone', {
    type: 'button', onclick: () => fileInput.click(),
  },
    el('span', { html: icon('cloudUpload', 26) }),
    el('span.dz-title', {}, 'Choose files or drop them here'),
    el('span.dz-sub', {}, `PDFs and images, up to ${formatBytes(MAX_FILE_BYTES)} each`)
  );
  bindDropzone(zone, (file, all) => files.add(all || [file]));

  const status = el('p.small.faint', { style: { marginTop: '12px', textAlign: 'center' }, 'aria-live': 'polite' });
  const actions = el('div');
  const addBtn = el('button.btn.btn-primary.btn-block', {
    type: 'button', style: { padding: '12px', marginTop: '14px' }, html: icon('plus', 16, 2.2),
    onclick: () => run(),
  }, ' Add to the document');

  function renderState() {
    clear(actions);
    if (!files.items.length) return;
    const total = doc.pageCount + files.totalPages();
    const problem = files.problem() || (total > MAX_PAGES
      ? `That would be ${total} pages. The limit is ${MAX_PAGES} in one document.`
      : '');
    append(actions, [
      el('button.btn.btn-soft.btn-block', {
        type: 'button', style: { marginTop: '10px' }, html: icon('plus', 15, 2.2),
        onclick: () => fileInput.click(),
      }, ' Add another file'),
      addBtn,
      problem && problem !== 'Still reading…'
        ? el('p.field-error', { style: { textAlign: 'center' } }, problem)
        : el('p.small.faint', { style: { textAlign: 'center', marginTop: '8px' } },
          `${doc.pageCount} + ${files.totalPages()} = ${total} pages, added at the end.`),
    ]);
    addBtn.disabled = Boolean(problem) || !files.ready();
  }

  const body = el('div', {}, zone, fileInput, files, actions, status);
  const modal = openModal({ title: 'Add pages', content: body });

  let busy = false;
  async function run() {
    if (busy || !files.ready()) return;
    busy = true;
    addBtn.disabled = true;
    zone.disabled = true;
    const payload = files.payload();
    // Read before the write: `doc` IS the store's own record, so replacePdf
    // updates this very object and the difference measured afterwards is
    // always zero ("0 pages added").
    const before = doc.pageCount;
    status.textContent = 'Adding the pages…';
    try {
      const current = await store.readPdf(doc.id);
      const { bytes, pageCount } = await mergeFiles(payload, { onto: current });
      await store.replacePdf(doc.id, bytes, pageCount, {
        audit: { type: 'pages_added', detail: payload.map((item) => item.name).join(', ') },
      });
      modal.close();
      const added = pageCount - before;
      toast(`${added} page${added === 1 ? '' : 's'} added`, { icon: 'check' });
      onDone();
    } catch (err) {
      console.error(err);
      status.textContent = '';
      toast(err.message || 'Could not add those pages', { icon: 'triangleAlert', duration: 5000 });
      busy = false;
      zone.disabled = false;
      renderState();
    }
  }
}
