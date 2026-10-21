/**
 * Adding pages to a draft. The dialog is driven for real: files go into the
 * list, the button is pressed, and what the user is told afterwards is read
 * back off the toast.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const toasts = [];
vi.mock('../src/ui/toast.js', () => ({ toast: (message) => toasts.push(message) }));

let merged = { bytes: new Uint8Array([1]), pageCount: 5 };
let pagesPerFile = 3;
vi.mock('../src/lib/pdfedit.js', () => ({
  inspectPdf: async () => pagesPerFile,
  mergeFiles: async () => {
    if (merged instanceof Error) throw merged;
    return merged;
  },
}));

// The real store hands out its OWN record, so replacePdf writes through the
// same object the caller is holding. That aliasing is the point of the first
// test, so the fake reproduces it.
const doc = { id: 'd1', status: 'draft', pageCount: 2 };
vi.mock('../src/lib/store.js', () => ({
  store: {
    readPdf: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    replacePdf: async (id, bytes, pageCount) => {
      doc.pageCount = pageCount;
      return doc;
    },
  },
}));

const { openAddPages } = await import('../src/ui/addpages.js');

const pdfFile = (name = 'exhibit.pdf') =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' });

async function open() {
  openAddPages(doc, { onDone: () => {} });
  const list = document.querySelector('.file-list');
  await list.add([pdfFile()]);
  const addBtn = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.includes('Add to the document'));
  return { list, addBtn };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  document.body.replaceChildren();
  toasts.length = 0;
  doc.status = 'draft';
  doc.pageCount = 2;
  pagesPerFile = 3;
  merged = { bytes: new Uint8Array([1]), pageCount: 5 };
});

describe('add pages', () => {
  it('counts the pages it added, not the ones it ended up with', async () => {
    const { addBtn } = await open();
    expect(addBtn.disabled).toBe(false);
    addBtn.click();
    await settle();
    // Measured against the page count BEFORE the write. Reading doc.pageCount
    // afterwards compares the new count with itself: "0 pages added".
    expect(toasts).toEqual(['3 pages added']);
    expect(doc.pageCount).toBe(5);
  });

  it('says "1 page" when it added one', async () => {
    merged = { bytes: new Uint8Array([1]), pageCount: 3 };
    pagesPerFile = 1;
    const { addBtn } = await open();
    addBtn.click();
    await settle();
    expect(toasts).toEqual(['1 page added']);
  });

  it('refuses a draft that is no longer one', () => {
    doc.status = 'sent';
    openAddPages(doc);
    expect(toasts).toEqual(['Only a draft can take new pages']);
    expect(document.querySelector('.file-list')).toBeNull();
  });

  it('reports a merge that failed and lets the user try again', async () => {
    merged = new Error('exhibit.pdf is not a readable PDF.');
    const { addBtn } = await open();
    addBtn.click();
    await settle();
    expect(toasts).toEqual(['exhibit.pdf is not a readable PDF.']);
    // The dialog is still open, and still usable.
    const again = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.includes('Add to the document'));
    expect(again.disabled).toBe(false);
    expect(doc.pageCount).toBe(2);
  });
});
