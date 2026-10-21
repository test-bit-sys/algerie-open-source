import { describe, it, expect, vi } from 'vitest';
import { createMailReply, describeResult } from '../src/js/mail-reply.js';

function decodeIcs(payload) {
  const att = payload.attachments[0];
  return Buffer.from(att.content, 'base64').toString('utf8');
}

function attendeeLinesOf(ics) {
  // Unfold RFC 5545 continuation lines (CRLF + single leading space/tab), then
  // split on the real line breaks that remain.
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter((l) => l.toUpperCase().startsWith('ATTENDEE'));
}

/* ---- describeResult ------------------------------------------------------ */

describe('describeResult', () => {
  it('reports a send', () => {
    expect(describeResult({ sent: true, organizerEmail: 'alice@example.com' })).toMatchObject({
      message: 'Reply sent to alice@example.com',
      variant: 'success',
    });
  });

  it('reports a failure without throwing into the RSVP path', () => {
    const { message, variant } = describeResult({ sent: false, reason: 'offline' });
    expect(message).toContain('Saved.');
    expect(message).toContain("you're offline");
    expect(variant).toBe('danger');
  });
});

/* ---- createMailReply: offerReply / sendReply ----------------------------- */

function fakeStore() {
  return { getSettings: () => ({ hour12: true }) };
}

function fakeUser(overrides = {}) {
  return { username: 'nariman', email: 'nariman@example.com', ...overrides };
}

function fakeEvent(overrides = {}) {
  return {
    id: 'evt-1',
    title: 'Team offsite',
    start: Date.UTC(2026, 8, 11, 16),
    end: Date.UTC(2026, 8, 11, 17),
    allDay: false,
    organizer: { email: 'alice@example.com', name: 'Alice' },
    guests: [{ email: 'nariman@example.com', name: 'Nariman', status: 'needs-action' }],
    ...overrides,
  };
}

function deliveredBody(addr = 'alice@example.com') {
  return { sentPath: '/nariman/.mail/sent/x', delivered: [addr], failed: [] };
}

function fakePuter({ api = true, worker = true, sendImpl, permsRequest = vi.fn(async () => true) } = {}) {
  const send = sendImpl || vi.fn(async () => deliveredBody());
  return {
    ...(api ? { email: { send } } : {}),
    perms: { request: permsRequest },
    ...(worker ? { workers: { exec: vi.fn() } } : {}),
  };
}

function workerOk() {
  return { ok: true, json: async () => ({ ok: true }) };
}

function makeMail({ p, toast = vi.fn(), user = fakeUser(), store = fakeStore() } = {}) {
  return createMailReply({
    store,
    user,
    getPuter: () => p,
    toast,
    requestUser: async () => user,
    requestEmail: async () => user.email,
  });
}

describe('createMailReply: sendReply — call shape', () => {
  it('calls puter.email.send with the recipient, ASCII subject, base64 .ics content and method=REPLY contentType', async () => {
    let captured = null;
    const send = vi.fn(async (payload) => {
      captured = payload;
      return deliveredBody();
    });
    const p = fakePuter({ sendImpl: send });
    const mail = makeMail({ p });

    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(out).toMatchObject({ ok: true, sent: true, method: 'api' });

    expect(captured.to).toBe('alice@example.com');
    expect(captured.subject).toBe('Accepted: Team offsite');
    expect(typeof captured.text).toBe('string');
    expect(captured.text).toContain('has accepted');

    expect(captured.attachments).toHaveLength(1);
    const att = captured.attachments[0];
    expect(att.filename).toBe('reply.ics');
    expect(att.contentType).toBe('text/calendar; charset=utf-8; method=REPLY');
    expect(typeof att.content).toBe('string');
    expect(decodeIcs(captured)).toContain('METHOD:REPLY');
  });

  it('ASCII-folds a non-ASCII title into the subject, one "?" per run of non-ASCII characters', async () => {
    let captured = null;
    const send = vi.fn(async (payload) => {
      captured = payload;
      return deliveredBody();
    });
    const p = fakePuter({ sendImpl: send });
    const mail = makeMail({ p });

    await mail.sendReply(fakeEvent({ title: 'Café ☕ meetup' }), 'accepted');
    expect(captured.subject).toBe('Accepted: Caf? ? meetup');
    expect(captured.subject).not.toMatch(/[^\x00-\x7f]/);
  });

  it('falls back to "Accepted: invitation" when the title has nothing printable left', async () => {
    let captured = null;
    const send = vi.fn(async (payload) => {
      captured = payload;
      return deliveredBody();
    });
    const p = fakePuter({ sendImpl: send });
    const mail = makeMail({ p });

    await mail.sendReply(fakeEvent({ title: '日本語' }), 'declined');
    expect(captured.subject).toBe('Declined: invitation');
  });
});

