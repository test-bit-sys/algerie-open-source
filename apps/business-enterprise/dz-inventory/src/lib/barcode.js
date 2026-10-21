/**
 * Code 128 barcode generation, hand-rolled as SVG — in keeping with the
 * app's hand-rolled charts and no-dependency stance. Code 128 encodes
 * the full printable-ASCII range (so SKUs work as-is) and every scanner
 * the app supports reads it.
 *
 * Pure; unit-tested. The DOM never appears here — the SVG is a string.
 */

/**
 * Symbol widths, values 0–106. Each entry is six digits — alternating
 * bar/space module counts summing to 11 — except the stop symbol (106),
 * which is seven summing to 13. Straight from the Code 128 spec table.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

/** Can this text be encoded at all? Code 128 B covers ASCII 32–126. */
export function encodable(text) {
  const s = String(text ?? '');
  return s.length > 0 && [...s].every((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 32 && c <= 126;
  });
}

/**
 * Encode text into Code 128 symbol values, start through stop, with the
 * checksum in place. Pure digits of even length use code set C (half
 * the width); everything else uses code set B. Null when unencodable.
 */
export function encode128(text) {
  const s = String(text ?? '');
  if (!encodable(s)) return null;

  const symbols = [];
  if (/^\d+$/.test(s) && s.length % 2 === 0 && s.length >= 2) {
    symbols.push(START_C);
    for (let i = 0; i < s.length; i += 2) symbols.push(Number(s.slice(i, i + 2)));
  } else {
    symbols.push(START_B);
    for (const ch of s) symbols.push(ch.charCodeAt(0) - 32);
  }

  let sum = symbols[0];
  for (let i = 1; i < symbols.length; i++) sum += symbols[i] * i;
  symbols.push(sum % 103);
  symbols.push(STOP);
  return symbols;
}

/** Total width in modules, including the quiet zones. */
function moduleCount(symbols, quiet) {
  // Every symbol is 11 modules except the 13-module stop.
  return quiet * 2 + (symbols.length - 1) * 11 + 13;
}

/**
 * The barcode as an SVG string: black bars on transparent, a `quiet`
 * modules margin each side (the spec minimum is 10), scaling cleanly to
 * whatever box it's put in via its viewBox. Null when unencodable.
 */
export function barcodeSVG(text, { height = 44, quiet = 10, label = '' } = {}) {
  const symbols = encode128(text);
  if (!symbols) return null;
  const total = moduleCount(symbols, quiet);

  let x = quiet;
  const rects = [];
  for (const value of symbols) {
    const widths = PATTERNS[value];
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]);
      // Even indexes are bars, odd are spaces.
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
      x += w;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" `
    + `preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(label || `Barcode ${text}`)}" `
    + `fill="#000" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/* ---------- Codes for products ---------- */

/** The value a label should encode: the barcode, else the SKU (a scan
 *  of either finds the product), else nothing. */
export function codeForProduct(product) {
  const barcode = String(product?.barcode ?? '').trim();
  if (barcode) return barcode;
  return String(product?.sku ?? '').trim();
}

const INTERNAL = /^INV-(\d+)$/;

/**
 * Generate `count` internal codes (INV-000001, …) that collide with no
 * existing barcode or SKU — scanning resolves against both, so both
 * namespaces have to stay clear.
 */
export function nextInternalCodes(products, count = 1) {
  let max = 0;
  for (const p of products || []) {
    for (const value of [p.barcode, p.sku]) {
      const hit = INTERNAL.exec(String(value ?? '').trim());
      if (hit) max = Math.max(max, Number(hit[1]));
    }
  }
  const out = [];
  for (let i = 1; i <= count; i++) out.push(`INV-${String(max + i).padStart(6, '0')}`);
  return out;
}
