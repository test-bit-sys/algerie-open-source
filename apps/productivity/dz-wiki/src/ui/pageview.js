/**
 * One open page: cover, icon, title, then the block editor (or a database,
 * or a database row's properties above its own content).
 */
import { h, debounce, announce } from '../lib/dom.js';
import { icon, pageIcon, hasIcon } from '../lib/icons.js';
import { getPage, updatePage, childrenOf, displayTitle, isTrashed } from '../data/tree.js';
import { listBlocks, insertBlock } from '../data/page.js';
import { Editor } from '../editor/editor.js';
import { openIconPicker, openCoverPicker } from './pickers.js';
import { DatabaseView, RowProperties } from './dbview.js';
import { isDatabase } from '../data/database.js';
import { openByBlock } from '../data/comments.js';
import { textOf as blockText } from '../data/page.js';

export class PageView {
  constructor(app, space, pageId, { focusTitle = false, block = null } = {}) {
    this.app = app;
    this.ws = app.ws;
    this.space = space;
    this.pageId = pageId;
    this.el = h('article.page', { 'aria-labelledby': `title-${pageId}` });
    this.wantFocusTitle = focusTitle;
    this.wantBlock = block;
    this.onTree = () => this.treeChanged();
    space.tree.getMap('pages').observeDeep(this.onTree);
    this.onRole = () => this.refreshEditable();
    space.on('role', this.onRole);
  }

  get page() {
    return getPage(this.space.tree, this.pageId);
  }

  get readOnly() {
    const p = this.page;
    return !this.space.canEdit || !!p?.locked || isTrashed(this.space.tree, this.pageId);
  }

  async mount() {
    const page = this.page;
    if (!page) return false;
    this.el.classList.toggle('full-width', !!page.fullWidth);
    this.el.classList.toggle('small-text', !!page.smallText);
    this.cover = h('div.page-cover-slot');
    this.iconSlot = h('div.page-icon-slot');
    this.addBar = h('div.page-add-bar');
    this.title = h('h1.page-title', {
      id: `title-${this.pageId}`,
      contenteditable: this.readOnly ? 'false' : 'true',
      'data-placeholder': page.row ? 'Untitled' : 'Untitled',
      spellcheck: 'true',
    });
    this.title.textContent = page.title || '';
    this.bindTitle();
    this.banner = h('div.page-banner-slot');
    this.body = h('div.page-body');
    this.footer = h('div.page-footer');
    this.header = h('header.page-header', this.cover, h('div.page-head-inner', this.iconSlot, this.addBar, this.title));
    this.el.replaceChildren(this.banner, this.header, this.body, this.footer);
    this.renderHeader();
    this.renderBanner();
    let doc;
    try {
      doc = await this.space.doc(this.pageId);
    } catch (err) {
      this.body.replaceChildren(h('div.page-error', icon('cloudOff', 20), h('p', err.message || 'This page could not be opened.')));
      return true;
    }
    if (this.destroyed) return true;
    this.doc = doc;
    this.holdDoc(this.pageId);
    this.commentsDoc = await this.space.doc(`${this.pageId}.c`).catch(() => null);
    if (this.destroyed) return true;
    if (this.commentsDoc) this.holdDoc(`${this.pageId}.c`);
    const isDb = page.kind === 'database' || isDatabase(doc);
    if (isDb) {
      this.el.classList.add('is-database');
      this.db = new DatabaseView(this.app, this.space, this.pageId, doc, { readOnly: this.readOnly });
      this.body.append(this.db.el);
      this.db.render();
    } else {
      if (page.row && page.parent) {
        this.props = new RowProperties(this.app, this.space, page.parent, this.pageId, { readOnly: this.readOnly });
        this.body.append(this.props.el);
        this.props.mount();
      }
      const host = h('div.editor-host');
      this.body.append(host);
      this.editor = new Editor(host, doc, this.editorContext());
      this.ws.noteText(this.space, this.pageId, doc);
      this.indexSoon = debounce(() => this.ws.noteText(this.space, this.pageId, doc), 1500);
      this.renderFooter();
    }
    if (this.wantFocusTitle && !this.readOnly) this.focusTitle(true);
    else if (this.wantBlock && this.editor?.els.has(this.wantBlock)) {
      const el = this.editor.els.get(this.wantBlock);
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
    }
    return true;
  }