describe('createMailReply: sendReply — result interpretation matrix', () => {
  it('delivered including the organizer -> sent, worker never touched', async () => {
    const p = fakePuter();
    const toast = vi.fn();
    const mail = makeMail({ p, toast });

    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(out).toMatchObject({ ok: true, sent: true, method: 'api' });
    expect(p.workers.exec).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Reply sent to alice@example.com', { variant: 'success' });
  });

  it('forbidden -> requests the .mail:write grant, retries once, and the retry succeeds', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ code: 'forbidden', message: 'no grant' })
      .mockResolvedValueOnce(deliveredBody());
    const permsRequest = vi.fn(async () => true);
    const p = fakePuter({ sendImpl: send, permsRequest });
    const mail = makeMail({ p });

    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(send).toHaveBeenCalledTimes(2);
    expect(permsRequest).toHaveBeenCalledTimes(1);
    expect(permsRequest.mock.calls[0][1]).toMatchObject({ permission: 'fs:/nariman/.mail:write', create: true });
    expect(out).toMatchObject({ ok: true, sent: true, method: 'api' });
    expect(p.workers.exec).not.toHaveBeenCalled();
  });

  it('forbidden -> grant refused -> retry still forbidden -> falls back to the worker', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ code: 'forbidden' })
      .mockResolvedValueOnce({ code: 'forbidden' });
    const permsRequest = vi.fn(async () => false); // denial resolves falsy, never throws
    const p = fakePuter({ sendImpl: send, permsRequest });
    p.workers.exec = vi.fn(async () => workerOk());
    const mail = makeMail({ p });

    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(send).toHaveBeenCalledTimes(2);
    expect(permsRequest).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ok: true, sent: true, method: 'worker' });
  });

  it('subscription_required -> falls back to the worker, no retry', async () => {
    const send = vi.fn(async () => ({ code: 'subscription_required', message: 'upgrade' }));
    const p = fakePuter({ sendImpl: send });
    p.workers.exec = vi.fn(async () => workerOk());
    const mail = makeMail({ p });

    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(send).toHaveBeenCalledTimes(1);
    expect(out.method).toBe('worker');
  });

  it('a `failed` entry naming an external-plan refusal -> falls back to the worker', async () => {
    const send = vi.fn(async () => ({
      sentPath: '/nariman/.mail/sent/x',
      delivered: [],
      failed: [{ address: 'alice@example.com', reason: 'destination_requires_paid_plan' }],
    }));
    const p = fakePuter({ sendImpl: send });
    p.workers.exec = vi.fn(async () => workerOk());
    const mail = makeMail({ p });

    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(out.method).toBe('worker');
  });

  it('too_many_requests -> reports it and does NOT fall back (the budget is the user\'s own)', async () => {
    const send = vi.fn(async () => ({ code: 'too_many_requests' }));
    const p = fakePuter({ sendImpl: send });
    p.workers.exec = vi.fn();
    const toast = vi.fn();
    const mail = makeMail({ p, toast });

    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(out).toMatchObject({ ok: false, sent: false, method: 'api' });
    expect(p.workers.exec).not.toHaveBeenCalled();
    expect(toast.mock.calls[0][0]).toContain("today's email limit");
  });

  it('an unrecognized body -> falls back to the worker', async () => {
    const send = vi.fn(async () => ({ code: 'something_new_we_do_not_know' }));
    const p = fakePuter({ sendImpl: send });
    p.workers.exec = vi.fn(async () => workerOk());
    const mail = makeMail({ p });

    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(out.method).toBe('worker');
  });

  it('goes straight to the worker when this SDK has no puter.email.send at all', async () => {
    const p = fakePuter({ api: false });
    p.workers.exec = vi.fn(async () => workerOk());
    const mail = makeMail({ p });

    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(out.method).toBe('worker');
  });

  it('reports, but never throws, when neither the API nor the worker is available', async () => {
    const p = fakePuter({ api: false, worker: false });
    const toast = vi.fn();
    const mail = makeMail({ p, toast });
    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(out).toMatchObject({ ok: false, sent: false });
    expect(toast).toHaveBeenCalled();
  });

  it('does nothing when the event has no organizer to reply to', async () => {
    const p = fakePuter();
    const mail = makeMail({ p });
    const out = await mail.sendReply(fakeEvent({ organizer: null }), 'accepted');
    expect(out).toMatchObject({ ok: false, sent: false, reason: 'no_organizer' });
    expect(p.email.send).not.toHaveBeenCalled();
  });

  it('does nothing while offline', async () => {
    const p = fakePuter();
    const mail = createMailReply({
      store: fakeStore(),
      user: fakeUser(),
      getPuter: () => p,
      blocked: () => true,
      toast: vi.fn(),
    });
    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(out.reason).toBe('offline');
    expect(p.email.send).not.toHaveBeenCalled();
  });
});

