/**
 * First-run onboarding: one decision (set up / sample data / skip) and one
 * short setup step (currency + default rate). Gated on an empty dataset;
 * closing at any point marks onboarding done.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { field, fieldError, RATE_ERROR } from './fields.js';
import { store, rateAt } from '../lib/store.js';
import { sampleDataset } from '../lib/sample.js';
import { CURRENCIES, parseAmount } from '../lib/util.js';
import { todayISO } from '../lib/time.js';

export function shouldOnboard(store) {
  return !store.settings.onboarded && !store.settings.sampleData
    && store.clients.length === 0 && store.months.length === 0;
}

export function openOnboarding() {
  const body = el('div');

  const markDone = () => {
    if (!store.settings.onboarded) {
      store.updateSettings({ onboarded: true }).catch(() => {});
    }
  };
  const modal = openModal({ title: 'Welcome', content: body, onClose: markDone });

  const skipBtn = () => el('button.btn.btn-ghost.btn-block', {
    type: 'button', style: { marginTop: '10px' },
    onclick: () => { markDone(); modal.close(); },
  }, 'Skip for now');

  /* Step 0: welcome */
  function renderWelcome() {
    clear(body);
    append(body, [
      el('div.onboard-hero', {},
        el('img', { src: './icons/icon-192.png', width: 64, height: 64, alt: '' }),
        el('h3.onboard-title', {}, 'Every hour, accounted for'),
        el('p.onboard-sub', {}, 'Track billable hours by client, project, or task. Stored in your own Puter account, never sold or shared.')
      ),
      el('button.btn.btn-primary.btn-block.btn-tall', {
        type: 'button',
        onclick: renderSetup,
      }, 'Set up tracking'),
      el('button.btn.btn-ghost.btn-block.btn-dashed', {
        type: 'button', style: { marginTop: '10px' },
        html: icon('sparkle', 15, 2),
        onclick: useSampleData,
      }, ' Explore with sample data'),
      skipBtn(),
    ]);
  }

  async function useSampleData(e) {
    // currentTarget is only set while the event dispatches; capture the
    // button before awaiting (e.target can be the icon inside it).
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await store.importAll(sampleDataset(store));
    } catch (err) {
      console.error(err);
      toast('Could not load the sample data, check your connection', { icon: 'wifiOff' });
      btn.disabled = false;
      return;
    }
    modal.close();
    toast('Sample data loaded, wipe it anytime from the banner', { icon: 'sparkle' });
  }

  /* Step 1: currency + default rate, then the Projects view takes over */
  function renderSetup() {
    clear(body);
    const currency = el('select.select', { 'aria-label': 'Currency' },
      CURRENCIES.map((c) => el('option', { value: c, selected: c === store.settings.currency }, c)));
    const rate = el('input.input', {
      type: 'text', inputmode: 'decimal', placeholder: 'e.g. 100',
      // The default rate can be an effective-dated list (kept across a
      // sample-data wipe); show the rate in effect today, not the list.
      value: rateAt(store.settings.defaultRate, todayISO()) || '', autocomplete: 'off',
    });
    const rateErr = fieldError(rate);
    append(body, [
      el('h3.onboard-h', {}, 'How do you bill?'),
      el('p.onboard-p', {}, 'The default rate applies when a client or project has no rate of its own. You can change both anytime in Settings.'),
      el('div.form-grid', {},
        field('Currency', currency),
        el('div', {}, field('Default hourly rate', rate), rateErr)
      ),
      el('button.btn.btn-primary.btn-block.btn-tall', {
        type: 'button',
        onclick: async (ev) => {
          rateErr.hide();
          const n = rate.value.trim() === '' ? 0 : parseAmount(rate.value);
          if (!Number.isFinite(n) || n < 0) {
            rateErr.show(RATE_ERROR);
            rate.focus();
            return;
          }
          ev.target.disabled = true;
          await store.updateSettings({ currency: currency.value, defaultRate: n, onboarded: true }).catch(() => {});
          modal.close();
          location.hash = '#/projects';
          toast('Now add your first client and project', { icon: 'folders' });
        },
      }, 'Start tracking'),
      skipBtn(),
    ]);
  }

  renderWelcome();
}
