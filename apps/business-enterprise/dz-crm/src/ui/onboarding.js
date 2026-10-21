/**
 * First-run onboarding: one decision (set up / sample data / skip) and one
 * setting (currency). Gated on an empty dataset; closing at any point marks
 * onboarding done, so it never nags twice.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { sampleDataset } from '../lib/sample.js';
import { openContactForm } from './forms.js';

const CURRENCIES = [
  { code: 'DZD', name: 'دينار جزائري (Algerian Dinar)' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'SEK', name: 'Swedish Krona' },
];

export function shouldOnboard(store) {
  return !store.settings.onboarded && !store.settings.sampleData
    && store.contacts.length === 0 && store.companies.length === 0
    && store.deals.length === 0;
}

export function openOnboarding() {
  const body = el('div');

  const markDone = () => {
    if (!store.settings.onboarded) {
      store.updateSettings({ onboarded: true }).catch(() => {});
    }
  };
  const modal = openModal({ title: 'Welcome', content: body, onClose: markDone });

  const skipBtn = () => el('button.btn.btn-ghost.btn-block.mt-sm', {
    type: 'button',
    onclick: () => { markDone(); modal.close(); },
  }, 'Skip for now');

  /* Step 0 - welcome */
  function renderWelcome() {
    clear(body);
    append(body, [
      el('div.empty.onboard-hero', {},
        el('img.onboard-mark', { src: './icon-192.png', width: 58, height: 58, alt: '' }),
        el('h3', {}, 'Your pipeline, your cloud'),
        el('p', {}, 'Track leads, companies, deals, and follow-ups, and see a forecast you can trust. Stored in your own Puter account, never sold or shared.')
      ),
      el('button.btn.btn-primary.btn-block.btn-tall', {
        type: 'button',
        onclick: renderCurrency,
      }, 'Set up my pipeline'),
      el('button.btn.btn-ghost.btn-block.btn-dashed.mt-sm', {
        type: 'button',
        html: icon('sparkle', 15, 2),
        onclick: useSampleData,
      }, ' Explore with sample data'),
      skipBtn(),
    ]);
  }

  async function useSampleData(e) {
    // currentTarget, not target: the button carries an icon, so a click on
    // the SVG would otherwise "disable" the svg and leave the button live.
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await store.importAll(sampleDataset(store));
    } catch (err) {
      console.error(err);
      toast('Couldn’t load the sample data. Check your connection', { icon: 'wifiOff' });
      btn.disabled = false;
      return;
    }
    modal.close();
    toast('Sample data loaded. Wipe it anytime from the banner', { icon: 'sparkle' });
  }

  /* Step 1 - currency, then straight into the first lead */
  function renderCurrency() {
    clear(body);
    let picked = store.settings.currency;
    append(body, [
      el('h3.onboard-h', {}, 'What currency do you sell in?'),
      el('p.onboard-p', {}, 'Deal values, pipeline totals, and forecasts are shown in this currency.'),
      el('div.field', {},
        el('div.select-wrap', {},
          el('select.select', {
            'aria-label': 'Currency',
            onchange: (ev) => { picked = ev.target.value; },
          }, CURRENCIES.map((c) =>
            el('option', { value: c.code, selected: c.code === picked }, `${c.code} · ${c.name}`)))
        )
      ),
      el('button.btn.btn-primary.btn-block.btn-tall', {
        type: 'button',
        onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          await store.updateSettings({ currency: picked, onboarded: true }).catch(() => {});
          modal.close();
          // The natural first move in an empty CRM: add the first lead.
          openContactForm();
        },
      }, 'Add my first lead'),
      skipBtn(),
    ]);
  }

  renderWelcome();
}
