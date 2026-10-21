/**
 * Per-browser preferences in localStorage (theme, layout, defaults). Reads
 * and writes never throw: storage can be unavailable in private windows.
 */
const KEY = 'api-client:prefs';
const DEFAULTS = {
  theme: 'system',
  sidebarWidth: 280,
  sidebarOpen: true,
  sidebarSection: 'collections',
  layout: 'stacked',
  split: 0.48,
  consoleOpen: false,
  consoleHeight: 220,
  rightPanel: null,
  rightWidth: 360,
  transport: 'auto',
  timeoutMs: 0,
  followRedirects: true,
  wrapResponse: true,
  editorFontSize: 13,
  historyGrouping: 'date',
  lastOpened: 0,
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export const prefs = {
  get(k) {
    return load()[k];
  },
  set(k, v) {
    // Re-read first: another tab may have changed other preferences since this one loaded them.
    cache = null;
    load()[k] = v;
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {}
  },
  all: () => ({ ...load() }),
};

export function resolvedTheme(theme = prefs.get('theme')) {
  if (theme === 'light' || theme === 'dark') return theme;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme = prefs.get('theme')) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const resolved = resolvedTheme(theme);
  root.dataset.themeResolved = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#18181b' : '#ffffff');
}

export function setTheme(theme) {
  prefs.set('theme', theme);
  applyTheme(theme);
}

export function watchSystemTheme() {
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  mq?.addEventListener?.('change', () => {
    if (prefs.get('theme') === 'system') applyTheme('system');
  });
  // A theme picked in another tab applies here too.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const before = prefs.get('theme');
    cache = null;
    if (prefs.get('theme') !== before) applyTheme();
  });
}
