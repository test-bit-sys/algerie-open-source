import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, KV_KEYS } from '../src/lib/store.js';
import { templateSeed, templateInstance, duplicateSeed } from '../src/lib/model.js';
import { copyTitle } from '../src/lib/util.js';
import { makeFakePuter } from './helpers/fake-puter.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

const DOC = {
  id: 'd1',
  title: 'Contractor agreement',
  fileName: 'agreement.pdf',
  pageCount: 2,
  signers: [
    { id: 's1', name: 'Ava Chen', email: 'ava@example.com', isMe: false, status: 'signed', signedAt: 5 },
    { id: 'me', name: 'Me', email: 'me@example.com', isMe: true, status: 'pending' },
  ],
  fields: [
    { id: 'f1', signerId: 's1', type: 'signature', page: 0, x: 0.1, y: 0.2, w: 0.26, h: 0.05, required: true },
    { id: 'f2', signerId: 'me', type: 'date', page: 1, x: 0.5, y: 0.6, w: 0.16, h: 0.03, required: true },
    { id: 'f3', signerId: 'gone', type: 'text', page: 0, x: 0.2, y: 0.2, w: 0.2, h: 0.03, required: true },
  ],
};

describe('template seeds', () => {
  it('turns signers into roles and re-keys their fields', () => {
    const { roles, fields } = templateSeed(DOC);
    expect(roles.map((r) => r.label)).toEqual(['Ava Chen', 'Me']);
    expect(roles[1].isMe).toBe(true);
    // The orphan field (no matching signer) is dropped.
    expect(fields).toHaveLength(2);
    expect(fields[0].roleId).toBe(roles[0].id);
    expect(fields[0].signerId).toBeUndefined();
    // Geometry survives untouched.
    expect(fields[0]).toMatchObject({ type: 'signature', page: 0, x: 0.1, y: 0.2, w: 0.26, h: 0.05 });
    // Ids are fresh, so editing the template can't reach the document.
    expect(fields.map((f) => f.id)).not.toContain('f1');
  });

  it('labels unnamed signers by position', () => {
    const { roles } = templateSeed({ signers: [{ id: 'a' }, { id: 'b', isMe: true }], fields: [] });
    expect(roles.map((r) => r.label)).toEqual(['Signer 1', 'Me']);
  });

  it('instantiates a template with real people', () => {
    const { roles, fields } = templateSeed(DOC);
    const instance = templateInstance({ roles, fields }, {
      [roles[0].id]: { name: 'Dana Lopez', email: 'dana@example.com' },
      [roles[1].id]: { name: 'Alex', email: 'alex@example.com' },
    });
    expect(instance.signers.map((s) => s.name)).toEqual(['Dana Lopez', 'Alex']);
    expect(instance.signers[0].status).toBe('pending');
    expect(instance.signers[1].isMe).toBe(true);
    expect(instance.signers[0].roleLabel).toBe('Ava Chen');
    expect(instance.fields).toHaveLength(2);
    expect(instance.fields[0].signerId).toBe(instance.signers[0].id);
    expect(instance.fields[0].roleId).toBeUndefined();
    expect(instance.fields[1].signerId).toBe(instance.signers[1].id);
  });

  it('tolerates roles nobody was named for', () => {
    const { roles, fields } = templateSeed(DOC);
    const instance = templateInstance({ roles, fields }, {});
    expect(instance.signers.map((s) => s.name)).toEqual(['', '']);
    expect(instance.fields).toHaveLength(2);
  });
});

describe('duplicateSeed', () => {
  it('copies people and layout with fresh ids and no signatures', () => {
    const { signers, fields } = duplicateSeed(DOC);
    expect(signers.map((s) => s.email)).toEqual(['ava@example.com', 'me@example.com']);
    expect(signers.every((s) => s.status === 'pending')).toBe(true);
    expect(signers.some((s) => s.signedAt)).toBe(false);
    expect(signers.map((s) => s.id)).not.toContain('s1');
    expect(fields).toHaveLength(2);
    expect(fields[0].signerId).toBe(signers[0].id);
  });
});

