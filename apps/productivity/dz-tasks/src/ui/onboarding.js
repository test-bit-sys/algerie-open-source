/**
 * First-run onboarding: one decision (start fresh / sample data / skip).
 * Gated on an empty dataset; closing at any point marks onboarding done.
 */

import { el } from '../lib/dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { sampleDataset } from '../lib/sample.js';
import { openTaskForm } from './taskform.js';

export function shouldOnboard(store) {
  return !store.settings.onboarded && !store.settings.sampleData && store.tasks.length === 0;
}

export function openOnboarding() {
  const markDone = () => {
    if (!store.settings.onboarded) store.updateSettings({ onboarded: true }).catch(() => {});
  };

  const body = el('div', {},
    el('div.empty', { style: { padding: '10px 8px 4px' } },
      el('div.empty-icon', {
        html: icon('checkBig', 30),
        style: { background: 'var(--accent-wash)', color: 'var(--accent)' },
      }),
      el('h3', { style: { fontSize: '19px' } }, 'Your day, sorted'),
      el('p', {}, 'Personal and shared lists, recurring reminders, priorities, and subtasks. Everything lives in your own Puter cloud, never sold or shared.')
    ),
    el('button.btn.btn-primary.btn-block', {
      type: 'button', style: { padding: '13px' },
      onclick: () => {
        markDone();
        modal.close();
        openTaskForm({});
      },
    }, 'Add my first task'),
    el('button.btn.btn-ghost.btn-block', {
      type: 'button', style: { marginTop: '10px', border: '1px dashed var(--hairline-strong)' },
      html: icon('sparkle', 15, 2),
      onclick: async (e) => {
        // currentTarget, not target: the button holds an icon svg, so a
        // click landing on the icon would leave target as the svg and the
        // guard would not disable the button — letting an impatient second
        // click fire a concurrent, redundant import.
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await store.importAll(sampleDataset());
        } catch (err) {
          console.error(err);
          // A full cloud does not stop the import — the data is in place
          // locally and queued — so only real failures reopen this choice.
          if (!err.quota) {
            toast('Could not load the sample data. Check your connection', { icon: 'wifiOff' });
            btn.disabled = false;
            return;
          }
          modal.close();
          toast(err.message, { icon: 'cloud', duration: 5000 });
          return;
        }
        modal.close();
        toast('Sample data loaded. Wipe it anytime from the banner', { icon: 'sparkle' });
      },
    }, ' Explore with sample data'),
    el('button.btn.btn-ghost.btn-block', {
      type: 'button', style: { marginTop: '10px' },
      onclick: () => { markDone(); modal.close(); },
    }, 'Skip for now')
  );

  const modal = openModal({ title: 'Welcome', content: body, onClose: markDone });
}
