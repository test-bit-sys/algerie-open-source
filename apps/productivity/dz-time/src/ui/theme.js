const LS_KEY = 'hourly:theme';

/**
 * 'system' clears the stamp so the media query rules apply; an explicit
 * choice stamps <html data-theme> so it wins over the OS in both directions.
 */
export function applyTheme(mode) {
  const rootEl = document.documentElement;
  if (mode === 'light' || mode === 'dark') {
    rootEl.dataset.theme = mode;
  } else {
    delete rootEl.dataset.theme;
  }
  try {
    if (mode === 'light' || mode === 'dark') localStorage.setItem(LS_KEY, mode);
    else localStorage.removeItem(LS_KEY);
  } catch {}
  updateThemeColorMeta();
}

export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === 'light' || t === 'dark' ? t : 'system';
}

function updateThemeColorMeta() {
  const dark = currentTheme() === 'dark' ||
    (currentTheme() === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.setAttribute('content', dark ? '#0e0e10' : '#f8f8f9');
  }
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColorMeta);
