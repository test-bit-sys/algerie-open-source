/**
 * Wraps a view whose code loads on demand. The wrapper shows a spinner,
 * then builds the real view and forwards every call to it.
 */
import { h } from '../lib/dom.js';

export function LazyView(load) {
  let Loaded = null;
  return class {
    constructor(app, tab) {
      this.app = app;
      this.tab = tab;
      this.el = h('div.lazy-view', { role: 'status' }, h('div.spinner', { 'aria-hidden': 'true' }), h('span.sr-only', 'Loading'));
      this.inner = null;
      this.pending = [];
      const build = (C) => {
        Loaded = C;
        if (this.destroyed) return;
        this.inner = new C(app, tab);
        this.el.replaceWith(this.inner.el);
        this.el = this.inner.el;
        for (const [name, args] of this.pending) this.inner[name]?.(...args);
        this.pending = [];
      };
      if (Loaded) build(Loaded);
      else load().then(build, (err) => this.el.replaceChildren(h('p', 'This view could not be loaded. Check your connection and reopen the tab.'), h('span.sr-only', String(err))));
      return new Proxy(this, {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (target.inner) {
            const v = target.inner[prop];
            return typeof v === 'function' ? v.bind(target.inner) : v;
          }
          return (...args) => {
            target.pending.push([prop, args]);
          };
        },
      });
    }

    destroy() {
      this.destroyed = true;
      this.inner?.destroy?.();
    }
  };
}
