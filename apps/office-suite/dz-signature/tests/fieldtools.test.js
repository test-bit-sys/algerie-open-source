import { describe, it, expect } from 'vitest';
import {
  copyFieldToPages, duplicateField, snapEdge, snapPosition, snapSize, shiftFields,
  alignFields, matchFieldSizes, SNAP, GRID, MIN_FIELD, DOC_LIMITS,
} from '../src/lib/model.js';
import { sendBlockers } from '../src/ui/sendflow.js';

const field = (over = {}) => ({
  id: 'f1', type: 'initials', page: 0, x: 0.1, y: 0.2, w: 0.09, h: 0.045,
  signerId: 's1', required: true, ...over,
});

describe('copying a field across pages', () => {
  it('puts one on every page but the one it is already on', () => {
    const copies = copyFieldToPages(field({ page: 2 }), [0, 1, 2, 3]);
    expect(copies.map((f) => f.page)).toEqual([0, 1, 3]);
    // Same rect, same signer, same options; new identity.
    expect(copies[0]).toMatchObject({ x: 0.1, y: 0.2, w: 0.09, h: 0.045, signerId: 's1', required: true });
    expect(new Set(copies.map((f) => f.id)).size).toBe(3);
    expect(copies.map((f) => f.id)).not.toContain('f1');
  });

  it("carries the field's own options along", () => {
    const [copy] = copyFieldToPages(
      field({ page: 0, label: 'Initial here', help: 'Both parties', inputType: 'text', readOnly: false }),
      [0, 1],
    );
    expect(copy).toMatchObject({ label: 'Initial here', help: 'Both parties', inputType: 'text' });
  });

  it('copies nothing when the only page is its own', () => {
    expect(copyFieldToPages(field({ page: 1 }), [1])).toEqual([]);
  });
});

describe('duplicating', () => {
  it('offsets the copy so it cannot hide under the original', () => {
    const copy = duplicateField(field());
    expect(copy.x).toBeCloseTo(0.12);
    expect(copy.y).toBeCloseTo(0.22);
    expect(copy.id).not.toBe('f1');
  });

  it('keeps the copy on the page at the far corner', () => {
    const copy = duplicateField(field({ x: 0.99, y: 0.99 }));
    expect(copy.x + copy.w).toBeLessThanOrEqual(1.0001);
    expect(copy.y + copy.h).toBeLessThanOrEqual(1.0001);
  });
});

describe('snapping', () => {
  it('takes the nearest edge within reach', () => {
    const others = [{ start: 0.3, end: 0.5, size: 0.2 }];
    expect(snapEdge(0.3 + SNAP / 2, others, 0.1).value).toBe(0.3);
    expect(snapEdge(0.5 - SNAP / 2, others, 0.1).value).toBe(0.5);
  });

  it('settles on the grid when nothing is near', () => {
    const out = snapEdge(0.317, [], 0.1);
    expect(out.value).toBeCloseTo(Math.round(0.317 / GRID) * GRID);
    expect(out.guide).toBeNull();
  });

  it('lines a dragged field up with another one and says where', () => {
    const others = [field({ id: 'o', x: 0.4, y: 0.6, w: 0.2, h: 0.05 })];
    const out = snapPosition({ x: 0.4 + SNAP / 2, y: 0.6 + SNAP / 2, w: 0.09, h: 0.045 }, others);
    expect(out.x).toBeCloseTo(0.4);
    expect(out.y).toBeCloseTo(0.6);
    expect(out.guides).toHaveLength(2);
    expect(out.guides[0]).toMatchObject({ axis: 'x' });
  });

  it('keeps a snapped field on the page', () => {
    const out = snapPosition({ x: 0.99, y: 0.99, w: 0.2, h: 0.1 }, []);
    expect(out.x).toBeCloseTo(0.8);
    expect(out.y).toBeCloseTo(0.9);
  });

  it('snaps a resize to the far edge of a neighbour', () => {
    const others = [field({ id: 'o', x: 0.2, y: 0.2, w: 0.3, h: 0.06 })];
    const out = snapSize({ x: 0.1, y: 0.1, w: 0.4 + SNAP / 2, h: 0.1 }, others);
    // 0.1 + w should land on the neighbour's right edge, 0.5.
    expect(out.w).toBeCloseTo(0.4);
    expect(out.guides.some((g) => g.axis === 'x')).toBe(true);
  });

  it('never resizes below the minimum', () => {
    const out = snapSize({ x: 0.1, y: 0.1, w: 0.0001, h: 0.0001 }, []);
    expect(out.w).toBe(MIN_FIELD.w);
    expect(out.h).toBe(MIN_FIELD.h);
  });
});