describe('createMailReply: sendReply — worker fallback payload', () => {
  it('sends the fallback with the documented { event, attendee, partstat, ics, version } shape', async () => {
    const send = vi.fn(async () => ({ code: 'subscription_required' }));
    const p = fakePuter({ sendImpl: send });
    p.workers.exec = vi.fn(async () => workerOk());
    const mail = makeMail({ p });

    await mail.sendReply(fakeEvent(), 'declined');
    expect(p.workers.exec).toHaveBeenCalledTimes(1);
    const [url, init] = p.workers.exec.mock.calls[0];
    expect(url).toBe('https://calendar-email.puter.work/replies');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      event: { id: 'evt-1', title: 'Team offsite', organizerEmail: 'alice@example.com', organizerName: 'Alice' },
      attendee: { email: 'nariman@example.com', name: 'Nariman' },
      partstat: 'declined',
    });
    expect(typeof body.ics).toBe('string');
    expect(typeof body.version).toBe('string');
  });

  it('surfaces the worker\'s own failure message when it refuses the fallback', async () => {
    const send = vi.fn(async () => ({ code: 'subscription_required' }));
    const p = fakePuter({ sendImpl: send });
    p.workers.exec = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: 'daily_limit' }) }));
    const toast = vi.fn();
    const mail = makeMail({ p, toast });

    const out = await mail.sendReply(fakeEvent(), 'accepted');
    expect(out).toMatchObject({ ok: false, sent: false, method: 'worker' });
    expect(toast.mock.calls[0][0]).toContain("today's email limit");
  });
});

describe('createMailReply: sendReply — .ics attendee/UID', () => {
  it("uses invite.attendee — the address the original REQUEST invited us by — not the account email, when they differ", async () => {
    let captured = null;
    const send = vi.fn(async (payload) => {
      captured = payload;
      return deliveredBody();
    });
    const p = fakePuter({ sendImpl: send });
    const mail = makeMail({ p, user: fakeUser({ email: 'nariman@example.com' }) });

    const event = fakeEvent({ invite: { uid: 'ext-uid-123@google.com', attendee: 'nariman@puter.email' } });
    await mail.sendReply(event, 'accepted');

    const ics = decodeIcs(captured);
    const attendeeLines = attendeeLinesOf(ics);
    expect(attendeeLines).toHaveLength(1);
    expect(attendeeLines[0].toLowerCase()).toContain('nariman@puter.email');
    expect(attendeeLines[0].toLowerCase()).not.toContain('nariman@example.com');
    expect(attendeeLines[0].toUpperCase()).toContain('PARTSTAT=ACCEPTED');
    expect(ics).toContain('UID:ext-uid-123@google.com');
  });

  it('falls back to the current account email, then <username>@puter.email, when there is no invite.attendee', async () => {
    let captured = null;
    const send = vi.fn(async (payload) => {
      captured = payload;
      return deliveredBody();
    });
    const p = fakePuter({ sendImpl: send });
    const mail = makeMail({ p, user: fakeUser({ email: 'nariman@example.com' }) });
    await mail.sendReply(fakeEvent(), 'declined');

    const ics = decodeIcs(captured);
    const attendeeLines = attendeeLinesOf(ics);
    expect(attendeeLines).toHaveLength(1);
    expect(attendeeLines[0].toLowerCase()).toContain('nariman@example.com');
    expect(attendeeLines[0].toUpperCase()).toContain('PARTSTAT=DECLINED');
    expect(ics).toContain('UID:evt-1@calendar.puter.com');
  });
});

describe('createMailReply: offerReply — nothing sent without a press', () => {
  it('opens a confirm dialog and sends only when "Send" is pressed', async () => {
    const p = fakePuter();
    const mail = makeMail({ p });

    mail.offerReply(fakeEvent(), 'accepted');
    // The dialog is up; nothing has been sent yet.
    expect(p.email.send).not.toHaveBeenCalled();
    expect(document.querySelector('.dialog-scrim')).toBeTruthy();
    expect(document.body.textContent).toContain('alice@example.com');

    document.querySelector('.btn.btn--primary').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(p.email.send).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.dialog-scrim')).toBeFalsy();
  });

  it('sends nothing at all when "Don\'t send" is pressed', async () => {
    const p = fakePuter();
    const mail = makeMail({ p });

    mail.offerReply(fakeEvent(), 'declined');
    const buttons = [...document.querySelectorAll('.modal__foot .btn')];
    const dontSend = buttons.find((b) => b.textContent === "Don't send");
    dontSend.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(p.email.send).not.toHaveBeenCalled();
    expect(document.querySelector('.dialog-scrim')).toBeFalsy();
  });

  it('offers nothing when the event has no organizer, offline, or reply is unavailable', () => {
    const p = fakePuter();
    const noOrganizerMail = makeMail({ p });
    noOrganizerMail.offerReply(fakeEvent({ organizer: null }), 'accepted');
    expect(document.querySelector('.dialog-scrim')).toBeFalsy();

    const blockedMail = createMailReply({ store: fakeStore(), user: fakeUser(), getPuter: () => p, blocked: () => true, toast: vi.fn() });
    blockedMail.offerReply(fakeEvent(), 'accepted');
    expect(document.querySelector('.dialog-scrim')).toBeFalsy();

    const noneMail = createMailReply({
      store: fakeStore(),
      user: fakeUser(),
      getPuter: () => fakePuter({ api: false, worker: false }),
      toast: vi.fn(),
    });
    noneMail.offerReply(fakeEvent(), 'accepted');
    expect(document.querySelector('.dialog-scrim')).toBeFalsy();
  });
});
