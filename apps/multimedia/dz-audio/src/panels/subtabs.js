// Tabs inside a panel (Amplitude Statistics, Metadata): a row of text tabs
// with arrow-key navigation over panes that are shown one at a time.

import { h } from '../lib/dom.js';

let uid = 0;

/**
 * @param {{id: string, label: string, pane: HTMLElement}[]} tabs
 * @param {{value?: string, label: string, onChange?: (id: string) => void}} opts
 * @returns {{el: HTMLElement, bar: HTMLElement, value: string, set(id: string): void}}
 */
export function subTabs(tabs, { value, label, onChange } = {}) {
  const base = `subtab-${++uid}`;
  const bar = h('div.subtabs', { role: 'tablist', 'aria-label': label });
  const panes = h('div.subtab-panes');
  const api = { el: null, bar, value: tabs.some((t) => t.id === value) ? value : tabs[0].id, set };
  const buttons = tabs.map((t) => {
    const b = h(
      'button.subtab',
      {
        type: 'button',
        role: 'tab',
        id: `${base}-${t.id}`,
        'aria-controls': `${base}-${t.id}-pane`,
        dataset: { tab: t.id },
        onclick: () => set(t.id, true),
        onkeydown: (e) => {
          const i = tabs.indexOf(t);
          let next = null;
          if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
          else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
          else if (e.key === 'Home') next = tabs[0];
          else if (e.key === 'End') next = tabs[tabs.length - 1];
          if (!next) return;
          e.preventDefault();
          e.stopPropagation();
          set(next.id, true);
          bar.querySelector(`[data-tab="${next.id}"]`)?.focus();
        },
      },
      t.label,
    );
    t.pane.id = `${base}-${t.id}-pane`;
    t.pane.setAttribute('role', 'tabpanel');
    t.pane.setAttribute('aria-labelledby', b.id);
    t.pane.classList.add('subtab-pane');
    panes.append(t.pane);
    bar.append(b);
    return b;
  });
  function set(id, user = false) {
    if (!tabs.some((t) => t.id === id)) return;
    api.value = id;
    tabs.forEach((t, i) => {
      const on = t.id === id;
      buttons[i].setAttribute('aria-selected', String(on));
      buttons[i].tabIndex = on ? 0 : -1;
      t.pane.hidden = !on;
    });
    if (user) onChange?.(id);
  }
  set(api.value);
  api.el = h('div.subtabs-host', bar, panes);
  return api;
}
