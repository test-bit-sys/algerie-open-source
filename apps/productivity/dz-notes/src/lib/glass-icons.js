/**
 * The ribbon's command icons, drawn for this app in a glass idiom shared with the Spreadsheet app
 * (src/spreadsheet/src/ui/command-icons.js): thin ink outlines over top-lit gradient fills in the
 * system palette, see-through layers, round badges for adding and removing. They are original
 * drawings on a 20-unit grid; strokes do not scale, so a 26px ribbon command keeps 1px lines as a
 * 16px one does. Colours come from the --ico-* tokens (styles/icons.css), keyed to the app theme.
 *
 * Drawings for commands the Spreadsheet app also has (paste, bold, table, zoom and the rest) are its
 * bodies verbatim, built with the same helpers and glyph outlines, so the icons match across apps;
 * only Notes' own commands (tags, pens, recording, pages and sections...) are drawn here.
 *
 * Classes: o outline, of outline on paper, s solid ink, and per accent x ∈ {b, g, r, y, n, p}:
 * x stroke only, xf soft fill with stroke, xs solid fill, xw soft fill without stroke. ink / inkf
 * take a pen's colour from --pen-color.
 */

import { ICON_GLYPHS } from './icon-glyphs.js';

const p = (d, c = 'o') => `<path class="${c}" d="${d}"/>`;
/** Outlined rectangles (frames, sheets, tiles) get softly rounded corners unless `rx` says otherwise; fills laid inside a frame stay square. */
const ROUND = 1.6;
const rounds = (c) => /(^| )(o|of|[bgrynp]f)( |$)/.test(c) && !c.includes('dash');
const r = (x, y, w, h, c = 'o', rx = rounds(c) ? +Math.min(ROUND, w / 4, h / 4).toFixed(2) : 0) => `<rect class="${c}" x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ''}/>`;
const ci = (cx, cy, rad, c = 'o') => `<circle class="${c}" cx="${cx}" cy="${cy}" r="${rad}"/>`;
const el = (cx, cy, rx, ry, c = 'o') => `<ellipse class="${c}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;
/**
 * Lettering as outlines from the fonts (icon-glyphs.js), never SVG text: text would be read out as
 * part of a button's or menu item's text, and would depend on the fonts installed.
 */
const t = (x, y, text, size, { weight = 400, italic = false, serif = false, anchor = 'middle', c = 'tx' } = {}) => {
  const font = ICON_GLYPHS[serif ? (italic ? 'serifItalic' : 'serif') : weight >= 600 ? 'sansBold' : 'sans'];
  const scale = size / 1000;
  const chars = [...text].map((ch) => font[ch]);
  if (chars.some((g) => !g)) throw new Error(`glass-icons: no outline for "${text}"`);
  const width = chars.reduce((sum, [adv]) => sum + adv, 0) * scale;
  const x0 = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  let at = 0;
  const parts = chars.map(([adv, d]) => { const part = `<path d="${d}" transform="translate(${at} 0)"/>`; at += adv; return part; });
  return `<g class="${c}" transform="translate(${+x0.toFixed(2)} ${y}) scale(${+scale.toFixed(5)})">${parts.join('')}</g>`;
};

/* ---- Shared pieces ---- */
/** A grid of cells: a frame with `cols` × `rows` cells, optionally a soft header row. */
function cells(x, y, w, h, cols, rows, { head = null, frame = 'of' } = {}) {
  let out = r(x, y, w, h, frame);
  const k = +Math.min(ROUND, w / 4, h / 4).toFixed(2);
  if (head) out += p(`M${x} ${y + h / rows}V${y + k}a${k} ${k} 0 0 1 ${k}-${k}H${x + w - k}a${k} ${k} 0 0 1 ${k} ${k}V${y + h / rows}z`, head);
  let d = '';
  for (let i = 1; i < cols; i++) d += `M${x + (w * i) / cols} ${y}v${h}`;
  for (let j = 1; j < rows; j++) d += `M${x} ${y + (h * j) / rows}h${w}`;
  return out + p(d, 'o ln');
}
/** A table with `fill` laid under its lines. */
const tableWith = (x, y, w, h, cols, rows, fill) => cells(x, y, w, h, cols, rows) + fill + cells(x, y, w, h, cols, rows, { frame: 'o' });
/** A page with rounded corners and a blue glass fold. */
const page = (x = 4.5, y = 2.5, w = 11, h = 15, fold = 3, k = 1.2) => p(`M${x + k} ${y}h${w - fold - k}l${fold} ${fold}v${h - fold - k}a${k} ${k} 0 0 1-${k} ${k}h-${w - 2 * k}a${k} ${k} 0 0 1-${k}-${k}v-${h - 2 * k}a${k} ${k} 0 0 1 ${k}-${k}z`, 'of') + (fold ? p(`M${x + w - fold} ${y}v${fold}h${fold}z`, 'bf') : '');
const lines = (x, y, w, n, gap = 2.5, c = 'o ln') => p(Array.from({ length: n }, (_, i) => `M${x} ${y + i * gap}h${w}`).join(''), c);
const arrowDown = (x, y, len, c = 'b') => p(`M${x} ${y}v${len}M${x - 2.5} ${y + len - 2.5}l2.5 2.5 2.5-2.5`, c);
const arrowUp = (x, y, len, c = 'b') => p(`M${x} ${y + len}v-${len}M${x - 2.5} ${y + 2.5}l2.5-2.5 2.5 2.5`, c);
const arrowRight = (x, y, len, c = 'b') => p(`M${x} ${y}h${len}M${x + len - 2.5} ${y - 2.5}l2.5 2.5-2.5 2.5`, c);
const lock = (x, y) => r(x - 1, y - 4.5, 10, 11.5, 'knock', 2.5) + p(`M${x + 1.5} ${y}v-2a2.5 2.5 0 0 1 5 0v2`, 'o thick') + r(x, y, 8, 6, 'ns', 1.4) + ci(x + 4, y + 3, 0.9, 'glint');
const magnifier = (cx, cy, rad, fill = 'bw') => ci(cx, cy, rad, fill) + ci(cx, cy, rad, 'o') + p(`M${cx + rad * 0.78} ${cy + rad * 0.78}l${rad * 0.85} ${rad * 0.85}`, 'o grip');
const az = (x, y, first = 'A', second = 'Z') => t(x, y, first, 6.5, { weight: 600, c: 'txb' }) + t(x, y + 7, second, 6.5, { weight: 600 });
/** Signs drawn in white on a badge: each a path about (x, y) with half-size `k`. */
const SIGNS = {
  plus: (x, y, k) => `M${x - k} ${y}h${2 * k}M${x} ${y - k}v${2 * k}`,
  minus: (x, y, k) => `M${x - k} ${y}h${2 * k}`,
  x: (x, y, k) => `M${x - k * 0.8} ${y - k * 0.8}l${k * 1.6} ${k * 1.6}M${x + k * 0.8} ${y - k * 0.8}l-${k * 1.6} ${k * 1.6}`,
  check: (x, y, k) => `M${x - k} ${y + 0.1}l${k * 0.7} ${k * 0.7} ${k * 1.3}-${k * 1.5}`,
};
/** A round solid badge carrying a white sign, cut out of the drawing under it by a ring of the surface colour. */
const badge = (cx, cy, sign, hue = 'g', rad = 3.4) => ci(cx, cy, rad + 0.9, 'knock') + ci(cx, cy, rad, `${hue}s`) + p(SIGNS[sign](cx, cy, rad * 0.48), 'wh thick');
/** A solid record dot in a ring of the surface colour. */
const recordDot = (cx, cy, rad = 3) => ci(cx, cy, rad + 0.9, 'knock') + ci(cx, cy, rad, 'rs') + ci(cx - rad * 0.35, cy - rad * 0.35, rad * 0.3, 'glint');
/** A four-pointed sparkle about (cx, cy) with radius `s`. */
const spark = (cx, cy, s, c = 'ys') => {
  const k = s * 0.2;
  return p(`M${cx} ${cy - s}Q${cx + k} ${cy - k} ${cx + s} ${cy}Q${cx + k} ${cy + k} ${cx} ${cy + s}Q${cx - k} ${cy + k} ${cx - s} ${cy}Q${cx - k} ${cy - k} ${cx} ${cy - s}z`, c);
};
/** A small printer, its top-left corner at (x, y): paper in, the body, paper out. */
const printerBadge = (x, y) => r(x + 2, y, 5, 2.5, 'of') + r(x, y + 2.5, 9, 4.5, 'of', 1) + r(x + 2, y + 5, 5, 3.5, 'of') + p(`M${x + 3.2} ${y + 6.8}h2.6`, 'o ln');
/** A microphone centred on `cx`, its capsule's top at `top`, `s` its scale. */
const mic = (cx, top, s = 1) => r(cx - 3 * s, top, 6 * s, 10 * s, 'bs', 3 * s) + p(`M${cx - 1.2 * s} ${top + 2 * s}v3`, 'wh ln') + p(`M${cx - 5.3 * s} ${top + 6.5 * s}a${5.3 * s} ${5.3 * s} 0 0 0 ${10.6 * s} 0`, 'o') + p(`M${cx} ${top + 11.8 * s}v${3 * s}M${cx - 2.8 * s} ${top + 14.8 * s}h${5.6 * s}`, 'o');
const borderIcon = (solid) => {
  const edges = { top: 'M3.5 3.5h13', bottom: 'M3.5 16.5h13', left: 'M3.5 3.5v13', right: 'M16.5 3.5v13', h: 'M3.5 10h13', v: 'M10 3.5v13' };
  const dashed = Object.keys(edges).filter((k) => !solid.includes(k)).map((k) => edges[k]).join('');
  return (dashed ? p(dashed, 'o dash ln') : '') + (solid.length ? p(solid.map((k) => edges[k]).join(''), 'b thick') : '');
};
const star = (c = 'ys') => p('M10 2.6L12 7.85 17.6 8.13 13.23 11.65 14.7 17.07 10 14 5.3 17.07 6.77 11.65 2.4 8.13 8 7.85z', c);
const flag = (hue) => p(`M4.5 3.2h10.8l-2.6 3.6 2.6 3.6H4.5z`, `${hue}s`) + p('M6.2 5h4', 'wh ln') + p('M4.5 2.5v15', 'o thick');
const envelope = r(2, 4.5, 16, 11, 'bs', 2) + p('M2.8 5.6 10 11l7.2-5.4', 'wh') + p('M2.8 14.6l5.2-4.4M17.2 14.6 12 10.2', 'wh ln');
const calendar = r(3, 3.5, 14, 14, 'of', 2.4) + p('M3 7.5V5.9a2.4 2.4 0 0 1 2.4-2.4h9.2A2.4 2.4 0 0 1 17 5.9v1.6z', 'rs') + t(10, 15.4, '31', 7, { weight: 600 });
const handset = 'M5.3 2.5h2.3l1.4 3.7-1.8 1.2a9.4 9.4 0 0 0 5.4 5.4l1.2-1.8 3.7 1.4v2.3a2 2 0 0 1-2 2A14.3 14.3 0 0 1 3.3 4.5a2 2 0 0 1 2-2z';
const person = (cx, cy, s, c) => ci(cx, cy, 3.3 * s, c) + p(`M${cx - 6 * s} ${cy + 10.2 * s}a${6 * s} ${6 * s} 0 0 1 ${12 * s} 0z`, c);
const globe = ci(10, 10, 7, 'bf') + p('M3 10h14M10 3c-2.5 2-3.5 4.5-3.5 7s1 5 3.5 7c2.5-2 3.5-4.5 3.5-7s-1-5-3.5-7z', 'o');
/** A text highlight: a band of colour with letters on it. */
const marked = (c) => r(2, 5, 16, 10, c, 2.5) + t(10, 13.1, 'Abc', 7.6);
const pencil = `<g transform="rotate(45 10 10)">${r(8.2, 1, 3.6, 2.6, 'rf', 0.8) + r(8.2, 3.4, 3.6, 10, 'ys', 0.4) + p('M9.4 3.6v9.6', 'wh ln') + p('M8.2 13.4h3.6L10 17.6z', 'nf') + p('M9.4 16.2h1.2L10 17.6z', 's')}</g>`;
const paperclip = 'M15.5 7.5v6.3a3.2 3.2 0 0 1-6.4 0V5.4a2.1 2.1 0 0 1 4.2 0v8.1a1 1 0 0 1-2 0V7.5';
/** Pens for the Draw tab: tip, band or body in the pen's ink (--pen-color). */
const inkPen = p('M14.6 2.4a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L9.2 13.8l-3-3z', 'inkf') + p('M13.4 3.6l3 3', 'o ln') + p('M6.2 10.8l3 3-4.6 1.7-.2-.2z', 'of') + p('M3.4 15.6l1 1-2 .8z', 'ink');
const inkHighlighter = p('M12.7 2.5l4.8 4.8-6 6-4.8-4.8z', 'of') + p('M6.7 8.5l4.8 4.8-1.8 1.8-4.8-4.8z', 'inkf') + p('M4.9 10.3l4.8 4.8-1.6 1.6-3.8-1z', 'inkf') + r(2, 17, 9, 1.8, 'ink');

/* ---- The icons, keyed by the names the commands use (src/ui/commands.js) ---- */
export const GLASS_ICONS = {
  /* Clipboard */
  paste: r(3, 3.5, 11, 14, 'nf', 2) + r(5.5, 2, 6, 3.2, 'of', 1.2) + page(8.5, 7, 9, 11, 2.5) + lines(10.3, 11.5, 5, 3, 2),
  cut: p('M7.4 11.8 14 2.5M12.6 11.8 6 2.5', 'o') + ci(10, 8.6, 0.7, 's') + ci(6.2, 14.6, 2.7, 'bs') + ci(6.2, 14.6, 1.2, 'knock') + ci(13.8, 14.6, 2.7, 'bs') + ci(13.8, 14.6, 1.2, 'knock'),
  copy: r(2.5, 2.5, 10, 12, 'bf glassy', 2) + r(7.5, 5.5, 10, 12, 'of', 2) + lines(9.7, 9.5, 5.6, 4, 2),
  formatPainter: `<g transform="rotate(45 10 10)">${p('M9 9.5V2.5a1 1 0 0 1 2 0v7', 'of') + p('M7.6 9.5h4.8V12H7.6z', 'bs') + p('M7.6 12h4.8v1.5c0 2.2-1 3.8-2.4 5-1.4-1.2-2.4-2.8-2.4-5z', 'ys')}</g>`,

  undo: p('M7 4.5 3.5 8 7 11.5', 'o thick') + p('M3.5 8h8.5a4.5 4.5 0 0 1 0 9H8', 'o thick'),
  redo: p('M13 4.5 16.5 8 13 11.5', 'o thick') + p('M16.5 8H8a4.5 4.5 0 0 0 0 9h4', 'o thick'),

  /* Font */
  grow: t(7.5, 17.5, 'A', 21) + p('M14.5 6l2.5-3 2.5 3', 'o thick'),
  shrink: t(7.5, 17.5, 'A', 16) + p('M14.5 3l2.5 3 2.5-3', 'o thick'),
  bold: t(10, 16.2, 'B', 17, { weight: 700 }),
  italic: t(10, 16.2, 'I', 18, { italic: true, serif: true }),
  underline: t(10, 14, 'U', 15) + p('M4.5 17.2h11', 'o thick'),
  strike: t(10, 15.5, 'S', 16) + p('M4 10.5h12', 'o'),
  subscript: t(8, 13.5, 'x', 15, { italic: true, serif: true }) + t(15.5, 18, '2', 7, { weight: 600, c: 'txb' }),
  superscript: t(8, 17, 'x', 15, { italic: true, serif: true }) + t(15.5, 8, '2', 7, { weight: 600, c: 'txb' }),
  // The ribbon draws the current colour as a bar under these two.
  highlight: p('M12.7 2.5l4.8 4.8-6 6-4.8-4.8z', 'of') + p('M6.7 8.5l4.8 4.8-1.8 1.8-4.8-4.8z', 'ys') + p('M4.9 10.3l4.8 4.8-1.6 1.6-3.8-1z', 'ys') + p('M13.6 4.6l2.4 2.4', 'o ln'),
  fontColor: t(10, 14.5, 'A', 16),
  clearFormat: t(7.5, 16, 'A', 19) + `<g transform="rotate(-40 15 15.5)">${r(10.6, 12.1, 8.8, 6.8, 'knock', 2.4) + r(11.5, 13, 7, 5, 'ps', 1.4) + r(11.5, 13, 2.8, 5, 'of', 1.2)}</g>`,

  /* Paragraph */
  bullets: ci(4.5, 5, 1.6, 'bs') + ci(4.5, 10, 1.6, 'bs') + ci(4.5, 15, 1.6, 'bs') + p('M8.5 5h9M8.5 10h9M8.5 15h9', 'o'),
  numbering: t(4.5, 7.2, '1', 5.6, { weight: 600, c: 'txb' }) + t(4.5, 12.2, '2', 5.6, { weight: 600, c: 'txb' }) + t(4.5, 17.2, '3', 5.6, { weight: 600, c: 'txb' }) + p('M8.5 5h9M8.5 10h9M8.5 15h9', 'o'),
  outdent: p('M3 3.5h14M9.5 7.5h7.5M9.5 11.5h7.5M3 16.5h14', 'o') + p('M7.5 9.5h-5M4.5 7.5l-2 2 2 2', 'b'),
  indent: p('M3 3.5h14M9.5 7.5h7.5M9.5 11.5h7.5M3 16.5h14', 'o') + p('M2.5 9.5h5M5.5 7.5l2 2-2 2', 'b'),
  alignLeft: p('M3 4.5h14M3 8.5h9M3 12.5h14M3 16.5h9', 'o'),
  alignCenter: p('M3 4.5h14M5.5 8.5h9M3 12.5h14M5.5 16.5h9', 'o'),
  alignRight: p('M3 4.5h14M8 8.5h9M3 12.5h14M8 16.5h9', 'o'),
  paraUp: r(2.5, 9, 10, 8.5, 'bw', 1.5) + lines(4, 11.5, 7, 3, 2.3, 'o') + p('M3 4h9.5', 'o ln') + arrowUp(15.5, 3, 13, 'b thick'),
  paraDown: r(2.5, 2.5, 10, 8.5, 'bw', 1.5) + lines(4, 5, 7, 3, 2.3, 'o') + p('M3 16h9.5', 'o ln') + arrowDown(15.5, 4, 13, 'b thick'),

  /* Tags */
  todoDone: r(3.5, 3.5, 13, 13, 'gs', 3) + p('M6.8 10.3l2.3 2.3 4.2-5', 'wh thick'),
  findTags: p('M2.5 8.5V3.5a1 1 0 0 1 1-1h5l6 6-7.5 7.5-4.5-4.5z', 'yf') + ci(6, 6, 1.2, 'of') + ci(13.5, 13, 4.5, 'knock') + magnifier(13.5, 13, 3.3),
  flag: flag('r'),

  /* Voice, Assist, Email */
  mic: mic(10, 2),
  dictate: mic(6, 3, 0.85) + p('M12 6h5.5', 'b thick') + lines(12, 9.5, 5.5, 3, 2.7, 'o'),
  sparkles: spark(8.5, 11, 6.5, 'ps') + spark(15.5, 4.5, 3) + spark(15.8, 15.2, 2.2, 'bs') + ci(7.4, 9.6, 0.8, 'glint'),
  mail: envelope,

  /* Insert */
  table: cells(2.5, 3.5, 15, 13, 3, 4, { head: 'bf' }) + cells(2.5, 3.5, 15, 13, 3, 4, { frame: 'o' }),
  file: page(2.5, 2.5, 10, 14.5) + lines(4.5, 8, 5, 3, 2.3) + p(paperclip, 'halo') + p(paperclip, 'b thick'),
  printout: page(3.5, 2, 11, 14.5) + r(5.5, 6, 7, 5, 'bw') + p('M5.5 11l2.2-2.6 1.8 1.8 1.2-1.2 1.8 2z', 'gs') + r(9.2, 9.7, 10.6, 10.1, 'knock', 2) + printerBadge(10, 10.5),
  picture: r(2.5, 3.5, 15, 13, 'bf', 2) + p('M2.5 14l4.5-5 3.5 3.5 2.5-2.5 4.5 4.5v.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z', 'gs') + ci(13, 7.5, 1.7, 'ys'),
  // Screen clipping: a dashed selection drawn over a screen.
  screenshot: r(2, 3, 16, 11, 'of', 2) + r(5, 5.5, 8.5, 6, 'bw') + r(5, 5.5, 8.5, 6, 'b dash') + ci(5, 5.5, 1, 'bs') + ci(13.5, 11.5, 1, 'bs') + p('M7 17.5h6M10 14v3.5', 'o'),
  link: p('M8.5 11.5a3 3 0 0 0 4.2 0l3-3a3 3 0 0 0-4.2-4.2l-1 1', 'b thick') + p('M11.5 8.5a3 3 0 0 0-4.2 0l-3 3a3 3 0 0 0 4.2 4.2l1-1', 'o thick'),
  equation: t(10, 15.5, 'π', 15),
  date: calendar,
  time: ci(10, 10, 7.5, 'bs') + ci(10, 10, 5.8, 'of') + p('M10 6.3V10l2.6 1.8', 'o thick') + ci(10, 10, 0.8, 'bs') + p('M10 4.6v.6M15.4 10h-.6M10 15.4v-.6M4.6 10h.6', 'o ln'),
  dateTime: r(2.5, 4.5, 12, 11.5, 'of', 1) + r(2.5, 4.5, 12, 3, 'bf', 1) + p('M5.5 3v3M11.5 3v3', 'o') + ci(14, 14, 4, 'of') + p('M14 11.5V14l1.6 1', 'b'),
  hrLine: lines(3, 3.5, 14, 2, 2.5) + p('M2.5 10h15', 'b grip') + lines(3, 14, 14, 2, 2.5),
  recordAudio: mic(8.5, 2) + recordDot(15.5, 15.5),
  recordVideo: r(1.5, 3.5, 11.5, 9, 'bs', 2) + p('M13 6.6l4.5-2.4v7.6L13 9.4z', 'bs') + ci(4.2, 6, 0.9, 'glint') + recordDot(14.5, 15),
  video: r(1.5, 5.5, 11.5, 9, 'bs', 2) + p('M13 8.6l4.5-2.4v7.6L13 11.4z', 'bs') + ci(4.2, 8, 0.9, 'glint'),
  template: r(6, 2, 11.5, 13.5, 'bf glassy', 2) + r(2.5, 4.5, 11.5, 13.5, 'of', 2) + r(4.2, 6.2, 8.1, 2.6, 'bs', 0.8) + r(4.2, 10.2, 3.6, 5.8, 'gw', 0.6) + r(8.8, 10.2, 3.5, 2.5, 'nw', 0.6) + p('M8.8 14.3h3.5M8.8 16h2.5', 'o ln'),
  insertSpace: r(2.5, 7, 15, 6, 'bw', 1.5) + p('M3 3h14M3 5.2h9M3 14.8h14M3 17h9', 'o') + p('M10 7.6v4.8M8.2 9.2 10 7.6l1.8 1.6M8.2 10.8 10 12.4l1.8-1.6', 'b thick'),
  // Shapes
  shapes: ci(7.5, 7.5, 5, 'bs') + r(8.5, 8.5, 9, 9, 'nf glassy', 2),
  line: p('M4 16 16 4', 'b thick'),
  arrow: p('M4 16 15.5 4.5M9.5 4.5h6v6', 'b thick'),
  doubleArrow: p('M4.5 15.5l11-11M10 4.5h5.5V10M4.5 10v5.5H10', 'b thick'),
  rect: r(2.5, 5, 15, 10, 'bf', 2),
  ellipse: el(10, 10, 7.5, 5.5, 'bf'),
  triangle: p('M10 3.5l7.5 13h-15z', 'bf'),
  diamond: p('M10 2.5l7.5 7.5-7.5 7.5L2.5 10z', 'bf'),

  /* Draw */
  type: t(7.5, 15.5, 'A', 13) + p('M15.5 3.5v13M13.8 3.5h3.4M13.8 16.5h3.4', 'b thick'),
  lasso: p('M10 3c4.1 0 7 1.8 7 4.2s-2.9 4.3-7 4.3-7-1.9-7-4.3S5.9 3 10 3z', 'o dash') + p('M6.4 10.9c-1 1.2-.8 2.6.5 3.1s1.6 1.6.8 2.7-2.3 1.2-3.2.6', 'b') + ci(6.6, 10.6, 1, 'bs'),
  eraser: p('M7 16.5 2.8 12.3a1 1 0 0 1 0-1.4l7.4-7.4a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-7.1 7.1z', 'pf') + p('M2.8 12.3a1 1 0 0 1 0-1.4l3-3 6.4 6.4-2.5 2.5H7z', 'of') + p('M11 18.5h6.5', 'o'),
  pen: inkPen,
  inkPen,
  inkHighlighter,
  palette: p('M10 2.5a7.5 7.5 0 0 0 0 15c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.5-1-2.6 0-.9.7-1.6 1.7-1.6h2A3 3 0 0 0 17.5 8.6C17.5 5.2 14.2 2.5 10 2.5z', 'of') + ci(6, 8.5, 1.5, 'rs') + ci(9, 5.5, 1.5, 'ys') + ci(13, 6, 1.5, 'gs') + ci(6.2, 12.6, 1.5, 'bs'),
  inkToShape: p('M2.5 8.5c.4-3 2.6-5 5-4.3s1.8 3.3-.4 4.4-3.8 1.2-4.6-.1', 'o') + arrowRight(7.8, 10.2, 3.6, 'o') + r(12.5, 7.5, 5.5, 5.5, 'bf') + ci(8.5, 15.8, 2.2, 'gf'),
  trash: p('M3.5 5.5h13M8 5.5V3.5h4v2', 'o') + p('M5 5.5l1 11a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-11', 'of') + p('M8.5 8.5v6M11.5 8.5v6', 'r'),
  penLine: pencil + p('M10.5 18h7', 'o'),

  /* View */
  panel: r(2.5, 3.5, 15, 13, 'of', 2) + p('M2.5 5.5a2 2 0 0 1 2-2H8v13H4.5a2 2 0 0 1-2-2z', 'bs') + p('M4 7h2.5M4 9.5h2.5M4 12h2.5', 'wh') + lines(10, 7, 5.5, 3, 2.5),
  reader: p('M10 5.5C8.5 4 6 3.5 2.5 4v11.5c3.5-.5 6 0 7.5 1.5z', 'bs') + p('M10 5.5c1.5-1.5 4-2 7.5-1.5v11.5c-3.5-.5-6 0-7.5 1.5z', 'of') + p('M4.5 7.5c1.4 0 2.6.2 3.5.7M4.5 10.2c1.4 0 2.6.2 3.5.7', 'wh ln') + p('M12 8.2c.9-.5 2.1-.7 3.5-.7M12 10.9c.9-.5 2.1-.7 3.5-.7', 'o ln'),
  fullPage: p('M2.5 7V3.5a1 1 0 0 1 1-1H7M13 2.5h3.5a1 1 0 0 1 1 1V7M17.5 13v3.5a1 1 0 0 1-1 1H13M7 17.5H3.5a1 1 0 0 1-1-1V13', 'b thick') + page(6.5, 5.5, 7, 9, 2, 0.8),
  exitFullPage: p('M7 2.5V6a1 1 0 0 1-1 1H2.5M13 2.5V6a1 1 0 0 0 1 1h3.5M17.5 13H14a1 1 0 0 0-1 1v3.5M2.5 13H6a1 1 0 0 1 1 1v3.5', 'b thick') + r(8.5, 8.5, 3, 3, 'bf', 0.6),
  pageColor: p('M3.5 9.5 9 4l6.5 6.5L10 16z', 'bf') + p('M3.5 9.5h12', 'b') + p('M9 4 6.5 1.5', 'o') + p('M16.5 11.5c1 1.6 1.6 2.6 1.6 3.3a1.6 1.6 0 0 1-3.2 0c0-.7.6-1.7 1.6-3.3z', 'ys'),
  ruleLines: r(2.5, 2.5, 15, 15, 'of', 2) + p('M2.5 7h15M2.5 10.5h15M2.5 14h15', 'b') + p('M6.5 2.5v15', 'r'),
  // Switch Background: half a light page, half a dark one.
  switchBackground: r(2.5, 3.5, 15, 13, 'of', 2) + p('M10 3.5h5.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10z', 's') + ci(6.2, 10, 2.2, 'ys') + p('M14.6 7.4a2.8 2.8 0 1 0 0 5.2 3.3 3.3 0 0 1 0-5.2z', 'ys'),
  history: p('M10 3a7 7 0 1 1-7 7', 'o') + p('M3 6v4h4', 'o') + p('M10 6.5V10l2.5 1.5', 'b thick') + p('M15.5 1.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z', 'ys'),
  zoomIn: magnifier(8.5, 8.5, 5.5) + p('M6 8.5h5M8.5 6v5', 'o'),
  zoomOut: magnifier(8.5, 8.5, 5.5) + p('M6 8.5h5', 'o'),
  zoom100: magnifier(8.5, 8.5, 5.5, 'bw') + t(8.5, 10.4, '100', 4.6, { weight: 700, c: 'txb' }),
  pageWidth: page(5.5, 4.5, 9, 11, 2) + p('M1.5 10h17M3.5 8l-2 2 2 2M16.5 8l2 2-2 2', 'b'),
  external: p('M15.5 11.5v5h-12v-12h5', 'o') + p('M11.5 3.5h5v5M16.5 3.5l-7 7', 'b thick'),
  sun: p('M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M4 16l1.4-1.4M14.6 5.4 16 4', 'n thick') + ci(10, 10, 4.2, 'ys') + ci(8.6, 8.6, 0.9, 'glint'),
  moon: p('M11.5 2.6a7.5 7.5 0 1 0 6 11.2A6 6 0 0 1 11.5 2.6z', 'ps') + spark(15.6, 5, 2.2) + ci(6.6, 7.4, 0.9, 'glint'),
  monitor: r(2.5, 3.5, 15, 10, 'of', 1.6) + r(3.8, 4.8, 12.4, 7.4, 'bs', 0.8) + p('M7 17.5h6M10 13.5v4', 'o'),

  /* Help */
  question: ci(10, 10, 7.5, 'bs') + t(10, 14.2, '?', 11, { weight: 700, c: 'txw' }),
  keyboard: r(1.5, 5, 17, 10.5, 'of', 2) + p('M4.5 8h1M7.5 8h1M10.5 8h1M13.5 8h1M4.5 10.5h1M7.5 10.5h1M10.5 10.5h1M13.5 10.5h1', 'o thick') + r(6, 12.3, 8, 1.7, 'bs', 0.85),
  info: ci(10, 10, 7.5, 'bs') + p('M10 9v5.2', 'wh grip') + ci(10, 6.1, 1.15, 'txw'),
  accessibility: ci(8, 4, 1.8, 'bs') + p('M3 7.5h10M8 7.5v5M8 12.5l-3 5M8 12.5l3 5', 'o thick') + badge(15, 15, 'check'),

  /* Table */
  pointer: r(2.5, 2.5, 11, 8.5, 'bw') + r(2.5, 2.5, 11, 8.5, 'b dash') + p('M8 6.5v11.2l2.9-2.8 2 4.4 2-1-2-4.3h4z', 'knock') + p('M8 6.5v11.2l2.9-2.8 2 4.4 2-1-2-4.3h4z', 'of'),
  rowAbove: tableWith(2.5, 5.5, 15, 12, 3, 3, r(2.5, 5.5, 15, 4, 'bw')) + badge(4, 4.5, 'plus'),
  rowBelow: tableWith(2.5, 2.5, 15, 12, 3, 3, r(2.5, 10.5, 15, 4, 'bw')) + badge(16, 15.5, 'plus'),
  colLeft: tableWith(5.5, 2.5, 12, 15, 3, 3, r(5.5, 2.5, 4, 15, 'bw')) + badge(4.5, 4, 'plus'),
  colRight: tableWith(2.5, 2.5, 12, 15, 3, 3, r(10.5, 2.5, 4, 15, 'bw')) + badge(16, 16, 'plus'),
  grid: borderIcon([]),
  headerRow: cells(2.5, 3.5, 15, 13, 3, 4, { head: 'bs' }) + cells(2.5, 3.5, 15, 13, 3, 4, { frame: 'o' }),
  sortAZ: az(6, 9) + arrowDown(13.5, 3.5, 13),
  tableToText: cells(2, 2.5, 9.5, 7.5, 2, 2, { head: 'bw' }) + cells(2, 2.5, 9.5, 7.5, 2, 2, { frame: 'o' }) + p('M6.5 11.5v3.5h3M8 13.5l1.5 1.5L8 16.5', 'b') + lines(12, 12, 6, 3, 2.3, 'o'),

  /* Notebooks, sections and pages */
  newPage: page(4.5, 2.5, 11, 15) + badge(14.5, 14.5, 'plus'),
  newSection: r(4, 2.5, 5.5, 4, 'ps', 1.2) + r(2.5, 5, 12.5, 12.5, 'of', 1.8) + lines(5, 9, 7.5, 3, 2.5) + badge(15, 15, 'plus'),
  sectionGroup: r(3, 2.5, 4.5, 4, 'ps', 1) + r(7.8, 2.5, 4.5, 4, 'ns', 1) + r(12.6, 2.5, 4.4, 4, 'gs', 1) + r(2.5, 5.5, 15, 12, 'bf', 1.8) + p('M5 10h10M5 13h7', 'b'),
  notebook: r(4, 2.5, 12.5, 15, 'ps', 1.8) + p('M7 2.5v15', 'wh ln') + r(9, 5.5, 5.5, 3, 'of', 0.6) + p('M2.5 6h3M2.5 10h3M2.5 14h3', 'o thick'),
  subpage: r(2.5, 2.5, 11, 4.5, 'of', 1.2) + p('M4.5 4.75h5', 'o ln') + p('M5 7v5.2h2.5', 'o') + r(7.5, 9.5, 10, 5.5, 'bs', 1.4) + p('M9.5 12.25h5', 'wh'),
  promote: r(2.5, 2.5, 15, 4.5, 'of', 1.2) + p('M4.5 4.75h7', 'o ln') + r(2.5, 9.5, 9.5, 5.5, 'bs', 1.4) + p('M4.5 12.25h5', 'wh') + p('M18 12.25h-3.5M16.2 10.2l-2 2.05 2 2.05', 'b thick'),
  folderOpen: p('M2.5 15.5v-10a1 1 0 0 1 1-1h4l1.5 1.5h7a1 1 0 0 1 1 1v2', 'bf') + p('M2.5 15.5l2.3-6.2a1 1 0 0 1 .9-.6h12l-2.3 6.2a1 1 0 0 1-.9.6z', 'bs'),
  folder: p('M2.5 5a1 1 0 0 1 1-1h4l1.5 1.5h7.5a1 1 0 0 1 1 1V8h-15z', 'nf') + r(2.5, 7, 15, 9.5, 'ns', 1.4) + ci(4.8, 9.2, 0.8, 'glint'),
  fileText: page(4.5, 2.5, 11, 15) + lines(6.5, 8, 7, 4, 2),
  fileGeneric: page(4.5, 2.5, 11, 15),
  lock: page(2.5, 2.5, 10, 14) + lock(9.5, 11.5),
  unlock: page(2.5, 2.5, 10, 14) + p('M11 11.5v-2a2.5 2.5 0 0 1 5 0', 'o') + r(9.5, 11.5, 8, 6, 'nf', 1),

  /* File */
  print: r(5.5, 2.5, 9, 5, 'of') + r(2.5, 7, 15, 7.5, 'bs', 2) + r(5.5, 11.5, 9, 6, 'of', 0.8) + lines(7, 14, 6, 2, 2) + ci(15, 9.3, 0.7, 'glint'),
  download: p('M3.5 13.5v3h13v-3', 'o') + arrowDown(10, 3, 10),
  upload: p('M3.5 13.5v3h13v-3', 'o') + arrowUp(10, 3, 10),
  share: p('M3.5 9.5v7h13v-7', 'o') + p('M10 12.5v-10M7 5.5l3-3 3 3', 'b thick'),
  sync: p('M16.5 7.5a7 7 0 0 0-12.5-1.5M4 3v3h3', 'g thick') + p('M3.5 12.5a7 7 0 0 0 12.5 1.5M16 17v-3h-3', 'g thick'),
  globe,
  translate: p('M2.5 4a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 12.5 4v5A1.5 1.5 0 0 1 11 10.5H7l-3 2.5v-2.5A1.5 1.5 0 0 1 2.5 9z', 'bs') + t(7.5, 9.2, 'A', 6.5, { weight: 600, c: 'txw' }) + p('M8.5 9.5a1.5 1.5 0 0 1 1.5-1.5h6a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-.5v2.5l-3-2.5H10a1.5 1.5 0 0 1-1.5-1.5z', 'of') + t(13, 14.6, 'a', 6.5),
};

/* Tags gallery: each tag drawn in its own colour (src/data/tags.js). */
Object.assign(GLASS_ICONS, {
  'tag:todo': r(3.5, 3.5, 13, 13, 'bf', 3.2),
  'tag:important': star() + ci(8.6, 7.6, 0.8, 'glint'),
  'tag:question': ci(10, 10, 7.5, 'ps') + t(10, 14.2, '?', 11, { weight: 700, c: 'txw' }),
  'tag:remember': marked('yf'),
  'tag:definition': marked('gf'),
  'tag:highlight': marked('ys'),
  'tag:contact': person(10, 6.5, 1, 'bs') + ci(9, 5.5, 0.9, 'glint'),
  'tag:address': p('M4 9.4V16a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 16V9.4L10 4.3z', 'of') + p('M2.5 10.2 10 3.8l7.5 6.4', 'r grip') + r(8.3, 12, 3.4, 5.5, 'bs', 0.8),
  'tag:phone': p(handset, 'gs'),
  'tag:website': globe,
  'tag:idea': p('M10 2.5a5.5 5.5 0 0 0-3.3 9.9c.6.5.8 1.1.8 1.8v.3h5v-.3c0-.7.2-1.3.8-1.8A5.5 5.5 0 0 0 10 2.5z', 'ys') + ci(8, 6, 1, 'glint') + r(7.5, 15, 5, 2.4, 'of', 0.8) + p('M8.5 18.4h3', 'o'),
  'tag:password': ci(6.3, 10, 4, 'ns') + ci(5.4, 10, 1.3, 'knock') + p('M9.8 8.8h7.6l1 1.2-1 1.2h-1.2l-.9 1.4-.9-1.4h-.8l-.9 1.4-.9-1.4H9.8z', 'ns'),
  'tag:critical': ci(10, 10, 7.5, 'rs') + p('M10 5.6v5.2', 'wh grip') + ci(10, 14.1, 1.15, 'txw'),
  'tag:projectA': flag('r'),
  'tag:projectB': flag('y'),
  'tag:movie': r(2.5, 8, 15, 9.5, 'ps', 1.8) + r(2.5, 4, 15, 3.6, 'of', 0.9) + p('M5.5 4l-1.8 3.6M9.5 4 7.7 7.6M13.5 4l-1.8 3.6', 'o') + ci(4.8, 10.2, 0.8, 'glint'),
  'tag:book': p('M5 3h9.5A1.5 1.5 0 0 1 16 4.5V14H6.5A1.5 1.5 0 0 0 5 15.5z', 'gs') + p('M5 15.5A1.5 1.5 0 0 1 6.5 14H16v3.5H6.5A1.5 1.5 0 0 1 5 16z', 'of') + p('M8 6.5h5', 'wh'),
  'tag:music': p('M7.5 14.5V5l9-2v9.5', 'o thick') + p('M7.5 7.5l9-2', 'o thick') + el(5.5, 14.8, 2.4, 2, 'ps') + el(14.5, 12.8, 2.4, 2, 'ps'),
  'tag:source': GLASS_ICONS.fileText,
  'tag:discuss': person(13.5, 6.8, 0.85, 'gs glassy') + person(7.5, 7.2, 1, 'bs'),
  'tag:email': envelope,
  'tag:meeting': calendar,
  'tag:callback': p(handset, 'gs') + p('M12 2.5a5.5 5.5 0 0 1 5.5 5.5M12 5.3A2.7 2.7 0 0 1 14.7 8', 'g'),
  'tag:priority1': r(3.5, 3.5, 13, 13, 'rf', 3.2) + t(10, 13.8, '1', 8.5, { weight: 600, c: 'tx' }),
  'tag:priority2': r(3.5, 3.5, 13, 13, 'yf', 3.2) + t(10, 13.8, '2', 8.5, { weight: 600, c: 'tx' }),
  'tag:client': r(2.5, 6, 15, 11, 'ns', 2) + p('M7.5 6V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V6', 'o thick') + p('M2.5 10.5h15', 'wh ln') + r(8.8, 9.5, 2.4, 2, 'of', 0.5),
});

export function hasGlassIcon(name) {
  return Object.hasOwn(GLASS_ICONS, name);
}

/** The drawing's markup: an `<svg class="ico">` on the 20-unit grid, or null when there is none. */
export function glassMarkup(name, size = 16) {
  const body = GLASS_ICONS[name];
  if (!body) return null;
  return `<svg class="ico" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;
}
