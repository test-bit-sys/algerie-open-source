// Entry point: builds the app, installs features, mounts the shell.

import { App } from './app.js';
import { FEATURES } from './features.js';
import { createShell } from './ui/shell.js';
import { openFiles } from './storage/files.js';

const app = new App();
for (const install of FEATURES) install(app);
createShell(app, document.getElementById('app'));
app.setWorkspace(app.prefs.get('workspace') || 'Default');
app.setStatus(`Launched in ${(performance.now() / 1000).toFixed(2)} seconds`);

// Files handed to the app by the Puter desktop ("Open with").
const p = typeof window !== 'undefined' ? window.puter : null;
if (p?.ui?.onLaunchedWithItems) {
  p.ui.onLaunchedWithItems((items) => openFiles(app, items));
}

// Retire the service worker from the previous version of this app.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
}

if (import.meta.env?.DEV) {
  window.as = app;
  // Dev hook: open gitignored test media from .dev-media/ by file name.
  app.openDev = async (names) => {
    const files = await Promise.all(names.map(async (n) => new File([await (await fetch(`/.dev-media/${n}`)).blob()], n)));
    return openFiles(app, files);
  };
}
