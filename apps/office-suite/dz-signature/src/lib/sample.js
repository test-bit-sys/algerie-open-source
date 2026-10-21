/**
 * Sample data for onboarding's "explore with sample documents": three
 * documents in three states, with PDFs generated locally by pdf-lib, so
 * nothing is downloaded and nothing real is signed. Sample documents are
 * flagged `sample: true`; links and email are disabled for them in the UI,
 * and the banner's wipe removes them all.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { uid } from './util.js';

const INK = rgb(0.1, 0.1, 0.14);
const MUTED = rgb(0.45, 0.45, 0.5);

const DAY = 86_400_000;
const HOUR = 3_600_000;

/* ---- PDF generation --------------------------------------------------------- */

/** The signature block layout, shared between drawing and field placement.
 *  Two columns on the LAST page; fractions of the page. */
const SIG_BLOCK = {
  top: 0.62, // y fraction where the block starts
  cols: [{ x: 0.09 }, { x: 0.55 }],
  lineW: 0.36,
};

async function makeSamplePdf({ title, subtitle, paragraphs, parties }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const W = 612;
  const H = 792;
  const M = 72;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const write = (text, { size = 11, useFont = font, color = INK, gap = 6 } = {}) => {
    let rest = String(text);
    while (rest.length) {
      let take = rest;
      while (useFont.widthOfTextAtSize(take, size) > W - M * 2 && take.includes(' ')) {
        take = take.slice(0, take.lastIndexOf(' '));
      }
      if (y < M + size) {
        page = pdf.addPage([W, H]);
        y = H - M;
      }
      page.drawText(take, { x: M, y: y - size, size, font: useFont, color });
      y -= size + gap;
      rest = rest.slice(take.length).trimStart();
    }
  };

  write(title, { size: 20, useFont: bold, gap: 8 });
  if (subtitle) write(subtitle, { size: 11, color: MUTED, gap: 18 });
  for (const p of paragraphs) {
    write(p.heading, { size: 12, useFont: bold, gap: 8 });
    write(p.body, { gap: 16 });
  }

  // The signature block always sits on a fresh final page so field fractions
  // are deterministic.
  page = pdf.addPage([W, H]);
  page.drawText('Agreed and accepted', { x: M, y: H - M - 14, size: 14, font: bold, color: INK });
  const blockY = (1 - SIG_BLOCK.top) * H;
  parties.forEach((party, i) => {
    const col = SIG_BLOCK.cols[i % 2];
    const x = col.x * W;
    const lw = SIG_BLOCK.lineW * W;
    const rows = [
      { label: 'Signature', dy: 0 },
      { label: 'Name', dy: -64 },
      { label: 'Date', dy: -128 },
    ];
    for (const row of rows) {
      const ly = blockY + row.dy;
      page.drawLine({ start: { x, y: ly }, end: { x: x + lw, y: ly }, thickness: 0.8, color: MUTED });
      page.drawText(row.label, { x, y: ly - 12, size: 8.5, font, color: MUTED });
    }
    // Above the signature field (which spans ~41pt over the line).
    page.drawText(party, { x, y: blockY + 52, size: 10, font: bold, color: INK });
  });

  return pdf.save();
}

/** Field rects that sit on the drawn signature lines of the last page. */
function partyFields(pageIndex, columnIndex, signerId) {
  const col = SIG_BLOCK.cols[columnIndex];
  const yLine = SIG_BLOCK.top; // fraction from top where the signature line is
  return [
    { id: uid(), signerId, type: 'signature', page: pageIndex, x: col.x, y: yLine - 0.055, w: SIG_BLOCK.lineW, h: 0.052, required: true },
    { id: uid(), signerId, type: 'text', page: pageIndex, x: col.x, y: yLine + 0.081 - 0.033, w: SIG_BLOCK.lineW, h: 0.031, required: true, label: 'Full name' },
    { id: uid(), signerId, type: 'date', page: pageIndex, x: col.x, y: yLine + 0.162 - 0.033, w: SIG_BLOCK.lineW * 0.6, h: 0.031, required: true },
  ];
}

/* ---- Signature images --------------------------------------------------------- */

