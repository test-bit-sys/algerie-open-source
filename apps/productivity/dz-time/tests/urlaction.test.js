import { describe, it, expect } from 'vitest';
import { parseAction, withoutAction, startLinkFor } from '../src/lib/urlaction.js';

describe('parseAction', () => {
  it('reads the three verbs off the hash', () => {
    expect(parseAction('#/?action=log')).toEqual({ action: 'log', projectId: null, task: '' });
    expect(parseAction('#/?action=stop')).toEqual({ action: 'stop', projectId: null, task: '' });
    expect(parseAction('#/?action=start&project=p1&task=Design%20review'))
      .toEqual({ action: 'start', projectId: 'p1', task: 'Design review' });
  });

  it('ignores anything it does not know', () => {
    expect(parseAction('#/')).toBeNull();
    expect(parseAction('#/timesheet')).toBeNull();
    expect(parseAction('#/?action=')).toBeNull();
    expect(parseAction('#/?action=delete-everything')).toBeNull();
    expect(parseAction('')).toBeNull();
    expect(parseAction(undefined)).toBeNull();
  });

  it('reads a verb on any route, and tolerates case and spacing', () => {
    expect(parseAction('#/reports?action=STOP')?.action).toBe('stop');
    expect(parseAction('#/?action=%20log%20')?.action).toBe('log');
  });
});

describe('withoutAction', () => {
  it('strips the action so a reload cannot re-fire it', () => {
    expect(withoutAction('#/?action=start&project=p1')).toBe('#/');
    expect(withoutAction('#/timesheet?action=log')).toBe('#/timesheet');
  });

  it('keeps a hash that carries no action, and any unrelated parameter', () => {
    expect(withoutAction('#/reports')).toBe('#/reports');
    expect(withoutAction('#/?action=log&keep=1')).toBe('#/?keep=1');
    expect(withoutAction('')).toBe('#/');
  });
});

describe('startLinkFor', () => {
  it('builds an absolute link that parses back to a start action', () => {
    const link = startLinkFor('p 1', { origin: 'https://hourly.test', path: '/app/' });
    expect(link).toBe('https://hourly.test/app/#/?action=start&project=p%201');
    expect(parseAction(link.slice(link.indexOf('#')))).toEqual({ action: 'start', projectId: 'p 1', task: '' });
  });
});
