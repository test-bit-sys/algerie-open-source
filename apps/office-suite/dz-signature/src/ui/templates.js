/**
 * Reusable templates: the PDF plus its field layout, keyed to ROLES ("Client",
 * "Contractor") instead of named people, so the documents you send every week
 * are laid out once.
 *
 * Saving reads from a document (draft or already sent); using one asks for the
 * real person behind each role and lands in the editor with every field
 * already placed and assigned.
 */

import { el, clear, append, fieldId } from './dom.js';
import { icon } from './icons.js';
import { openModal, promptDialog, confirmDialog } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { normalizeEmail, relativeTime } from '../lib/util.js';

/** Save a document's PDF and field layout as a template. */
export async function saveAsTemplateFlow(doc) {
  if (!doc.fields.length) {
    toast('Place at least one field first, then save the layout as a template', {
      icon: 'circleAlert', duration: 4500,
    });
    return null;
  }
  const name = await promptDialog({
    title: 'Save as template',
    label: 'Template name',
    value: doc.title || '',
    placeholder: 'e.g. Standard NDA',
    confirmLabel: 'Save template',
    hint: `Saves this PDF and its ${doc.fields.length} field${doc.fields.length === 1 ? '' : 's'}. Signers become roles you fill in each time.`,
  });
  if (!name) return null;
  try {
    const template = await store.saveTemplateFromDoc(doc, { name });
    const target = store.getDoc(doc.id);
    if (target) {
      store.addAudit(target, 'template_saved', template.name);
      await store.persistDoc(target).catch(() => {});
    }
    toast(`Saved as template "${template.name}"`, { icon: 'template' });
    return template;
  } catch (err) {
    console.error(err);
    toast('Could not save the template. Check your connection', { icon: 'wifiOff' });
    return null;
  }
}

/** Ask who each role is this time, then create the draft. */
export function openNewFromTemplate(template, { navigate }) {
  const titleId = fieldId('tpltitle');
  const titleInput = el('input.input', {
    id: titleId, type: 'text', maxLength: 200, value: template.name,
    placeholder: 'Document title',
  });

  const roleValues = {};
  const roleRows = (template.roles || []).map((role, index) => {
    const nameId = fieldId('rn');
    const emailId = fieldId('re');
    const errorId = fieldId('ree');
    const fieldCount = (template.fields || []).filter((f) => f.roleId === role.id).length;
    const prefillName = role.isMe
      ? (store.settings.fullName || store.user?.username || 'Me')
      : '';
    const prefillEmail = role.isMe ? (store.user?.email || '') : '';
    roleValues[role.id] = { name: prefillName, email: prefillEmail };

    const emailError = el('p.field-error', { id: errorId, hidden: true },
      'Enter a valid email address, like alex@example.com');
    const emailInput = el('input.input', {
      id: emailId, type: 'email', maxLength: 254, value: prefillEmail,
      placeholder: 'email@example.com', disabled: role.isMe,
      oninput: (e) => {
        roleValues[role.id].email = e.target.value.trim();
        if (!e.target.value || normalizeEmail(e.target.value)) setValidity(false);
      },
      onblur: (e) => setValidity(Boolean(e.target.value) && !normalizeEmail(e.target.value)),
    });
    function setValidity(invalid) {
      emailError.hidden = !invalid;
      if (invalid) {
        emailInput.setAttribute('aria-invalid', 'true');
        emailInput.setAttribute('aria-describedby', errorId);
        emailInput.style.borderColor = 'var(--danger)';
      } else {
        emailInput.removeAttribute('aria-invalid');
        emailInput.removeAttribute('aria-describedby');
        emailInput.style.borderColor = '';
      }
    }

    return el('div.role-row', {},
      el('div.role-head', {},
        el('span.recipient-dot', { className: `recipient-dot c${(index % 6) + 1}`, 'aria-hidden': 'true' }),
        el('span.role-name', {}, role.label),
        el('span.small.faint', {}, `${fieldCount} field${fieldCount === 1 ? '' : 's'}`)),
      el('div.role-inputs', {},
        el('div.field', { style: { margin: '0' } },
          el('label', { for: nameId }, role.isMe ? 'Your name' : 'Full name'),
          el('input.input', {
            id: nameId, type: 'text', maxLength: 100, value: prefillName,
            placeholder: role.isMe ? 'Your name' : 'Full name',
            oninput: (e) => { roleValues[role.id].name = e.target.value; },
          })),
        el('div.field', { style: { margin: '0' } },
          el('label', { for: emailId }, 'Email'),
          emailInput,
          emailError,
          role.isMe && el('span.small.faint', {}, 'You sign in this app, no email needed'))),
    );
  });

  const status = el('p.small.faint', { style: { margin: '10px 0 0' }, 'aria-live': 'polite' });
  const createBtn = el('button.btn.btn-primary.btn-block', {
    type: 'button', style: { padding: '12px', marginTop: '16px' },
    html: icon('filePlus', 16, 2),
  }, ' Create draft');

  const body = el('div');
  append(body, [
    el('p.small.muted', { style: { margin: '0 0 14px' } },
      `${template.pageCount} page${template.pageCount === 1 ? '' : 's'} · ${(template.fields || []).length} field${(template.fields || []).length === 1 ? '' : 's'} already placed`),
    el('div.field', {}, el('label', { for: titleId }, 'Document title'), titleInput),
    (template.roles || []).length
      ? el('div', {}, el('div.card-title', {}, 'Who signs this time'), roleRows)
      : el('p.small.muted', {}, 'This template has no roles yet. Add signers in the editor.'),
    createBtn,
    status,
  ]);

  const modal = openModal({ title: 'New from template', content: body });

  createBtn.addEventListener('click', async () => {
    createBtn.disabled = true;
    status.textContent = 'Creating your draft…';
    try {
      const doc = await store.createDocFromTemplate(template.id, {
        title: titleInput.value.trim() || template.name,
        roleValues,
      });
      modal.close();
      toast('Draft ready. Everything is already placed', { icon: 'check' });
      navigate(`#/doc/${doc.id}/edit`);
    } catch (err) {
      console.error(err);
      status.textContent = '';
      toast('Could not create the draft. Check your connection', { icon: 'wifiOff' });
      createBtn.disabled = false;
    }
  });
}

