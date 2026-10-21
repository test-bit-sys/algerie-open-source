/**
 * Printing, two ways:
 *
 *   printView()          — print the current view as-is; the print
 *                          stylesheet strips the app chrome.
 *   printSheet(children) — print a built document (an order sheet, a
 *                          count sheet, a label sheet): the document
 *                          replaces the app on paper entirely, then
 *                          cleans itself up.
 *
 * No PDF library: the browser's own print dialog does paper, PDF, and
 * printer selection better than anything we could bundle.
 */

import { el } from './dom.js';

let activeCleanup = null;

export function printView() {
  window.print();
}

/**
 * Render `children` into the print-only container and open the print
 * dialog. `title`/`subtitle` become the document's heading; `foot`
 * prints small under the content.
 */
export function printSheet(children, { title = '', subtitle = '', foot = '' } = {}) {
  activeCleanup?.();
  // A sheet left behind by an interrupted print would stack under the
  // next one; there is only ever one print document.
  document.getElementById('print-sheet')?.remove();

  const sheet = el('div', { id: 'print-sheet' },
    title ? el('h1.print-title', {}, title) : null,
    subtitle ? el('p.print-sub', {}, subtitle) : null,
    children,
    foot ? el('p.print-foot', {}, foot) : null
  );
  document.body.append(sheet);
  document.body.classList.add('printing');

  // The print media query goes false when the preview closes, which is
  // the one signal every engine agrees on — afterprint is missing on
  // some, and a timer can pull the document out from under a dialog
  // that is still open.
  const printMedia = matchMedia('print');
  let cleaned = false;
  let armed = false;
  let timer;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    if (activeCleanup === cleanup) activeCleanup = null;
    window.removeEventListener('afterprint', cleanup);
    printMedia.removeEventListener?.('change', onMedia);
    sheet.remove();
    document.body.classList.remove('printing');
  };
  const onMedia = (e) => {
    // Ignore the transition into printing; clean up on the way out.
    if (e.matches) { armed = true; return; }
    if (armed) cleanup();
  };
  window.addEventListener('afterprint', cleanup);
  printMedia.addEventListener?.('change', onMedia);
  activeCleanup = cleanup;

  window.print();
  // Deliberately no eager cleanup: on engines where print() returns
  // before the dialog has the page, removing the document here would
  // print a blank sheet. A sheet left behind costs nothing — it is
  // display:none on screen, and the next print replaces it — so the
  // long timer is only there to stop it living for the whole session.
  if (!cleaned) timer = setTimeout(cleanup, 60000);
}

/** A plain table for print sheets. `columns`: [{ label, num }] */
export function printTable(columns, rows) {
  return el('table', {},
    el('thead', {}, el('tr', {}, columns.map((c) => el(c.num ? 'th.num' : 'th', { scope: 'col' }, c.label)))),
    el('tbody', {}, rows.map((cells) => el('tr', {},
      cells.map((value, i) => el(columns[i]?.num ? 'td.num' : 'td', {}, value))
    )))
  );
}
