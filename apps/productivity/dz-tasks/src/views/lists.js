import { el } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { taskCard } from '../ui/taskrow.js';
import { openTaskForm } from '../ui/taskform.js';
import { openListForm } from '../ui/listform.js';
import { openShareSheet } from '../ui/sharesheet.js';
import { openRowMenu } from '../ui/rowmenu.js';
import { makeSortable } from '../ui/sortable.js';
import { quickAddBar } from '../ui/quickadd.js';
import { plural } from '../lib/util.js';

/** All lists as tappable cards. */
export function listsView({ navigate }) {
  const root = el('div', {},
    el('header.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Lists'),
        el('p.view-sub', {}, 'Personal and shared')
      ),
      el('div.view-actions', {},
        el('button.btn.btn-primary', {
          html: icon('plus', 15, 2.4),
          onclick: () => openListForm({ onSaved: (l) => l && navigate(`#/list/${l.id}`) }),
        }, ' New list')
      )
    )
  );

  if (!store.lists.length) {
    root.append(el('div.card', {}, el('div.empty', {},
      el('div.empty-icon', { html: icon('grid', 26) }),
      el('h3', {}, 'No lists yet'),
      el('p', {}, 'Lists keep home, work, and projects apart. Create your first one.')
    )));
    return root;
  }

  // The keyboard/screen-reader path to reordering (dragging is the other):
  // the same Move up/down menu task rows use, one per card.
  async function moveListBy(list, dir) {
    const seq = store.lists;
    const i = seq.findIndex((x) => x.id === list.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= seq.length) return;
    const args = dir < 0
      ? { prevId: seq[j - 1]?.id || null, nextId: seq[j].id }
      : { prevId: seq[j].id, nextId: seq[j + 1]?.id || null };
    await store.reorderList(list.id, args);
    toast(dir < 0 ? 'Moved up' : 'Moved down', { duration: 1200 });
  }

  const listActions = (l) => {
    const i = store.lists.findIndex((x) => x.id === l.id);
    return [
      { icon: 'chevUp', label: 'Move up', disabled: i <= 0, onClick: () => moveListBy(l, -1) },
      { icon: 'chevDown', label: 'Move down', disabled: i === store.lists.length - 1, onClick: () => moveListBy(l, 1) },
    ];
  };

  const grid = el('div.list-grid', {},
    store.lists.map((l) => {
      const open = store.tasks.filter((t) => t.listId === l.id && !t.done).length;
      return el('div.list-card', { dataset: { listId: l.id } },
        el('button.l-open', { 'aria-label': `Open list: ${l.name}`, onclick: () => navigate(`#/list/${l.id}`) },
          el('span.l-icon', {
            html: icon(l.icon, 19),
            style: { background: `color-mix(in srgb, var(--slot-${l.slot}) 14%, transparent)`, color: `var(--slot-${l.slot})` },
          }),
          el('div.grow', {},
            el('div.l-name', {}, l.name,
              l.collab ? el('span.shared-mark', { html: icon('users', 13, 2.2), title: 'Shared: everyone can edit' })
                : l.shared ? el('span.shared-mark', { html: icon('eye', 13, 2.2), title: 'Shared as a view-only link' }) : null),
            el('div.l-sub', {}, open ? plural(open, 'open task') : 'All done')
          ),
          el('span.l-count', {}, String(open || ''))
        ),
        el('button.icon-btn.row-menu', {
          html: icon('more', 17),
          'aria-label': `Actions for ${l.name}`,
          'aria-haspopup': 'dialog',
          onclick: (e) => {
            e.stopPropagation();
            openRowMenu({ id: l.id, title: l.name }, listActions(l));
          },
        })
      );
    })
  );
  makeSortable(grid, {
    itemSelector: '.list-card',
    grid: true,
    onDrop: (item, prev, next) => store.reorderList(item.dataset.listId, {
      prevId: prev?.dataset.listId || null,
      nextId: next?.dataset.listId || null,
    }),
  });
  root.append(grid);

  const tags = store.allTags();
  if (tags.length) {
    root.append(
      el('div.section-label', {}, 'Tags'),
      el('div.tag-cloud', {},
        tags.map(({ tag, open }) => el('button.tag-chip.big', {
          onclick: () => navigate(`#/tag/${encodeURIComponent(tag)}`),
        },
          `#${tag}`,
          open ? el('span.count', {}, String(open)) : null
        )))
    );
  }

  return root;
}

