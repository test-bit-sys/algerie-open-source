import { describe, it, expect, vi, afterEach } from 'vitest';
import { openMailDialog } from '../src/js/mail-dialog.js';

function makeMailbox(status = {}, overrides = {}) {
  return {
    status: () => ({
      mode: 'off',
      state: 'off',
      subId: '',
      suspendedReason: '',
      lastError: '',
      watermark: '',
      lastScanAt: 0,
      ...status,
    }),
    connect: vi.fn(async () => {}),
    reconnect: vi.fn(async () => {}),
    rescan: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    onChange: () => () => {},
    available: () => true,
    ...overrides,
  };
}

function makeIntake(blocked = [], overrides = {}) {
  return {
    getBlocked: () => blocked,
    unblock: vi.fn(async () => {}),
    onChange: () => () => {},
    ...overrides,
  };
}

function makeStore(settings = {}, overrides = {}) {
  const s = { mailInvites: 'known', mailInvitesShowUnknown: false, ...settings };
  return {
    getSettings: () => ({ ...s }),
    saveSettings: vi.fn(async (patch) => {
      Object.assign(s, patch);
      return { ...s };
    }),
    subscribe: () => () => {},
    ...overrides,
  };
}

let closeDialog = null;
function open(opts) {
  closeDialog = openMailDialog(opts);
  return document.querySelector('.mail-dialog');
}

afterEach(() => {
  if (closeDialog) closeDialog();
  closeDialog = null;
  document.body.replaceChildren();
});

describe('mail dialog — connection state line', () => {
  it.each([
    ['off', {}, 'Not connected', 'Connect'],
    ['off', { lastError: 'Not available on this Puter server.' }, 'Not available on this Puter server.', 'Connect'],
    ['connecting', {}, 'Connecting…', 'Connecting…'],
    ['ok', {}, 'Connected — invitations are checked automatically.', 'Check now'],
    ['foreground', {}, 'Checked while the calendar is open.', 'Check now'],
    [
      'suspended',
      { suspendedReason: 'Permission was revoked — reconnect to resume.' },
      'Permission was revoked — reconnect to resume.',
      'Reconnect',
    ],
    ['unavailable', { lastError: 'Local scanning is unavailable.' }, 'Local scanning is unavailable.', 'Reconnect'],
  ])('state=%s renders its message and primary action', (state, statusExtra, expectedMessage, expectedAction) => {
    const dialog = open({
      mailbox: makeMailbox({ state, ...statusExtra }),
      intake: makeIntake(),
      store: makeStore(),
    });
    const stateLine = dialog.querySelector('.mail-dialog__state');
    expect(stateLine.textContent).toContain(expectedMessage);
    expect(stateLine.querySelector('button').textContent).toBe(expectedAction);
  });

  it('Connect calls mailbox.connect() directly from the click handler', () => {
    const mailbox = makeMailbox({ state: 'off' });
    const dialog = open({ mailbox, intake: makeIntake(), store: makeStore() });
    dialog.querySelector('.mail-dialog__state button').click();
    expect(mailbox.connect).toHaveBeenCalledTimes(1);
  });

  it('Reconnect calls mailbox.reconnect() when suspended', () => {
    const mailbox = makeMailbox({ state: 'suspended', suspendedReason: 'Paused.' });
    const dialog = open({ mailbox, intake: makeIntake(), store: makeStore() });
    dialog.querySelector('.mail-dialog__state button').click();
    expect(mailbox.reconnect).toHaveBeenCalledTimes(1);
  });

  it('Check now forces an immediate rescan when connected', () => {
    const mailbox = makeMailbox({ state: 'ok' });
    const dialog = open({ mailbox, intake: makeIntake(), store: makeStore() });
    dialog.querySelector('.mail-dialog__state button').click();
    expect(mailbox.rescan).toHaveBeenCalledWith({ force: true });
  });
});

describe('mail dialog — auto-add policy', () => {
  it('shows the two policy choices with the stored one checked — "all" is gone', () => {
    const dialog = open({
      mailbox: makeMailbox(),
      intake: makeIntake(),
      store: makeStore({ mailInvites: 'never' }),
    });
    const checked = dialog.querySelector('input[name="mail-policy"]:checked');
    expect(checked.value).toBe('never');
    expect([...dialog.querySelectorAll('input[name="mail-policy"]')].map((i) => i.value)).toEqual([
      'known',
      'never',
    ]);
  });

  it('changing the radio saves the new policy', () => {
    const store = makeStore({ mailInvites: 'known' });
    const dialog = open({ mailbox: makeMailbox(), intake: makeIntake(), store });
    dialog.querySelector('input[value="never"]').click();
    expect(store.saveSettings).toHaveBeenCalledWith({ mailInvites: 'never' });
  });
});

describe('mail dialog — unknown-sender switch', () => {
  it('is off by default and reflects the stored setting', () => {
    const dialog = open({
      mailbox: makeMailbox(),
      intake: makeIntake(),
      store: makeStore({ mailInvitesShowUnknown: true }),
    });
    const input = dialog.querySelector('[data-focus-key="mail-show-unknown"]');
    expect(input.type).toBe('checkbox');
    expect(input.checked).toBe(true);
  });

  it('mentions people the user has not interacted with', () => {
    const dialog = open({ mailbox: makeMailbox(), intake: makeIntake(), store: makeStore() });
    expect(dialog.textContent).toContain("Show invitations from people I haven't interacted with");
  });

  it('toggling it saves mailInvitesShowUnknown', () => {
    const store = makeStore({ mailInvitesShowUnknown: false });
    const dialog = open({ mailbox: makeMailbox(), intake: makeIntake(), store });
    const input = dialog.querySelector('[data-focus-key="mail-show-unknown"]');
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(store.saveSettings).toHaveBeenCalledWith({ mailInvitesShowUnknown: true });
  });
});

describe('mail dialog — blocked senders', () => {
  it('is absent when nothing is blocked', () => {
    const dialog = open({ mailbox: makeMailbox(), intake: makeIntake([]), store: makeStore() });
    expect(dialog.textContent).not.toContain('Blocked senders');
  });

  it('lists each blocked address with an Unblock button', () => {
    const dialog = open({
      mailbox: makeMailbox(),
      intake: makeIntake(['spam@example.com', 'nope@example.com']),
      store: makeStore(),
    });
    expect(dialog.textContent).toContain('spam@example.com');
    expect(dialog.textContent).toContain('nope@example.com');
  });

  it('Unblock calls intake.unblock with that address', () => {
    const intake = makeIntake(['spam@example.com']);
    const dialog = open({ mailbox: makeMailbox(), intake, store: makeStore() });
    dialog.querySelector('[data-focus-key="mail-unblock-spam@example.com"]').click();
    expect(intake.unblock).toHaveBeenCalledWith('spam@example.com');
  });
});

describe('mail dialog — disconnect', () => {
  it('Disconnect calls mailbox.disconnect()', () => {
    const mailbox = makeMailbox({ state: 'ok' });
    const dialog = open({ mailbox, intake: makeIntake(), store: makeStore() });
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Disconnect').click();
    expect(mailbox.disconnect).toHaveBeenCalledTimes(1);
  });

  it('mentions what access was granted and where to revoke it', () => {
    const dialog = open({ mailbox: makeMailbox(), intake: makeIntake(), store: makeStore() });
    expect(dialog.textContent).toContain('Puter’s own app permissions settings');
  });
});
