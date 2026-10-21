import { el, clear, append } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { pendingWrites, releaseAccount } from '../lib/cloud.js';
import { applyTheme } from '../ui/theme.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { openImporter } from '../ui/importer.js';
import { CURRENCIES } from '../lib/currencies.js';
import { sortProducts } from '../lib/inventory.js';
import { productsToCSV } from '../lib/csv.js';
import { buildBackup, backupFilename, validateBackup, describeBackup } from '../lib/backup.js';
import { downloadFile, formatQty, dateStamp, timeAgo } from '../lib/util.js';
import { DEFAULT_SAFETY_DAYS } from '../lib/demand.js';

const THEMES = [
  { key: 'system', label: 'System', icon: 'monitor' },
  { key: 'light', label: 'Light', icon: 'sun' },
  { key: 'dark', label: 'Dark', icon: 'moon' },
];

/**
 * Why an automatic snapshot was taken, for the restore row's subtitle.
 * One entry per reason the store passes to saveSnapshot — a missing one
 * reads as "saved automatically", which tells the user nothing about
 * what the snapshot sits in front of.
 */
const SNAPSHOT_REASONS = {
  erase: 'before erasing all data',
  import: 'before a CSV import',
  restore: 'before restoring a backup',
  stocktake: 'before applying a stocktake',
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Persist a settings patch. Settings are applied optimistically, so a
 * write that doesn't land leaves the screen showing something the account
 * doesn't hold — reporting that is the difference between a preference
 * and a preference that survives a reload.
 */
async function saveSettings(patch, okMessage = '') {
  try {
    await store.updateSettings(patch);
    if (okMessage) toast(okMessage);
    return true;
  } catch (err) {
    console.error(err);
    toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
    return false;
  }
}

export async function confirmSignOut() {
  // Signing out clears this device's offline mirror and write queue;
  // changes that haven't reached the cloud yet would go with it.
  const unsynced = pendingWrites();
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: unsynced
      ? `${unsynced} change${unsynced === 1 ? ' hasn’t' : 's haven’t'} synced to your Puter account yet and will be lost if you sign out now. Everything already synced stays safe.`
      : 'Your inventory stays safe in your Puter account and will be here when you sign back in.',
    confirmLabel: 'Sign out',
    danger: unsynced > 0,
  });
  if (!ok) return;
  // Let sign-out finish before reloading, or the reload can cut off the
  // session teardown and come back still signed in.
  try { await puter.auth.signOut(); } catch {}
  // The mirror and queue hold this account's data; the next person on
  // this browser must not browse it or replay it into their account.
  await releaseAccount().catch(() => {});
  location.reload();
}

export function settingsView() {
  const root = el('div.main-inner');
  renderInto(root);
  return root;
}

