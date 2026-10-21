import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openCustomRecurrence, openScopeDialog } from '../src/js/recurrence-dialog.js';

const $ = (sel) => document.querySelector('.dialog-scrim ' + sel);
const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));

describe('custom recurrence — "Ends on" cannot precede the start', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('clamps a typed end date before the start to the start day', () => {
    // Regression: an "Ends on" date before the event's start built a rule with
    // zero occurrences — the saved event vanished from every calendar view.
    const startMs = new Date(2026, 8, 1, 9, 0).getTime(); // Sep 1, 2026
    let built = null;
    openCustomRecurrence({
      rule: null,
      startMs,
      weekStartsOn: 0,
      onDone: (rule) => {
        built = rule;
      },
    });

    // The date picker itself must not offer pre-start dates.
    const until = $('input[aria-label="End date"]');
    expect(until.min).toBe('2026-09-01');

    // Choose "Ends on" and type a date a month before the start.
    const onRadio = $('input[name="rr-ends"][value="on"]');
    onRadio.checked = true;
    fire(onRadio, 'change');
    until.value = '2026-08-01';

    fire($('form.rr-modal'), 'submit');
    expect(built).toBeTruthy();
    // Clamped to the start's own day (one occurrence), not before it.
    expect(built.until).toBe(new Date(2026, 8, 1, 23, 59, 59, 999).getTime());
  });

  it('lets a series edit shorten the series to before the displayed occurrence', () => {
    // Regression: the min/clamp was anchored to the occurrence the modal was
    // open on, so editing the June occurrence of a January series could not
    // set "Ends on March 31" — the dialog clamped it up to June, silently
    // keeping months of occurrences the user asked to remove. The floor is
    // the series ANCHOR, passed separately.
    const startMs = new Date(2026, 5, 15, 9, 0).getTime(); // displayed: Jun 15
    const anchorMs = new Date(2026, 0, 5, 9, 0).getTime(); // series anchor: Jan 5
    let built = null;
    openCustomRecurrence({
      rule: { freq: 'weekly', interval: 1, byWeekday: [1] },
      startMs,
      anchorMs,
      weekStartsOn: 0,
      onDone: (rule) => {
        built = rule;
      },
    });

    const until = $('input[aria-label="End date"]');
    expect(until.min).toBe('2026-01-05'); // picker floor = the anchor, not Jun 15

    const onRadio = $('input[name="rr-ends"][value="on"]');
    onRadio.checked = true;
    fire(onRadio, 'change');
    until.value = '2026-03-31';
    fire($('form.rr-modal'), 'submit');

    expect(built.until).toBe(new Date(2026, 2, 31, 23, 59, 59, 999).getTime()); // NOT clamped

    // Still clamps a date before the anchor itself.
    document.body.innerHTML = '';
    openCustomRecurrence({
      rule: { freq: 'weekly', interval: 1, byWeekday: [1] },
      startMs,
      anchorMs,
      weekStartsOn: 0,
      onDone: (rule) => {
        built = rule;
      },
    });
    const onRadio2 = $('input[name="rr-ends"][value="on"]');
    onRadio2.checked = true;
    fire(onRadio2, 'change');
    $('input[aria-label="End date"]').value = '2025-12-01';
    fire($('form.rr-modal'), 'submit');
    expect(built.until).toBe(new Date(2026, 0, 5, 23, 59, 59, 999).getTime());
  });

  it('keeps a valid post-start end date untouched', () => {
    const startMs = new Date(2026, 8, 1, 9, 0).getTime();
    let built = null;
    openCustomRecurrence({
      rule: null,
      startMs,
      weekStartsOn: 0,
      onDone: (rule) => {
        built = rule;
      },
    });
    const onRadio = $('input[name="rr-ends"][value="on"]');
    onRadio.checked = true;
    fire(onRadio, 'change');
    $('input[aria-label="End date"]').value = '2026-09-15';
    fire($('form.rr-modal'), 'submit');
    expect(built.until).toBe(new Date(2026, 8, 15, 23, 59, 59, 999).getTime());
  });
});

describe('scope chooser — the focus trap treats the radio group as one stop', () => {
  let offsetParentDesc;
  beforeEach(() => {
    // jsdom has no layout: offsetParent is always null, which the trap uses to
    // skip hidden controls. Make every attached element count as visible.
    offsetParentDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        return this.parentElement;
      },
    });
  });
  afterEach(() => {
    document.body.innerHTML = '';
    if (offsetParentDesc) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParentDesc);
  });

  const tab = (node, shiftKey) =>
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));

  it('wraps Shift+Tab from a non-first radio to the last button instead of leaking out', () => {
    openScopeDialog({ mode: 'edit', onConfirm: () => {} });
    const radios = [...document.querySelectorAll('.dialog-scrim input[name="rr-scope"]')];
    expect(radios.length).toBeGreaterThan(1);
    radios[1].checked = true;
    radios[1].focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    radios[1].dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const buttons = [...document.querySelectorAll('.dialog-scrim button')];
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    // …and Tab forward from that last button lands on the CHECKED radio.
    tab(document.activeElement, false);
    expect(document.activeElement).toBe(radios[1]);
  });
});
