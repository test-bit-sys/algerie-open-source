import { describe, it, expect, afterEach } from 'vitest';
import {
  aiAvailable, aiEnabled, readAIText, parseDraft, recordContext,
  contactPrompt, companyPrompt, emailPrompt, summaryPrompt, askAI,
  CONTACT_DRAFT_FIELDS, COMPANY_DRAFT_FIELDS,
} from '../src/lib/ai.js';

afterEach(() => { delete globalThis.puter; });

const withAI = (chat) => { globalThis.puter = { ai: { chat } }; };

describe('availability', () => {
  it('needs the platform capability to be there', () => {
    expect(aiAvailable()).toBe(false);
    globalThis.puter = {};
    expect(aiAvailable()).toBe(false);
    globalThis.puter = { ai: {} };
    expect(aiAvailable()).toBe(false);
    withAI(async () => 'hi');
    expect(aiAvailable()).toBe(true);
  });

  it('is on by default, off by switch, off without the platform', () => {
    withAI(async () => 'hi');
    expect(aiEnabled({})).toBe(true);
    expect(aiEnabled({ aiAssist: true })).toBe(true);
    expect(aiEnabled({ aiAssist: false })).toBe(false);
    delete globalThis.puter;
    expect(aiEnabled({ aiAssist: true })).toBe(false);
  });
});

describe('readAIText', () => {
  it('reads every shape a platform might hand back', () => {
    expect(readAIText('  hello  ')).toBe('hello');
    expect(readAIText({ message: { content: 'hello' } })).toBe('hello');
    expect(readAIText({ content: 'hello' })).toBe('hello');
    expect(readAIText({ text: 'hello' })).toBe('hello');
    expect(readAIText({
      message: { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] },
    })).toBe('one\ntwo');
    expect(readAIText({ toString: () => 'printed' })).toBe('printed');
  });

  it('reads nothing as nothing', () => {
    expect(readAIText(null)).toBe('');
    expect(readAIText(undefined)).toBe('');
    expect(readAIText({})).toBe('');
    expect(readAIText({ message: {} })).toBe('');
  });
});

describe('askAI', () => {
  it('refuses when the platform has no model', async () => {
    await expect(askAI('hi')).rejects.toThrow('ai-unavailable');
  });

  it('hands back the text', async () => {
    withAI(async () => ({ message: { content: 'the answer' } }));
    expect(await askAI('hi')).toBe('the answer');
  });

  it('treats an empty answer as a failure, so callers can say so', async () => {
    withAI(async () => ({ message: { content: '   ' } }));
    await expect(askAI('hi')).rejects.toThrow('ai-empty');
  });

  it('lets a platform error through as a failure', async () => {
    withAI(async () => { throw new Error('offline'); });
    await expect(askAI('hi')).rejects.toThrow('offline');
  });
});

describe('parseDraft', () => {
  it('takes a bare JSON object', () => {
    expect(parseDraft('{"name":"Mei Tanaka","title":"VP Ops"}', CONTACT_DRAFT_FIELDS))
      .toEqual({ name: 'Mei Tanaka', title: 'VP Ops' });
  });

  it('digs the object out of a fence or a sentence', () => {
    expect(parseDraft('```json\n{"name":"Mei"}\n```', CONTACT_DRAFT_FIELDS)).toEqual({ name: 'Mei' });
    expect(parseDraft('Sure! Here you go: {"name":"Mei"} Hope that helps.', CONTACT_DRAFT_FIELDS))
      .toEqual({ name: 'Mei' });
  });

  it('keeps only the keys it asked for', () => {
    expect(parseDraft('{"name":"Mei","salary":"lots","notes":"x"}', CONTACT_DRAFT_FIELDS))
      .toEqual({ name: 'Mei' });
    expect(parseDraft('{"name":"Acme","industry":"Retail"}', COMPANY_DRAFT_FIELDS))
      .toEqual({ name: 'Acme', industry: 'Retail' });
  });

  it('drops blanks and the words models use for "it does not say"', () => {
    expect(parseDraft('{"name":"Mei","title":"","email":"n/a","phone":"unknown","company":"None"}',
      CONTACT_DRAFT_FIELDS)).toEqual({ name: 'Mei' });
  });

  it('reads a number as its text, and refuses anything else', () => {
    expect(parseDraft('{"name":"Mei","phone":5550134}', CONTACT_DRAFT_FIELDS))
      .toEqual({ name: 'Mei', phone: '5550134' });
    expect(parseDraft('{"name":{"first":"Mei"}}', CONTACT_DRAFT_FIELDS)).toEqual({});
  });

  it('is empty for anything that isn’t an object', () => {
    expect(parseDraft('I could not find any details.', CONTACT_DRAFT_FIELDS)).toEqual({});
    expect(parseDraft('{"name": broken', CONTACT_DRAFT_FIELDS)).toEqual({});
    expect(parseDraft('["Mei"]', CONTACT_DRAFT_FIELDS)).toEqual({});
    expect(parseDraft('', CONTACT_DRAFT_FIELDS)).toEqual({});
  });
});

describe('prompts', () => {
  it('carry the pasted text and name every field they want back', () => {
    const prompt = contactPrompt('Mei Tanaka\nVP Operations');
    expect(prompt).toContain('Mei Tanaka');
    for (const field of CONTACT_DRAFT_FIELDS) expect(prompt).toContain(field);
    expect(companyPrompt('Acme')).toContain('Acme');
  });

  it('cap how much pasted text goes out', () => {
    expect(contactPrompt('x'.repeat(9000)).length).toBeLessThan(5000);
  });

  it('describe one record and nothing else', () => {
    const context = recordContext({
      contact: { name: 'Mei Tanaka', title: 'VP Ops', email: 'mei@x.example', notes: 'Prefers calls' },
      company: { name: 'Northwind', industry: 'Manufacturing' },
      deal: { name: 'Rollout', value: 42000, stage: 'proposal', expectedClose: '2026-09-30' },
      activities: [{ date: '2026-08-01', type: 'call', summary: 'Scoping call', notes: 'Ten trucks' }],
      tasks: [{ due: '2026-08-25', title: 'Chase legal' }],
    });
    expect(context).toContain('Mei Tanaka');
    expect(context).toContain('Northwind');
    expect(context).toContain('Scoping call');
    expect(context).toContain('Chase legal');
    expect(context).toContain('$42,000');
    // Nothing about any other record can be in it - there is nothing else in it.
    expect(context.split('\n').length).toBeLessThan(20);
  });

  it('leave out what a record does not have', () => {
    expect(recordContext({ contact: { name: 'Mei' } })).toBe('Contact: Mei');
    expect(recordContext({})).toBe('');
  });

  it('build the email and summary asks around the record', () => {
    const context = recordContext({ contact: { name: 'Mei' } });
    const email = emailPrompt(context, { subject: 'Next steps', sender: 'demo' });
    expect(email).toContain('Next steps');
    expect(email).toContain('demo');
    expect(email).toContain('Mei');
    expect(summaryPrompt(context)).toContain('Mei');
  });
});