describe('copyTitle', () => {
  it('numbers copies without stacking suffixes', () => {
    expect(copyTitle('NDA', [])).toBe('NDA (copy)');
    expect(copyTitle('NDA', ['NDA (copy)'])).toBe('NDA (copy 2)');
    expect(copyTitle('NDA (copy)', ['NDA (copy)', 'NDA (copy 2)'])).toBe('NDA (copy 3)');
    expect(copyTitle('', [])).toBe('Untitled document (copy)');
  });

  it('keeps the suffix on a title already at the 200-character cap', () => {
    const long = 'A'.repeat(200);
    const first = copyTitle(long, [long]);
    expect(first).toBe(`${'A'.repeat(193)} (copy)`);
    expect(first).toHaveLength(200);
    const second = copyTitle(long, [long, first]);
    expect(second).toBe(`${'A'.repeat(191)} (copy 2)`);
    // Copying the copy numbers on from the same base.
    expect(copyTitle(first, [long, first, second])).toBe(`${'A'.repeat(191)} (copy 3)`);
  });
});

describe('template storage', () => {
  let p;
  let store;

  beforeEach(async () => {
    p = makeFakePuter();
    store = createStore({ getPuter: () => p });
    await store.init();
  });

  async function draftWithLayout() {
    const doc = await store.createDoc({ title: 'NDA', fileName: 'nda.pdf', pdfBytes: PDF, pageCount: 2 });
    await store.patchDoc(doc.id, {
      note: 'Please sign by Friday',
      signers: [{ id: 's1', name: 'Ava Chen', email: 'ava@example.com', isMe: false, status: 'pending' }],
      fields: [{ id: 'f1', signerId: 's1', type: 'signature', page: 1, x: 0.1, y: 0.2, w: 0.26, h: 0.05, required: true }],
    });
    return store.getDoc(doc.id);
  }

  it('saves a template with its own copy of the PDF', async () => {
    const doc = await draftWithLayout();
    const tpl = await store.saveTemplateFromDoc(doc, { name: 'Standard NDA' });
    expect(tpl.name).toBe('Standard NDA');
    expect(tpl.roles).toHaveLength(1);
    expect(tpl.fields).toHaveLength(1);
    expect(tpl.note).toBe('Please sign by Friday');
    expect(p.kv.map.get(KV_KEYS.tplPrefix + tpl.id).name).toBe('Standard NDA');
    expect([...(await store.readTemplatePdf(tpl.id))]).toEqual([...PDF]);
    // Deleting the source document leaves the template usable.
    await store.deleteDoc(doc.id);
    expect([...(await store.readTemplatePdf(tpl.id))]).toEqual([...PDF]);
    // And a second store instance finds it.
    const second = createStore({ getPuter: () => p });
    await second.init();
    expect(second.listTemplates()).toHaveLength(1);
  });

  it('creates a draft from a template, fully laid out', async () => {
    const doc = await draftWithLayout();
    const tpl = await store.saveTemplateFromDoc(doc, { name: 'Standard NDA' });
    const fresh = await store.createDocFromTemplate(tpl.id, {
      title: 'NDA for Dana',
      roleValues: { [tpl.roles[0].id]: { name: 'Dana Lopez', email: 'dana@example.com' } },
    });
    expect(fresh.status).toBe('draft');
    expect(fresh.title).toBe('NDA for Dana');
    expect(fresh.note).toBe('Please sign by Friday');
    expect(fresh.signers[0]).toMatchObject({ name: 'Dana Lopez', email: 'dana@example.com', status: 'pending' });
    expect(fresh.fields[0]).toMatchObject({ page: 1, x: 0.1, type: 'signature', signerId: fresh.signers[0].id });
    expect(fresh.audit.some((a) => a.type === 'from_template' && a.detail === 'Standard NDA')).toBe(true);
    expect([...(await store.readPdf(fresh.id))]).toEqual([...PDF]);
    expect(store.getTemplate(tpl.id).useCount).toBe(1);
  });

  /**
   * "Sign in order" is part of the layout, not of one send: it is set in the
   * editor next to the signers it orders. Both reuse paths dropped it, so a
   * document that had to be countersigned came back parallel - every link
   * live at once - with nothing on screen to say the setting had changed.
   */
  it('carries "sign in order" into a copy and a template', async () => {
    const doc = await draftWithLayout();
    await store.patchDoc(doc.id, {
      signOrder: true,
      signers: [
        { id: 's1', name: 'Ava Chen', email: 'ava@example.com', status: 'pending' },
        { id: 's2', name: 'Bo Diaz', email: 'bo@example.com', status: 'pending' },
      ],
    });

    const copy = await store.duplicateDoc(doc.id);
    expect(copy.signOrder).toBe(true);
    // And the signers keep the order that ordering is about.
    expect(copy.signers.map((s) => s.name)).toEqual(['Ava Chen', 'Bo Diaz']);

    const tpl = await store.saveTemplateFromDoc(store.getDoc(doc.id), { name: 'Ordered NDA' });
    expect(tpl.signOrder).toBe(true);
    const fresh = await store.createDocFromTemplate(tpl.id, {
      roleValues: Object.fromEntries(tpl.roles.map((role, i) => [role.id, { name: `P${i}`, email: `p${i}@x.co` }])),
    });
    expect(fresh.signOrder).toBe(true);
    expect(fresh.signers.map((s) => s.roleLabel)).toEqual(['Ava Chen', 'Bo Diaz']);
  });

  it('leaves an unordered document unordered', async () => {
    const doc = await draftWithLayout();
    expect(store.getDoc(doc.id).signOrder).toBe(false);
    expect((await store.duplicateDoc(doc.id)).signOrder).toBe(false);
    const tpl = await store.saveTemplateFromDoc(store.getDoc(doc.id), { name: 'Plain' });
    expect(tpl.signOrder).toBe(false);
    expect((await store.createDocFromTemplate(tpl.id, { roleValues: {} })).signOrder).toBe(false);
  });

  it('deleting a template removes its record and file', async () => {
    const doc = await draftWithLayout();
    const tpl = await store.saveTemplateFromDoc(doc, { name: 'Gone soon' });
    await store.patchTemplate(tpl.id, { name: 'Renamed' });
    expect(store.getTemplate(tpl.id).name).toBe('Renamed');
    await store.deleteTemplate(tpl.id);
    expect(store.getTemplate(tpl.id)).toBeNull();
    expect(store.listTemplates()).toHaveLength(0);
    await expect(store.readTemplatePdf(tpl.id)).rejects.toThrow();
  });

  it('duplicates a sent document into a clean draft', async () => {
    const doc = await draftWithLayout();
    await store.markSent(doc.id, { s1: 'https://w.puter.work/sign/aa' });
    await store.markSignerSigned(doc.id, 's1', {});
    const copy = await store.duplicateDoc(doc.id);
    expect(copy.status).toBe('draft');
    expect(copy.title).toBe('NDA (copy)');
    expect(copy.links).toEqual({});
    expect(copy.emailed).toEqual({});
    expect(copy.sentAt).toBeNull();
    expect(copy.signers[0]).toMatchObject({ name: 'Ava Chen', status: 'pending' });
    expect(copy.signers[0].id).not.toBe('s1');
    expect(copy.fields[0].signerId).toBe(copy.signers[0].id);
    expect(copy.audit.some((a) => a.type === 'duplicated' && a.detail === 'NDA')).toBe(true);
    // The original is untouched.
    expect(store.getDoc(doc.id).signers[0].status).toBe('signed');
    // A second copy gets its own name.
    expect((await store.duplicateDoc(doc.id)).title).toBe('NDA (copy 2)');
  });
});
