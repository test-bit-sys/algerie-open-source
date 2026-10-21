import { el } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store, compareTasks } from '../lib/store.js';
import { taskCard } from '../ui/taskrow.js';
import { plural } from '../lib/util.js';

/** Every task carrying a tag, across all lists. */
export function tagView(tag, { navigate }) {
  const open = store.tasks.filter((t) => !t.done && t.tags?.includes(tag)).sort(compareTasks);
  const done = store.tasks.filter((t) => t.done && t.tags?.includes(tag))
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  const root = el('div', {},
    el('header.view-head', {},
      el('button.icon-btn', { html: icon('chevL', 20), 'aria-label': 'Back to lists', onclick: () => navigate('#/lists') }),
      el('div.grow', { style: { minWidth: 0 } },
        el('h1.view-title', {}, `#${tag}`),
        el('p.view-sub', {}, `${plural(open.length, 'open task')} across your lists`)
      )
    )
  );

  if (open.length) {
    root.append(taskCard(open, { showList: true }));
  } else {
    root.append(el('div.card', {}, el('div.empty', {},
      el('div.empty-icon', { html: icon('search', 26) }),
      el('h3', {}, done.length ? 'All done' : 'Nothing carries this tag'),
      el('p', {}, done.length
        ? 'Every task with this tag is complete.'
        : 'Add tags to tasks in the edit form, or type #' + tag + ' in the quick-add bar.')
    )));
  }

  if (done.length) {
    root.append(
      el('div.section-label', {}, 'Completed', el('span.count', {}, plural(done.length, 'task'))),
      taskCard(done, { showList: true })
    );
  }

  return root;
}