  /** Keeps a document in sync while this view shows it; destroy() lets go. */
  holdDoc(id) {
    if (this.destroyed) return;
    this.held ||= [];
    this.held.push(id);
    this.space.hold(id);
  }

  editorContext() {
    const app = this.app;
    return {
      space: this.space,
      pageId: this.pageId,
      readOnly: this.readOnly,
      tree: () => this.space.tree,
      lookup: (id) => {
        const sp = getPage(this.space.tree, id) ? this.space : this.ws.locate(id);
        return sp ? getPage(sp.tree, id) : null;
      },
      navigate: (id, opts) => app.openById(id, opts, this.space),
      pageTitle: (id) => app.pageTitle(id, this.space),
      toast: (m, o) => app.toast(m, o),
      pickIcon: (anchor, current, cb) => openIconPicker(anchor, current, cb, { colors: false, allowRemove: false }),
      createChild: (kind) => this.ws.createPage(this.space, { parent: this.pageId, kind }),
      trashPage: (id) => {
        if (getPage(this.space.tree, id)?.parent === this.pageId) app.trashPage(this.space, id, { quiet: false });
      },
      searchPages: (q) => this.ws.search(q, { limit: 12 }).filter((r) => r.page.id !== this.pageId),
      focusTitle: () => this.focusTitle(),
      copyBlockLink: (blockId) => app.copyLink(this.space, this.pageId, blockId),
      fetchTitle: (url) => app.fetchTitle(url),
      onTextChange: () => {
        this.indexSoon?.();
        this.touch();
        this.renderFooterSoon();
      },
      onRemoteChange: () => {},
      onRender: () => this.updateCommentMarkers(),
      toolbarExtras: (target) => (this.space.canComment && this.commentsDoc ? [this.commentButton(target)] : []),
      blockMenuExtras: (ids) => (this.space.canComment && this.commentsDoc && ids.length === 1 ? [{ label: 'Comment', icon: 'messageSquare', run: () => this.commentOn(ids[0], '') }] : []),
    };
  }

  commentButton(target) {
    const b = h('button.tb-btn', { type: 'button', 'aria-label': 'Comment', 'data-tip': 'Comment' }, icon('messageSquare', 16), h('span.tb-label', 'Comment'));
    b.addEventListener('click', () => {
      const text = blockText(this.doc, target.id)?.toString().slice(target.start, target.end) || '';
      this.commentOn(target.id, text);
    });
    return b;
  }

  commentOn(blockId, quote) {
    const text = quote || blockText(this.doc, blockId)?.toString() || '';
    this.app.comments.open({ block: blockId, quote: text.replace(/\s+/g, ' ').trim().slice(0, 140) });
  }

  /** Markers in the margin for blocks with open comments. */
  updateCommentMarkers() {
    if (!this.editor || !this.commentsDoc) return;
    const counts = openByBlock(this.commentsDoc);
    for (const [id, el] of this.editor.els) {
      let marker = el.querySelector(':scope > .blk-comments');
      const n = counts.get(id) || 0;
      if (!n) {
        marker?.remove();
        continue;
      }
      if (!marker) {
        marker = h('button.blk-comments', { type: 'button', contenteditable: 'false' }, icon('messageSquare', 14), h('span'));
        marker.addEventListener('click', () => {
          const thread = (this.app.comments.doc && [...this.commentsDoc.getMap('threads').entries()].find(([, m]) => m.get('block') === id && !m.get('resolved'))?.[0]) || null;
          this.app.comments.open({ thread });
        });
        el.append(marker);
      }
      marker.querySelector('span').textContent = String(n);
      marker.setAttribute('aria-label', `${n} comment${n === 1 ? '' : 's'} on this block`);
    }
  }

