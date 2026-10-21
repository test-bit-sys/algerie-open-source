import { describe, it, expect } from 'vitest';
import { fillTemplate, templateContext, buildMailto, buildTel } from '../src/lib/templates.js';

describe('fillTemplate', () => {
  const ctx = { firstName: 'Dana', company: 'Atlas', dealValue: '' };

  it('fills known fields, tolerating whitespace in the braces', () => {
    expect(fillTemplate('Hi {{firstName}} of {{ company }}', ctx)).toBe('Hi Dana of Atlas');
  });

  it('fills a known-but-empty field with nothing', () => {
    expect(fillTemplate('Worth {{dealValue}}', ctx)).toBe('Worth ');
  });

  it('leaves unknown tokens visible rather than swallowing typos', () => {
    expect(fillTemplate('Hi {{fistName}}', ctx)).toBe('Hi {{fistName}}');
  });

  it('handles null text', () => {
    expect(fillTemplate(null, ctx)).toBe('');
  });
});

describe('templateContext', () => {
  it('derives first name and formats the deal value', () => {
    const ctx = templateContext({
      contact: { name: '  Dana Fox ' },
      company: { name: 'Atlas' },
      deal: { name: 'Fleet pilot', value: 18000 },
      currency: 'USD',
    });
    expect(ctx.firstName).toBe('Dana');
    expect(ctx.name).toBe('  Dana Fox ');
    expect(ctx.company).toBe('Atlas');
    expect(ctx.dealName).toBe('Fleet pilot');
    expect(ctx.dealValue).toBe('$18,000');
  });

  it('is all empty strings with nothing linked', () => {
    const ctx = templateContext({});
    expect(Object.values(ctx).every((v) => v === '')).toBe(true);
  });

  it('leaves dealValue empty for a zero-value deal', () => {
    expect(templateContext({ deal: { name: 'X', value: 0 } }).dealValue).toBe('');
  });
});

describe('buildMailto', () => {
  it('percent-encodes subject and body', () => {
    const url = buildMailto('dana@x.com', 'Next steps & timing', 'Line one\nLine two');
    expect(url).toBe('mailto:dana%40x.com?subject=Next%20steps%20%26%20timing&body=Line%20one%0ALine%20two');
  });

  it('omits empty parts', () => {
    expect(buildMailto('a@b.c')).toBe('mailto:a%40b.c');
    expect(buildMailto(' a@b.c ', '', 'hi')).toBe('mailto:a%40b.c?body=hi');
  });
});

describe('buildTel', () => {
  it('keeps a number dialable', () => {
    expect(buildTel('+1 (415) 555-0134')).toBe('tel:+1(415)555-0134');
    expect(buildTel('020 7946 0958')).toBe('tel:02079460958');
  });

  it('drops the pause and wait characters that append a second dial sequence', () => {
    expect(buildTel('+15551234,,1234#')).toBe('tel:+155512341234');
    expect(buildTel('555-0100;ext=99')).toBe('tel:555-010099');
    expect(buildTel('')).toBe('tel:');
  });
});
