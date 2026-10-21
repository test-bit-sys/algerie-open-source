/**
 * Playbooks: the follow-up cadence you run every time, saved once.
 *
 * A founder who sells the same thing twice does the same steps twice -
 * recap email the day of the demo, nudge in three days, check in after two
 * weeks. Every piece was already here (dated follow-ups, recurrence, email
 * templates, next-step nudges) except a way to say "do the usual", so the
 * usual got retyped from memory and the fifth step was the one that got
 * forgotten.
 *
 * A playbook is a name plus steps, each `{ title, offset, templateId }`,
 * where `offset` is days from the day it is applied - the same way
 * repeat.js counts from completion rather than by calendar rules.
 *
 * Applied steps become plain follow-ups with no link back, so this module
 * is only ever asked to shape definitions and work out dates. Pure
 * functions: no Puter, no DOM.
 */

import { uid, addDays, todayISO } from './util.js';

/** Enough for the cadences a founder actually runs, few enough to scan. */
export const MAX_PLAYBOOKS = 8;
export const MAX_PLAYBOOK_STEPS = 10;
export const MAX_STEP_OFFSET = 365;
export const MAX_PLAYBOOK_NAME = 60;
export const MAX_STEP_TITLE = 200;

const str = (v) => (typeof v === 'string' ? v : '');

const offsetOf = (value) => {
  const n = typeof value === 'number' ? value
    : (typeof value === 'string' && value.trim() ? Number(value) : NaN);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_STEP_OFFSET, Math.max(0, Math.round(n)));
};

/** One step, or null when there is no title to put on a follow-up. */
export function normalizePlaybookStep(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title).trim().slice(0, MAX_STEP_TITLE);
  if (!title) return null;
  const templateId = str(raw.templateId).trim();
  return { title, offset: offsetOf(raw.offset), ...(templateId ? { templateId } : {}) };
}

/** Steps, soonest first, capped. Ordering is the cadence. */
export function normalizePlaybookSteps(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizePlaybookStep)
    .filter(Boolean)
    .sort((a, b) => a.offset - b.offset)
    .slice(0, MAX_PLAYBOOK_STEPS);
}

/**
 * One playbook, or null for anything unusable. A playbook with no steps is
 * kept - it is a name waiting for its steps, and Settings shows it as
 * empty rather than losing it while the user is halfway through writing.
 */
export function normalizePlaybook(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name).trim().slice(0, MAX_PLAYBOOK_NAME);
  if (!name) return null;
  return {
    id: str(raw.id).trim() || uid(),
    name,
    // The stage whose arrival offers this playbook, or '' for none. Not
    // validated against the funnel here: a stage can be renamed or removed
    // while a playbook points at it, and playbookForStage simply never
    // matches then.
    trigger: str(raw.trigger).trim(),
    steps: normalizePlaybookSteps(raw.steps),
  };
}

export function normalizePlaybooks(raw) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const book = normalizePlaybook(item);
    if (!book || seen.has(book.id)) continue;
    seen.add(book.id);
    out.push(book);
    if (out.length >= MAX_PLAYBOOKS) break;
  }
  return out;
}

export function playbooksOf(settings) {
  return normalizePlaybooks(settings?.playbooks);
}

export function playbookById(settings, id) {
  return playbooksOf(settings).find((p) => p.id === id) || null;
}

/**
 * The playbook a stage arrival offers, if any. First match wins, so two
 * playbooks pointing at one stage can't both fire.
 */
export function playbookForStage(settings, stageId) {
  if (!stageId) return null;
  return playbooksOf(settings).find((p) => p.trigger === stageId) || null;
}

/**
 * The follow-ups a playbook would create, dated from `from` (today by
 * default): `[{ title, due, templateId }]`. This is what the preview shows
 * and what the store writes - one function, so they cannot disagree.
 */
export function playbookTasks(playbook, from = todayISO()) {
  return normalizePlaybookSteps(playbook?.steps).map((step) => ({
    title: step.title,
    due: step.offset ? addDays(from, step.offset) : from,
    ...(step.templateId ? { templateId: step.templateId } : {}),
  }));
}

/** "Today" / "in 3 days" - how a step's offset reads in a preview. */
export function offsetLabel(offset) {
  const n = offsetOf(offset);
  if (n === 0) return 'the day it is applied';
  if (n === 1) return 'the next day';
  if (n % 7 === 0) return `${n / 7} week${n === 7 ? '' : 's'} later`;
  return `${n} days later`;
}

/** "4 steps over 3 weeks" - a playbook in one line. */
export function playbookSummary(playbook) {
  const steps = normalizePlaybookSteps(playbook?.steps);
  if (!steps.length) return 'No steps yet';
  const span = steps[steps.length - 1].offset;
  const over = span === 0 ? 'all on the same day'
    : span % 7 === 0 ? `over ${span / 7} week${span === 7 ? '' : 's'}`
      : `over ${span} days`;
  return `${steps.length} step${steps.length === 1 ? '' : 's'} · ${over}`;
}

/** A fresh playbook for the Settings editor. */
export function blankPlaybook() {
  return {
    id: uid(),
    name: '',
    trigger: '',
    steps: [{ title: '', offset: 0 }],
  };
}