  flashBlock(id) {
    const el = this.editor?.els.get(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  touch = debounce(() => {
    if (this.space.canEdit && !this.destroyed) updatePage(this.space.tree, this.pageId, {}, this.ws.by);
  }, 4000);

  renderFooterSoon = debounce(() => !this.destroyed && this.renderFooter(), 400);

  bindTitle() {
    const save = debounce(() => {
      const text = this.title.textContent.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (text !== (this.page?.title || '')) updatePage(this.space.tree, this.pageId, { title: text }, this.ws.by);
    }, 250);
    this.saveTitle = save;
    this.title.addEventListener('input', () => {
      // Pasting or typing must leave plain text only.
      if (this.title.children.length) this.title.textContent = this.title.textContent;
      save();
      this.app.setDocumentTitle(this.title.textContent.trim() || 'Untitled');
    });
    this.title.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' '));
    });
    this.title.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) {
        e.preventDefault();
        save.flush();
        if (this.editor) {
          if (e.key === 'Enter') {
            const first = this.editor.visibleIds()[0];
            const b = first && this.editor.block(first);
            // Enter in the title starts a fresh first line unless the page is empty.
            if (b && b.type === 'paragraph' && !b.delta.length) this.editor.focusBlock(first, 'start');
            else {
              this.editor.pendingSel = null;
              const id = insertBlock(this.doc, { type: 'paragraph' }, first ? { before: first } : {});
              this.editor.pendingSel = { id, start: 0 };
            }
          } else this.editor.focusStart();
        } else this.db?.focus();
      }
    });
    this.title.addEventListener('blur', () => save.flush());
  }

  focusTitle(selectAll = false) {
    this.title.focus();
    const sel = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(this.title);
    if (!selectAll) range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  renderHeader() {
    const page = this.page;
    if (!page) return;
    const ro = this.readOnly;
    // Cover
    if (page.cover) {
      const cover = h('div.page-cover', { 'data-c': page.cover.color || null });
      if (page.cover.asset) {
        this.space.assetUrl(page.cover.asset).then((url) => {
          if (url) cover.style.backgroundImage = `url("${url}")`;
        });
        cover.classList.add('image');
      }
      if (!ro) {
        const change = h('button.btn.small.cover-btn', { type: 'button' }, 'Change cover');
        change.addEventListener('click', () => this.pickCover(change));
        cover.append(h('div.cover-actions', change));
      }
      this.cover.replaceChildren(cover);
    } else this.cover.replaceChildren();
    this.el.classList.toggle('has-cover', !!page.cover);
    // Icon
    if (page.icon) {
      const btn = h(ro ? 'span.page-big-icon' : 'button.page-big-icon', ro ? {} : { type: 'button', 'aria-label': 'Change page icon', 'data-tip': 'Change icon' }, pageIcon(page, 56));
      if (!ro) btn.addEventListener('click', () => this.pickIcon(btn));
      this.iconSlot.replaceChildren(btn);
    } else this.iconSlot.replaceChildren();
    this.el.classList.toggle('has-icon', !!page.icon);
    // Add icon / cover
    const add = [];
    if (!ro && !page.icon) {
      const b = h('button.add-btn', { type: 'button' }, icon('smile', 15), 'Add icon');
      b.addEventListener('click', () => this.pickIcon(b));
      add.push(b);
    }
    if (!ro && !page.cover) {
      const b = h('button.add-btn', { type: 'button' }, icon('imagePlus', 15), 'Add cover');
      b.addEventListener('click', () => updatePage(this.space.tree, this.pageId, { cover: { color: ['blue', 'green', 'purple', 'orange', 'pink'][Math.floor(Math.random() * 5)] } }, this.ws.by));
      add.push(b);
    }
    this.addBar.replaceChildren(...add);
    if (document.activeElement !== this.title && this.title.textContent !== (page.title || '')) this.title.textContent = page.title || '';
  }

  renderBanner() {
    const page = this.page;
    if (!page) return;
    const items = [];
    if (isTrashed(this.space.tree, this.pageId)) {
      items.push(
        h(
          'div.banner.danger',
          { role: 'status' },
          icon('trash', 16),
          h('span', 'This page is in the trash.'),
          this.space.canEdit ? h('button.btn.small', { type: 'button', onclick: () => this.app.restorePage(this.space, page.trashed ? this.pageId : this.trashedAncestor()) }, 'Restore') : null,
          this.space.canEdit ? h('button.btn.small.danger', { type: 'button', onclick: () => this.app.deleteForever(this.space, page.trashed ? this.pageId : this.trashedAncestor()) }, 'Delete forever') : null,
        ),
      );
    } else if (page.locked) {
      items.push(h('div.banner', { role: 'status' }, icon('lock', 16), h('span', 'This page is locked to prevent edits.'), this.space.canEdit ? h('button.btn.small', { type: 'button', onclick: () => updatePage(this.space.tree, this.pageId, { locked: false }, this.ws.by) }, 'Unlock') : null));
    } else if (this.space.kind === 'shared' && !this.space.canEdit) {
      items.push(h('div.banner', { role: 'status' }, icon('eye', 16), h('span', this.space.role === 'commenter' ? 'You can view and comment on this page.' : 'You can view this page.')));
    }
    this.banner.replaceChildren(...items);
  }

  trashedAncestor() {
    let p = this.page;
    while (p && !p.trashed && p.parent) p = getPage(this.space.tree, p.parent);
    return p?.id || this.pageId;
  }

  renderFooter() {
    if (!this.editor || !this.doc) return;
    const linked = new Set(listBlocks(this.doc).filter((b) => b.type === 'page').map((b) => b.page));
    const kids = childrenOf(this.space.tree, this.pageId).filter((p) => !linked.has(p.id));
    if (!kids.length) return this.footer.replaceChildren();
    this.footer.replaceChildren(
      h('h2.footer-title', `Subpages`),
      h(
        'ul.subpage-list',
        ...kids.map((p) => {
          const a = h('a.subpage', { href: '#' }, pageIcon(p, 16), h('span', displayTitle(p)));
          a.addEventListener('click', (e) => {
            e.preventDefault();
            this.app.open(this.space, p.id);
          });
          return h('li', a);
        }),
      ),
    );
  }

  pickIcon(anchor) {
    openIconPicker(anchor, this.page?.icon, (picked) => {
      updatePage(this.space.tree, this.pageId, { icon: picked }, this.ws.by);
      announce(picked ? 'Icon changed' : 'Icon removed');
    });
  }

  pickCover(anchor) {
    openCoverPicker(anchor, this.page?.cover, {
      onPick: (cover) => updatePage(this.space.tree, this.pageId, { cover }, this.ws.by),
      onUpload: async (file) => {
        if (!file.type.startsWith('image/')) return this.app.toast('Choose an image file.', { kind: 'error' });
        try {
          const asset = await this.space.putAsset(file);
          updatePage(this.space.tree, this.pageId, { cover: { asset } }, this.ws.by);
        } catch (err) {
          this.app.toast(err.message || 'The cover could not be uploaded.', { kind: 'error' });
        }
      },
    });
  }

  treeChanged() {
    if (this.destroyed) return;
    const page = this.page;
    if (!page) {
      this.app.pageGone(this.space, this.pageId);
      return;
    }
    this.el.classList.toggle('full-width', !!page.fullWidth);
    this.el.classList.toggle('small-text', !!page.smallText);
    this.renderHeader();
    this.renderBanner();
    this.refreshEditable();
    this.renderFooterSoon();
    if (document.activeElement !== this.title) this.app.setDocumentTitle(displayTitle(page));
    this.app.updateTopbarSoon();
  }

  refreshEditable() {
    const ro = this.readOnly;
    if (this.lastReadOnly === ro) return;
    this.lastReadOnly = ro;
    this.title.contentEditable = ro ? 'false' : 'true';
    this.editor?.setReadOnly(ro);
    this.db?.setReadOnly(ro);
    this.props?.setReadOnly(ro);
    this.renderHeader();
    this.renderBanner();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const id of this.held || []) this.space.release(id);
    this.held = [];
    this.saveTitle?.flush();
    this.touch.cancel();
    this.space.tree.getMap('pages').unobserveDeep(this.onTree);
    this.space.off('role', this.onRole);
    this.editor?.destroy();
    this.db?.destroy();
    this.props?.destroy();
    this.el.remove();
  }
}
