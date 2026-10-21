import { el, clear } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { todayISO, fmtDay, fmtMonth } from '../lib/dates.js';
import { taskCard } from '../ui/taskrow.js';
import { plural } from '../lib/util.js';

/**
 * Which archive months the user has opened. Kept outside the view: the
 * shell rebuilds this view on every store change (completing a task from
 * the search sheet, a sync landing from another device), and collapsing
 * what someone was reading is worse than re-reading the file.
 */
const expanded = new Set();

/**
 * Logbook: recent completions (still in the hot document) grouped by day,
 * plus older monthly archives loaded from fs on demand.
 */
export function logbookView() {
  const recent = store.completedTasks();

  const root = el('div', {},
    el('header.view-head', {},
      el('div', {},
        el('h1.view-title', {}, 'Logbook'),
        el('p.view-sub', {}, recent.length ? plural(recent.length, 'recent completion') : 'Completed tasks land here')
      )
    )
  );

  if (!recent.length && !store.logMonths.length) {
    root.append(el('div.card', {}, el('div.empty', {},
      el('div.empty-icon', { html: icon('history', 26) }),
      el('h3', {}, 'Nothing completed yet'),
      el('p', {}, 'Check something off and it shows up here.')
    )));
    return root;
  }

  // Group recent completions by the day they were finished.
  const byDay = new Map();
  for (const t of recent) {
    const day = todayISO(new Date(t.completedAt || Date.now()));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(t);
  }
  for (const [day, tasks] of byDay) {
    root.append(
      el('div.day-group-head', {},
        el('span.d-name', {}, fmtDay(day)),
        el('span.d-date', {}, plural(tasks.length, 'task'))
      ),
      taskCard(tasks, { showList: true })
    );
  }

  // Older months, one loader per archive file (newest first).
  const archived = [...store.logMonths].reverse();
  if (archived.length) {
    root.append(el('div.section-label', {}, 'Archive'));
    for (const key of archived) {
      const holder = el('div');
      const [y, m] = key.split('-').map(Number);
      const btn = el('button.btn.btn-ghost.btn-block', {
        style: { marginBottom: '10px' },
        html: icon('archive', 15, 2),
        onclick: () => { expanded.add(key); show(); },
      }, ` Show ${fmtMonth(y, m)}`);
      holder.append(btn);
      root.append(holder);

      async function show() {
        btn.disabled = true;
        btn.textContent = 'Loading…';
        try {
          const tasks = await store.loadLog(key);
          tasks.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
          clear(holder);
          holder.append(
            el('div.day-group-head', {},
              el('span.d-name', {}, fmtMonth(y, m)),
              el('span.d-date', {}, plural(tasks.length, 'task'))
            ),
            taskCard(tasks, { showList: true, readonly: true, tagLinks: true })
          );
        } catch (err) {
          console.error(err);
          // A month that fails to load stays closed, so the next mount
          // shows its button rather than retrying on every re-render.
          expanded.delete(key);
          btn.disabled = false;
          btn.replaceChildren('Could not load. Try again');
        }
      }

      // Re-open what the user had open before this re-render. The file is
      // re-read rather than cached so an archive the boot sweep just
      // extended does not come back short.
      if (expanded.has(key)) show();
    }
  }

  return root;
}
