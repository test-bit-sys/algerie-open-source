/**
 * Editable key/value table used for params, headers, form fields and
 * variables. The last row is a blank row: typing in it adds a real one.
 * Rows are edited in place so focus and caret survive every keystroke;
 * the table is only rebuilt when rows are added or removed.
 *
 * columns: { description: bool, files: bool, secret: bool }
 */
import { h, domId } from '../lib/dom.js';
import { uid } from '../lib/ids.js';
import { icon } from './icons.js';
import { createVarInput } from './var-input.js';
import { showMenu } from './menu.js';

export function createKvTable({
  rows = [],
  onChange,
  vars = null,
  label = 'Items',
  keyLabel = 'Key',
  valueLabel = 'Value',
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  description = true,
  files = false,
  secret = false,
  keySuggestions = null,
  onPickFile = null,
  bulk = true,
  readOnly = false,
  makeRow = null,
} = {}) {
  let data = rows.map((r) => ({ ...r }));
  let bulkMode = false;
  const listId = keySuggestions ? domId('keys') : null;
  const tbody = h('tbody');
  const table = h(
    'table.kv',
    { 'aria-label': label },
    h(
      'thead',
      h(
        'tr',
        h('th.kv-check', h('span.sr-only', 'Enabled')),
        h('th', keyLabel),
        files ? h('th.kv-kind', h('span.sr-only', 'Type')) : null,
        h('th', valueLabel),
        description ? h('th.kv-desc-col', 'Description') : null,
        secret ? h('th.kv-secret-col', h('span.sr-only', 'Secret')) : null,
        h('th.kv-actions', h('span.sr-only', 'Actions')),
      ),
    ),
    tbody,
  );
  const textarea = h('textarea.textarea.mono.kv-bulk', {
    'aria-label': `${label}, one per line as key:value. Start a line with // to disable it.`,
    spellcheck: false,
    rows: 8,
  });
  textarea.addEventListener('input', () => {
    data = parseBulk(textarea.value, data);
    emit();
  });
  const toggle = h('button.link-btn.kv-bulk-toggle', { type: 'button' }, 'Bulk edit');
  toggle.addEventListener('click', () => setBulk(!bulkMode));
  const el = h(
    'div.kv-wrap',
    h('div.kv-scroll', table),
    textarea,
    listId ? h('datalist', { id: listId }, keySuggestions.map((k) => h('option', { value: k }))) : null,
  );
  textarea.hidden = true;

  function emit() {
    onChange?.(data.map((r) => ({ ...r })));
  }

  function setBulk(on) {
    bulkMode = on;
    toggle.textContent = on ? 'Key-value edit' : 'Bulk edit';
    textarea.hidden = !on;
    table.parentElement.hidden = on;
    if (on) {
      textarea.value = toBulk(data);
      textarea.focus();
    } else render();
  }

  function newRow(fields) {
    const base = makeRow ? makeRow() : { id: uid(), key: '', value: '', enabled: true, description: '' };
    if (files) Object.assign(base, { kind: 'text', file: null });
    if (secret) base.secret = false;
    return { ...base, ...fields };
  }

  function rowEl(row, index, ghost = false) {
    const n = index + 1;
    let promoted = false;
    const update = (patch, e) => {
      if (ghost) {
        // Adding the row rebuilds the table, which would cut an IME composition
        // short: wait for compositionend. Some browsers send one more input after it.
        if (e?.isComposing || promoted) return;
        promoted = true;
        const created = newRow(patch);
        data.push(created);
        emit();
        render({ focus: { id: created.id, field: Object.keys(patch)[0] } });
        return;
      }
      Object.assign(row, patch);
      if ('key' in patch) relabel();
      emit();
    };
    const name = () => row.key || `row ${n}`;
    // The row's controls are named after its key, so keep them in step as it is typed.
    const relabel = () => {
      check.setAttribute('aria-label', `Enable ${name()}`);
      secretBtn?.setAttribute('aria-label', `${row.secret ? 'Show' : 'Hide'} value of ${name()}`);
      del?.setAttribute('aria-label', `Delete ${name()}`);
    };
    const check = h('input', {
      type: 'checkbox',
      checked: ghost ? false : row.enabled,
      disabled: ghost || readOnly,
      'aria-label': ghost ? 'New row' : `Enable ${name()}`,
      onchange: (e) => {
        update({ enabled: e.target.checked });
        tr.classList.toggle('disabled', !e.target.checked);
      },
    });
    const keyInput = createVarInput({
      value: ghost ? '' : row.key,
      placeholder: keyPlaceholder,
      label: ghost ? `New ${keyLabel.toLowerCase()}` : `${keyLabel}, row ${n}`,
      vars,
      readOnly,
      onInput: (v, e) => update({ key: v }, e),
      className: 'kv-input',
    });
    if (listId) keyInput.input.setAttribute('list', listId);
    keyInput.el.dataset.field = 'key';
    const isFile = files && !ghost && row.kind === 'file';
    let valueCell;
    if (isFile) {
      const name = row.file?.name || 'No file chosen';
      valueCell = h(
        'div.kv-file',
        h(
          'button.btn.sm',
          {
            type: 'button',
            disabled: readOnly,
            onclick: async () => {
              const file = await onPickFile?.();
              if (file) {
                update({ file });
                render();
              }
            },
          },
          icon('paperclip', 13),
          h('span', row.file ? 'Change' : 'Choose file'),
        ),
        h('span.kv-file-name', { title: name }, name),
      );
    } else {
      const valueInput = createVarInput({
        value: ghost ? '' : row.value,
        placeholder: valuePlaceholder,
        label: ghost ? `New ${valueLabel.toLowerCase()}` : `${valueLabel}, row ${n}`,
        vars,
        readOnly,
        onInput: (v, e) => update({ value: v }, e),
        className: `kv-input${secret && !ghost && row.secret ? '.masked' : ''}`,
      });
      valueInput.el.dataset.field = 'value';
      valueCell = valueInput.el;
    }
    const kindSelect = files
      ? h(
          'select.select.sm.kv-kind-select',
          {
            'aria-label': `Type, row ${n}`,
            disabled: ghost || readOnly,
            onchange: (e) => {
              update({ kind: e.target.value, value: '', file: null });
              render();
            },
          },
          h('option', { value: 'text', selected: !isFile }, 'Text'),
          h('option', { value: 'file', selected: isFile }, 'File'),
        )
      : null;
    const desc = description
      ? h('input.kv-plain', {
          type: 'text',
          value: ghost ? '' : row.description || '',
          placeholder: 'Description',
          readOnly,
          'aria-label': ghost ? 'New description' : `Description, row ${n}`,
          dataset: { field: 'description' },
          oninput: (e) => update({ description: e.target.value }, e),
        })
      : null;
    const secretBtn =
      secret && !ghost
        ? h(
            'button.icon-btn.sm',
            {
              type: 'button',
              'aria-label': `${row.secret ? 'Show' : 'Hide'} value of ${name()}`,
              'aria-pressed': String(!!row.secret),
              title: row.secret ? 'Secret: value is hidden' : 'Mark as secret',
              disabled: readOnly,
              onclick: () => {
                update({ secret: !row.secret });
                render();
              },
            },
            icon(row.secret ? 'eyeOff' : 'eye', 14),
          )
        : null;
    const del = ghost || readOnly
      ? null
      : h(
          'button.icon-btn.sm.kv-del',
          {
            type: 'button',
            'aria-label': `Delete ${name()}`,
            onclick: () => {
              data.splice(data.indexOf(row), 1);
              emit();
              render({ focusRow: Math.min(index, data.length) });
            },
          },
          icon('trash', 14),
        );
    const tr = h(
      `tr${ghost ? '.ghost' : ''}${!ghost && !row.enabled ? '.disabled' : ''}`,
      { dataset: { id: ghost ? '' : row.id } },
      h('td.kv-check', check),
      h('td', keyInput.el),
      files ? h('td.kv-kind', kindSelect) : null,
      h('td', valueCell),
      description ? h('td.kv-desc-col', desc) : null,
      secret ? h('td.kv-secret-col', secretBtn) : null,
      h('td.kv-actions', del),
    );
    if (ghost) {
      tr.addEventListener('compositionend', (e) => {
        const field = e.target.closest('[data-field]')?.dataset.field;
        if (field && e.target.value) update({ [field]: e.target.value });
      });
    } else {
      tr.addEventListener('contextmenu', (e) => {
        if (readOnly) return;
        e.preventDefault();
        showMenu(
          [
            { label: row.enabled ? 'Disable' : 'Enable', icon: row.enabled ? 'circleSlash' : 'circleCheck', run: () => { update({ enabled: !row.enabled }); render(); } },
            { label: 'Duplicate', icon: 'copy', run: () => { data.splice(data.indexOf(row) + 1, 0, newRow({ ...row, id: uid() })); emit(); render(); } },
            { label: 'Move up', icon: 'chevronUp', disabled: index === 0, run: () => move(index, -1) },
            { label: 'Move down', icon: 'chevronDown', disabled: index === data.length - 1, run: () => move(index, 1) },
            '-',
            { label: 'Delete', icon: 'trash', danger: true, run: () => { data.splice(index, 1); emit(); render({ focusRow: Math.min(index, data.length) }); } },
          ],
          { rect: { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }, label: 'Row actions' },
        );
      });
    }
    return tr;
  }

  function move(index, delta) {
    const [r] = data.splice(index, 1);
    data.splice(index + delta, 0, r);
    emit();
    render();
  }

  function render({ focus = null, focusRow = null } = {}) {
    // Rebuilding would drop focus to the page: note the control that has it, to focus it again in its new row.
    const active = document.activeElement;
    const activeRow = tbody.contains(active) ? active.closest('tr') : null;
    const keep = activeRow?.dataset.id ? { id: activeRow.dataset.id, cell: [...activeRow.children].indexOf(active.closest('td')), caret: active.selectionStart } : null;
    const rowsEls = data.map((r, i) => rowEl(r, i));
    if (!readOnly) rowsEls.push(rowEl(null, data.length, true));
    tbody.replaceChildren(...rowsEls);
    if (!focus && focusRow == null && keep) {
      const target = tbody.querySelector(`tr[data-id="${keep.id}"]`)?.children[keep.cell]?.querySelector('input, select, button');
      target?.focus();
      if (keep.caret != null) target?.setSelectionRange?.(keep.caret, keep.caret);
    } else if (focus) {
      const tr = tbody.querySelector(`tr[data-id="${focus.id}"]`);
      const target = tr?.querySelector(`[data-field="${focus.field}"] input, input[data-field="${focus.field}"]`);
      if (target) {
        target.focus();
        const len = target.value.length;
        target.setSelectionRange?.(len, len);
      }
    } else if (focusRow != null) {
      tbody.children[focusRow]?.querySelector('[data-field="key"] input')?.focus();
    }
  }

  render();
  return {
    el,
    bulkToggle: bulk && !readOnly ? toggle : null,
    setRows(next) {
      data = next.map((r) => ({ ...r }));
      if (bulkMode) textarea.value = toBulk(data);
      else render();
    },
    getRows: () => data.map((r) => ({ ...r })),
  };
}

