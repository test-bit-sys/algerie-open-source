/**
 * Units of measure. A product is either counted ("each": boxes, mice,
 * notebooks) or measured (kg, litres, metres). Counted stock stays in
 * whole numbers everywhere; measured stock allows decimals.
 *
 * The unit is free text so anyone can track "rolls" or "pallets"; the
 * curated list below is only what the picker suggests. Anything other
 * than "each" is treated as measured, which costs a counted-in-rolls
 * user nothing (they simply never type a decimal).
 */

import { round2 } from './util.js';

export const EACH = 'each';

/** Suggested units, in the order the picker offers them. */
export const UNIT_SUGGESTIONS = [
  { key: EACH, label: 'each (a count of items)' },
  { key: 'kg', label: 'kilograms' },
  { key: 'g', label: 'grams' },
  { key: 'lb', label: 'pounds' },
  { key: 'oz', label: 'ounces' },
  { key: 'L', label: 'litres' },
  { key: 'mL', label: 'millilitres' },
  { key: 'm', label: 'metres' },
  { key: 'cm', label: 'centimetres' },
  { key: 'ft', label: 'feet' },
];

/** Normalize what the user typed; blank means the default, "each". */
export function normalizeUnit(unit) {
  const s = String(unit ?? '').trim();
  if (!s || s.toLowerCase() === EACH) return EACH;
  // Match a suggestion's casing ("KG" → "kg") so the same unit doesn't
  // show up three ways across a list.
  const hit = UNIT_SUGGESTIONS.find((u) => u.key.toLowerCase() === s.toLowerCase());
  return hit ? hit.key : s.slice(0, 12);
}

export function isCountUnit(unit) {
  return normalizeUnit(unit) === EACH;
}

/** Decimal places a quantity in this unit may carry. */
export function unitPrecision(unit) {
  return isCountUnit(unit) ? 0 : 3;
}

/** Clamp and round a quantity the way its unit allows. Never negative. */
export function roundQty(n, unit) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (isCountUnit(unit)) return Math.round(v);
  return Math.round(v * 1000) / 1000;
}

const FMT = new Map();

/** Format a quantity, hiding decimals a counted unit can't have. */
export function formatQtyIn(n, unit) {
  const digits = unitPrecision(unit);
  let fmt = FMT.get(digits);
  if (!fmt) {
    fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: digits });
    FMT.set(digits, fmt);
  }
  return fmt.format(Number(n) || 0);
}

/** The word after the number: "units" for counts, the unit otherwise. */
export function unitLabel(unit, n = 2) {
  if (!isCountUnit(unit)) return normalizeUnit(unit);
  return Math.abs(Number(n)) === 1 ? 'unit' : 'units';
}

/** "2.5 kg", "1 unit", "42 units" — a quantity you can read aloud. */
export function qtyWithUnit(n, unit) {
  return `${formatQtyIn(n, unit)} ${unitLabel(unit, n)}`;
}

/* ---------- Pack sizes ---------- */

/** A usable pack size, or 0 when the product isn't bought in packs. */
export function packSizeOf(product) {
  const n = Number(product?.packSize) || 0;
  return n > 1 ? roundQty(n, product?.unit) : 0;
}

/**
 * English plural for a user-typed pack name. Not linguistics — just
 * enough that "box" doesn't come out as "boxs" in the UI.
 */
function plural(word) {
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** What one pack is called: "case", "box", or just "pack". */
export function packLabel(product, n = 2) {
  const name = String(product?.packName ?? '').trim() || 'pack';
  return Math.abs(Number(n)) === 1 ? name : plural(name);
}

/** Units in `packs` packs, rounded the way the unit allows. */
export function packsToUnits(packs, product) {
  const size = packSizeOf(product);
  if (!size) return roundQty(packs, product?.unit);
  return roundQty(Number(packs) * size, product?.unit);
}

/** "3 cases of 24 = 72 units", for the stock form's preview line. */
export function packSummary(packs, product) {
  const size = packSizeOf(product);
  if (!size) return '';
  const total = packsToUnits(packs, product);
  return `${formatQtyIn(packs, EACH)} ${packLabel(product, packs)} of ${formatQtyIn(size, product.unit)} = ${qtyWithUnit(total, product.unit)}`;
}

/** Value of a quantity at a unit cost, rounded to cents. */
export function qtyValue(quantity, cost) {
  return round2((Number(quantity) || 0) * (Number(cost) || 0));
}
