import { describe, it, expect, afterEach, vi } from 'vitest';
import { offerCancellation } from '../src/js/cancellation-dialog.js';

/**
 * The "Send cancellation emails?" ask (offered after a host deletes an
 * invited event). Invites and store are stubbed — this is about the question
 * and what a yes, a no, and a raced Undo each do, not about sending.
 */

const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function makeWorld({ result = { ok: true, sent: 2, failed: 0, suppressed: 0 }, error = null, restored = false } = {}) {
  const toasts = [];
  return {
    toasts,
    invites: {
      sendCancellation: vi.fn(async () => {
        if (error) throw error;
        return result;
      }),
    },
    store: { getEvent: () => (restored ? { id: 'e1' } : null) },
    cancel: {
      eventId: 'e1',
      event: { id: 'e1' },
      details: { title: 'Team offsite' },
      recipients: [
        { email: 'ada@example.com', name: 'Ada', version: 'aaaa1111' },
        { email: 'bob@example.com', name: '', version: 'aaaa1111' },
      ],
    },
    toast: (message, opts) => toasts.push({ message, variant: (opts && opts.variant) || 'default' }),
  };
}

const dialog = () => document.querySelector('form.cancel-ask');
const button = (label) =>
  [...(dialog() ? dialog().querySelectorAll('button') : [])].find((b) => b.textContent.trim() === label);
const submit = () =>
  dialog().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cancellation dialog', () => {
  it('says who gets mail about what, and a no sends none', () => {
    const world = makeWorld();
    offerCancellation(world);
    expect(dialog().textContent).toContain('Send cancellation emails?');
    expect(dialog().textContent).toContain('2 guests will get an email saying “Team offsite” was cancelled.');
    expect(dialog().textContent).toContain('You’ll receive a cancellation email too');

    button("Don't send").click();
    expect(dialog()).toBeNull();
    expect(world.invites.sendCancellation).not.toHaveBeenCalled();
    expect(world.toasts).toHaveLength(0);
  });

  it('counts one guest in the singular', () => {
    const world = makeWorld();
    world.cancel.recipients = world.cancel.recipients.slice(0, 1);
    offerCancellation(world);
    expect(dialog().textContent).toContain('1 guest will get an email');
  });

  it('Escape is a no', () => {
    const world = makeWorld();
    offerCancellation(world);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
    expect(world.invites.sendCancellation).not.toHaveBeenCalled();
  });

  it('sends on a yes and reports what happened', async () => {
    const world = makeWorld();
    offerCancellation(world);
    submit();
    await flush();
    expect(world.invites.sendCancellation).toHaveBeenCalledWith(world.cancel);
    expect(dialog()).toBeNull();
    expect(world.toasts).toEqual([{ message: 'Cancellation emails sent: 2', variant: 'success' }]);
  });

  it('reports a failure as one, in the send\'s own words', async () => {
    const world = makeWorld({ error: new Error("You're offline — reconnect to send the cancellation.") });
    offerCancellation(world);
    submit();
    await flush();
    expect(world.toasts).toEqual([
      { message: "You're offline — reconnect to send the cancellation.", variant: 'danger' },
    ]);
  });

  it('sends nothing when Undo restored the event before the answer', async () => {
    const world = makeWorld({ restored: true });
    offerCancellation(world);
    submit();
    await flush();
    expect(world.invites.sendCancellation).not.toHaveBeenCalled();
    expect(world.toasts).toEqual([
      { message: 'The event was restored — no cancellation was sent.', variant: 'default' },
    ]);
  });

  it('never opens over nothing: no recipients, no question', () => {
    const world = makeWorld();
    world.cancel.recipients = [];
    offerCancellation(world);
    expect(dialog()).toBeNull();
    offerCancellation({ ...makeWorld(), cancel: null });
    expect(dialog()).toBeNull();
  });

  it.each([false, true])('checks whether the occurrence was restored (undo=%s), not whether its series exists', async (undo) => {
    const world = makeWorld();
    world.cancel.recurrenceId = 1234;
    world.cancel.details.when = 'Monday, July 20 at 9:00 AM';
    world.store.getEvent = () => ({ id: 'e1', exdates: undo ? [] : [1234] });
    offerCancellation(world);
    expect(dialog().textContent).toContain('this occurrence of “Team offsite” (Monday, July 20 at 9:00 AM)');
    expect(dialog().textContent).toContain('The rest of the series will stay on their calendars.');
    submit();
    await flush();
    expect(world.invites.sendCancellation).toHaveBeenCalledTimes(undo ? 0 : 1);
    if (undo) expect(world.toasts[0].message).toContain('restored');
  });
});
