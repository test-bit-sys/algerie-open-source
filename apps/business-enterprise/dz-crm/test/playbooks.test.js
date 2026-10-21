import { describe, it, expect } from 'vitest';
import {
  MAX_PLAYBOOKS, MAX_PLAYBOOK_STEPS, MAX_STEP_OFFSET,
  normalizePlaybookStep, normalizePlaybookSteps, normalizePlaybook, normalizePlaybooks,
  playbooksOf, playbookById, playbookForStage, playbookTasks,
  offsetLabel, playbookSummary, blankPlaybook,
} from '../src/lib/playbooks.js';

const book = (over = {}) => ({
  id: 'p1', name: 'Proposal chase', trigger: '',
  steps: [{ title: 'Recap', offset: 0 }, { title: 'Nudge', offset: 3 }],
  ...over,
});

describe('steps', () => {
  it('needs a title to become a follow-up', () => {
    expect(normalizePlaybookStep({ title: '  ', offset: 2 })).toBeNull();
    expect(normalizePlaybookStep(null)).toBeNull();
    expect(normalizePlaybookStep({ title: 'Call' }))
      .toEqual({ title: 'Call', offset: 0 });
  });

  it('reads an offset in whole days, clamped', () => {
    expect(normalizePlaybookStep({ title: 'a', offset: '3' }).offset).toBe(3);
    expect(normalizePlaybookStep({ title: 'a', offset: 2.6 }).offset).toBe(3);
    expect(normalizePlaybookStep({ title: 'a', offset: -5 }).offset).toBe(0);
    expect(normalizePlaybookStep({ title: 'a', offset: 9999 }).offset).toBe(MAX_STEP_OFFSET);
    expect(normalizePlaybookStep({ title: 'a', offset: 'soon' }).offset).toBe(0);
  });

  it('carries a template only when there is one', () => {
    expect(normalizePlaybookStep({ title: 'a', templateId: 't1' }).templateId).toBe('t1');
    expect(normalizePlaybookStep({ title: 'a', templateId: '' }).templateId).toBeUndefined();
  });

  it('orders steps by offset and caps them', () => {
    const steps = normalizePlaybookSteps([
      { title: 'later', offset: 10 }, { title: 'now', offset: 0 }, { title: 'blank' , offset: 1 },
    ]);
    expect(steps.map((s) => s.title)).toEqual(['now', 'blank', 'later']);
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `s${i}`, offset: i }));
    expect(normalizePlaybookSteps(many)).toHaveLength(MAX_PLAYBOOK_STEPS);
  });
});

describe('playbooks', () => {
  it('needs a name, and keeps a playbook with no steps yet', () => {
    expect(normalizePlaybook({ name: '  ', steps: [] })).toBeNull();
    expect(normalizePlaybook({ name: 'Empty' })).toMatchObject({ name: 'Empty', steps: [] });
  });

  it('drops duplicates and caps the list', () => {
    expect(normalizePlaybooks([book(), book()])).toHaveLength(1);
    const many = Array.from({ length: 20 }, (_, i) => book({ id: `p${i}` }));
    expect(normalizePlaybooks(many)).toHaveLength(MAX_PLAYBOOKS);
    expect(normalizePlaybooks('nope')).toEqual([]);
  });

  it('reads them out of settings', () => {
    const settings = { playbooks: [book()] };
    expect(playbooksOf(settings)).toHaveLength(1);
    expect(playbookById(settings, 'p1').name).toBe('Proposal chase');
    expect(playbookById(settings, 'nope')).toBeNull();
    expect(playbooksOf({})).toEqual([]);
  });

  it('finds the one a stage offers, first match only', () => {
    const settings = {
      playbooks: [book({ id: 'a', trigger: 'proposal' }), book({ id: 'b', trigger: 'proposal' })],
    };
    expect(playbookForStage(settings, 'proposal').id).toBe('a');
    expect(playbookForStage(settings, 'negotiation')).toBeNull();
    expect(playbookForStage(settings, '')).toBeNull();
    // A trigger pointing at a stage that no longer exists simply never fires.
    expect(playbookForStage({ playbooks: [book({ trigger: 'gone' })] }, 'proposal')).toBeNull();
  });
});

describe('playbookTasks', () => {
  it('dates every step from the day it is applied', () => {
    expect(playbookTasks(book(), '2026-08-20')).toEqual([
      { title: 'Recap', due: '2026-08-20' },
      { title: 'Nudge', due: '2026-08-23' },
    ]);
  });

  it('crosses a month boundary properly', () => {
    expect(playbookTasks(book({ steps: [{ title: 'Check in', offset: 14 }] }), '2026-08-25'))
      .toEqual([{ title: 'Check in', due: '2026-09-08' }]);
  });

  it('carries the template a step named', () => {
    const tasks = playbookTasks(book({ steps: [{ title: 'Email', offset: 0, templateId: 't1' }] }), '2026-08-20');
    expect(tasks[0].templateId).toBe('t1');
  });

  it('is empty for a playbook with nothing in it', () => {
    expect(playbookTasks(book({ steps: [] }), '2026-08-20')).toEqual([]);
    expect(playbookTasks(null, '2026-08-20')).toEqual([]);
  });
});

describe('words', () => {
  it('says when a step lands', () => {
    expect(offsetLabel(0)).toBe('the day it is applied');
    expect(offsetLabel(1)).toBe('the next day');
    expect(offsetLabel(7)).toBe('1 week later');
    expect(offsetLabel(14)).toBe('2 weeks later');
    expect(offsetLabel(5)).toBe('5 days later');
  });

  it('sums a playbook up in one line', () => {
    expect(playbookSummary(book())).toBe('2 steps · over 3 days');
    expect(playbookSummary(book({ steps: [{ title: 'a', offset: 14 }] })))
      .toBe('1 step · over 2 weeks');
    expect(playbookSummary(book({ steps: [{ title: 'a', offset: 0 }] })))
      .toBe('1 step · all on the same day');
    expect(playbookSummary(book({ steps: [] }))).toBe('No steps yet');
  });

  it('mints a blank playbook with one empty step', () => {
    const fresh = blankPlaybook();
    expect(fresh.steps).toHaveLength(1);
    expect(fresh.name).toBe('');
    expect(fresh.id).toBeTruthy();
  });
});
