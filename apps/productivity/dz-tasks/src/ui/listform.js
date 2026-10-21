import { el, clear } from '../lib/dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store, LIST_ICON_CHOICES } from '../lib/store.js';

/** Create/edit a list: name, color slot, icon. Delete lives here too. */
export function openListForm({ list = null, onSaved = null } = {}) {
  const editing = !!list;
  const draft = {
    name: list?.name || '',
    slot: list?.slot || 1,
    icon: list?.icon || 'list',
  };

  const nameError = el('p.field-error', { id: 'lf-name-error', hidden: true, html: icon('alert', 14, 2.4) },
    el('span', {}, 'A list needs a name'));

  const nameInput = el('input.input', {
    value: draft.name, placeholder: 'List name', maxlength: 80, 'aria-label': 'List name',
    'aria-describedby': 'lf-name-error',
    oninput: (e) => {
      draft.name = e.target.value;
      if (e.target.value.trim()) { nameInput.removeAttribute('aria-invalid'); nameError.hidden = true; }
    },
    // isComposing: an IME's confirm-candidate Enter must not submit the form.
    onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } },
  });

  const swatches = el('div.swatch-grid', { role: 'group', 'aria-label': 'List color' });
  function renderSwatches() {
    clear(swatches);
    for (let s = 1; s <= 8; s++) {
      swatches.append(el('button.swatch', {
        type: 'button', 'aria-pressed': String(draft.slot === s), 'aria-label': `Color ${s}`,
        onclick: () => { draft.slot = s; renderSwatches(); },
      }, el('span.dot', { style: { background: `var(--slot-${s})` } })));
    }
  }
  renderSwatches();

  const icons = el('div.icon-grid', { role: 'group', 'aria-label': 'List icon' });
  function renderIcons() {
    clear(icons);
    icons.append(...LIST_ICON_CHOICES.map((name) =>
      el('button.icon-choice', {
        type: 'button', 'aria-pressed': String(draft.icon === name), 'aria-label': `Icon ${name}`,
        html: icon(name, 18),
        onclick: () => { draft.icon = name; renderIcons(); },
      })));
  }
  renderIcons();

  const saveBtn = el('button.btn.btn-primary', { onclick: save }, editing ? 'Save' : 'Create list');

  // Enter in the name input calls save() directly, so disabling the
  // button alone doesn't stop key auto-repeat from creating the list twice.
  let saving = false;
  async function save() {
    if (saving) return;
    if (!nameInput.value.trim()) {
      // Was a silent bounce: focus moved and nothing said why.
      nameInput.setAttribute('aria-invalid', 'true');
      nameError.hidden = false;
      nameInput.focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    let saved = list;
    try {
      if (editing) await store.updateList(list.id, { ...draft, name: nameInput.value });
      else saved = await store.addList({ ...draft, name: nameInput.value });
    } catch (err) {
      console.error(err);
      // A full cloud still keeps (and queues) the list, so the form is done —
      // reopening it for another attempt would create a second copy. There
      // is no saved list to hand back, so no navigation follows.
      if (!err?.quota) {
        saving = false;
        saveBtn.disabled = false;
        toast('Could not save. Check your connection', { icon: 'wifiOff' });
        return;
      }
      modal.close();
      toast(err.message, { icon: 'cloud', duration: 5000 });
      return;
    }
    modal.close();
    onSaved?.(saved);
  }

  const body = el('div', {},
    el('div.field', {}, nameInput, nameError),
    el('div.field', {}, el('span.field-label', {}, 'Color'), swatches),
    el('div.field', {}, el('span.field-label', {}, 'Icon'), icons),
    el('div.row', { style: { marginTop: '18px', justifyContent: 'space-between' } },
      editing ? el('button.icon-btn', {
        html: icon('trash', 18), 'aria-label': 'Delete list',
        style: { color: 'var(--danger)' },
        onclick: async () => {
          const n = store.tasks.filter((t) => t.listId === list.id).length;
          const ok = await confirmDialog({
            title: `Delete "${list.name}"?`,
            message: n
              ? `The list and its ${n} task${n === 1 ? '' : 's'} will be removed. This cannot be undone.`
              : 'The empty list will be removed.',
          });
          if (!ok) return;
          await store.deleteList(list.id);
          modal.close();
          location.hash = '#/lists';
          toast('List deleted', { icon: 'trash' });
        },
      }) : el('span'),
      el('div.row', {},
        el('button.btn.btn-ghost', { onclick: () => modal.close() }, 'Cancel'),
        saveBtn
      )
    )
  );

  const modal = openModal({ title: editing ? 'Edit list' : 'New list', content: body });
  return modal;
}
