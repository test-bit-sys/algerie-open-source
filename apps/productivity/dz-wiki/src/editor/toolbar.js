/**
 * The formatting bar that appears over selected text: turn into, bold,
 * italic, underline, strikethrough, code, link and colors.
 */
import { h, modLabel } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { COLORS, safeUrl } from '../lib/sanitize.js';
import { formatAt, setSelectionOffsets, getSelectionOffsets } from '../data/richtext.js';
import * as P from '../data/page.js';
import { openMenu } from '../ui/menu.js';
import { Popover } from '../ui/popover.js';
import { INSERTABLE, TEXT_TYPES } from './commands.js';

const MARKS = [
  ['bold', 'bold', 'Bold', 'B'],
  ['italic', 'italic', 'Italic', 'I'],
  ['underline', 'underline', 'Underline', 'U'],
  ['strike', 'strike', 'Strikethrough', 'Shift+S'],
  ['code', 'code', 'Inline code', 'E'],
];

export class InlineToolbar {
  constructor(editor) {
    this.editor = editor;
    this.target = null;
    this.buttons = {};
    this.turn = h('button.tb-btn.tb-turn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, h('span.tb-turn-label', 'Text'), icon('chevronDown', 13));
    this.turn.addEventListener('click', () => this.openTurnInto());
    const marks = MARKS.map(([mark, ic, label, key]) => {
      const b = h('button.tb-btn', { type: 'button', 'aria-label': label, 'aria-pressed': 'false', 'data-tip': label, 'data-shortcut': `${modLabel}${key}` }, icon(ic, 16));
      b.addEventListener('click', () => this.editor.toggleMark(mark));
      this.buttons[mark] = b;
      return b;
    });
    this.linkBtn = h('button.tb-btn', { type: 'button', 'aria-label': 'Link', 'aria-pressed': 'false', 'data-tip': 'Link', 'data-shortcut': `${modLabel}K` }, icon('link', 16));
    this.linkBtn.addEventListener('click', () => this.editLink());
    this.colorBtn = h('button.tb-btn.tb-color', { type: 'button', 'aria-label': 'Text color', 'aria-haspopup': 'menu', 'data-tip': 'Color' }, h('span.tb-a', 'A'), icon('chevronDown', 12));
    this.colorBtn.addEventListener('click', () => this.openColors());
    this.extra = h('span.tb-extra');
    this.el = h('div.inline-toolbar', { role: 'toolbar', 'aria-label': 'Text formatting', hidden: true }, this.turn, h('span.tb-sep'), ...marks, this.linkBtn, this.colorBtn, this.extra);
    // Keep the text selection while using the toolbar with a mouse.
    this.el.addEventListener('pointerdown', (e) => e.preventDefault());
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    (document.getElementById('main') || document.body).append(this.el);
  }

  destroy() {
    this.el.remove();
  }

  /** Shows the bar over a selection, or hides it (target null). */
  update(target) {
    if (this.el.contains(document.activeElement) || this.linkPop?.open) return;
    if (!target) {
      this.el.hidden = true;
      this.target = null;
      return;
    }
    const b = this.editor.block(target.id);
    if (!b || !TEXT_TYPES.has(b.type) || b.type === 'code') {
      this.el.hidden = true;
      return;
    }
    this.target = target;
    const yt = P.textOf(this.editor.doc, target.id);
    const fmt = formatAt(yt, target.start, target.end);
    for (const [mark] of MARKS) this.buttons[mark].setAttribute('aria-pressed', String(!!fmt[mark]));
    this.linkBtn.setAttribute('aria-pressed', String(!!(fmt.link || fmt.page)));
    this.turn.querySelector('.tb-turn-label').textContent = P.BLOCK_TYPES[b.type]?.label || 'Text';
    this.colorBtn.dataset.color = fmt.color || '';
    const extras = this.editor.ctx.toolbarExtras?.(target) || [];
    this.extra.replaceChildren(...extras);
    this.el.classList.toggle('ro', this.editor.readOnly);
    if (this.editor.readOnly && !extras.length) {
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    const sel = document.getSelection();
    if (!sel?.rangeCount) return;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const w = this.el.offsetWidth;
    const top = r.top - this.el.offsetHeight - 8;
    this.el.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
    this.el.style.top = `${top < 8 ? r.bottom + 8 : top}px`;
  }

  /** Arrow keys move between buttons; Escape returns to the text. */
  onKey(e) {
    const btns = [...this.el.querySelectorAll('button')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.restore();
    }
  }

  /** Alt+F10 style entry: focus the bar from the keyboard. */
  focus() {
    if (!this.el.hidden) this.turn.focus();
  }

  restore() {
    const t = this.target;
    if (!t) return;
    const el = this.editor.textEl(t.id);
    el?.focus();
    if (el) setSelectionOffsets(el, t.start, t.end);
  }

  openTurnInto() {
    const t = this.target;
    if (!t) return;
    const cur = this.editor.block(t.id)?.type;
    openMenu(
      this.turn,
      INSERTABLE.filter((c) => TEXT_TYPES.has(c.type)).map((c) => ({ label: c.label, icon: c.icon, checked: c.type === cur, radio: true, run: () => this.editor.turnInto([t.id], c.type) })),
      { label: 'Turn into' },
    );
  }

  openColors() {
    const t = this.target;
    if (!t) return;
    const yt = P.textOf(this.editor.doc, t.id);
    const fmt = formatAt(yt, t.start, t.end);
    const name = (c) => c[0].toUpperCase() + c.slice(1);
    const apply = (attrs) => this.editor.applyFormat(t.id, { start: t.start, end: t.end }, attrs);
    openMenu(
      this.colorBtn,
      [
        { type: 'header', label: 'Text color' },
        { label: 'Default', icon: h('span.swatch.fg', 'A'), checked: !fmt.color, run: () => apply({ color: null }) },
        ...COLORS.map((c) => ({ label: name(c), icon: h('span.swatch.fg', { 'data-c': c }, 'A'), checked: fmt.color === c, run: () => apply({ color: c }) })),
        { type: 'header', label: 'Highlight' },
        { label: 'None', icon: h('span.swatch.bg'), checked: !fmt.bg, run: () => apply({ bg: null }) },
        ...COLORS.map((c) => ({ label: `${name(c)} highlight`, icon: h('span.swatch.bg', { 'data-c': c }), checked: fmt.bg === c, run: () => apply({ bg: c }) })),
      ],
      { label: 'Colors' },
    );
  }

  /** Adds, edits or removes the link on the selected text. */
  editLink() {
    const ed = this.editor;
    const id = ed.focusedBlockId() || this.target?.id;
    const el = id && ed.textEl(id);
    if (!el) return;
    const live = document.activeElement === el ? getSelectionOffsets(el) : null;
    const range = live && live.end > live.start ? live : this.target?.id === id ? this.target : { start: 0, end: 0 };
    if (range.end <= range.start) return;
    const yt = P.textOf(ed.doc, id);
    const current = formatAt(yt, range.start, range.end).link || '';
    const input = h('input.field', { type: 'url', value: current, placeholder: 'Paste a link', 'aria-label': 'Link address' });
    const form = h(
      'form.link-form',
      input,
      h('button.btn.primary.small', { type: 'submit' }, 'Apply'),
      current ? h('button.btn.small.ghost', { type: 'button', onclick: () => finish(null) }, 'Remove') : null,
    );
    const finish = (url) => {
      this.linkPop.close({ focus: false });
      ed.applyFormat(id, range, { link: url, page: null });
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = safeUrl(input.value);
      if (!input.value.trim()) return finish(null);
      if (!url) {
        input.setCustomValidity('Enter a web address, like https://example.com');
        input.reportValidity();
        return;
      }
      finish(url);
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    const r = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0).getBoundingClientRect() : el.getBoundingClientRect();
    this.el.hidden = true;
    this.linkPop = new Popover({ anchor: r, content: form, className: 'link-pop', label: 'Edit link', returnFocus: false, onClose: () => ed.textEl(id)?.focus() });
    input.focus();
    input.select();
  }
}