function renderInto(root) {
  clear(root);
  const s = store.settings;

  /* The export row and the snapshot row show live data; update them in
     place so the rest of the form never re-renders under the user (no
     focus loss). */
  const exportSubText = () => {
    const n = store.products.length;
    return `${formatQty(n)} product${n === 1 ? '' : 's'}, re-importable`;
  };
  const exportCount = el('span', {}, exportSubText());
  const backupList = el('div.settings-list');
  const onChange = () => {
    exportCount.textContent = exportSubText();
    renderBackupList();
  };
  store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange);

  root.append(el('div.view-head', {},
    el('div', {},
      el('h1.view-title', {}, 'Settings'),
      el('p.view-sub', {}, 'Appearance, data, and your account')
    )
  ));

  root.append(el('section', {},
    el('h2.section-title', {}, 'Help & resources'),
    el('div.row', {},
      el('a', { href: '/docs/', target: '_blank', rel: 'noopener' }, 'Documentation'),
      el('a', { href: '/guides/', target: '_blank', rel: 'noopener' }, 'Practical guides')
    )
  ));

  /* Appearance */
  const themeSeg = el('div.segmented', { role: 'group', 'aria-label': 'Theme' },
    THEMES.map((t) => el('button', {
      type: 'button',
      html: icon(t.icon, 14, 2),
      dataset: { theme: t.key },
      'aria-pressed': String((s.theme || 'system') === t.key),
      onclick: async () => {
        applyTheme(t.key);
        markTheme(t.key);
        // The theme is its own feedback; only a failure needs saying — and
        // then the screen goes back to the theme the account still holds.
        if (!await saveSettings({ theme: t.key })) {
          const held = store.settings.theme || 'system';
          applyTheme(held);
          markTheme(held);
        }
      },
    }, ` ${t.label}`))
  );

  function markTheme(key) {
    for (const b of themeSeg.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.theme === key));
    }
  }

  const currencySelect = el('select.select', {
    id: 'set-currency',
    'aria-label': 'Currency',
    onchange: async () => {
      // Like the theme and threshold rows: a failed save goes back to
      // showing what the account actually holds, not what was picked.
      if (!await saveSettings({ currency: currencySelect.value }, 'Currency updated')) {
        currencySelect.value = store.settings.currency;
      }
    },
  }, CURRENCIES.map((c) => el('option', { value: c.code, selected: c.code === s.currency }, `${c.code} - ${c.name}`)));

  const lowInput = el('input.input', {
    id: 'set-lowstock',
    type: 'number', min: 0, step: 1, inputmode: 'numeric',
    value: String(s.defaultLowStock),
    style: { maxWidth: '120px' },
    onchange: async () => {
      const n = lowInput.valueAsNumber;
      if (!Number.isFinite(n) || n < 0) { lowInput.value = String(store.settings.defaultLowStock); return; }
      const ok = await saveSettings({ defaultLowStock: Math.round(n) }, 'Default threshold updated');
      // Show what the account actually holds, not what was typed at it.
      if (!ok) lowInput.value = String(store.settings.defaultLowStock);
    },
  });

  /* --- Reorder planning ---
     Both feed suggestions only: a reorder point the form offers, and a
     quantity the reorder list proposes. Nothing here writes a threshold
     or places an order, which is why the defaults can be opinionated
     without changing what the account holds. */
  const safetyInput = el('input.input', {
    id: 'set-safety',
    type: 'number', min: 0, max: 365, step: 1, inputmode: 'numeric',
    value: String(s.safetyDays ?? DEFAULT_SAFETY_DAYS),
    style: { maxWidth: '120px' },
    onchange: async () => {
      const n = safetyInput.valueAsNumber;
      if (!Number.isFinite(n) || n < 0) { safetyInput.value = String(store.settings.safetyDays); return; }
      const ok = await saveSettings({ safetyDays: Math.min(365, Math.round(n)) }, 'Safety days updated');
      safetyInput.value = String(store.settings.safetyDays);
      if (!ok) return;
    },
  });

  const coverageInput = el('input.input', {
    id: 'set-coverage',
    type: 'number', min: 0, max: 365, step: 1, inputmode: 'numeric',
    value: String(s.coverageDays ?? 0),
    style: { maxWidth: '120px' },
    onchange: async () => {
      const n = coverageInput.valueAsNumber;
      if (!Number.isFinite(n) || n < 0) { coverageInput.value = String(store.settings.coverageDays); return; }
      const ok = await saveSettings({ coverageDays: Math.min(365, Math.round(n)) }, 'Coverage horizon updated');
      coverageInput.value = String(store.settings.coverageDays);
      if (!ok) return;
    },
  });

  root.append(
    el('h2.section-title', {}, 'Appearance'),
    el('div.settings-list', {},
      el('div.settings-row.row-stacks', {},
        el('div.grow', {},
          el('div.title', {}, 'Theme'),
          el('div.sub', {}, 'System follows your device setting')
        ),
        themeSeg
      )
    ),

    el('h2.section-title', {}, 'Inventory'),
    el('div.settings-list', {},
      el('div.settings-row.row-stacks', {},
        el('div.grow', {},
          el('label.title', { htmlFor: 'set-currency' }, 'Currency'),
          el('div.sub', {}, 'Used for costs, prices, and stock value')
        ),
        el('div.select-wrap.settings-control', {}, currencySelect)
      ),
      el('div.settings-row.row-stacks', {},
        el('div.grow', {},
          el('label.title', { htmlFor: 'set-lowstock' }, 'Default low-stock threshold'),
          el('div.sub', {}, 'Products without their own threshold alert at this count')
        ),
        lowInput
      )
    ),

    el('h2.section-title', {}, 'Reorder planning'),
    el('div.settings-list', {},
      el('div.settings-row.row-stacks', {},
        el('div.grow', {},
          el('label.title', { htmlFor: 'set-safety' }, 'Safety days'),
          el('div.sub', {}, 'Added to the supplier’s lead time when a reorder point is suggested, and what counts as “running out soon”')
        ),
        safetyInput
      ),
      el('div.settings-row.row-stacks', {},
        el('div.grow', {},
          el('label.title', { htmlFor: 'set-coverage' }, 'Coverage horizon'),
          el('div.sub', {}, 'Days of demand a suggested order aims to carry. 0 keeps suggesting twice the threshold')
        ),
        coverageInput
      )
    ),

    el('h2.section-title', {}, 'Data'),
    el('div.settings-list', {},
      settingsButton('fileDown', 'Export products as CSV', exportCount, () => {
        if (!store.products.length) {
          toast('Nothing to export yet', { icon: 'info' });
          return;
        }
        // Sorted by name like the products view's export, so the same
        // data always produces the same file wherever it's exported from.
        const csv = productsToCSV(sortProducts(store.products, 'name', 1), { locations: store.locations, suppliers: store.suppliers });
        downloadFile(`inventory-${dateStamp()}.csv`, csv);
        toast('Export downloaded', { icon: 'fileDown' });
      }),
      settingsButton('fileUp', 'Import products from CSV', 'Match by SKU to update or add stock', () => openImporter())
    ),

    el('h2.section-title', {}, 'Backup & restore'),
    backupList,
    el('p.small.muted', { style: { margin: '8px 4px 0' } },
      'A backup holds everything a CSV can’t: history, settings, and supplier and location details.'),

    el('h2.section-title', {}, 'Danger zone'),
    el('div.settings-list', {},
      settingsButton('trash', 'Erase all data', 'Removes every product, location, and supplier', async () => {
        const ok = await confirmDialog({
          title: 'Erase everything?',
          message: 'Products, locations, suppliers, and history are cleared from your inventory. A safety snapshot and recovery history stay in your account, so you can restore from this page afterwards.',
          confirmLabel: 'Erase all data',
        });
        if (!ok) return;
        try {
          await store.wipeAll();
          await store.updateSettings({ onboarded: false });
          toast('All data erased', { icon: 'trash' });
          location.hash = '#/';
        } catch (err) {
          console.error(err);
          toast(err.message || 'Couldn’t erase. Check your connection', { icon: 'wifiOff' });
        }
      }, { danger: true })
    )
  );

  /* Backup & restore rows. Rebuilt on change so the snapshot row can
     appear (and age) as snapshots are taken. */
  const restoreInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
    style: { display: 'none' },
    onchange: async () => {
      const file = restoreInput.files?.[0];
      // Reset first: picking the same file twice must fire change again.
      restoreInput.value = '';
      if (file) await restoreFromFile(file);
    },
  });

  function renderBackupList() {
    clear(backupList);
    const snap = store.latestSnapshot();
    const snapProducts = snap?.counts?.products || 0;
    append(backupList, [
      settingsButton('download', 'Download backup', 'One JSON file with everything in this account', async () => {
        if (!store.hasData) {
          toast('Nothing to back up yet', { icon: 'info' });
          return;
        }
        let archives;
        try {
          // A backup missing months it should hold is worse than no
          // backup: restoring it deletes those months for real.
          archives = await store.loadAllArchives();
        } catch (err) {
          console.error(err);
          toast('Couldn’t load older history for the backup. Check your connection and try again', { icon: 'wifiOff' });
          return;
        }
        downloadFile(backupFilename(), JSON.stringify(buildBackup(store, Date.now(), archives), null, 2), 'application/json');
        toast('Backup downloaded', { icon: 'download' });
      }),
      settingsButton('upload', 'Restore from backup', 'Replaces everything with a backup file', () => restoreInput.click()),
      snap && settingsButton('rotateCcw', 'Restore automatic snapshot',
        `${cap(timeAgo(snap.at))}, ${SNAPSHOT_REASONS[snap.reason] || 'saved automatically'}`
          + ` · ${formatQty(snapProducts)} product${snapProducts === 1 ? '' : 's'}`,
        () => restoreSnapshot(snap)),
    ]);
  }
  renderBackupList();
  root.append(restoreInput);

  async function restoreFromFile(file) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast('That file isn’t valid JSON', { icon: 'circleAlert' });
      return;
    }
    const res = validateBackup(parsed);
    if (!res.ok) {
      toast(res.error, { icon: 'circleAlert' });
      return;
    }
    const made = res.exportedAt ? ` Made ${new Date(res.exportedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}.` : '';
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      message: `${describeBackup(res.data)}.${made} Everything currently in your account is replaced. A snapshot of it is kept first.`,
      confirmLabel: 'Restore',
      danger: false,
    });
    if (!ok) return;
    await applyRestore(res.data);
  }

  async function restoreSnapshot(snap) {
    const data = await store.readSnapshot(snap.id);
    if (!data) {
      toast('That snapshot is no longer available', { icon: 'circleAlert' });
      return;
    }
    const ok = await confirmDialog({
      title: 'Restore the snapshot?',
      message: `Your data as it was ${timeAgo(snap.at)}, ${SNAPSHOT_REASONS[snap.reason] || 'saved automatically'}: ${describeBackup(data)}. Everything currently in your account is replaced.`,
      confirmLabel: 'Restore',
      danger: false,
    });
    if (!ok) return;
    await applyRestore(data);
  }

  async function applyRestore(data) {
    try {
      await store.restoreBackup(data);
      applyTheme(store.settings.theme || 'system');
      toast('Backup restored', { icon: 'rotateCcw' });
      location.hash = '#/';
    } catch (err) {
      console.error(err);
      toast('Couldn’t restore. Check your connection', { icon: 'wifiOff' });
    }
  }

  /* Account: inside a Puter app window the platform owns the session, so
     offering sign-out would break the host — hide it there. */
  const username = store.user?.username;
  const isPuterApp = typeof puter !== 'undefined' && puter.env === 'app';
  root.append(
    el('h2.section-title', {}, 'Account'),
    el('div.settings-list', {},
      el('div.settings-row.row-stacks', {},
        el('span.user-avatar', {}, (username || 'P').charAt(0).toUpperCase()),
        el('div.grow', {},
          el('div.title', {}, username || 'Puter user'),
          el('div.sub', {}, isPuterApp ? 'Signed in with Puter' : 'Signed in with Puter cloud storage')
        ),
        !isPuterApp && el('button.btn.btn-secondary', { onclick: confirmSignOut }, 'Sign out')
      )
    ),
    el('p.small.muted', { style: { margin: '18px 4px' } },
      'Inventory stores everything in your own Puter account. Powered by ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'), '.')
  );
}

function settingsButton(ic, title, sub, onclick, { danger = false } = {}) {
  return el(`button.settings-row${danger ? '.danger' : ''}`, { type: 'button', onclick },
    el('span.settings-ic', { html: icon(ic, 19, 1.8), style: danger ? { color: 'var(--danger)' } : null }),
    el('div.grow', {},
      el('div.title', {}, title),
      el('div.sub', {}, sub)
    ),
    el('span', { html: icon('chevR', 17), style: { color: 'var(--ink-3)' } })
  );
}