/** One list: its open tasks, then completed. */
export function listDetailView(listId, { navigate }) {
  const list = store.listById(listId);
  if (!list) {
    return el('div.card', { style: { marginTop: '24px' } }, el('div.empty', {},
      el('div.empty-icon', { html: icon('grid', 26) }),
      el('h3', {}, 'List not found'),
      el('p', {}, 'It may have been deleted.'),
      el('button.btn.btn-ghost', { style: { marginTop: '14px' }, onclick: () => navigate('#/lists') }, 'All lists')
    ));
  }

  // Detail view is the list's own space: the user's manual (drag) order
  // rules here, while Today/Upcoming keep their date-first grouping.
  const open = store.manualTasks(list.id);
  const done = store.completedTasks(list.id);

  async function moveBy(task, dir) {
    const seq = store.manualTasks(list.id);
    const i = seq.findIndex((t) => t.id === task.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= seq.length) return;
    const args = dir < 0
      ? { prevId: seq[j - 1]?.id || null, nextId: seq[j].id }
      : { prevId: seq[j].id, nextId: seq[j + 1]?.id || null };
    await store.reorderTask(task.id, args);
    toast(dir < 0 ? 'Moved up' : 'Moved down', { duration: 1200 });
  }

  const rowActions = (task) => {
    const seq = store.manualTasks(list.id);
    const i = seq.findIndex((t) => t.id === task.id);
    if (i < 0) return null; // completed rows have no ordering
    return [
      { icon: 'chevUp', label: 'Move up', disabled: i === 0, onClick: () => moveBy(task, -1) },
      { icon: 'chevDown', label: 'Move down', disabled: i === seq.length - 1, onClick: () => moveBy(task, 1) },
    ];
  };

  const root = el('div', {},
    el('header.view-head', {},
      el('button.icon-btn', { html: icon('chevL', 20), 'aria-label': 'Back to lists', onclick: () => navigate('#/lists') }),
      el('span.l-icon', {
        html: icon(list.icon, 19), 'aria-hidden': 'true',
        style: {
          background: `color-mix(in srgb, var(--slot-${list.slot}) 14%, transparent)`, color: `var(--slot-${list.slot})`,
        },
      }),
      el('div.grow', { style: { minWidth: 0 } },
        el('h1.view-title', {}, list.name),
        el('p.view-sub', {},
          list.collab?.role === 'member' ? `Shared by ${list.collab.ownerName || 'the owner'}`
            : list.collab ? 'Shared: everyone can edit'
              : list.shared ? 'Shared as a live link'
                : plural(open.length, 'open task'))
      ),
      el('div.view-actions', {},
        el('button.icon-btn', {
          html: icon('share', 18),
          'aria-label': list.shared || list.collab ? 'Sharing options' : 'Share list',
          style: list.shared || list.collab ? { color: 'var(--accent)' } : null,
          onclick: () => openShareSheet(list),
        }),
        // Members don't own the list's name/color — the owner's manifest
        // would overwrite any local edit on the next sync.
        list.collab?.role !== 'member' && el('button.icon-btn', {
          html: icon('pencil', 18), 'aria-label': 'Edit list',
          onclick: () => openListForm({ list }),
        }),
        el('button.btn.btn-primary', {
          html: icon('plus', 15, 2.4),
          onclick: () => openTaskForm({ listId: list.id }),
        }, ' Add')
      )
    )
  );

  root.append(quickAddBar({ listId: list.id }));

  if (open.length) {
    const openCard = taskCard(open, { actions: rowActions });
    makeSortable(openCard, {
      itemSelector: '.task-row',
      carrySelector: '.subtask-strip',
      onDrop: (item, prev, next) => store.reorderTask(item.dataset.taskId, {
        prevId: prev?.dataset.taskId || null,
        nextId: next?.dataset.taskId || null,
      }),
    });
    root.append(openCard);
  } else {
    root.append(el('div.card', {}, el('div.empty', {},
      el('div.empty-icon', { html: icon('checkBig', 26) }),
      el('h3', {}, done.length ? 'All done' : 'Nothing here yet'),
      el('p', {}, done.length ? 'Every task in this list is complete.' : 'Add the first task to this list.')
    )));
  }

  if (done.length) {
    root.append(
      el('div.section-label', {}, 'Completed', el('span.count', {}, plural(done.length, 'task'))),
      taskCard(done)
    );
  }

  return root;
}
