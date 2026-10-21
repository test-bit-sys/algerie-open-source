import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * public/rsvp.html is the app-hosted guest page: the worker serves no HTML,
 * so this page renders the invitation from the worker's JSON API. Its inline
 * script exposes `window.__rsvpPageInit(opts)` when `__RSVP_PAGE_TEST__` is
 * set, which lets these tests drive it with a mock fetch.
 */
const HTML = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/rsvp.html'),
  'utf8',
);
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(HTML)[1];

const WORKER = 'https://cal-rsvp-ab12cd34ef.puter.work';
const TOKEN = 'a'.repeat(40);
const HASH = `#w=${encodeURIComponent(WORKER)}&t=${TOKEN}`;

function invite(overrides = {}, response = {}) {
  return {
    ok: true,
    event: {
      title: 'Team offsite',
      start: 1,
      end: 2,
      allDay: false,
      when: 'Wed, Jul 22, 2026 · 3:00 PM – 5:00 PM (PDT)',
      timezone: 'America/Los_Angeles',
      location: 'Pier 39',
      description: 'Bring sunscreen',
      organizer: 'Nariman',
      recurrence: '',
      ended: false,
      expiresAt: 9999999999999,
      ...overrides,
    },
    guest: { email: 'ada@example.com', name: 'Ada' },
    response: { status: 'needs-action', respondedAt: 0, comment: '', ...response },
    allowedStatuses: ['accepted', 'declined', 'tentative'],
    suggestions: [], // present since worker v11 — its absence marks an older worker
  };
}

function jsonRes(data, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => data });
}

let init;
let root;

