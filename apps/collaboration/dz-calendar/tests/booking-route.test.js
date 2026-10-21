import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * index.html carries one inline script that runs before anything else: it
 * recognises a booking share link — calendar.puter.com/#/<host>/<page> — and
 * forwards the visitor to the guest page (public/book.html) with the route
 * intact, so a guest never downloads the calendar. These tests run that script
 * verbatim against a stand-in `location`.
 */
const HTML = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../index.html'),
  'utf8',
);
const SCRIPTS = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const SCRIPT = SCRIPTS.find((s) => s.includes('book.html#/'));

/** Runs the script against a stand-in location; `listen` stands in for the
 *  window's addEventListener so nothing leaks onto jsdom's real window. */
function exec(location, listen = vi.fn()) {
  new Function('location', 'addEventListener', SCRIPT)(location, listen);
}

function run(hash) {
  const location = { hash, replace: vi.fn() };
  exec(location);
  return location.replace;
}

describe('index.html: booking link route', () => {
  it('is the first script on the page, ahead of the theme pass and the app bundle', () => {
    // A guest should be gone before the calendar starts loading — and the
    // redirect must not wait behind anything that could throw or stall.
    expect(SCRIPT).toBeTruthy();
    expect(SCRIPTS[0]).toBe(SCRIPT);
    expect(HTML.indexOf(SCRIPT)).toBeLessThan(HTML.indexOf('<script type="module"'));
    expect(HTML.indexOf(SCRIPT)).toBeLessThan(HTML.indexOf('plausible'));
  });

  it('forwards #/<host>/<page> to the sibling guest page, keeping the route', () => {
    expect(run('#/nariman/intro-call')).toHaveBeenCalledWith('book.html#/nariman/intro-call');
    // Suffixed worker names and pre-slug hex ids travel as they are.
    expect(run('#/nariman-a1b2/ab12cd34ef')).toHaveBeenCalledWith('book.html#/nariman-a1b2/ab12cd34ef');
    expect(run('#/rsvp-ab12cd34ef/intro-call')).toHaveBeenCalledWith('book.html#/rsvp-ab12cd34ef/intro-call');
  });

  it('lowercases a retyped link — hostnames are case-insensitive, page ids are stored lowercase', () => {
    expect(run('#/Nariman/Intro-Call')).toHaveBeenCalledWith('book.html#/nariman/intro-call');
  });

  it('leaves every other hash to the calendar', () => {
    for (const hash of [
      '',
      '#',
      '#/',
      '#/nariman',
      '#/nariman/',
      '#/nariman/intro-call/extra',
      '#/-nariman/intro-call',
      '#/nariman/-intro',
      '#/nariman/a',
      '#/nariman/intro call',
      '#/nariman/../intro-call',
      '#/evil.example.com/intro-call',
      '#/nariman%2fx/intro-call',
      `#/${'n'.repeat(60)}/intro-call`,
      '#w=https%3A%2F%2Fcal-nariman.puter.work&p=intro-call', // the worker's own redirect form
      '#/nariman/intro-call?w=https://evil.example.com',
      '#today',
    ]) {
      expect(run(hash), JSON.stringify(hash)).not.toHaveBeenCalled();
    }
  });

  it('forwards a link pasted into a tab that already shows the calendar (hashchange)', () => {
    // From calendar.puter.com/ to calendar.puter.com/#/nariman/intro-call is
    // a same-document navigation: no reload, so the load-time check never
    // re-runs. The listener has to do it.
    const location = { hash: '', replace: vi.fn() };
    const listen = vi.fn();
    exec(location, listen);
    expect(location.replace).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith('hashchange', expect.any(Function));
    const onHashChange = listen.mock.calls.find(([type]) => type === 'hashchange')[1];

    location.hash = '#/nariman'; // half a route: still the calendar
    onHashChange();
    expect(location.replace).not.toHaveBeenCalled();

    location.hash = '#/Nariman/Intro-Call';
    onHashChange();
    expect(location.replace).toHaveBeenCalledWith('book.html#/nariman/intro-call');
  });

  it('never throws, whatever location looks like', () => {
    const location = {};
    Object.defineProperty(location, 'hash', {
      get() {
        throw new Error('boom');
      },
    });
    expect(() => exec(location)).not.toThrow();
    expect(() => exec({ hash: null, replace: vi.fn() })).not.toThrow();
    expect(() => exec({ hash: '#/nariman/intro-call' })).not.toThrow(); // no replace()
    // No addEventListener either (an exotic embedding): the load-time check still ran.
    const bare = { hash: '#/nariman/intro-call', replace: vi.fn() };
    expect(() => new Function('location', 'addEventListener', SCRIPT)(bare, undefined)).not.toThrow();
    expect(bare.replace).toHaveBeenCalledWith('book.html#/nariman/intro-call');
  });

  it('only ever builds the target from the two validated segments', () => {
    // Whatever the hash is, the only string handed to replace() is the sibling
    // page plus the route — never anything that could leave the origin.
    for (const hash of ['#/nariman/intro-call', '#/a/bcd1', `#/${'a'.repeat(59)}/${'b'.repeat(32)}`]) {
      const replace = run(hash);
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace.mock.calls[0][0]).toMatch(/^book\.html#\/[a-z0-9-]+\/[a-z0-9-]+$/);
    }
  });
});