/**
 * A compact list of templates. Rows start a new document; `manage` adds the
 * rename and delete controls.
 */
export function templateList({ navigate, manage = false, onClose = null, limit = 0, onEmpty = null }) {
  const wrap = el('div.tpl-list');

  function render() {
    clear(wrap);
    let templates = store.listTemplates();
    if (limit) templates = templates.slice(0, limit);
    if (!templates.length) {
      if (onEmpty) wrap.append(onEmpty());
      return;
    }
    for (const template of templates) {
      const meta = [`${template.pageCount} page${template.pageCount === 1 ? '' : 's'}`];
      const fieldCount = (template.fields || []).length;
      meta.push(`${fieldCount} field${fieldCount === 1 ? '' : 's'}`);
      if (template.useCount) meta.push(`used ${template.useCount}×`);
      else if (template.updatedAt) meta.push(`saved ${relativeTime(template.updatedAt)}`);

      wrap.append(el('div.tpl-row', {},
        el('button.tpl-use', {
          type: 'button',
          'aria-label': `New document from template ${template.name}`,
          onclick: () => {
            onClose?.();
            openNewFromTemplate(template, { navigate });
          },
        },
          el('span.tpl-icon', { html: icon('template', 19) }),
          el('span.grow', {},
            el('span.tpl-name', {}, template.name),
            el('span.tpl-meta', {}, meta.join(' · '))),
          el('span.tpl-go', { html: icon('chevR', 17) })),
        manage && el('div.tpl-acts', {},
          el('button.icon-btn', {
            type: 'button', html: icon('pencil', 16), title: 'Rename',
            'aria-label': `Rename template ${template.name}`,
            onclick: async () => {
              const name = await promptDialog({
                title: 'Rename template',
                label: 'Template name',
                value: template.name,
                confirmLabel: 'Rename',
              });
              if (!name || name === template.name) return;
              await store.patchTemplate(template.id, { name })
                .catch(() => toast('Could not rename. Check your connection', { icon: 'wifiOff' }));
            },
          }),
          el('button.icon-btn', {
            type: 'button', html: icon('trash', 16), title: 'Delete',
            'aria-label': `Delete template ${template.name}`,
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Delete this template?',
                message: `"${template.name}" and its saved layout are removed. Documents already created from it are not affected.`,
                confirmLabel: 'Delete template',
              });
              if (!ok) return;
              try {
                await store.deleteTemplate(template.id);
                toast('Template deleted', { icon: 'trash' });
              } catch {
                toast('Could not delete it. Check your connection', { icon: 'wifiOff' });
              }
            },
          }))
      ));
    }
  }

  render();
  const onStoreChange = () => render();
  store.addEventListener('change', onStoreChange);
  wrap.destroy = () => store.removeEventListener('change', onStoreChange);
  return wrap;
}

/** Manage templates: use, rename, delete. */
export function openTemplatesModal({ navigate }) {
  let list = null;
  const body = el('div');
  const modal = openModal({
    title: 'Templates',
    content: body,
    onClose: () => list?.destroy?.(),
  });
  list = templateList({
    navigate,
    manage: true,
    onClose: () => modal.close(),
    onEmpty: () => el('div.empty', { style: { padding: '24px 8px' } },
      el('div.empty-icon', { html: icon('template', 24) }),
      el('h3', {}, 'No templates yet'),
      el('p', {}, 'Open a document you send often and choose "Save as template" to reuse its field layout.')),
  });
  body.append(list);
}
