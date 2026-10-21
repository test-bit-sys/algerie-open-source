/**
 * The comments panel beside a page: page comments and comments on blocks,
 * with replies, resolve and reopen, editing and deleting your own messages.
 * It follows live changes from other people.
 */
import { h, modKey, modLabel, announce, fill } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import * as C from '../data/comments.js';
import { personAvatar } from './avatar.js';
import { openMenu } from './menu.js';
import { confirmDialog } from './dialog.js';

function when(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export class CommentsPanel {
  constructor(app) {
    this.app = app;
    this.show = 'open';
    this.anchor = null;
    this.el = h('aside.comments-panel', { 'aria-label': 'Comments', hidden: true });
    this.el.addEventListener('focusout', (e) => {
      if (this.deferred && !this.el.contains(e.relatedTarget)) {
        this.deferred = false;
        this.render();
      }
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        this.close();
      }
    });
    this.onChange = () => this.renderSoon();
  }

  get isOpen() {
    return !this.el.hidden;
  }

  /** Points the panel at a page's comments (or nothing). */
  bind(space, pageId, doc) {
    this.doc?.getMap('threads').unobserveDeep(this.onChange);
    this.space = space;
    this.pageId = pageId;
    this.doc = doc;
    this.anchor = null;
    doc?.getMap('threads').observeDeep(this.onChange);
    if (this.isOpen) this.render();
  }

  open({ block = null, quote = '', thread = null } = {}) {
    if (!this.doc) return;
    this.el.hidden = false;
    this.app.shell.classList.add('comments-open');
    this.anchor = block ? { block, quote } : this.anchor;
    if (thread) {
      const t = C.getThread(this.doc, thread);
      if (t) this.show = t.resolved ? 'resolved' : 'open';
    }
    this.render();
    if (thread) {
      const el = this.el.querySelector(`[data-thread="${thread}"]`);
      el?.scrollIntoView({ block: 'nearest' });
      el?.classList.add('flash');
      el?.querySelector('textarea, button')?.focus();
    } else (this.el.querySelector('.comment-compose textarea') || this.el.querySelector('.comments-close'))?.focus();
    this.app.updateCommentButton();
  }

  close() {
    this.el.hidden = true;
    this.app.shell.classList.remove('comments-open');
    this.anchor = null;
    this.app.updateCommentButton();
    this.app.commentsBtn?.focus();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  renderSoon() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.app.updateCommentButton();
      this.app.view?.updateCommentMarkers?.();
      if (!this.isOpen) return;
      if (this.el.contains(document.activeElement) && document.activeElement.matches('textarea') && document.activeElement.value) {
        this.deferred = true;
        return;
      }
      this.render();
    });
  }

  composer({ placeholder, submitLabel, onSubmit, autofocus = false, value = '' }) {
    const ta = h('textarea.comment-input', { rows: 1, placeholder, 'aria-label': placeholder, maxlength: 4000 });
    ta.value = value;
    const btn = h('button.btn.small.primary', { type: 'submit', disabled: !value.trim() }, submitLabel);
    const form = h('form.comment-compose', ta, h('div.compose-row', h('span.compose-hint', `${modLabel}Enter to send`), btn));
    const grow = () => {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(200, ta.scrollHeight)}px`;
      btn.disabled = !ta.value.trim();
    };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && modKey(e)) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      onSubmit(text);
      ta.value = '';
      grow();
    });
    if (autofocus) queueMicrotask(() => ta.focus());
    return form;
  }

  render() {
    if (!this.doc) return;
    const me = this.app.user?.username || null;
    const canComment = this.space.canComment;
    const canEdit = this.space.canEdit;
    const threads = C.listThreads(this.doc);
    const shown = threads.filter((t) => (this.show === 'open' ? !t.resolved : t.resolved));
    const tabs = h(
      'div.segmented.small',
      { role: 'radiogroup', 'aria-label': 'Show' },
      ...[
        ['open', `Open ${threads.filter((t) => !t.resolved).length || ''}`.trim()],
        ['resolved', 'Resolved'],
      ].map(([key, label]) =>
        h('button.segment', { type: 'button', role: 'radio', 'aria-checked': String(this.show === key), onclick: () => {
            this.show = key;
            this.render();
          } }, label),
      ),
    );
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      this.show = this.show === 'open' ? 'resolved' : 'open';
      this.render();
      this.el.querySelector('.segment[aria-checked="true"]')?.focus();
    });
    for (const seg of tabs.children) seg.tabIndex = seg.getAttribute('aria-checked') === 'true' ? 0 : -1;
    const head = h('header.comments-head', h('h2.comments-title', 'Comments'), tabs, h('button.icon-btn.comments-close', { type: 'button', 'aria-label': 'Close comments', onclick: () => this.close() }, icon('x', 16)));
    let compose = null;
    if (canComment && this.show === 'open') {
      const quote = this.anchor ? h('div.compose-quote', h('span', icon('textQuote', 14), this.anchor.quote || 'This block'), h('button.icon-btn', { type: 'button', 'aria-label': 'Comment on the whole page instead', onclick: () => {
          this.anchor = null;
          this.render();
        } }, icon('x', 14))) : null;
      compose = h(
        'div.compose-wrap',
        quote,
        this.composer({
          placeholder: this.anchor ? 'Comment on this block' : 'Comment on this page',
          submitLabel: 'Comment',
          autofocus: !!this.anchor,
          onSubmit: (text) => {
            C.addThread(this.doc, { block: this.anchor?.block || null, quote: this.anchor?.quote || '', text, by: me });
            this.anchor = null;
            announce('Comment added');
            this.render();
          },
        }),
      );
    }
    const list = h('div.thread-list');
    for (const t of shown) list.append(this.thread(t, { me, canComment, canEdit }));
    if (!shown.length) list.append(h('p.comments-empty', this.show === 'open' ? (canComment ? 'No open comments. Select text or use a block’s menu to comment on part of the page.' : 'No comments yet.') : 'No resolved comments.'));
    fill(this.el, head, compose, list);
  }

  thread(t, { me, canComment, canEdit }) {
    const blockExists = t.block && this.app.view?.editor?.blocks.has(t.block);
    const quote = t.block
      ? h('button.thread-quote', { type: 'button', disabled: !blockExists, onclick: () => this.app.view?.flashBlock(t.block) }, icon('textQuote', 13), h('span', t.quote || 'A block'), blockExists ? null : h('em', '(block deleted)'))
      : null;
    const messages = t.messages.map((m) => {
      const own = m.by && m.by === me;
      const more = own && canComment ? h('button.icon-btn.msg-more', { type: 'button', 'aria-label': 'Message options' }, icon('more', 14)) : null;
      more?.addEventListener('click', () =>
        openMenu(more, [
          { label: 'Edit', icon: 'pencil', run: () => this.editMessage(t.id, m) },
          { label: 'Delete', icon: 'trash', danger: true, run: async () => {
              if (await confirmDialog({ title: 'Delete this comment?', message: 'It is removed for everyone.', confirm: 'Delete', danger: true })) C.deleteMessage(this.doc, t.id, m.id);
            } },
        ], { label: 'Message options' }),
      );
      return h(
        'div.msg',
        { 'data-msg': m.id },
        personAvatar(m.by || '?', { size: 24 }),
        h('div.msg-body', h('div.msg-head', h('strong', m.by || 'Someone'), h('time', { datetime: new Date(m.at).toISOString(), title: new Date(m.at).toLocaleString() }, when(m.at)), m.edited ? h('span.msg-edited', '(edited)') : null, more), h('p.msg-text', m.text)),
      );
    });
    const canResolve = canEdit || (canComment && t.by === me);
    const actions = h(
      'div.thread-actions',
      canResolve ? h('button.btn.small.ghost', { type: 'button', onclick: () => {
          C.setResolved(this.doc, t.id, !t.resolved);
          announce(t.resolved ? 'Reopened' : 'Resolved');
        } }, icon(t.resolved ? 'rotateCcw' : 'check', 14), t.resolved ? 'Reopen' : 'Resolve') : null,
    );
    const replyBox = canComment ? this.composer({ placeholder: 'Reply', submitLabel: 'Reply', onSubmit: (text) => C.reply(this.doc, t.id, text, me) }) : null;
    return h('article.thread', { 'data-thread': t.id, 'aria-label': `Comment by ${t.messages[0]?.by || 'someone'}` }, quote, ...messages, replyBox, actions);
  }

  editMessage(threadId, m) {
    const el = this.el.querySelector(`[data-thread="${threadId}"] [data-msg="${m.id}"] .msg-text`);
    if (!el) return;
    const form = this.composer({
      placeholder: 'Edit comment',
      submitLabel: 'Save',
      value: m.text,
      autofocus: true,
      onSubmit: (text) => {
        C.editMessage(this.doc, threadId, m.id, text);
        this.render();
      },
    });
    el.replaceWith(form);
  }
}
