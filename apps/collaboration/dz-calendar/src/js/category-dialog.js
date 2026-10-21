/**
 * "Rename category" — reached from the pencil on a sidebar category row.
 *
 * The palette key ('violet') is what events, the filter and the app-to-app API
 * store; only the label belongs to the user, so this dialog writes nothing but
 * a name. Submitting an empty field clears the custom name and the palette
 * default comes back — which is what the placeholder is showing all along, and
 * why there is no separate Reset button.
 */
import { el } from './dom.js';
import { mountDialog } from './recurrence-dialog.js';
import { colorHex, colorLabel, categoryLabel, MAX_CATEGORY_NAME } from './colors.js';

/**
 * @param {object}   opts
 * @param {string}   opts.key            palette key being renamed
 * @param {object}   [opts.names]        current `settings.categoryNames`
 * @param {function} opts.onSave         called with the new name, '' to clear
 */
export function openCategoryRename({ key, names = {}, onSave }) {
  const fallback = colorLabel(key);
  const current = typeof names[key] === 'string' ? names[key].trim() : '';

  const input = el('input', {
    class: 'input',
    type: 'text',
    maxlength: String(MAX_CATEGORY_NAME),
    placeholder: fallback,
    'aria-label': 'Category name',
    autocomplete: 'off',
    value: current,
  });
  // Set imperatively, the same way the search field does it: `spellcheck` is a
  // *boolean* IDL attribute, so el()'s `key in node` branch assigns it the
  // string 'false' — which is truthy, and turns spellcheck ON. Passing the
  // boolean false doesn't work either: el() skips any value that is `false`.
  input.spellcheck = false;

  const dialog = el(
    'form',
    {
      class: 'modal rr-modal cat-rename',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'cat-rename-title',
    },
    [
      el('div', { class: 'modal__head' }, [
        el('h2', {
          class: 'modal__title',
          id: 'cat-rename-title',
          // Names the row being renamed, since the pencil that opened this sits
          // in a column of six identical ones.
          text: `Rename “${categoryLabel(key, names)}”`,
        }),
      ]),
      el('div', { class: 'modal__body' }, [
        el('div', { class: 'cat-rename__row' }, [
          el('span', { class: 'cat-rename__dot', style: { background: colorHex(key) } }),
          input,
        ]),
        el('p', {
          class: 'cat-rename__hint',
          text: `Leave it empty to go back to “${fallback}”. The color doesn’t change.`,
        }),
      ]),
      el('div', { class: 'modal__foot' }, [
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => close() } }),
        el('button', { class: 'btn btn--primary', type: 'submit', text: 'Save' }),
      ]),
    ],
  );

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = input.value.trim().slice(0, MAX_CATEGORY_NAME).trim();
    close();
    if (next !== current) onSave(next);
  });

  const close = mountDialog(dialog);
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return close;
}
