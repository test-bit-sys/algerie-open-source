/**
 * AI assist, on Puter's built-in models.
 *
 * The app runs on Puter, where `puter.ai.chat` is available to the
 * signed-in user at no cost to this app - the one platform capability the
 * CRM never touched. Meanwhile the reason founders abandon a CRM is typing
 * into it. So: three narrow chores handed off, each one a button the user
 * pressed, each result landing in a field they can edit and nothing saved
 * on its own.
 *
 *   1. Paste to create - a signature or some scribbles become fields.
 *   2. Draft this email - a first pass into the same editable body.
 *   3. Catch me up - what a long timeline adds up to.
 *
 * Prompt building and response reading are pure functions (testable
 * without Puter); `askAI` is the only part that talks to the platform. No
 * model id is passed: Puter picks for the signed-in user, and naming a
 * model here would pin the app to one catalogue and break as it changes.
 */

import { formatDate, formatMoney } from './util.js';

/** Is the platform capability there at all? */
export function aiAvailable() {
  return typeof puter !== 'undefined' && typeof puter?.ai?.chat === 'function';
}

/**
 * Should the assist controls show? The switch defaults to on, but only
 * where the capability exists - with either half missing the app behaves
 * exactly as it did before any of this.
 */
export function aiEnabled(settings) {
  return settings?.aiAssist !== false && aiAvailable();
}

/**
 * The text out of whatever shape the platform hands back: a string, a
 * message with string content, a message with content blocks, or an object
 * that only knows how to print itself. Written wide on purpose - this is
 * someone else's response shape, and it is allowed to change.
 */
export function readAIText(response) {
  if (response === null || response === undefined) return '';
  if (typeof response === 'string') return response.trim();
  const content = response.message?.content ?? response.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof response.text === 'string') return response.text.trim();
  const printed = String(response);
  return printed === '[object Object]' ? '' : printed.trim();
}

/**
 * Ask the model. Rejects with a plain Error on anything at all, so every
 * caller can fail the same way: a toast, and the form untouched.
 */
export async function askAI(prompt, { system = null } = {}) {
  if (!aiAvailable()) throw new Error('ai-unavailable');
  const options = system ? { system } : undefined;
  const answer = await puter.ai.chat(prompt, options);
  const text = readAIText(answer);
  if (!text) throw new Error('ai-empty');
  return text;
}

/* ---------- paste to create ---------- */

/** The lead fields the extractor is allowed to fill. */
export const CONTACT_DRAFT_FIELDS = ['name', 'title', 'email', 'phone', 'company'];
/** The company fields the extractor is allowed to fill. */
export const COMPANY_DRAFT_FIELDS = ['name', 'industry', 'website'];

const jsonInstruction = (fields) =>
  `Reply with one JSON object and nothing else - no prose, no code fence. Use exactly these keys: ${fields.join(', ')}. `
  + 'Leave a value as an empty string when the text does not say. Never invent a value.';

export function contactPrompt(text) {
  return `Pull the contact details out of the text below.\n\n${jsonInstruction(CONTACT_DRAFT_FIELDS)}\n`
    + '"name" is the person\'s full name, "title" their job title, "company" the organisation they work for.\n\n'
    + `Text:\n"""\n${String(text || '').slice(0, 4000)}\n"""`;
}

export function companyPrompt(text) {
  return `Pull the company details out of the text below.\n\n${jsonInstruction(COMPANY_DRAFT_FIELDS)}\n`
    + '"industry" is a short sector name; "website" is a bare domain with no protocol.\n\n'
    + `Text:\n"""\n${String(text || '').slice(0, 4000)}\n"""`;
}

/**
 * The model's answer as a draft record: only the keys asked for, only
 * strings, blanks dropped. Tolerant about the wrapper (a code fence, a
 * sentence either side) because that is what models do; strict about what
 * comes out, because it lands in a form.
 */
export function parseDraft(text, fields) {
  const raw = String(text || '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  let parsed;
  try {
    parsed = JSON.parse(body.slice(start, end + 1));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const key of fields) {
    const value = parsed[key];
    const clean = typeof value === 'string' ? value.trim()
      : typeof value === 'number' ? String(value) : '';
    // "unknown" and friends are the model answering "the text doesn't say"
    // in words instead of leaving the string empty.
    if (!clean || /^(n\/?a|none|unknown|not (given|stated|provided))$/i.test(clean)) continue;
    out[key] = clean.slice(0, 200);
  }
  return out;
}

/* ---------- record context ----------
   What the model is told about a record: the fields on it and the recent
   history, and nothing else. One record per request - the one the user
   pressed a button on. */

const line = (label, value) => (value ? `${label}: ${value}\n` : '');

/**
 * A lead, a company, or a deal written out as plain text, plus its recent
 * timeline. `activities` are already the ones for this record.
 */
export function recordContext({
  contact = null, company = null, deal = null, activities = [], tasks = [],
  currency = 'USD', dealRate = null,
} = {}) {
  let out = '';
  if (contact) {
    out += line('Contact', contact.name)
      + line('Title', contact.title)
      + line('Email', contact.email)
      + line('Status', contact.status)
      + line('Source', contact.source)
      + line('Notes', contact.notes);
  }
  if (company) {
    out += line('Company', company.name)
      + line('Industry', company.industry)
      + line('Company notes', company.notes);
  }
  if (deal) {
    out += line('Deal', deal.name)
      + line('Value', dealRate || formatMoney(deal.value, currency))
      + line('Stage', deal.stage)
      + line('Expected close', deal.expectedClose ? formatDate(deal.expectedClose, { year: 'always' }) : '')
      + line('Deal notes', deal.notes);
  }
  if (activities.length) {
    out += '\nRecent history, newest first:\n';
    for (const a of activities.slice(0, 12)) {
      out += `- ${formatDate(a.date, { year: 'always' })} · ${a.type}: ${a.summary}`
        + `${a.notes ? ` - ${a.notes}` : ''}\n`;
    }
  }
  if (tasks.length) {
    out += '\nOpen follow-ups:\n';
    for (const t of tasks.slice(0, 8)) {
      out += `- due ${formatDate(t.due, { year: 'always' })}: ${t.title}\n`;
    }
  }
  return out.trim();
}

/* ---------- draft an email ---------- */

export function emailPrompt(context, { subject = '', body = '', sender = '' } = {}) {
  return 'Write a short, plain sales email to the contact below, from what the record says. '
    + 'Two or three sentences, specific to what actually happened, no filler, no subject line, '
    + 'no placeholder brackets. Reply with the email body only.\n'
    + (subject ? `\nThe subject line is already: ${subject}\n` : '')
    + (body ? `\nThere is a draft already; improve it rather than starting over:\n"""\n${body}\n"""\n` : '')
    + (sender ? `\nSign off as ${sender}.\n` : '')
    + `\nRecord:\n"""\n${context}\n"""`;
}

/* ---------- catch me up ---------- */

export function summaryPrompt(context) {
  return 'Sum up where this stands for the person selling, in at most four short lines: '
    + 'what has happened, what is outstanding, and the single next thing worth doing. '
    + 'Use only what the record says - do not guess, and say plainly if something important is missing. '
    + 'Plain sentences, no headings, no bullet characters.\n'
    + `\nRecord:\n"""\n${context}\n"""`;
}
