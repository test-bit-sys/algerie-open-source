const LS_KEY = 'crm:theme';

/**
 * 'system' leaves the root unstamped so the CSS media query decides;
 * 'light'/'dark' stamp data-theme, which the token scopes make win both ways.
 * The stamp is mirrored to localStorage so index.html can restore it before
 * first paint.
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
    m.setAttribute('content', dark ? '#0d0d0d' : '#f9f9f7');
  }
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColorMeta);
