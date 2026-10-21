import { describe, it, expect, afterEach } from 'vitest';
import { renderSidebar } from '../src/js/sidebar.js';
import { DEFAULT_SETTINGS } from '../src/js/store.js';

/** Minimal store/ctx stand-in, same shape as sidebar.test.js's makeCtx. */
function makeCtx({ settings = {}, actions = {}, mail = null } = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const store = {
    getAllEvents: () => [],
    getAllTasks: () => [],
    getEventsInRange: () => [],
    getSettings: () => ({ ...s }),
  };
  const now = new Date(2026, 6, 1);
  return {
    store,
    settings: s,
    cursor: now,
    miniCursor: new Date(2026, 6, 1),
    now,
    booking: null,
    mail,
    actions: {
      createAt() {},
      miniShift() {},
      selectDate() {},
      toggleColor() {},
      renameCategory() {},
      toggleCategories() {},
      toggleBookingLinks() {},
      newBookingPage() {},
      editBookingPage() {},
      copyBookingLink() {},
      toggleMailInvites() {},
      addMailInvite() {},
      ignoreMailInvite() {},
      blockMailSender() {},
      ...actions,
    },
  };
}

function makeMail(pending = []) {
  return { intake: { getPending: () => pending } };
}

const row = (overrides = {}) => ({
  id: 'r1',
  kind: 'request',
  title: 'Team offsite',
  whenText: 'Tomorrow, 9:00 – 10:00 AM',
  start: Date.now(),
  end: Date.now() + 3600_000,
  allDay: false,
  fromEmail: 'alice@example.com',
  fromName: 'Alice',
  hint: '',
  authenticated: true,
  at: Date.now(),
  ...overrides,
});

describe('sidebar — mail-detected invitations', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('is absent when there is no mail module at all', () => {
    const node = renderSidebar(makeCtx({ mail: null }));
    expect(node.querySelector('.mail-list')).toBeNull();
  });

  it('is absent when nothing is pending', () => {
    const node = renderSidebar(makeCtx({ mail: makeMail([]) }));
    expect(node.querySelector('.mail-list')).toBeNull();
    expect(node.querySelector('.mail-item')).toBeNull();
  });

  it('renders a row per pending invitation from the view models intake hands over', () => {
    const node = renderSidebar(
      makeCtx({
        mail: makeMail([
          row({ id: 'r1', title: 'Team offsite', hint: '' }),
          row({ id: 'r2', title: 'Rescheduled sync', hint: 'Proposed time', fromName: '', fromEmail: 'bob@example.com' }),
        ]),
      }),
    );
    const items = [...node.querySelectorAll('.mail-item')];
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.mail-item__title').textContent).toContain('Team offsite');
    expect(items[0].textContent).toContain('Alice · alice@example.com');
    expect(items[0].textContent).toContain('Tomorrow, 9:00 – 10:00 AM');
    // No name on the second row — sender line falls back to the address alone.
    expect(items[1].textContent).toContain('bob@example.com');
    expect(items[1].querySelector('.mail-item__pill').textContent).toBe('Proposed time');
    // No hint on the first row: no pill rendered at all.
    expect(items[0].querySelector('.mail-item__pill')).toBeNull();
  });

  it('the collapsed note reads "N waiting"', () => {
    const node = renderSidebar(
      makeCtx({
        mail: makeMail([row({ id: 'r1' }), row({ id: 'r2' }), row({ id: 'r3' })]),
        settings: { mailInvitesCollapsed: true },
      }),
    );
    const note = node.querySelector('.side-section__note');
    expect(note).not.toBeNull();
    expect(note.textContent).toBe('3 waiting');
  });

  it('folds via the same buildFoldingSection mechanics as the other sections', () => {
    const toggled = [];
    const node = renderSidebar(
      makeCtx({
        mail: makeMail([row()]),
        settings: { mailInvitesCollapsed: true },
        actions: { toggleMailInvites: () => toggled.push(true) },
      }),
    );
    const toggle = node.querySelector('[data-focus-key="mail-collapse"]');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(node.querySelector('.mail-list').hidden).toBe(true);
    toggle.click();
    expect(toggled).toEqual([true]);
  });

  it('Add calls through to actions.addMailInvite with the row id', () => {
    const added = [];
    const node = renderSidebar(
      makeCtx({ mail: makeMail([row({ id: 'rX' })]), actions: { addMailInvite: (id) => added.push(id) } }),
    );
    node.querySelector('[data-focus-key="mail-add-rX"]').click();
    expect(added).toEqual(['rX']);
  });

  it('Ignore calls through to actions.ignoreMailInvite with the row id', () => {
    const ignored = [];
    const node = renderSidebar(
      makeCtx({ mail: makeMail([row({ id: 'rX' })]), actions: { ignoreMailInvite: (id) => ignored.push(id) } }),
    );
    node.querySelector('[data-focus-key="mail-ignore-rX"]').click();
    expect(ignored).toEqual(['rX']);
  });

  it('Block asks for a second press before calling actions.blockMailSender', () => {
    const blocked = [];
    const node = renderSidebar(
      makeCtx({ mail: makeMail([row({ id: 'rX' })]), actions: { blockMailSender: (id) => blocked.push(id) } }),
    );
    const btn = node.querySelector('[data-focus-key="mail-block-rX"]');
    btn.click();
    expect(blocked).toEqual([]); // first press only asks for confirmation
    expect(btn.classList.contains('is-confirm')).toBe(true);
    btn.click();
    expect(blocked).toEqual(['rX']);
  });

  it('renders the "Unknown sender" pill for a known:false row', () => {
    const node = renderSidebar(
      makeCtx({ mail: makeMail([row({ id: 'rX', known: false, hint: 'Unknown sender' })]) }),
    );
    const pill = node.querySelector('.mail-item__pill');
    expect(pill).not.toBeNull();
    expect(pill.textContent).toBe('Unknown sender');
  });

  it('renders a mail-derived title/sender containing HTML as plain text, never markup', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const node = renderSidebar(
      makeCtx({
        mail: makeMail([row({ id: 'rX', title: payload, fromName: payload, fromEmail: 'evil@example.com' })]),
      }),
    );
    expect(node.querySelector('img')).toBeNull();
    const item = node.querySelector('.mail-item');
    expect(item.querySelector('.mail-item__title').textContent).toContain(payload);
    expect(item.textContent).toContain(payload);
  });
});
