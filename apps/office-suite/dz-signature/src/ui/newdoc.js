/**
 * New document: a dropzone modal that accepts PDFs and images, merges them in
 * the order given, creates a draft, and routes to the editor. Templates come
 * first when there are any — re-sending a known document is the repeat path,
 * and uploading is the one-off.
 */

import { el, append, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { bindDropzone } from './dropzone.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { formatBytes } from '../lib/util.js';
import { mergeFiles } from '../lib/pdfedit.js';
import { fileList, MAX_FILE_BYTES } from './filelist.js';
import { templateList, openTemplatesModal } from './templates.js';

/** A title from the first file's name: "client-nda_v2.pdf" -> "client nda v2". */
export function titleFromName(name) {
  return String(name || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .slice(0, 200) || 'Untitled document';
}

export function openNewDocModal({ navigate }) {
  const fileInput = el('input', {
    type: 'file', accept: 'application/pdf,.pdf,image/*', multiple: true,
    className: 'visually-hidden',
    onchange: () => {
      if (fileInput.files?.length) files.add(fileInput.files);
      // Same file twice in a row still fires a change.
      fileInput.value = '';
    },
  });

  const files = fileList({ onChange: () => renderState() });

  const zone = el('button.dropzone', {
    type: 'button',
    onclick: () => fileInput.click(),
  },
    el('span', { html: icon('cloudUpload', 30) }),
    el('span.dz-title', {}, 'Choose files or drop them here'),
    el('span.dz-sub', {}, `PDFs and images, up to ${formatBytes(MAX_FILE_BYTES)} each. They are uploaded to your own Puter cloud.`)
  );

  bindDropzone(zone, (file, all) => files.add(all || [file]));

  const status = el('p.small.faint', { style: { marginTop: '12px', textAlign: 'center' }, 'aria-live': 'polite' });
  const createBtn = el('button.btn.btn-primary.btn-block', {
    type: 'button', style: { padding: '12px', marginTop: '14px' }, html: icon('filePlus', 16, 2),
    onclick: () => build(),
  }, ' Create document');
  const actions = el('div');

  function renderState() {
    clear(actions);
    if (!files.items.length) return;
    const problem = files.problem();
    append(actions, [
      el('button.btn.btn-soft.btn-block', {
        type: 'button', style: { marginTop: '10px' }, html: icon('plus', 15, 2.2),
        onclick: () => fileInput.click(),
      }, ' Add another file'),
      createBtn,
      problem && problem !== 'Still reading…'
        ? el('p.field-error', { style: { textAlign: 'center' } }, problem)
        : null,
    ]);
    createBtn.disabled = !files.ready();
    createBtn.textContent = '';
    createBtn.innerHTML = icon('filePlus', 16, 2);
    const pages = files.totalPages();
    createBtn.append(files.items.length > 1
      ? ` Merge ${files.items.length} files${pages ? ` · ${pages} pages` : ''}`
      : ' Create document');
  }

  // Templates lead when there are any.
  const templates = store.listTemplates();
  const body = el('div');
  let list = null;
  if (templates.length) {
    list = templateList({ navigate, limit: 5, onClose: () => modal.close() });
    append(body, [
      el('div.card-title', { style: { marginBottom: '8px' } }, 'Start from a template'),
      list,
      templates.length > 5 && el('button.btn.btn-ghost.btn-sm', {
        type: 'button', style: { marginTop: '10px' },
        onclick: () => { modal.close(); openTemplatesModal({ navigate }); },
      }, `All ${templates.length} templates`),
      el('div.or-rule', { 'aria-hidden': 'true' }, el('span', {}, 'or upload files')),
    ]);
  }
  append(body, [zone, fileInput, files, actions, status]);

  const modal = openModal({
    title: 'New document',
    content: body,
    onClose: () => list?.destroy?.(),
  });

  let busy = false;
  async function build() {
    if (busy || !files.ready()) return;
    busy = true;
    zone.disabled = true;
    createBtn.disabled = true;
    const payload = files.payload();
    status.textContent = payload.length > 1
      ? `Merging ${payload.length} files…`
      : `Uploading ${payload[0].name}…`;
    try {
      const { bytes, pageCount } = await mergeFiles(payload);
      const doc = await store.createDoc({
        title: titleFromName(payload[0].name),
        fileName: payload.length > 1 ? 'document.pdf' : payload[0].name,
        pdfBytes: bytes,
        pageCount,
        origin: payload.length > 1
          ? { type: 'merged', detail: payload.map((item) => item.name).join(', ') }
          : null,
      });
      modal.close();
      navigate(`#/doc/${doc.id}/edit`);
    } catch (err) {
      console.error(err);
      status.textContent = '';
      toast(err.message || 'Could not build that document', { icon: 'triangleAlert', duration: 5000 });
      busy = false;
      zone.disabled = false;
      renderState();
    }
  }
}
