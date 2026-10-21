/** Settings: account, appearance, billing defaults, and your data. */

import { el, clear, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { applyTheme, currentTheme } from '../ui/theme.js';
import { field, fieldError, switchField, rateHistoryLine, RATE_ERROR } from '../ui/fields.js';
import { store, rateAt, withRateFrom } from '../lib/store.js';
import { entriesToCSV } from '../lib/csv.js';
import { wipeSampleData } from '../lib/sample.js';
import { offline } from '../lib/offline.js';
import { openOnboarding } from '../ui/onboarding.js';
import { openImporter } from '../ui/importer.js';
import { logoURL, prepareLogo } from '../ui/logo.js';
import { isPuterApp } from '../lib/env.js';
import {
  CURRENCIES, ROUNDINGS, TERM_DAYS, roundingLabel, termsLabel,
  parseAmount, downloadFile, debounce,
} from '../lib/util.js';
import { todayISO, fmtDay } from '../lib/time.js';

/** Confirm-and-sign-out, shared by Settings and the sidebar user block. */
export async function confirmSignOut() {
  const pending = store.pendingWrites();
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: pending
      ? `${pending} change${pending === 1 ? ' has' : 's have'} not synced to your Puter cloud yet and will be lost. The local copy of your data is removed from this device.`
      : 'Your data stays safe in your Puter account. The local copy is removed from this device.',
    confirmLabel: 'Sign out',
    danger: pending > 0,
  });
  if (!ok) return;
  offline.clearAll();
  puter.auth.signOut();
  location.reload();
}

