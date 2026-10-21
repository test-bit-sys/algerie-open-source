/** Home: recently visited pages, favorites, and ways to start something new. */
import { h, fill } from '../lib/dom.js';
import { icon, pageIcon } from '../lib/icons.js';
import { displayTitle, getPage, isTrashed } from '../data/tree.js';
import { TEMPLATES } from '../data/templates.js';

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export class HomeView {
  constructor(app) {
    this.app = app;
    this.el = h('div.home');
  }

  render() {
    const ws = this.app.ws;
    const hour = new Date().getHours();
    const greet = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const recent = ws.recentPages().slice(0, 8);
    const favs = ws.favorites.map((f) => ({ space: ws.space(f.space), id: f.page })).filter((f) => f.space?.tree && getPage(f.space.tree, f.id) && !isTrashed(f.space.tree, f.id));
    const card = (space, page, meta) =>
      h('button.home-card', { type: 'button', onclick: () => this.app.open(space, page.id) }, h('span.home-card-icon', pageIcon(page, 22)), h('span.home-card-title', displayTitle(page)), h('span.home-card-meta', meta));
    fill(this.el,
      h('h1.home-title', `${greet}${this.app.user?.username && !(this.app.user.sandbox && this.app.user.username === 'you') ? `, ${this.app.user.username}` : ''}`),
      recent.length ? h('section.home-section', { 'aria-labelledby': 'home-recent' }, h('h2#home-recent.home-label', icon('clock', 15), 'Recently visited'), h('div.home-cards', ...recent.map((r) => card(r.space, r.page, ago(r.at))))) : null,
      favs.length ? h('section.home-section', { 'aria-labelledby': 'home-favs' }, h('h2#home-favs.home-label', icon('star', 15), 'Favorites'), h('div.home-cards', ...favs.map((f) => card(f.space, getPage(f.space.tree, f.id), f.space.kind === 'shared' ? 'Shared' : 'Private')))) : null,
      h(
        'section.home-section',
        { 'aria-labelledby': 'home-start' },
        h('h2#home-start.home-label', icon('sparkles', 15), 'Start something'),
        h(
          'div.home-starts',
          h('button.home-start', { type: 'button', onclick: () => this.app.newPage() }, icon('filePlus', 20), h('span.home-start-title', 'Empty page'), h('span.home-start-desc', 'Start from a blank page')),
          ...TEMPLATES.map((t) => h('button.home-start', { type: 'button', onclick: () => this.app.newPage(ws.personal, null, { template: t.id }) }, h('span.page-icon', { 'data-color': t.icon.color }, icon(t.icon.name, 20)), h('span.home-start-title', t.name), h('span.home-start-desc', t.description))),
        ),
      ),
    );
  }

  destroy() {
    this.el.remove();
  }
}
