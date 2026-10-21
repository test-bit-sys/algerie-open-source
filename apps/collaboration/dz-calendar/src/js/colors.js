/**
 * Event color palette — the single source of truth for event colors. Views
 * inject the chosen `hex` inline (as `--chip-color` / `--ev-fill`) via
 * `colorHex()`, so there are no mirrored CSS tokens to keep in sync.
 *
 * `fg` is the ink that reads on a fill of that color (chip text runs at
 * 12–13px, where WCAG AA wants 4.5:1). Near-black ink clears that bar on a
 * bright fill, but on a mid-tone one it reads as a heavy smudge rather than as
 * text — so the fills are pitched deep enough to carry white ink at 4.5:1 or
 * better, and white is the ink everywhere it works. Amber is the exception
 * every palette has: an orange dark enough for white ink is a brown, so it
 * stays bright and keeps the near-black ink. Injected beside the fill as
 * `--ev-fg` wherever text or a glyph sits ON the color.
 */
const DARK_INK = '#101216'; // the dark theme's own base — reads as "black" on a chip
export const EVENT_COLORS = [
  { key: 'blue', label: 'Blue', hex: '#3171e0', fg: '#ffffff' }, // 4.6:1
  { key: 'indigo', label: 'Indigo', hex: '#5b5ef4', fg: '#ffffff' }, // 4.8:1
  { key: 'violet', label: 'Violet', hex: '#9355dc', fg: '#ffffff' }, // 4.6:1
  { key: 'pink', label: 'Pink', hex: '#d52f85', fg: '#ffffff' }, // 4.6:1
  { key: 'red', label: 'Red', hex: '#d73b3c', fg: '#ffffff' }, // 4.6:1
  { key: 'orange', label: 'Orange', hex: '#f59e0b', fg: DARK_INK }, // 8.7:1 (white: 2.2)
  { key: 'green', label: 'Green', hex: '#088657', fg: '#ffffff' }, // 4.6:1
  { key: 'teal', label: 'Teal', hex: '#078477', fg: '#ffffff' }, // 4.6:1
  { key: 'graphite', label: 'Graphite', hex: '#6b7280', fg: '#ffffff' }, // 4.8:1
];

export const DEFAULT_COLOR = 'indigo';

const COLOR_MAP = new Map(EVENT_COLORS.map((c) => [c.key, c]));

export function isValidColor(key) {
  return COLOR_MAP.has(key);
}

export function colorHex(key) {
  return (COLOR_MAP.get(key) || COLOR_MAP.get(DEFAULT_COLOR)).hex;
}

/** The ink that reads on a `colorHex(key)` fill — see the palette note. */
export function colorFg(key) {
  return (COLOR_MAP.get(key) || COLOR_MAP.get(DEFAULT_COLOR)).fg;
}

export function colorLabel(key) {
  return (COLOR_MAP.get(key) || COLOR_MAP.get(DEFAULT_COLOR)).label;
}

/* ---- Category names --------------------------------------------------- */
//
// The sidebar calls these rows "Categories", but the labels above are only the
// palette's own names, and "Violet" means nothing to someone filing events
// under Family. So the label is renameable while the key is not: events, the
// filter (`settings.hiddenColors`), and the app-to-app API all store the key,
// which means a rename touches no event and no wire format — just a name in
// `settings.categoryNames`.

/** Long enough for "Personal projects"; short enough not to wrap the sidebar. */
export const MAX_CATEGORY_NAME = 24;

/** The name to show for a category, given the user's `categoryNames` map. */
export function categoryLabel(key, names) {
  const custom = names && names[key];
  if (typeof custom === 'string' && custom.trim()) return custom.trim();
  return colorLabel(key);
}

/**
 * A `categoryNames` map fit to keep: unknown keys, non-strings and blanks
 * dropped, names trimmed and capped. Applied to every map read back from the
 * cloud (which is to say: written by another device, or by a hand-edited KV
 * value) as well as to fresh input.
 *
 * A name equal to the palette default is dropped too, so "renamed back to
 * Violet" and "never renamed" are the same stored state — and so an empty
 * string, the tombstone a cleared name travels as (see store.saveSettings),
 * survives exactly as long as the merge that needs it.
 */
export function sanitizeCategoryNames(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, name] of Object.entries(value)) {
    if (!isValidColor(key) || typeof name !== 'string') continue;
    // Trim again after the cap: a name cut mid-word can end on a space.
    const trimmed = name.trim().slice(0, MAX_CATEGORY_NAME).trim();
    if (!trimmed || trimmed === colorLabel(key)) continue;
    out[key] = trimmed;
  }
  return out;
}