/** A typed-style signature as a transparent PNG data URL (browser only). */
export function typedSignatureImage(name, { style = 'cursive' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 560;
  canvas.height = 168;
  const ctx = canvas.getContext('2d');
  const families = style === 'plain'
    ? 'Georgia, "Times New Roman", serif'
    : '"Snell Roundhand", "Savoye LET", "Segoe Script", "Brush Script MT", cursive';
  ctx.font = `${style === 'plain' ? 'italic ' : ''}64px ${families}`;
  ctx.fillStyle = '#141432';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(name).width;
  const scale = Math.min(1, (canvas.width - 24) / Math.max(1, width));
  ctx.setTransform(scale, 0, 0, scale, 12, canvas.height / 2);
  ctx.fillText(name, 0, 0);
  return canvas.toDataURL('image/png');
}

/* ---- The dataset ----------------------------------------------------------------- */

const NDA_PARAGRAPHS = [
  { heading: '1. Purpose', body: 'The parties wish to explore a potential business relationship. In connection with these discussions, each party may disclose to the other certain confidential technical and business information that the disclosing party desires to be treated as confidential.' },
  { heading: '2. Confidential information', body: 'Confidential information means any information disclosed by either party to the other, either directly or indirectly, in writing, orally, or by inspection of tangible objects, which is designated as confidential or would reasonably be understood to be confidential given the nature of the information and the circumstances of disclosure.' },
  { heading: '3. Obligations', body: 'Each party agrees not to use any confidential information of the other party for any purpose except to evaluate and engage in discussions concerning the potential business relationship. Each party agrees not to disclose any confidential information to third parties or to its employees, except to those who are required to have the information for the purpose described above.' },
  { heading: '4. Term', body: 'This agreement remains in effect for a period of three years from the date of the last signature below, unless terminated earlier by either party with thirty days written notice. The confidentiality obligations survive termination for two years.' },
];

const CONSULTING_PARAGRAPHS = [
  { heading: '1. Services', body: 'Consultant will provide product design services as described in Exhibit A, including discovery workshops, interface design, and design system documentation, to be delivered according to the schedule agreed by both parties in writing.' },
  { heading: '2. Compensation', body: 'Client will pay Consultant a fixed fee for the engagement, invoiced monthly. Invoices are payable within thirty days of receipt. Reasonable expenses incurred with prior written approval will be reimbursed at cost.' },
  { heading: '3. Intellectual property', body: 'Upon full payment, all deliverables created specifically for Client under this agreement become the property of Client. Consultant retains ownership of pre-existing materials and general know-how, and grants Client a perpetual license to use any such materials embedded in the deliverables.' },
  { heading: '4. Independent contractor', body: 'Consultant is an independent contractor and nothing in this agreement creates an employment, agency, or partnership relationship. Consultant is responsible for all taxes arising from compensation paid under this agreement.' },
];

const OFFER_PARAGRAPHS = [
  { heading: 'The role', body: 'We are delighted to offer you the position of Staff Designer. You will report to the Head of Design and lead design across our core product surfaces, with a focus on craft, systems thinking, and mentorship.' },
  { heading: 'Compensation and benefits', body: 'Your starting salary, equity grant, and benefits are detailed in the attached compensation summary. You will be eligible for our standard health, dental, and retirement plans from your first day.' },
  { heading: 'Start date', body: 'Your anticipated start date is the first Monday of next month. This offer is contingent on completion of our standard background verification and proof of eligibility to work.' },
];

/**
 * Build the sample dataset. Needs the signed-in user for the "me" signer and
 * a browser canvas for the signature images. Returns items for
 * store.importDataset: [{ doc, pdfBytes, sigData }].
 */
export async function sampleDataset(store) {
  const now = Date.now();
  const meName = store.settings.fullName || store.user?.username || 'You';
  const meEmail = store.user?.email || '';

  /* 1: completed NDA */
  const ndaBytes = await makeSamplePdf({
    title: 'Mutual non-disclosure agreement',
    subtitle: 'Between Northwind Labs and Ava Chen Consulting',
    paragraphs: NDA_PARAGRAPHS,
    parties: ['Northwind Labs', 'Ava Chen Consulting'],
  });
  const ndaPages = (await PDFDocument.load(ndaBytes)).getPageCount();
  const ndaMe = { id: uid(), name: meName, email: meEmail, isMe: true, status: 'signed', signedAt: now - 3 * DAY - 2 * HOUR };
  const ndaAva = { id: uid(), name: 'Ava Chen', email: 'ava.chen@example.com', isMe: false, status: 'signed', viewedAt: now - 3 * DAY, signedAt: now - 2 * DAY - 5 * HOUR };
  const ndaFields = [
    ...partyFields(ndaPages - 1, 0, ndaMe.id),
    ...partyFields(ndaPages - 1, 1, ndaAva.id),
  ];
  const dateFmt = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const ndaSigData = {
    [ndaFields[0].id]: { kind: 'image', data: typedSignatureImage(meName) },
    [ndaFields[1].id]: meName,
    [ndaFields[2].id]: dateFmt(ndaMe.signedAt),
    [ndaFields[3].id]: { kind: 'image', data: typedSignatureImage('Ava Chen', { style: 'plain' }) },
    [ndaFields[4].id]: 'Ava Chen',
    [ndaFields[5].id]: dateFmt(ndaAva.signedAt),
  };
  const nda = {
    id: uid(),
    title: 'Mutual non-disclosure agreement',
    fileName: 'mutual-nda.pdf',
    pageCount: ndaPages,
    note: 'Looking forward to working together. Please sign at your convenience.',
    status: 'completed',
    signers: [ndaMe, ndaAva],
    fields: ndaFields,
    links: {},
    emailed: {},
    audit: [
      { at: now - 4 * DAY, type: 'created', detail: 'mutual-nda.pdf' },
      { at: now - 3 * DAY - 3 * HOUR, type: 'sent', detail: '2 signers' },
      { at: now - 3 * DAY - 2 * HOUR, type: 'signed', detail: meName },
      { at: now - 3 * DAY, type: 'viewed', detail: 'Ava Chen' },
      { at: now - 2 * DAY - 5 * HOUR, type: 'signed', detail: 'Ava Chen' },
      { at: now - 2 * DAY - 5 * HOUR, type: 'completed', detail: '' },
    ],
    sample: true,
    createdAt: now - 4 * DAY,
    updatedAt: now - 2 * DAY - 5 * HOUR,
    sentAt: now - 3 * DAY - 3 * HOUR,
    completedAt: now - 2 * DAY - 5 * HOUR,
  };

  /* 2: consulting agreement out for signature, 1 of 2 signed */
  const consultingBytes = await makeSamplePdf({
    title: 'Consulting agreement',
    subtitle: 'Riverbend Studio engagement, Q3',
    paragraphs: CONSULTING_PARAGRAPHS,
    parties: ['Maya Torres', 'Jonah Patel'],
  });
  const consultingPages = (await PDFDocument.load(consultingBytes)).getPageCount();
  const maya = { id: uid(), name: 'Maya Torres', email: 'maya.torres@example.com', isMe: false, status: 'signed', viewedAt: now - DAY - 6 * HOUR, signedAt: now - DAY - 4 * HOUR };
  const jonah = { id: uid(), name: 'Jonah Patel', email: 'jonah.patel@example.com', isMe: false, status: 'viewed', viewedAt: now - 5 * HOUR };
  const consultingFields = [
    ...partyFields(consultingPages - 1, 0, maya.id),
    ...partyFields(consultingPages - 1, 1, jonah.id),
  ];
  const consultingSigData = {
    [consultingFields[0].id]: { kind: 'image', data: typedSignatureImage('Maya Torres') },
    [consultingFields[1].id]: 'Maya Torres',
    [consultingFields[2].id]: dateFmt(maya.signedAt),
  };
  const consulting = {
    id: uid(),
    title: 'Consulting agreement, Riverbend Studio',
    fileName: 'consulting-agreement.pdf',
    pageCount: consultingPages,
    note: '',
    status: 'sent',
    signers: [maya, jonah],
    fields: consultingFields,
    links: {},
    emailed: {},
    audit: [
      { at: now - 2 * DAY, type: 'created', detail: 'consulting-agreement.pdf' },
      { at: now - DAY - 7 * HOUR, type: 'sent', detail: '2 signers' },
      { at: now - DAY - 6 * HOUR, type: 'viewed', detail: 'Maya Torres' },
      { at: now - DAY - 4 * HOUR, type: 'signed', detail: 'Maya Torres' },
      { at: now - 5 * HOUR, type: 'viewed', detail: 'Jonah Patel' },
    ],
    sample: true,
    createdAt: now - 2 * DAY,
    updatedAt: now - 5 * HOUR,
    sentAt: now - DAY - 7 * HOUR,
    completedAt: null,
  };

  /* 3: draft offer letter */
  const offerBytes = await makeSamplePdf({
    title: 'Offer letter',
    subtitle: 'Staff Designer',
    paragraphs: OFFER_PARAGRAPHS,
    parties: ['Company', 'Candidate'],
  });
  const offerPages = (await PDFDocument.load(offerBytes)).getPageCount();
  const offerMe = { id: uid(), name: meName, email: meEmail, isMe: true, status: 'pending' };
  const priya = { id: uid(), name: 'Priya Nair', email: 'priya.nair@example.com', isMe: false, status: 'pending' };
  const offer = {
    id: uid(),
    title: 'Offer letter, Staff Designer',
    fileName: 'offer-letter.pdf',
    pageCount: offerPages,
    note: '',
    status: 'draft',
    signers: [offerMe, priya],
    fields: [
      ...partyFields(offerPages - 1, 0, offerMe.id),
      ...partyFields(offerPages - 1, 1, priya.id),
    ],
    links: {},
    emailed: {},
    audit: [{ at: now - 3 * HOUR, type: 'created', detail: 'offer-letter.pdf' }],
    sample: true,
    createdAt: now - 3 * HOUR,
    updatedAt: now - 3 * HOUR,
    sentAt: null,
    completedAt: null,
  };

  return [
    { doc: nda, pdfBytes: ndaBytes, sigData: ndaSigData },
    { doc: consulting, pdfBytes: consultingBytes, sigData: consultingSigData },
    { doc: offer, pdfBytes: offerBytes, sigData: {} },
  ];
}
