/**
 * First-run onboarding: one decision (set up, sample documents, or skip) and
 * one setting (the name signers see). Gated on an empty account; closing at
 * any point marks onboarding done.
 */

import { el, clear, append, fieldId } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';

export function shouldOnboard(store) {
  return !store.settings.onboarded && !store.settings.sampleData && store.listDocs().length === 0;
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
      el('div.empty', { style: { padding: '10px 8px 4px' } },
        el('div.empty-icon', {
          html: icon('signature', 30),
          style: { background: 'var(--accent-wash)', color: 'var(--accent-strong)' },
        }),
        el('h3', { style: { fontSize: '19px' } }, 'Get documents signed'),
        el('p', {}, 'Upload a PDF, place signature fields, and send private sign links by email. Everything is stored in your own Puter account.')
      ),
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { padding: '13px' },
        onclick: renderName,
      }, 'Set up my account'),
      el('button.btn.btn-ghost.btn-block', {
        type: 'button', style: { marginTop: '10px', border: '1px dashed var(--hairline-strong)' },
        html: icon('sparkle', 15, 2),
        onclick: useSampleData,
      }, ' Explore with sample documents'),
      skipBtn(),
    ]);
  }

  async function useSampleData(e) {
    // currentTarget, not target: the button holds an icon, and a click that
    // lands on the icon reports the <svg>. Held in a local because
    // currentTarget is null once we await.
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      // Imported lazily: pdf-lib only loads when sample PDFs are generated.
      const { sampleDataset } = await import('../lib/sample.js');
      await store.importDataset(await sampleDataset(store));
    } catch (err) {
      console.error(err);
      toast('Could not load the sample documents. Check your connection', { icon: 'wifiOff' });
      btn.disabled = false;
      return;
    }
    modal.close();
    toast('Sample documents loaded. Wipe them anytime from the banner', { icon: 'sparkle' });
  }

  /* Step 1: the name signers see */
  function renderName() {
    clear(body);
    const nameId = fieldId('fullname');
    const input = el('input.input', {
      id: nameId, type: 'text', autocomplete: 'name', maxLength: 80,
      value: store.settings.fullName || '',
      placeholder: 'e.g. Alex Rivera',
    });
    append(body, [
      el('h3.onboard-h', {}, 'What name should signers see?'),
      el('p.onboard-p', {}, 'It appears in email requests and on the signature certificate. You can change it anytime in Settings.'),
      el('div.field', {}, el('label', { for: nameId }, 'Your full name'), input),
      el('button.btn.btn-primary.btn-block', {
        type: 'button', style: { padding: '13px' },
        onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          const fullName = input.value.trim();
          await store.updateSettings({ fullName, onboarded: true }).catch(() => {});
          modal.close();
          toast('You are all set. Upload a PDF to get started', { icon: 'check' });
        },
      }, 'Start sending'),
      skipBtn(),
    ]);
    setTimeout(() => input.focus(), 50);
  }

  renderWelcome();
}