beforeEach(() => {
  window.__RSVP_PAGE_TEST__ = true;
  new Function(SCRIPT)();
  init = window.__rsvpPageInit;
  root = document.createElement('main');
  document.body.replaceChildren(root);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('rsvp.html page', () => {
  it('renders the invitation from the API and never injects markup', async () => {
    const fetchFn = vi.fn(() =>
      jsonRes(invite({ title: '<script>alert(1)</script>', location: '<b>x</b>' })),
    );
    init({ root, hash: HASH, fetchFn });
    await tick();

    expect(fetchFn).toHaveBeenCalledWith(`${WORKER}/api/rsvp/${TOKEN}`);
    // Malicious strings render as literal text; nothing becomes an element.
    expect(root.querySelector('h1').textContent).toBe('<script>alert(1)</script>');
    expect(root.querySelectorAll('script').length).toBe(0);
    expect(root.innerHTML).not.toContain('<b>x</b>'); // location stayed text
    expect(root.textContent).toContain('<b>x</b>'); // …shown literally
    expect(root.textContent).toContain('Are you going?');
    expect(root.textContent).toContain('ada@example.com');
    expect(root.querySelectorAll('.choices button').length).toBe(3);
  });

  it('renders the meeting link as a clickable Join row — exact room links only', async () => {
    const join = 'https://meetings.puter.com/#/m/abcd-efgh-ijkl';
    init({ root, hash: HASH, fetchFn: vi.fn(() => jsonRes(invite({ meetingUrl: join }))) });
    await tick();
    const a = [...root.querySelectorAll('a')].find((n) => n.getAttribute('href') === join);
    expect(a).toBeTruthy();
    expect(a.textContent).toBe(join);
    expect(a.rel).toContain('noopener');
    expect(root.textContent).toContain('Join');

    // A worker gone rogue must not turn this page into a relay: anything but
    // the exact Puter Meetings shape renders nothing at all.
    for (const bad of [
      'https://evil.example/#/m/abcd-efgh-ijkl',
      'https://meetings.puter.com/#/m/ABCD-EFGH-IJKL',
      'javascript:alert(1)',
    ]) {
      init({ root, hash: HASH, fetchFn: vi.fn(() => jsonRes(invite({ meetingUrl: bad }))) });
      await tick();
      expect([...root.querySelectorAll('a')].find((n) => n.getAttribute('href') === bad), bad).toBeUndefined();
    }
  });

  it('refuses non-puter.work origins and malformed tokens without fetching', async () => {
    for (const hash of [
      `#w=${encodeURIComponent('https://evil.example.com')}&t=${TOKEN}`,
      `#w=${encodeURIComponent('http://x.puter.work')}&t=${TOKEN}`, // http, not https
      `#w=${encodeURIComponent(WORKER)}&t=not-a-token`,
      '#',
    ]) {
      const fetchFn = vi.fn();
      init({ root, hash, fetchFn });
      await tick();
      expect(fetchFn, hash).not.toHaveBeenCalled();
      expect(root.textContent, hash).toContain("This link isn't active");
    }
  });

  it('answering keeps a suggestion the guest was in the middle of typing', async () => {
    // The reverse is already protected (sending a suggestion rebuilds only its
    // own section so an unsaved note survives); an answer rebuilt the whole
    // card and emptied the suggest form.
    const fetchFn = vi.fn((url, options) => {
      if (!options) return jsonRes(invite());
      return jsonRes({ ok: true, response: { status: 'accepted', respondedAt: 5, comment: '' } });
    });
    init({ root, hash: HASH, fetchFn });
    await tick();
    root.querySelector('.suggest input[type="email"]').value = 'sara@example.com';
    root.querySelector('.suggest input[type="text"]').value = 'Sara';
    root.querySelector('button[data-status="accepted"]').click();
    await tick();
    await tick();
    expect(root.textContent).toContain('Response saved');
    expect(root.querySelector('.suggest input[type="email"]').value).toBe('sara@example.com');
    expect(root.querySelector('.suggest input[type="text"]').value).toBe('Sara');
  });

  it('clicking Yes POSTs the answer (with the note) and shows the saved banner', async () => {
    const fetchFn = vi.fn((url, options) => {
      if (!options) return jsonRes(invite({}, { comment: 'flight pending' }));
      return jsonRes({
        ok: true,
        response: { status: 'accepted', respondedAt: 5, comment: 'flight pending' },
      });
    });
    init({ root, hash: HASH, fetchFn });
    await tick();

    root.querySelector('button[data-status="accepted"]').click();
    await tick();

    const [, options] = fetchFn.mock.calls[1];
    expect(options.method).toBe('POST');
    // URLSearchParams body: keeps the cross-origin POST a CORS-simple request.
    expect(options.body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(options.body)).toEqual({
      status: 'accepted',
      comment: 'flight pending',
    });
    expect(root.textContent).toContain('Response saved. You said you are going.');
    expect(root.querySelector('button[data-status="accepted"]').dataset.current).toBe('1');
  });

  it('shows the saved banner on arrival from a one-click link (s=1)', async () => {
    const fetchFn = vi.fn(() => jsonRes(invite({}, { status: 'declined', respondedAt: 5 })));
    init({ root, hash: `${HASH}&s=1`, fetchFn });
    await tick();
    expect(root.textContent).toContain('Response saved. You said you are not going.');
  });

  it('renders an ended event read-only', async () => {
    const fetchFn = vi.fn(() => jsonRes(invite({ ended: true }, { status: 'tentative' })));
    init({ root, hash: HASH, fetchFn });
    await tick();
    expect(root.textContent).toContain('This event has ended — you said maybe.');
    expect(root.querySelectorAll('button').length).toBe(0);
  });

  it('shows the not-active message on API 404', async () => {
    const fetchFn = vi.fn(() => jsonRes({ error: 'not_found' }, 404));
    init({ root, hash: HASH, fetchFn });
    await tick();
    expect(root.textContent).toContain("This link isn't active");
  });

  it('marks the current answer with aria-pressed and titles the tab', async () => {
    const fetchFn = vi.fn(() => jsonRes(invite({}, { status: 'tentative', respondedAt: 5 })));
    init({ root, hash: HASH, fetchFn });
    await tick();
    expect(root.querySelector('button[data-status="tentative"]').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(root.querySelector('button[data-status="accepted"]').getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(document.title).toBe('Team offsite — RSVP');
  });

  it('a failed submit keeps the card and the typed note, and recovers on retry', async () => {
    let posts = 0;
    const fetchFn = vi.fn((url, options) => {
      if (!options) return jsonRes(invite());
      posts += 1;
      if (posts === 1) return Promise.reject(new Error('offline'));
      return jsonRes({ ok: true, response: { status: 'accepted', respondedAt: 5, comment: 'hi' } });
    });
    init({ root, hash: HASH, fetchFn });
    await tick();

    root.querySelector('textarea').value = 'hi';
    root.querySelector('button[data-status="accepted"]').click();
    await tick();

    // The invitation is still on screen with an inline error — NOT the
    // load-failure screen, which would destroy the typed note.
    expect(root.textContent).toContain('Team offsite');
    expect(root.textContent).toContain("Couldn't save your response");
    expect(root.textContent).not.toContain('Could not load the invitation');
    expect(root.querySelector('.answer .banner--err').getAttribute('role')).toBe('alert');
    expect(root.querySelector('textarea').value).toBe('hi');
    const yes = root.querySelector('button[data-status="accepted"]');
    expect(yes.disabled).toBe(false);
    expect(yes.textContent).toBe('Yes'); // "Saving…" label restored

    yes.click();
    await tick();
    expect(root.textContent).toContain('Response saved. You said you are going.');
    expect(root.querySelector('.answer .banner--err')).toBeNull();
  });

  it('editing the note after answering reveals Save note, which submits the same status', async () => {
    const fetchFn = vi.fn((url, options) => {
      if (!options) return jsonRes(invite({}, { status: 'accepted', respondedAt: 5, comment: '' }));
      return jsonRes({
        ok: true,
        response: { status: 'accepted', respondedAt: 6, comment: 'running late' },
      });
    });
    init({ root, hash: HASH, fetchFn });
    await tick();

    const bar = root.querySelector('.notebar');
    expect(bar.hidden).toBe(true);
    const note = root.querySelector('textarea');
    note.value = 'running late';
    note.dispatchEvent(new Event('input'));
    expect(bar.hidden).toBe(false);

    bar.querySelector('button').click();
    await tick();
    const [, options] = fetchFn.mock.calls[1];
    expect(Object.fromEntries(options.body)).toEqual({
      status: 'accepted',
      comment: 'running late',
    });
    expect(root.textContent).toContain('Response saved. You said you are going.');
  });

  it('never offers Save note before an answer exists', async () => {
    const fetchFn = vi.fn(() => jsonRes(invite()));
    init({ root, hash: HASH, fetchFn });
    await tick();
    const note = root.querySelector('textarea');
    note.value = 'thinking about it';
    note.dispatchEvent(new Event('input'));
    expect(root.querySelector('.notebar').hidden).toBe(true);
  });

  it('network failure shows a retry that reloads', async () => {
    let calls = 0;
    const fetchFn = vi.fn(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('offline')) : jsonRes(invite());
    });
    init({ root, hash: HASH, fetchFn });
    await tick();
    expect(root.textContent).toContain('Could not load the invitation');

    root.querySelector('button.retry').click();
    await tick();
    expect(root.textContent).toContain('Team offsite');
  });
});

describe('rsvp.html page: suggesting a guest', () => {
  const SUGGEST_URL = `${WORKER}/api/rsvp/${TOKEN}/guests`;

  /** fetch stand-in: GET serves the invitation, POST /guests is delegated. */
  function fetchRouter(data, onSuggest) {
    return vi.fn((url, options) => {
      if (url === SUGGEST_URL) return onSuggest(options);
      return jsonRes(data);
    });
  }

  const emailInput = () => root.querySelector('.suggest input[type="email"]');
  const nameInput = () => root.querySelector('.suggest input[type="text"]');
  const sendBtn = () => root.querySelector('.suggest__bar button');

  it('renders the section for a live event — and not for an ended one', async () => {
    init({ root, hash: HASH, fetchFn: vi.fn(() => jsonRes(invite())) });
    await tick();
    expect(root.textContent).toContain('Want to bring someone?');
    expect(root.textContent).toContain('the organizer reviews suggestions');
    expect(emailInput()).toBeTruthy();

    init({ root, hash: HASH, fetchFn: vi.fn(() => jsonRes(invite({ ended: true }))) });
    await tick();
    expect(root.querySelector('.suggest')).toBeNull();
  });

  it('shows my pending suggestions as text, never markup', async () => {
    const data = invite();
    data.suggestions = [
      { email: 'sara@example.com', name: '<img src=x onerror=alert(1)>', at: 5 },
    ];
    init({ root, hash: HASH, fetchFn: vi.fn(() => jsonRes(data)) });
    await tick();
    const row = root.querySelector('.suggest__row');
    expect(row.textContent).toContain('<img src=x onerror=alert(1)> (sara@example.com)');
    expect(row.textContent).toContain('Waiting for the organizer');
    expect(root.querySelector('.suggest img')).toBeNull();
  });

  it('posts the suggestion CORS-simple (urlencoded) and rebuilds the section with it', async () => {
    const fetchFn = fetchRouter(invite(), (options) =>
      jsonRes({ ok: true, suggestion: { email: 'sara@example.com', name: 'Sara', at: 7 } }),
    );
    init({ root, hash: HASH, fetchFn });
    await tick();

    emailInput().value = ' Sara@example.com ';
    nameInput().value = 'Sara';
    sendBtn().click();
    await tick();

    const [url, options] = fetchFn.mock.calls.find(([u]) => u === SUGGEST_URL);
    expect(url).toBe(SUGGEST_URL);
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(URLSearchParams); // stays a CORS "simple request"
    expect(options.body.get('email')).toBe('Sara@example.com'); // trimmed
    expect(options.body.get('name')).toBe('Sara');

    expect(root.textContent).toContain('Sara (sara@example.com)');
    expect(root.textContent).toContain('Waiting for the organizer');
    expect(root.textContent).toContain('Suggestion sent — the organizer will take it from here.');
    expect(emailInput().value).toBe(''); // fresh inputs, ready for the next one
    expect(document.activeElement).toBe(emailInput()); // focus survived the rebuild
  });

  it('rejects an obviously bad address before any network round-trip', async () => {
    const fetchFn = fetchRouter(invite(), () => {
      throw new Error('must not be called');
    });
    init({ root, hash: HASH, fetchFn });
    await tick();

    emailInput().value = 'not-an-email';
    sendBtn().click();
    await tick();
    expect(root.textContent).toContain('Enter a valid email address.');
    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
    expect(fetchFn.mock.calls.some(([u]) => u === SUGGEST_URL)).toBe(false);
  });

  it('speaks the API error codes: already invited, list full', async () => {
    let reply = () => jsonRes({ error: 'already_invited' }, 409);
    const fetchFn = fetchRouter(invite(), () => reply());
    init({ root, hash: HASH, fetchFn });
    await tick();

    emailInput().value = 'ada@example.com';
    sendBtn().click();
    await tick();
    expect(root.textContent).toContain('They are already invited.');
    expect(sendBtn().disabled).toBe(false); // ready to try someone else

    reply = () => jsonRes({ error: 'suggestion_limit' }, 429);
    emailInput().value = 'more@example.com';
    sendBtn().click();
    await tick();
    expect(root.textContent).toContain('The suggestion list for this event is full');
  });

  it('a failed send keeps the section usable and says what happened', async () => {
    const fetchFn = fetchRouter(invite(), () => Promise.reject(new Error('offline')));
    init({ root, hash: HASH, fetchFn });
    await tick();

    emailInput().value = 'sara@example.com';
    sendBtn().click();
    await tick();
    expect(root.textContent).toContain("Couldn't send your suggestion");
    expect(sendBtn().disabled).toBe(false);
    expect(sendBtn().textContent).toBe('Suggest guest');
    expect(emailInput().value).toBe('sara@example.com'); // typed address kept
  });

  it('suggestions survive answering: the re-rendered card still lists them', async () => {
    const data = invite();
    data.suggestions = [{ email: 'sara@example.com', name: '', at: 5 }];
    const fetchFn = vi.fn((url, options) =>
      options && options.method === 'POST'
        ? jsonRes({ ok: true, response: { status: 'accepted', respondedAt: 9, comment: '' } })
        : jsonRes(data),
    );
    init({ root, hash: HASH, fetchFn });
    await tick();

    root.querySelector('.choices button[data-status="accepted"]').click();
    await tick();
    expect(root.textContent).toContain('Response saved.');
    expect(root.textContent).toContain('sara@example.com');
    expect(root.textContent).toContain('Waiting for the organizer');
  });

  it('offers no suggest form against a pre-v11 worker (no `suggestions` in the payload)', async () => {
    const data = invite();
    delete data.suggestions; // what a v10 worker returns
    init({ root, hash: HASH, fetchFn: vi.fn(() => jsonRes(data)) });
    await tick();
    expect(root.textContent).toContain('Are you going?'); // page fully alive
    expect(root.querySelector('.suggest')).toBeNull();
  });

  it("a routeless 404 (worker not upgraded mid-session) never nukes the invitation — only the worker's own not_found does", async () => {
    let reply = () => Promise.resolve({ ok: false, status: 404, json: async () => { throw new Error('no body'); } });
    const fetchFn = fetchRouter(invite(), () => reply());
    init({ root, hash: HASH, fetchFn });
    await tick();

    emailInput().value = 'sara@example.com';
    sendBtn().click();
    await tick();
    expect(root.textContent).toContain("This invitation doesn't support suggestions yet.");
    expect(root.textContent).toContain('Are you going?'); // card intact
    expect(sendBtn().disabled).toBe(false);

    reply = () => jsonRes({ error: 'not_found' }, 404); // a truly revoked link
    emailInput().value = 'sara@example.com';
    sendBtn().click();
    await tick();
    expect(root.textContent).toContain("This link isn't active");
  });

  it('Enter during an in-flight send never fires a second POST', async () => {
    let resolve;
    const fetchFn = fetchRouter(invite(), () => new Promise((r) => (resolve = r)));
    init({ root, hash: HASH, fetchFn });
    await tick();

    emailInput().value = 'sara@example.com';
    const enter = () =>
      emailInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    enter();
    emailInput().value = 'omar@example.com';
    enter();
    enter();
    expect(fetchFn.mock.calls.filter(([u]) => u === SUGGEST_URL).length).toBe(1);
    resolve(await jsonRes({ ok: true, suggestion: { email: 'sara@example.com', name: '', at: 1 } }));
    await tick();
  });

  it('a failing ANSWER cannot unlock an in-flight suggest button (scoped freezes)', async () => {
    let resolveSuggest;
    const fetchFn = vi.fn((url) => {
      if (url === SUGGEST_URL) return new Promise((r) => (resolveSuggest = r));
      if (fetchFn.mock.calls.length > 1) return Promise.reject(new Error('offline')); // the answer POST
      return jsonRes(invite());
    });
    init({ root, hash: HASH, fetchFn });
    await tick();

    emailInput().value = 'sara@example.com';
    sendBtn().click(); // suggest in flight, its button disabled
    root.querySelector('.choices button[data-status="accepted"]').click(); // answer fails
    await tick();
    expect(root.textContent).toContain("Couldn't save your response");
    expect(sendBtn().disabled).toBe(true); // still frozen by its own flight
    resolveSuggest(await jsonRes({ ok: true, suggestion: { email: 'sara@example.com', name: '', at: 1 } }));
    await tick();
  });

  it('prechecks the address with the same shape rule as the worker', async () => {
    const fetchFn = fetchRouter(invite(), () => {
      throw new Error('must not be called');
    });
    init({ root, hash: HASH, fetchFn });
    await tick();
    for (const bad of ['a@b', 'sara @example.com', '@example.com', 'sara@']) {
      emailInput().value = bad;
      sendBtn().click();
      await tick();
      expect(root.textContent, bad).toContain('Enter a valid email address.');
      expect(fetchFn.mock.calls.some(([u]) => u === SUGGEST_URL), bad).toBe(false);
    }
  });
});
