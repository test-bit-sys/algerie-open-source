/**
 * Touch screens have no hover handle or keyboard shortcuts, so while a block
 * is being edited a bar sits above the on-screen keyboard with the block
 * menu, insert, to-do, indent, bold, italic, link, page link and Done.
 */
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as P from '../data/page.js';
import { getSelectionOffsets } from '../data/richtext.js';

const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : { matches: false };

export class MobileBar {
  constructor(editor) {
    this.editor = editor;
    const b = (ic, label, run) => {
      const el = h('button.mb-btn', { type: 'button', 'aria-label': label }, icon(ic, 19));
      el.addEventListener('pointerdown', (e) => e.preventDefault());
      el.addEventListener('click', () => run(el));
      return el;
    };
    const current = () => {
      const id = editor.focusedBlockId() || this.lastId;
      return id && editor.blocks.has(id) ? id : null;
    };
    this.el = h(
      'div.mobile-bar',
      { role: 'toolbar', 'aria-label': 'Block tools', hidden: true },
      b('plus', 'Insert a block', () => {
        const id = current();
        const el = id && editor.textEl(id);
        if (!el) return;
        const off = getSelectionOffsets(el) || { start: 0 };
        editor.insertText(id, '/');
        editor.openSlash(id, off.start);
      }),
      b('moreVertical', 'Block actions', (btn) => {
        const id = current();
        if (id) editor.openBlockMenu(btn, [id]);
      }),
      b('squareCheck', 'To-do', () => {
        const id = current();
        if (id) editor.turnInto([id], editor.block(id).type === 'todo' ? 'paragraph' : 'todo');
      }),
      b('outdent', 'Outdent', () => {
        const id = current();
        if (id) P.indentBlocks(editor.doc, [id], -1);
      }),
      b('indent', 'Indent', () => {
        const id = current();
        if (id && P.canIndent(editor.doc, id)) P.indentBlocks(editor.doc, [id], 1);
      }),
      b('bold', 'Bold', () => editor.toggleMark('bold')),
      b('italic', 'Italic', () => editor.toggleMark('italic')),
      b('link', 'Link', () => editor.toolbar.editLink()),
      b('atSign', 'Link to a page', () => {
        const id = current();
        const el = id && editor.textEl(id);
        if (!el) return;
        const off = getSelectionOffsets(el) || { start: 0 };
        editor.insertText(id, '@');
        editor.openMention(id, off.start);
      }),
      h('span.mb-spacer'),
      b('keyboardOff', 'Done', () => {
        document.activeElement?.blur?.();
        this.hide();
      }),
    );
    (document.getElementById('main') || document.body).append(this.el);
    this.onFocus = (e) => {
      if (!coarse.matches || editor.readOnly || !e.target.closest?.('.blk-text')) return;
      this.lastId = e.target.closest('.blk').dataset.id;
      this.show();
    };
    this.onBlur = (e) => {
      if (!editor.root.contains(e.relatedTarget) && !this.el.contains(e.relatedTarget) && !e.relatedTarget?.closest?.('.popover')) setTimeout(() => {
        if (!editor.root.contains(document.activeElement) && !document.querySelector('.popover')) this.hide();
      }, 150);
    };
    this.place = () => {
      const vv = window.visualViewport;
      if (!vv || this.el.hidden) return;
      const bottom = window.innerHeight - vv.height - vv.offsetTop;
      this.el.style.transform = `translateY(${-Math.max(0, bottom)}px)`;
    };
    editor.root.addEventListener('focusin', this.onFocus);
    editor.root.addEventListener('focusout', this.onBlur);
    window.visualViewport?.addEventListener('resize', this.place);
    window.visualViewport?.addEventListener('scroll', this.place);
  }

  show() {
    this.el.hidden = false;
    document.body.classList.add('has-mobile-bar');
    this.place();
  }

  hide() {
    this.el.hidden = true;
    document.body.classList.remove('has-mobile-bar');
  }

  destroy() {
    window.visualViewport?.removeEventListener('resize', this.place);
    window.visualViewport?.removeEventListener('scroll', this.place);
    this.hide();
    this.el.remove();
  }
}
