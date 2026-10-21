/**
 * Per-device preferences in localStorage: theme, sidebar width and state.
 * Nothing here is content; pages live in the user's Puter cloud.
 */
const KEY = 'wiki:prefs';
const THEME_KEY = 'wiki:theme';
const DEFAULTS = {
  sidebarWidth: 264,
  sidebarOpen: true,
  expanded: {},
  lastPage: null,
  sectionsCollapsed: {},
};

let cache = null;

export function prefs() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function setPref(key, value) {
  prefs()[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode or full storage: preferences just do not persist */
  }
}

/** Test hook: forget the cached copy. */
export function resetPrefs() {
  cache = null;
}

export const THEMES = ['system', 'light', 'dark'];

// The theme has its own key so index.html can apply it before first paint.
export function getTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.includes(t) ? t : 'system';
  } catch {
    return 'system';
  }
}

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set();

export function resolvedTheme(theme = getTheme()) {
  if (theme === 'dark' || theme === 'light') return theme;
  return media?.matches ? 'dark' : 'light';
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  // Colors switch at once instead of fading element by element.
  root.classList.add('theme-switching');
  root.dataset.theme = theme;
  root.dataset.themeResolved = resolvedTheme(theme);
  setTimeout(() => root.classList.remove('theme-switching'), 60);
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.content = root.dataset.themeResolved === 'dark' ? '#191a1c' : '#ffffff';
  for (const fn of listeners) fn(root.dataset.themeResolved);
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'system';
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

media?.addEventListener?.('change', () => {
  if (getTheme() === 'system') applyTheme('system');
});
