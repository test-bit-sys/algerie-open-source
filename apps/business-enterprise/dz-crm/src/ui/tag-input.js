/**
 * Tag controls: the chip input forms use to edit a record's tags, and the
 * filter control list views use to narrow by them.
 *
 * The input is a chip box - existing tags as removable chips, a free text
 * field that commits on Enter, comma, or blur, and native datalist
 * autocomplete over every tag already in use, so the same label doesn't
 * drift into five spellings.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { store } from '../lib/store.js';
import { cleanTag, hasTag, MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD } from '../lib/tags.js';

let seq = 0;

export function tagInput(initial = []) {
  const tags = [...(initial || [])];
  const listId = `tag-options-${++seq}`;

  const input = el('input.tag-input-field', {
    type: 'text', list: listId, placeholder: tags.length ? '' : 'Add tags…',
    maxlength: MAX_TAG_LENGTH, autocomplete: 'off', spellcheck: false,
    'aria-label': 'Add a tag',
  });
  const datalist = el('datalist', { id: listId });
  const box = el('div.tag-input', {
    onclick: (e) => { if (e.target === box) input.focus(); },
  });

  function syncOptions() {
    clear(datalist);
    for (const t of store.allTags()) {
      if (!hasTag(tags, t.name)) datalist.append(el('option', { value: t.name }));
    }
  }

  function render() {
    // clear() detaches the focused input, dropping the keyboard to the
    // body - so committing a tag with Enter meant a mouse trip back for
    // every next one. Refocus only when focus was here to begin with: a
    // blur-time commit is the user already leaving, and yanking them back
    // would trap the field.
    const hadFocus = document.activeElement === input;
    clear(box);
    for (const tag of tags) {
      box.append(el('span.tag-chip', {},
        tag,
        el('button.tag-chip-x', {
          type: 'button',
          html: icon('x', 12, 2.4),
          'aria-label': `Remove tag ${tag}`,
          // Keep the press from blurring the text field: blur commits, and
          // the commit re-render tears this button out from under the
          // pointer before click can fire - the removal silently failed
          // and the half-typed text became a tag instead.
          onpointerdown: (e) => e.preventDefault(),
          onclick: () => {
            tags.splice(tags.indexOf(tag), 1);
            render();
            input.focus();
          },
        })
      ));
    }
    input.placeholder = tags.length ? '' : 'Add tags…';
    box.append(input, datalist);
    syncOptions();
    if (hadFocus) input.focus();
  }

  function commit() {
    const tag = cleanTag(input.value);
    input.value = '';
    if (!tag || hasTag(tags, tag) || tags.length >= MAX_TAGS_PER_RECORD) return;
    tags.push(tag);
    render();
  }

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop();
      render();
    }
  });
  // change covers both a datalist pick and typed text left at blur time,
  // so a tag typed just before hitting Save is never silently dropped.
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);

  render();
  return { el: box, get: () => [...tags] };
}

/**
 * What the tag filter would offer right now, as a comparable string.
 *
 * A list view builds its filter row once and rebuilds it when the user
 * touches it, so a tag that appears while the view is open - bulk-tagging
 * the selection, editing a record - was missing from the filter until the
 * user navigated away and back. On a list with no tags at all the control
 * isn't rendered, so there was nothing to touch and no way back. Views
 * compare this across store changes and rebuild only when it moves, which
 * keeps a search box from being rebuilt under the caret for nothing.
 *
 * `kind` must match the one the view passes to tagFilterControl, or the
 * comparison watches a vocabulary the control doesn't show.
 */
export function tagVocabulary(kind = null) {
  return store.allTags(kind).map((t) => t.name).join('\0');
}

/**
 * Marks whichever control the filter row ends in, so a rebuild can hand the
 * keyboard back to it. See keepingFocus in ui/dom.js.
 */
const FOCUS_KEY = 'tag-filter-control';

/**
 * Tag filter for list views: active tags as removable chips plus a select
 * of the rest. Returns null when there is nothing to filter by, so views
 * with no tags never show an empty control. Selected tags are ANDed -
 * each added tag narrows.
 *
 * `kind` names the collection being filtered ('contacts' | 'companies' |
 * 'deals'), so the select only offers labels those records actually wear.
 */
export function tagFilterControl(selected, onChange, kind = null) {
  const all = store.allTags(kind);
  if (!all.length && !selected.length) return null;

  const options = all.filter((t) => !hasTag(selected, t.name));
  // The group is named for what it holds, not for the one control inside
  // it. Sharing "Filter by tag" with the select gave two elements the same
  // accessible name, and the rebuilt-control lookup (which searches by
  // aria-label, in document order) then landed on this unfocusable div -
  // so picking a tag dropped the keyboard on the floor. FOCUS_KEY below is
  // the other half of that.
  const wrap = el('div.tag-filter', { role: 'group', 'aria-label': 'Tag filters' });

  for (const name of selected) {
    wrap.append(el('button.filter-chip.active.tag-filter-chip', {
      type: 'button',
      'aria-label': `Stop filtering by tag ${name}`,
      onclick: () => onChange(selected.filter((s) => s !== name)),
    },
      el('span', { html: icon('tag', 12, 2), 'aria-hidden': 'true' }),
      name,
      el('span', { html: icon('x', 12, 2.4), 'aria-hidden': 'true' })
    ));
  }

  if (options.length) {
    const select = el('select.select.tag-filter-select', {
      'aria-label': 'Filter by tag',
      dataset: { focusKey: FOCUS_KEY },
      onchange: () => { if (select.value) onChange([...selected, select.value]); },
    },
      el('option', { value: '', selected: true }, selected.length ? '+ Tag' : 'Any tag'),
      options.map((t) => el('option', { value: t.name }, `${t.name} (${t.count})`))
    );
    wrap.append(el('div.select-wrap', {}, select));
  } else {
    // Filtering by the last remaining tag takes the select away with it.
    // The chip that replaced it inherits the key, so the keyboard lands on
    // the control now standing where the one it used stood - and removing
    // that chip brings the select, and the key, straight back.
    wrap.lastElementChild?.setAttribute('data-focus-key', FOCUS_KEY);
  }
  return wrap;
}