export function toBulk(rows) {
  return rows
    .filter((r) => r.kind !== 'file')
    // "key: value": parsing drops exactly that one space, so values that start with a space survive.
    .map((r) => `${r.enabled ? '' : '//'}${r.key}: ${r.value}`)
    .join('\n');
}

/** Parses bulk text, keeping ids and descriptions of rows whose keys still match. */
export function parseBulk(text, previous = []) {
  // File rows are not in the text, so they are never matched to a line and keep their places below.
  const pool = previous.filter((p) => p.kind !== 'file');
  const known = pool.map((p) => p.key).filter(Boolean).sort((a, b) => b.length - a.length);
  const parsed = text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      let enabled = true;
      let body = line;
      if (body.trimStart().startsWith('//')) {
        enabled = false;
        body = body.trimStart().slice(2);
      }
      // Keys can contain colons: split after a key the table already has, else at
      // the first ": " (the way toBulk writes lines) when what is before it can be a
      // key, else at the first ":" (X-Data:{"a": 1} is X-Data and a JSON value).
      const lead = body.length - body.trimStart().length;
      const same = known.find((k) => body.startsWith(`${k}:`, lead));
      let colon = same ? lead + same.length : body.indexOf(': ');
      if (!same && colon >= 0 && /[\s"'{}[\]]/.test(body.slice(lead, colon))) colon = -1;
      if (colon < 0) colon = body.indexOf(':');
      const key = (colon < 0 ? body : body.slice(0, colon)).trim();
      const value = colon < 0 ? '' : body.slice(colon + 1).replace(/^ /, '');
      return { enabled, key, value };
    });
  const keys = new Set(parsed.map((p) => p.key));
  const byLine = [...pool];
  const out = parsed.map(({ enabled, key, value }, n) => {
    let at = pool.findIndex((p) => p.key === key);
    // A renamed key: the row on the same line whose key is gone keeps its id, secret flag and description.
    if (at < 0 && byLine[n] && !keys.has(byLine[n].key)) at = pool.indexOf(byLine[n]);
    const prev = at >= 0 ? pool.splice(at, 1)[0] : null;
    return { ...(prev || { id: uid(), description: '' }), key, value, enabled };
  });
  // File rows cannot be written as text; put them back where they were among the others.
  previous.forEach((p, i) => {
    if (p.kind === 'file') out.splice(Math.min(i, out.length), 0, p);
  });
  return out;
}
