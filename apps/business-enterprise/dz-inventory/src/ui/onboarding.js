/**
 * First-run onboarding: one decision (set up / sample data / skip) and
 * one setting (currency for cost values). Gated on an empty dataset;
 * closing at any point marks onboarding done.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { CURRENCIES } from '../lib/currencies.js';
import { sampleDataset } from '../lib/sample.js';

export function shouldOnboard(store) {
  return !store.settings.onboarded && !store.settings.sampleData
    && store.products.length === 0 && store.locations.length === 0;
}

export function openOnboarding() {
  const body = el('div');

  const markDone = () => {
    if (!store.settings.onboarded) {
      store.updateSettings({ onboarded: true }).catch(() => {});
    }
  };
  /* Assigned at the bottom, once the body holds the first step. The
     dialog hands focus to the first control it can find, and an empty
     panel leaves it nothing but itself: the welcome step opened with a
     focus ring drawn round the whole sheet, and Tab started one stop
     short of the button it was asking you to press. */
  let modal;

  const skipBtn = () => el('button.btn.btn-ghost.btn-block', {
    type: 'button', style: { marginTop: '10px' },
    onclick: () => { markDone(); modal.close(); },
  }, 'Skip for now');

  /* Step 0 — welcome */
  function renderWelcome() {
    clear(body);
    append(body, [
      el('div.empty', { style: { padding: '10px 8px 4px' } },
        el('img', {
          src: './icon-192.png', width: 56, height: 56, alt: '',
          style: { borderRadius: '14px', marginBottom: '14px' },
        }),
        el('h3', { style: { fontSize: '19px' } }, 'Your stock, your cloud'),
        el('p', {}, 'Track products, quantities, and costs across locations. Stored in your own Puter account, never sold or shared.')
      ),
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { padding: '13px' },
        onclick: renderCurrency,
      }, 'Set up my inventory'),
      el('button.btn.btn-ghost.btn-block', {
        type: 'button', style: { marginTop: '10px', border: '1px dashed var(--hairline-strong)' },
        html: icon('sparkle', 15, 2),
        onclick: useSampleData,
      }, ' Explore with sample data'),
      skipBtn()
    ]);
  }

  async function useSampleData(e) {
    // The button, not e.target: a click landing on the sparkle icon
    // would "disable" the SVG and leave the button live for a second,
    // concurrent importAll. (currentTarget is gone after the await.)
    const btn = e.currentTarget;
    if (btn.disabled) return;
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

  /* Step 1 — currency for cost values */
  function renderCurrency() {
    clear(body);
    let picked = store.settings.currency;
    append(body, [
      el('h3.onboard-h', {}, 'What currency do you buy in?'),
      el('p.onboard-p', {}, 'Purchase costs, prices, and stock value are shown in this currency. You can change it later in Settings.'),
      el('div.field', {},
        el('div.select-wrap', {},
          el('select.select', {
            'aria-label': 'Currency',
            onchange: (ev) => { picked = ev.target.value; },
          }, CURRENCIES.map((c) =>
            el('option', { value: c.code, selected: c.code === picked }, `${c.code} - ${c.name}`)))
        )
      ),
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { padding: '13px' },
        onclick: async (ev) => {
          ev.target.disabled = true;
          // Onboarding shouldn't dead-end on a flaky write — carry on,
          // but say the pick didn't stick rather than pretending it did.
          await store.updateSettings({ currency: picked }).catch(() => {
            toast('Couldn’t save the currency. Set it later in Settings', { icon: 'wifiOff' });
          });
          markDone();
          modal.close();
          location.hash = '#/products';
        },
      }, 'Start tracking'),
      el('p.small.muted', { style: { margin: '12px 0 0', textAlign: 'center' } },
        'Add your first product from the Products tab, or import a CSV you already have.'),
      skipBtn()
    ]);
  }

  renderWelcome();
  modal = openModal({ title: 'Welcome', content: body, onClose: markDone });
}
