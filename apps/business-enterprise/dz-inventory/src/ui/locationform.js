import { el } from './dom.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { stockAt } from '../lib/stock.js';
import { formatQtyIn, unitLabel } from '../lib/units.js';

export function openLocationForm(location = null, { onSaved } = {}) {
  const isEdit = !!location;

  const nameInput = el('input.input', { id: 'loc-name', required: true, maxLength: 120, value: location?.name || '', placeholder: 'e.g. Main warehouse' });
  const noteInput = el('input.input', { id: 'loc-note', maxLength: 200, value: location?.note || '', placeholder: 'e.g. Aisle-bin coded, A3-12' });
  const nameErr = el('p.field-error', { id: 'loc-name-error', hidden: true }, 'A location name is required.');
  nameInput.setAttribute('aria-describedby', nameErr.id);
  const submit = el('button.btn.btn-primary.btn-block', { type: 'submit' }, isEdit ? 'Save changes' : 'Add location');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      nameErr.hidden = !!name;
      nameInput.setAttribute('aria-invalid', String(!name));
      if (!name) { nameInput.focus(); return; }
      submit.disabled = true;
      try {
        if (isEdit) await store.updateLocation(location.id, { name, note: noteInput.value.trim() });
        else await store.addLocation({ name, note: noteInput.value.trim() });
        toast(isEdit ? 'Location saved' : 'Location added');
        modal.close();
        onSaved?.();
      } catch (err) {
        console.error(err);
        submit.disabled = false;
        toast('Couldn’t save. Check your connection', { icon: 'wifiOff' });
      }
    },
  },
    el('div.field', {},
      el('label', { htmlFor: 'loc-name' }, 'Name', el('span', { 'aria-hidden': 'true' }, ' *')),
      nameInput, nameErr),
    el('div.field', {},
      el('label', { htmlFor: 'loc-note' }, 'Note'),
      noteInput),
    submit,
    isEdit && el('button.btn.btn-ghost.btn-block', {
      type: 'button',
      style: { color: 'var(--danger)', marginTop: '8px' },
      onclick: async () => {
        // A count in progress froze its rows against a bucket; deleting
        // a location out from under it corrupts the apply. Asked in the
        // store's own words, rather than letting the refusal arrive as
        // a failed write reported as a connection problem.
        const blocked = store.locationDeleteBlocker(location.id);
        if (blocked) {
          toast(blocked, { icon: 'clipboard' });
          return;
        }
        const homed = store.products.filter((p) => p.locationId === location.id).length;
        /* Stock sitting here doesn't vanish, it moves to "No location" —
           a reassignment worth stating before it happens rather than
           discovering in the history afterwards. */
        const holding = store.products.filter((p) => stockAt(p, location.id) > 0);
        const units = holding.length === 1
          ? `${formatQtyIn(stockAt(holding[0], location.id), holding[0].unit)} ${unitLabel(holding[0].unit, stockAt(holding[0], location.id))} of "${holding[0].name}"`
          : `the stock of ${holding.length} products`;
        const sentences = [`"${location.name}" is removed.`];
        if (homed) {
          sentences.push(`${homed} product${homed === 1 ? ' keeps' : 's keep'} existing without a location.`);
        }
        if (holding.length) {
          sentences.push(`Whatever is on the shelf here (${units}) moves to "No location", and every move is recorded in the history.`);
        }
        if (sentences.length === 1) sentences.push('This cannot be undone.');
        const ok = await confirmDialog({
          title: 'Delete location?',
          message: sentences.join(' '),
        });
        if (!ok) return;
        try {
          await store.deleteLocation(location.id);
          toast('Location deleted', { icon: 'trash' });
          modal.close();
          onSaved?.();
        } catch (err) {
          console.error(err);
          toast('Couldn’t delete. Check your connection', { icon: 'wifiOff' });
        }
      },
    }, 'Delete location')
  );

  /* Unsaved typing must survive a mistap on the scrim. */
  const opened = `${nameInput.value}\0${noteInput.value}`;

  const modal = openModal({
    title: isEdit ? 'Edit location' : 'New location',
    content: form,
    unsaved: () => `${nameInput.value}\0${noteInput.value}` !== opened,
  });
}
