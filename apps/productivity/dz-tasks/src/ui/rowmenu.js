import { el } from '../lib/dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';

/**
 * Per-row action sheet: the keyboard- and screen-reader-friendly path to
 * everything drag/swipe can do (reordering, quick reschedules). Works for
 * task rows and list cards alike — `subject` needs { id, title }.
 * action: { icon, label, sub?, disabled?, danger?, onClick }
 */
export function openRowMenu(subject, actions) {
  const body = el('div.card', {},
    actions.map((a) => el('button.setting-row', {
      disabled: !!a.disabled,
      onclick: async () => {
        modal.close();
        await a.onClick();
        // The action usually re-renders the view, detaching the button
        // that opened this menu — the modal's own focus restore finds it
        // disconnected and gives up, dropping keyboard users at the top
        // of the page. Focus the row's fresh menu button instead (unless
        // the action moved focus itself, e.g. into another dialog).
        setTimeout(() => {
          const active = document.activeElement;
          if (active && active !== document.body && active.isConnected) return;
          if (!subject.id) return;
          const key = CSS.escape(String(subject.id));
          document.querySelector(
            `[data-task-id="${key}"] .row-menu, [data-list-id="${key}"] .row-menu`
          )?.focus();
        }, 230);
      },
    },
      el('span.s-icon', { html: icon(a.icon, 19), style: a.danger ? { color: 'var(--danger)' } : null }),
      el('div', {},
        el('div.s-label', { style: a.danger ? { color: 'var(--danger)' } : null }, a.label),
        a.sub ? el('div.s-sub', {}, a.sub) : null
      )
    ))
  );
  const modal = openModal({ title: subject.title, content: body });
  return modal;
}