describe('moving and aligning a group', () => {
  const group = [
    field({ id: 'a', x: 0.1, y: 0.1, w: 0.2, h: 0.05 }),
    field({ id: 'b', x: 0.5, y: 0.3, w: 0.1, h: 0.03 }),
  ];

  it('moves them all by the same delta', () => {
    const out = shiftFields(group, 0.1, 0.05);
    expect(out[0]).toMatchObject({ x: 0.2 });
    expect(out[1].x).toBeCloseTo(0.6);
    expect(out[1].y).toBeCloseTo(0.35);
  });

  it('stops the whole group at the edge, keeping their spacing', () => {
    const out = shiftFields(group, 0.9, 0);
    // 'b' is the one that hits the right edge first, so it caps the move.
    expect(out[1].x + out[1].w).toBeCloseTo(1);
    expect(out[0].x - group[0].x).toBeCloseTo(out[1].x - group[1].x);
  });

  it('lines them up on the first of them', () => {
    expect(alignFields(group, 'left').map((f) => f.x)).toEqual([0.1, 0.1]);
    expect(alignFields(group, 'top').map((f) => f.y)).toEqual([0.1, 0.1]);
    // Right and bottom line up the far edges, not the near ones.
    const right = alignFields(group, 'right');
    expect(right[1].x + right[1].w).toBeCloseTo(group[0].x + group[0].w);
  });

  it('makes them the size of the first of them', () => {
    const out = matchFieldSizes(group);
    expect(out.map((f) => [f.w, f.h])).toEqual([[0.2, 0.05], [0.2, 0.05]]);
  });

  it('does nothing to an empty group', () => {
    expect(alignFields([], 'left')).toEqual([]);
    expect(matchFieldSizes([])).toEqual([]);
    expect(shiftFields([], 1, 1)).toEqual([]);
  });
});

describe('the caps the sign worker enforces', () => {
  it('matches the worker\'s own limits', async () => {
    const source = (await import('../src/workers/sign-worker.js?raw')).default;
    expect(source).toContain(`const MAX_SIGNERS = ${DOC_LIMITS.signers};`);
    expect(source).toContain(`const MAX_FIELDS = ${DOC_LIMITS.fields};`);
  });

  it('blocks two signers from sharing one address', () => {
    const doc = {
      signers: [
        { id: 's1', name: 'Ava', email: 'ava@example.com' },
        { id: 's2', name: 'Bo', email: 'AVA@Example.com ' },
      ],
      fields: [field({ id: 'f1', signerId: 's1' }), field({ id: 'f2', signerId: 's2' })],
    };
    expect(sendBlockers(doc)[0]).toBe('Ava and Bo have the same email address. Each signer needs their own.');
  });

  it('blocks a read-only text field the sender left empty', () => {
    const signer = { id: 's1', name: 'Ava', email: 'ava@example.com' };
    const sig = field({ id: 'sig', type: 'signature', signerId: 's1' });
    const blank = field({ id: 'ro', type: 'text', signerId: 's1', readOnly: true, label: 'Company', page: 1 });
    expect(sendBlockers({ signers: [signer], fields: [sig, blank] }))
      .toEqual(['The read-only field "Company" on page 2 has nothing filled in. Fill it in, or let the signer.']);
    // Whitespace is not a value either; a filled one is fine.
    expect(sendBlockers({ signers: [signer], fields: [sig, { ...blank, preset: '  ' }] })).toHaveLength(1);
    expect(sendBlockers({ signers: [signer], fields: [sig, { ...blank, preset: 'Acme Inc' }] })).toEqual([]);
    // An unticked read-only checkbox is a real value.
    expect(sendBlockers({ signers: [signer], fields: [sig, field({ id: 'box', type: 'checkbox', signerId: 's1', readOnly: true })] })).toEqual([]);
    expect(sendBlockers({ signers: [signer], fields: [sig, blank, { ...blank, id: 'ro2' }] })[0])
      .toBe('2 read-only text fields have nothing filled in. Fill them in, or let the signer.');
  });

  it('blocks a read-only text field whose value does not fit its type', () => {
    const signer = { id: 's1', name: 'Ava', email: 'ava@example.com' };
    const sig = field({ id: 'sig', type: 'signature', signerId: 's1' });
    const amount = field({
      id: 'ro', type: 'text', signerId: 's1', readOnly: true, label: 'Amount', inputType: 'number', preset: '$1,250.00',
    });
    expect(sendBlockers({ signers: [signer], fields: [sig, amount] }))
      .toEqual(['The read-only field "Amount" on page 1 does not match what it accepts. Enter a number, like 1250.50.']);
    expect(sendBlockers({ signers: [signer], fields: [sig, { ...amount, preset: '1,250.00' }] })).toEqual([]);
  });

  it('blocks a send that the worker would silently truncate', () => {
    const signer = (id) => ({ id, name: id, email: `${id}@example.com` });
    const doc = {
      signers: Array.from({ length: DOC_LIMITS.signers + 1 }, (_, i) => signer(`s${i}`)),
      fields: Array.from({ length: DOC_LIMITS.fields + 1 }, (_, i) =>
        field({ id: `f${i}`, signerId: `s${i % (DOC_LIMITS.signers + 1)}` })),
    };
    const problems = sendBlockers(doc);
    expect(problems[0]).toContain(`more than the ${DOC_LIMITS.signers}`);
    expect(problems[1]).toContain(`more than the ${DOC_LIMITS.fields}`);
    // A document inside both caps has nothing to say about them.
    expect(sendBlockers({ signers: [signer('s0')], fields: [field({ signerId: 's0' })] })).toEqual([]);
  });
});