/** "1st", "7th", "15th": the day a monthly reminder starts looking. */
function ordinal(n) {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/* Wording for a weekly target that will not parse, phrased like the rate
   errors the sheets share. */
const TARGET_ERROR = 'Enter the target in hours, like 30';

/* Wording for a tax rate that will not parse, shared with the client
   sheet through the same phrasing the rate errors use. */
const TAX_ERROR = 'Enter the tax rate as a number, like 19';

export function settingsView() {
  const root = el('div.view');

  root.append(
    el('div.page-head', {},
      el('div', {},
        el('h1.page-title', {}, 'Settings'),
        el('p.page-sub', {}, 'Account, appearance, billing, and your data')
      )
    )
  );

  /* --- Account --- */
  const username = store.user?.username || 'Puter user';
  root.append(group('Account',
    el('div.user-chip', {},
      el('span.user-avatar', {}, username.charAt(0).toUpperCase()),
      el('div.grow', {},
        el('div.title', {}, username),
        el('div.sub', {}, 'Synced with your Puter cloud')
      ),
      // Inside Puter, the platform owns the session; no sign-out offered.
      !isPuterApp() && el('button.btn.btn-ghost', { onclick: confirmSignOut }, 'Sign out')
    )
  ));

  /* --- Appearance --- */
  const themeSeg = el('div.segmented', { role: 'group', 'aria-label': 'Theme' });
  let shownTheme = null;
  function renderTheme() {
    shownTheme = currentTheme();
    clear(themeSeg);
    for (const [value, label, ic] of [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'monitor']]) {
      themeSeg.append(el('button', {
        type: 'button',
        className: currentTheme() === value ? 'active' : '',
        'aria-pressed': currentTheme() === value ? 'true' : 'false',
        html: icon(ic, 15, 2),
        onclick: () => {
          applyTheme(value);
          store.updateSettings({ theme: value }).catch(() => {});
          keepFocus(themeSeg, renderTheme);
        },
      }, ` ${label}`));
    }
  }
  renderTheme();
  /* The theme syncs like every other setting, so another device changing
     it repaints this screen; the control has to say which option is on
     rather than keep pointing at the one that was. Only a theme that
     really differs rebuilds it, so the many other writes this view makes
     never disturb the option under the cursor. */
  const onThemeChange = () => {
    if (currentTheme() !== shownTheme) keepFocus(themeSeg, renderTheme);
  };
  store.addEventListener('change', onThemeChange);
  root.destroy = () => store.removeEventListener('change', onThemeChange);
  root.append(group('Appearance', themeSeg));

  /* --- Billing --- */
  const currency = el('select.select', {
    onchange: () => save({ currency: currency.value }),
  }, CURRENCIES.map((c) => el('option', { value: c, selected: c === store.settings.currency }, c)));

  /* The rate and applies-from fields express ONE pending edit, always
     applied to the history as it stood when this view opened: the
     debounced save that fires while the user is still reaching for the
     date field must not become the base of the dated edit, or the rate
     for work from before that date is silently overwritten. */
  const rateBase = store.settings.defaultRate || null;
  const rateHistory = el('div');
  const renderRateHistory = () => {
    clear(rateHistory);
    const line = rateHistoryLine(store.settings.defaultRate, store.settings.currency);
    if (line) rateHistory.append(line);
  };
  /* These fields save themselves as you type, so a value that will not
     parse used to be dropped in silence: nothing was written and nothing
     said so, leaving the old rate in force behind a field that showed the
     new one. It says what it needs instead, in the same slot the sheets
     use, and clears the moment the value reads as a number. Focus is left
     alone: the user is still typing in the field. */
  const saveRate = debounce(() => {
    const n = rate.value.trim() === '' ? 0 : parseAmount(rate.value);
    if (!Number.isFinite(n) || n < 0) {
      rateErr.show(RATE_ERROR);
      return;
    }
    rateErr.hide();
    // An empty rate clears the history; otherwise the edit lands on
    // the period picked by the applies-from date (empty = today's).
    save({
      defaultRate: rate.value.trim() === '' ? 0 : withRateFrom(rateBase, n, rateFrom.value || null),
    }, { quiet: true }).then(renderRateHistory);
  }, 600);
  let rateTouched = false;
  const rate = el('input.input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off',
    value: rateAt(store.settings.defaultRate, todayISO()) || '',
    oninput: () => { rateTouched = true; saveRate(); },
  });
  const rateErr = fieldError(rate);
  const rateFrom = el('input.input', {
    type: 'date', 'aria-label': 'Default rate applies from',
    // Picking the date after typing the rate must re-land the same edit
    // on that date. Untouched, the field just shows the current rate:
    // there is no edit to apply, and saving would only append a period
    // restating it.
    onchange: () => { if (rateTouched && rate.value.trim() !== '') saveRate(); },
  });
  renderRateHistory();

  const rounding = el('select.select', {
    onchange: () => save({ rounding: Number(rounding.value) }),
  }, ROUNDINGS.map((v) => el('option', { value: v, selected: v === store.settings.rounding }, roundingLabel(v))));

  const weekStart = el('select.select', {
    onchange: () => save({ weekStart: Number(weekStart.value) }),
  },
    el('option', { value: 1, selected: store.settings.weekStart === 1 }, 'Monday'),
    el('option', { value: 0, selected: store.settings.weekStart === 0 }, 'Sunday')
  );

  const weeklyTarget = el('input.input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off',
    value: store.settings.weeklyTargetHours || '',
    placeholder: 'e.g. 30',
    oninput: debounce(() => {
      const n = weeklyTarget.value.trim() === '' ? 0 : parseAmount(weeklyTarget.value);
      if (!Number.isFinite(n) || n < 0) {
        targetErr.show(TARGET_ERROR);
        return;
      }
      targetErr.hide();
      save({ weeklyTargetHours: n }, { quiet: true });
    }, 600),
  });
  const targetErr = fieldError(weeklyTarget);
  const weeklyTargetKind = el('select.select', {
    onchange: () => save({ weeklyTargetKind: weeklyTargetKind.value }),
  },
    el('option', { value: 'billable', selected: store.settings.weeklyTargetKind !== 'tracked' }, 'Billable time'),
    el('option', { value: 'tracked', selected: store.settings.weeklyTargetKind === 'tracked' }, 'All tracked time')
  );

  root.append(group('Billing',
    field('Currency', currency),
    // The rate and its applies-from date are one edit, so they sit side
    // by side like they do on the client and project sheets. Three
    // fields in a two-column grid wrapped the date under the currency,
    // where it read as belonging to it.
    el('div.form-grid', {},
      el('div', {}, field('Default hourly rate', rate), rateErr),
      field('Rate applies from', rateFrom, { hint: 'Empty changes the current rate in place; a date starts the new rate that day.' })
    ),
    rateHistory,
    field('Round billable time', rounding, { hint: 'Billable durations round up to this increment for amounts and exports. A client can be set to its own increment.' }),
    field('Week starts on', weekStart),
    el('div.form-grid', {},
      el('div', {}, field('Weekly target (hours)', weeklyTarget), targetErr),
      field('Target counts', weeklyTargetKind)
    ),
    el('p.field-hint', { style: { marginTop: '-6px' } },
      'Optional. The week tile on the Timer and Timesheet shows quiet progress toward it, nothing nags.')
  ));

  async function save(patch, { quiet = false } = {}) {
    try {
      await store.updateSettings(patch);
      if (!quiet) toast('Saved');
    } catch (err) {
      console.error(err);
      toast('Could not save, check your connection', { icon: 'wifiOff' });
    }
  }

  /* --- Invoicing --- */
  const bizText = (key, node) => {
    node.addEventListener('input', debounce(() => save({ [key]: node.value.trim() }, { quiet: true }), 600));
    return node;
  };
  const businessName = bizText('businessName', el('input.input', {
    type: 'text', maxLength: 120, autocomplete: 'off', value: store.settings.businessName || '',
    placeholder: 'e.g. Jane Doe Consulting',
  }));
  const businessAddress = bizText('businessAddress', el('textarea.input.textarea', {
    rows: 2, maxLength: 400, placeholder: 'Street, city, country',
  }, store.settings.businessAddress || ''));
  const businessTaxId = bizText('businessTaxId', el('input.input', {
    type: 'text', maxLength: 60, autocomplete: 'off', value: store.settings.businessTaxId || '',
  }));
  const invoiceTerms = bizText('invoiceTerms', el('input.input', {
    type: 'text', maxLength: 200, autocomplete: 'off', value: store.settings.invoiceTerms || '',
    placeholder: 'e.g. Payment due within 14 days',
  }));
  const paymentDetails = bizText('paymentDetails', el('textarea.input.textarea', {
    rows: 3, maxLength: 600,
    placeholder: 'IBAN or account number, BIC\nA PayPal, Wise, or Stripe link\nReference to quote',
  }, store.settings.paymentDetails || ''));

  /* Logo: picked here, stored in the user's own Puter files, and
     snapshotted onto each invoice, so replacing it never touches an
     invoice already issued. Removing it only stops future invoices from
     carrying one, which is why the hint says so out loud. */
  const logoBox = el('div.logo-field');
  const logoInput = el('input', {
    type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', hidden: true,
    onchange: async () => {
      const file = logoInput.files?.[0];
      logoInput.value = '';
      if (!file) return;
      let blob;
      try {
        blob = await prepareLogo(file);
      } catch (err) {
        toast(err?.message || 'Could not read that image', { icon: 'x' });
        return;
      }
      try {
        await store.saveLogo(blob);
      } catch (err) {
        console.error(err);
        toast('Could not save the logo, check your connection', { icon: 'wifiOff' });
        return;
      }
      toast('Logo saved');
      renderLogo();
    },
  });

  async function renderLogo() {
    const path = store.settings.businessLogo || '';
    const url = await logoURL(path).catch(() => null);
    clear(logoBox);
    logoBox.append(
      url
        ? el('img.logo-preview', { src: url, alt: 'Your invoice logo' })
        : el('span.logo-empty', { 'aria-hidden': 'true', html: icon('receipt', 20, 1.8) }),
      el('div.grow', {},
        el('button.btn.btn-ghost.btn-slim', {
          type: 'button',
          onclick: () => logoInput.click(),
        }, url ? 'Replace logo' : 'Upload logo'),
        path && el('button.btn.btn-ghost.btn-slim.btn-danger-ghost', {
          type: 'button',
          style: { marginTop: 0, marginInlineStart: '8px' },
          onclick: async () => {
            try {
              await store.updateSettings({ businessLogo: '' });
            } catch (err) {
              console.error(err);
              toast('Could not save, check your connection', { icon: 'wifiOff' });
              return;
            }
            toast('Logo removed');
            renderLogo();
          },
        }, 'Remove'),
        // A stored path that cannot be read is worth saying: offline, or a
        // file moved out from under the app.
        path && !url && el('p.field-hint', { style: { margin: '6px 0 0' } },
          'Your logo could not be loaded right now. Invoices print without it until it is back.')
      )
    );
  }
  renderLogo().catch(console.error);

  const paymentTerms = el('select.select', {
    onchange: () => save({ paymentTermsDays: paymentTerms.value === '' ? null : Number(paymentTerms.value) }),
  },
    el('option', { value: '', selected: store.settings.paymentTermsDays == null }, termsLabel(null)),
    TERM_DAYS.map((d) => el('option', {
      value: d,
      selected: store.settings.paymentTermsDays != null && Number(store.settings.paymentTermsDays) === d,
    }, termsLabel(d)))
  );

  const taxRate = el('input.input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off',
    value: store.settings.taxRate || '',
    placeholder: 'e.g. 19',
    oninput: debounce(() => {
      const n = taxRate.value.trim() === '' ? 0 : parseAmount(taxRate.value);
      if (!Number.isFinite(n) || n < 0) {
        taxErr.show(TAX_ERROR);
        return;
      }
      taxErr.hide();
      save({ taxRate: n }, { quiet: true });
    }, 600),
  });
  const taxErr = fieldError(taxRate);

  root.append(group('Invoicing',
    el('p.field-hint', { style: { marginBottom: '12px' } },
      'Printed on invoices you create from unbilled time in Reports. All optional, and each invoice keeps a copy of what these said the day it was issued.'),
    field('Business name', businessName),
    field('Address', businessAddress),
    el('div.form-grid', {},
      field('Tax / VAT ID', businessTaxId),
      el('div', {}, field('Default tax rate (%)', taxRate, {
        hint: 'Prefilled on new invoices. A client can carry its own rate.',
      }), taxErr)
    ),
    el('div.form-grid', {},
      field('Payment terms', paymentTerms, {
        hint: 'Dates each invoice\u2019s due date from its issue date, so overdue invoices can be flagged under Reports \u2192 Invoices. A client can have its own terms.',
      }),
      field('Terms line', invoiceTerms, { hint: 'Printed at the bottom of the invoice, exactly as typed.' })
    ),
    field('How to pay', paymentDetails, {
      hint: 'Printed in its own block on the invoice, so payment details do not have to be smuggled into the terms line.',
    }),
    // Not field(): a <label for> belongs to a form control, and this is a
    // preview with buttons. The heading names the block instead.
    el('div.field', {},
      el('span.field-label', {}, 'Logo'),
      logoBox,
      el('p.field-hint', {},
        'Stored in your own Puter files and printed in the invoice header at a fixed height. Replacing or removing it leaves invoices you already issued exactly as they were.')
    ),
    logoInput
  ));

  /* --- Reminders --- */
  const longTimer = el('select.select', {
    onchange: () => save({ longTimerHours: Number(longTimer.value) }),
  }, [[0, 'Off'], [4, 'After 4 hours'], [8, 'After 8 hours'], [12, 'After 12 hours']].map(([v, label]) =>
    el('option', { value: v, selected: (Number(store.settings.longTimerHours) || 0) === v }, label)));

  const idleGap = el('select.select', {
    onchange: () => save({ idleGapMinutes: Number(idleGap.value) }),
  }, [[0, 'Off'], [5, 'After 5 minutes'], [10, 'After 10 minutes'], [20, 'After 20 minutes'], [30, 'After 30 minutes']].map(([v, label]) =>
    el('option', { value: v, selected: (Number(store.settings.idleGapMinutes) || 0) === v }, label)));

  const nudge = el('select.select', {
    onchange: () => save({ dailyNudgeHour: nudge.value === '' ? null : Number(nudge.value) }),
  },
    el('option', { value: '', selected: store.settings.dailyNudgeHour == null }, 'Off'),
    [9, 12, 15, 17].map((h) =>
      el('option', { value: h, selected: store.settings.dailyNudgeHour === h }, `Weekdays by ${h}:00`))
  );

  const notify = switchField('System notifications', !!store.settings.notifyNative,
    { hint: 'Also notify when the app is in the background. Nothing is requested until you turn this on.' });
  notify.input.addEventListener('change', async () => {
    if (notify.input.checked) {
      if (typeof Notification === 'undefined') {
        toast('Notifications are not supported in this browser', { icon: 'x' });
        notify.input.checked = false;
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        toast('Notifications are blocked by the browser', { icon: 'x' });
        notify.input.checked = false;
        return;
      }
    }
    save({ notifyNative: notify.input.checked });
  });

  /* The money half of the safeguards: tracked work that never became an
     invoice. Once a month at most, and never repeated once seen. */
  const unbilledDay = el('select.select', {
    onchange: () => save({ unbilledReminderDay: unbilledDay.value === '' ? null : Number(unbilledDay.value) }),
  },
    el('option', { value: '', selected: store.settings.unbilledReminderDay == null }, 'Off'),
    [1, 7, 15, 25].map((d) => el('option', {
      value: d,
      selected: Number(store.settings.unbilledReminderDay) === d,
    }, `Monthly, from the ${ordinal(d)}`))
  );
  const unbilledAge = el('select.select', {
    onchange: () => save({ unbilledAgeDays: Number(unbilledAge.value) }),
  }, [14, 30, 60, 90].map((d) => el('option', {
    value: d,
    selected: (Number(store.settings.unbilledAgeDays) || 30) === d,
  }, `Older than ${d} days`)));

  root.append(group('Reminders',
    field('Long timer warning', longTimer, { hint: 'Asks whether a timer that runs past this was left on by mistake.' }),
    field('Away and sleep gaps', idleGap, { hint: 'If this device sleeps or the app closes for this long while a timer runs, asks whether that time really belongs on the bill.' }),
    field('Daily tracking nudge', nudge, { hint: 'A gentle reminder when nothing is tracked by this hour on a weekday.' }),
    el('div.form-grid', {},
      field('Unbilled time reminder', unbilledDay),
      field('Counts as aging', unbilledAge)
    ),
    el('p.field-hint', { style: { marginTop: '-6px' } },
      'Mentions clients holding tracked time that was never invoiced, once a month at most. The same list is always on Reports \u2192 Invoices.'),
    notify
  ));

  /* --- Backups --- */

  /* One hardened restore path shared by snapshot rows and the file
     picker: confirm, replace everything, land on a view built from the
     restored data. */
  async function confirmRestore(data) {
    const ok = await confirmDialog({
      title: 'Restore backup?',
      message: 'Everything currently in the app is replaced by the backup. This cannot be undone.',
      confirmLabel: 'Replace everything',
    });
    if (!ok) return;
    try {
      await store.importAll(data);
      applyTheme(store.settings.theme || 'system');
      toast('Backup restored');
      // This view's controls were built from the old settings; leave for
      // a view that reflects the restored data instead of stale values.
      location.hash = '#/';
    } catch (err) {
      console.error(err);
      toast(/newer version/.test(String(err?.message))
        ? 'This backup is from a newer version of Hourly'
        : 'Restore failed, nothing may have changed', { icon: 'x' });
    }
  }

  const backupInterval = el('select.select', {
    onchange: () => save({ backupInterval: backupInterval.value }),
  },
    el('option', { value: 'off', selected: store.settings.backupInterval === 'off' }, 'Off'),
    el('option', { value: 'weekly', selected: store.settings.backupInterval !== 'off' && store.settings.backupInterval !== 'monthly' }, 'Weekly'),
    el('option', { value: 'monthly', selected: store.settings.backupInterval === 'monthly' }, 'Monthly')
  );

  const prettySize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  const backupList = el('div.settings-list');
  function renderBackups() {
    clear(backupList);
    backupList.append(settingsRow('cloud', 'Back up now', 'Save a snapshot to your Puter cloud right away', async () => {
      try {
        const b = await store.writeBackup();
        toast(`Backed up ${prettySize(b.size)}`, { icon: 'cloud' });
      } catch (err) {
        console.error(err);
        toast('Could not back up, check your connection', { icon: 'wifiOff' });
        return;
      }
      renderBackups();
    }));
    for (const b of [...store.backups].reverse()) {
      const read = async () => {
        try {
          return await store.readBackup(b.date);
        } catch (err) {
          console.error(err);
          toast('Could not read that backup, check your connection', { icon: 'wifiOff' });
          return null;
        }
      };
      backupList.append(el('div.backup-row', {},
        el('span.settings-row-ic', { html: icon('archive', 19, 1.8) }),
        el('div.grow', {},
          el('div.title', {}, fmtDay(b.date, { year: true })),
          el('div.sub', {}, `Snapshot · ${prettySize(b.size)}`)
        ),
        el('button.icon-btn', {
          html: icon('download', 17, 2),
          'aria-label': `Download the backup from ${fmtDay(b.date, { year: true })}`,
          title: 'Download',
          onclick: async () => {
            const data = await read();
            if (data) downloadFile(JSON.stringify(data, null, 2), `hourly-backup-${b.date}.json`, 'application/json');
          },
        }),
        el('button.icon-btn', {
          html: icon('reset', 17, 2),
          'aria-label': `Restore the backup from ${fmtDay(b.date, { year: true })}`,
          title: 'Restore',
          onclick: async () => {
            const data = await read();
            if (data) confirmRestore(data);
          },
        })
      ));
    }
  }
  renderBackups();

  root.append(group('Backups',
    field('Automatic backups', backupInterval, {
      hint: `Saves a full snapshot into your Puter cloud when you open the app, keeping the last 8. Restore or download any of them below.`,
    }),
    backupList
  ));

  /* --- Data --- */

  /* Both exports read every month file, and a month this device has never
     cached cannot be read at all while offline. Without this the tap was
     simply dead: no file, no message, an unhandled rejection in the
     console and nothing on screen, while every other action in the app
     says why it could not do the thing. */
  async function exportData() {
    try {
      return await store.exportAll();
    } catch (err) {
      console.error(err);
      toast('Could not read all your entries, check your connection', { icon: 'wifiOff' });
      return null;
    }
  }

  const dataRows = el('div.settings-list', {},
    settingsRow('fileDown', 'Export CSV', 'Every entry, ready for invoicing or a spreadsheet', async () => {
      const data = await exportData();
      if (!data) return;
      // Months come oldest-first with entries newest-first inside each;
      // flatten to one newest-first list like every list in the app.
      const entries = Object.values(data.entries).flat()
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      if (!entries.length) {
        toast('Nothing to export yet', { icon: 'fileDown' });
        return;
      }
      // BOM: Excel needs it to read UTF-8 CSVs correctly.
      downloadFile('\ufeff' + entriesToCSV(entries, store), `hourly-all-${todayISO()}.csv`, 'text/csv;charset=utf-8');
    }),
    settingsRow('download', 'Download backup', 'A full JSON backup of clients, projects, and entries', async () => {
      const data = await exportData();
      if (!data) return;
      downloadFile(JSON.stringify(data, null, 2), `hourly-backup-${todayISO()}.json`, 'application/json');
    }),
    settingsRow('fileUp', 'Import from another tracker', 'Toggl, Clockify, or Harvest CSV exports', () => openImporter()),
    settingsRow('reset', 'Restore backup', 'Replace everything with a backup file', () => importInput.click()),
    store.settings.sampleData && settingsRow('sparkle', 'Wipe sample data', 'Remove the demo dataset and start fresh', async () => {
      const ok = await confirmDialog({
        title: 'Start fresh?',
        message: 'All sample data is removed and you set up your own clients from scratch.',
        confirmLabel: 'Wipe sample data',
      });
      if (!ok) return;
      try {
        await wipeSampleData(store);
      } catch (err) {
        console.error(err);
        toast('Could not wipe, check your connection', { icon: 'wifiOff' });
        return;
      }
      // Same flow as the banner: back to the start, wizard reopens.
      location.hash = '#/';
      openOnboarding();
    })
  );

  const importInput = el('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: async () => {
      const file = importInput.files?.[0];
      importInput.value = '';
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        toast('That file is not a valid backup', { icon: 'x' });
        return;
      }
      if (data?.app !== 'hourly') {
        toast('That file is not an Hourly backup', { icon: 'x' });
        return;
      }
      confirmRestore(data);
    },
  });

  root.append(group('Your data', dataRows, importInput));

  /* --- About --- */
  root.append(group('About',
    el('p.about-text', {},
      `Hourly stores everything in your own Puter account. Amounts are shown in ${store.settings.currency}. `,
      'Built with ', el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'), '.')
  ));

  function group(title, ...children) {
    return el('section.settings-group', {},
      el('h2.settings-group-title', {}, title),
      ...children
    );
  }

  function settingsRow(ic, title, sub, onclick) {
    return el('button.settings-row', { type: 'button', onclick },
      el('span.settings-row-ic', { html: icon(ic, 19, 1.8) }),
      el('div.grow', {},
        el('div.title', {}, title),
        el('div.sub', {}, sub)
      ),
      el('span.settings-row-chev', { html: icon('chevR', 17), 'aria-hidden': 'true' })
    );
  }

  return root;
}
