/**
 * Tooltips for icon buttons: shown on hover after a short wait and on
 * keyboard focus, from the element's data-tip (or aria-label). The
 * accessible name stays on the element itself.
 */
let tip = null;
let timer = 0;
let current = null;

function show(el) {
  const text = el.dataset.tip || el.getAttribute('aria-label');
  if (!text) return;
  tip ||= Object.assign(document.createElement('div'), { className: 'tooltip', role: 'presentation' });
  tip.textContent = text;
  if (el.dataset.shortcut) {
    const k = document.createElement('kbd');
    k.textContent = el.dataset.shortcut;
    tip.append(k);
  }
  (el.closest('dialog') || document.body).append(tip);
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const below = r.bottom + 6 + tip.offsetHeight < window.innerHeight;
  tip.style.left = `${Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6))}px`;
  tip.style.top = `${below ? r.bottom + 6 : r.top - 6 - tip.offsetHeight}px`;
  current = el;
}

function hide() {
  clearTimeout(timer);
  tip?.remove();
  current = null;
}

export function installTooltips(root = document) {
  root.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (!el || el === current || e.pointerType === 'touch') return;
    clearTimeout(timer);
    timer = setTimeout(() => el.isConnected && el.matches(':hover') && show(el), 450);
  });
  root.addEventListener('pointerout', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  root.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el && el.matches(':focus-visible')) show(el);
  });
  root.addEventListener('focusout', hide);
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('keydown', (e) => e.key === 'Escape' && hide(), true);
}
