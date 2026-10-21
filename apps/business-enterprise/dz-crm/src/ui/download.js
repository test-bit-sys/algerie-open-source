/** Files in and out of the browser: one blob, one click, one cleanup. */

import { el } from './dom.js';

export function downloadFile(filename, content, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Ask the user for a file, and hand it over once they pick one.
 *
 * The input has to be in the document when it is clicked - some mobile
 * engines refuse to open a picker on a detached input, and a detached one
 * is collectable before its change event ever fires, which is why the
 * attachments section keeps its own picker in the page. It is taken out
 * again as soon as the dialog is answered; any stray from a cancel on an
 * engine without the cancel event goes with the next one asked for.
 */
export function pickFile(accept, onPick) {
  for (const stray of document.querySelectorAll('.file-picker')) stray.remove();
  const picker = el('input.file-picker.attachment-picker', {
    type: 'file', accept, tabindex: -1, 'aria-hidden': 'true',
  });
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    picker.remove();
    if (file) onPick(file);
  });
  picker.addEventListener('cancel', () => picker.remove());
  document.body.append(picker);
  picker.click();
}
