import { describe, it, expect, afterEach, vi } from 'vitest';
import { createTimeField, parseTimeText, formatTimeText, formatDuration, ownsEscape } from '../src/js/time-field.js';

const key = (node, k, init = {}) =>
  node.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));

function mount(opts = {}) {
  const field = createTimeField({ label: 'Start time', ...opts });
  document.body.append(field.el);
  const list = field.el.querySelector('[role="listbox"]');
  const options = () => [...field.el.querySelectorAll('[role="option"]')];
  const highlighted = () => options().find((o) => o.getAttribute('aria-selected') === 'true') || null;
  return { field, input: field.input, list, options, highlighted };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('parseTimeText', () => {
  it('reads 24-hour text', () => {
    expect(parseTimeText('9')).toBe(9 * 60);
    expect(parseTimeText('09:30')).toBe(9 * 60 + 30);
    expect(parseTimeText('21:30')).toBe(21 * 60 + 30);
    expect(parseTimeText('2130')).toBe(21 * 60 + 30);
    expect(parseTimeText('930')).toBe(9 * 60 + 30);
    expect(parseTimeText('0')).toBe(0);
    expect(parseTimeText('23:59')).toBe(23 * 60 + 59);
  });

  it('reads 12-hour text in its many spellings', () => {
    expect(parseTimeText('9am')).toBe(9 * 60);
    expect(parseTimeText('9 pm')).toBe(21 * 60);
    expect(parseTimeText('9:30p')).toBe(21 * 60 + 30);
    expect(parseTimeText('930a')).toBe(9 * 60 + 30);
    expect(parseTimeText('9.30 PM')).toBe(21 * 60 + 30);
    expect(parseTimeText('9 a.m.')).toBe(9 * 60);
    expect(parseTimeText('12am')).toBe(0);
    expect(parseTimeText('12pm')).toBe(12 * 60);
    expect(parseTimeText('12:30 AM')).toBe(30);
    expect(parseTimeText('noon')).toBe(12 * 60);
    expect(parseTimeText('midnight')).toBe(0);
  });

  it('rejects what is not a time', () => {
    for (const bad of ['', '   ', 'abc', '24:00', '9:60', '13pm', '0am', '99', '9:', ':30', '1 2']) {
      expect(parseTimeText(bad)).toBe(null);
    }
  });
});

describe('formatTimeText', () => {
  it('always shows minutes so an edit can start from digits that are there', () => {
    expect(formatTimeText(9 * 60, true)).toBe('9:00 AM');
    expect(formatTimeText(0, true)).toBe('12:00 AM');
    expect(formatTimeText(12 * 60 + 5, true)).toBe('12:05 PM');
    expect(formatTimeText(23 * 60 + 59, true)).toBe('11:59 PM');
    expect(formatTimeText(9 * 60, false)).toBe('09:00');
    expect(formatTimeText(23 * 60 + 59, false)).toBe('23:59');
  });
});

describe('time field — value', () => {
  it('speaks HH:MM on value and shows the formatted time', () => {
    const { field, input } = mount();
    expect(field.value).toBe('');
    expect(input.value).toBe('');
    field.value = '09:30';
    expect(field.value).toBe('09:30');
    expect(input.value).toBe('9:30 AM');
    expect(field.el.dataset.value).toBe('09:30');
    field.value = '';
    expect(field.value).toBe('');
    expect(input.value).toBe('');
  });

  it('reflects typed text before it is committed, like a native input', () => {
    // Cmd+Enter saves from inside the field, before any blur/change: the
    // time on screen must be what gets saved.
    const { field, input } = mount();
    field.value = '09:30';
    input.value = '15:30';
    expect(field.value).toBe('15:30');
    input.value = 'not yet';
    expect(field.value).toBe('09:30');
  });

  it('ignores a malformed value the way a native time input does', () => {
    const { field, input } = mount();
    field.value = 'lunchtime';
    expect(field.value).toBe('');
    expect(input.value).toBe('');
  });

  it('re-reads a live hour12 setting on every render', () => {
    let hour12 = true;
    const { field, input, highlighted } = mount({ hour12: () => hour12 });
    field.value = '13:00';
    expect(input.value).toBe('1:00 PM');
    hour12 = false;
    field.value = '13:00';
    expect(input.value).toBe('13:00');
    fire(input, 'focus');
    expect(highlighted().textContent).toBe('13:00');
  });

  it('hides and shows through a hidden property like an input', () => {
    const { field } = mount();
    field.hidden = true;
    expect(field.el.hidden).toBe(true);
    field.hidden = false;
    expect(field.el.hidden).toBe(false);
  });
});

describe('time field — the list', () => {
  it('opens on focus with the field’s own slot highlighted, closes on blur', () => {
    const { field, input, list, options, highlighted } = mount();
    field.value = '09:30';
    expect(list.hidden).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');

    fire(input, 'focus');
    expect(list.hidden).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(options()).toHaveLength(96);
    expect(highlighted().dataset.min).toBe(String(9 * 60 + 30));
    expect(highlighted().textContent).toBe('9:30 AM');
    expect(input.getAttribute('aria-activedescendant')).toBe(highlighted().id);

    fire(input, 'blur');
    expect(list.hidden).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(highlighted()).toBe(null);
  });

  it('highlights nothing for an off-grid time but keeps the time itself', () => {
    const { field, input, highlighted } = mount();
    field.value = '09:07';
    fire(input, 'focus');
    expect(highlighted()).toBe(null);
    expect(input.value).toBe('9:07 AM');
    expect(field.value).toBe('09:07');
  });

  it('picks a time on click and announces the change', () => {
    const { field, input, list, options } = mount();
    field.value = '09:30';
    const onChange = vi.fn();
    field.addEventListener('change', onChange);
    fire(input, 'focus');
    // Pressing in the list must not take focus off the input.
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    list.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);

    options().find((o) => o.dataset.min === String(10 * 60)).click();
    expect(field.value).toBe('10:00');
    expect(input.value).toBe('10:00 AM');
    expect(list.hidden).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('steps the highlight with the arrows and picks it with Enter, without submitting', () => {
    const form = document.createElement('form');
    document.body.append(form);
    const { field, input, highlighted, list } = mount();
    form.append(field.el);
    const onSubmit = vi.fn((e) => e.preventDefault());
    form.addEventListener('submit', onSubmit);
    const onChange = vi.fn();
    field.addEventListener('change', onChange);
    field.value = '09:30';

    // Down from a closed list opens it and moves off the current slot.
    key(input, 'ArrowDown');
    expect(list.hidden).toBe(false);
    expect(highlighted().dataset.min).toBe(String(9 * 60 + 45));
    key(input, 'ArrowDown');
    expect(highlighted().dataset.min).toBe(String(10 * 60));
    key(input, 'ArrowUp');
    expect(highlighted().dataset.min).toBe(String(9 * 60 + 45));
    // The text is untouched until something is picked.
    expect(input.value).toBe('9:30 AM');

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(field.value).toBe('09:45');
    expect(list.hidden).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();

    // With the list closed, Enter is the form's: it commits and lets it through.
    const enter2 = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter2);
    expect(enter2.defaultPrevented).toBe(false);
  });

  it('steps from an off-grid time to the slots on either side of it', () => {
    const { field, input, highlighted } = mount();
    field.value = '09:07';
    key(input, 'ArrowDown');
    expect(highlighted().dataset.min).toBe(String(9 * 60 + 15));
    fire(input, 'blur');
    key(input, 'ArrowUp');
    expect(highlighted().dataset.min).toBe(String(9 * 60));
  });

  it('clamps the highlight at the ends of the day', () => {
    const { field, input, highlighted } = mount();
    field.value = '00:00';
    key(input, 'ArrowUp');
    expect(highlighted().dataset.min).toBe('0');
    field.value = '23:45';
    fire(input, 'blur');
    key(input, 'ArrowDown');
    expect(highlighted().dataset.min).toBe(String(23 * 60 + 45));
  });

  it('follows what is typed, highlighting an exact slot', () => {
    const { field, input, highlighted } = mount();
    field.value = '09:30';
    fire(input, 'focus');
    input.value = '10';
    fire(input, 'input');
    expect(highlighted().dataset.min).toBe(String(10 * 60));
    input.value = '10:3';
    fire(input, 'input');
    expect(highlighted()).toBe(null);
    input.value = '10:30';
    fire(input, 'input');
    expect(highlighted().dataset.min).toBe(String(10 * 60 + 30));
  });

  it('closes on Escape, keeping the Escape to itself and dropping half-typed text', () => {
    const { field, input, list } = mount();
    field.value = '09:30';
    fire(input, 'focus');
    input.value = '10:1';
    fire(input, 'input');
    const seenAbove = vi.fn();
    document.body.addEventListener('keydown', seenAbove);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(seenAbove).not.toHaveBeenCalled();
    expect(list.hidden).toBe(true);
    expect(input.value).toBe('9:30 AM');
    expect(field.value).toBe('09:30');
    // A closed list leaves Escape to whoever is listening above.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(seenAbove).toHaveBeenCalledTimes(1);
    document.body.removeEventListener('keydown', seenAbove);
  });

  it('tells a dialog whether the field owns the Escape', () => {
    const { field, input } = mount();
    field.value = '09:30';
    expect(ownsEscape(input)).toBe(false);
    fire(input, 'focus');
    expect(ownsEscape(input)).toBe(true);
    expect(ownsEscape(null)).toBe(false);
    expect(ownsEscape(document.body)).toBe(false);
  });

  it('reopens on a click or on typing after Escape closed it', () => {
    const { field, input, list } = mount();
    field.value = '09:30';
    fire(input, 'focus');
    key(input, 'Escape');
    expect(list.hidden).toBe(true);
    fire(input, 'click');
    expect(list.hidden).toBe(false);
    key(input, 'Escape');
    input.value = '1';
    fire(input, 'input');
    expect(list.hidden).toBe(false);
  });
});

describe('time field — committing typed text', () => {
  it('commits free-form text on change and normalizes the display', () => {
    const { field, input } = mount();
    field.value = '09:30';
    const onChange = vi.fn();
    field.addEventListener('change', onChange);
    input.value = '930p';
    fire(input, 'change');
    expect(field.value).toBe('21:30');
    expect(input.value).toBe('9:30 PM');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps an off-grid typed time as typed', () => {
    const { field, input } = mount();
    field.value = '09:00';
    input.value = '9:07';
    fire(input, 'change');
    expect(field.value).toBe('09:07');
    expect(input.value).toBe('9:07 AM');
  });

  it('reverts text that is not a time and says nothing', () => {
    const { field, input } = mount();
    field.value = '09:30';
    const onChange = vi.fn();
    field.addEventListener('change', onChange);
    input.value = 'later';
    fire(input, 'change');
    expect(field.value).toBe('09:30');
    expect(input.value).toBe('9:30 AM');
    input.value = '';
    fire(input, 'change');
    expect(field.value).toBe('09:30');
    expect(input.value).toBe('9:30 AM');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not announce a commit of the same time', () => {
    const { field, input } = mount();
    field.value = '09:30';
    const onChange = vi.fn();
    field.addEventListener('change', onChange);
    input.value = '09:30';
    fire(input, 'change');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('time field — native mode (touch)', () => {
  it('wraps a native time input and passes its value and change through', () => {
    const field = createTimeField({ label: 'Start time', native: true });
    document.body.append(field.el);
    const input = field.el.querySelector('input');
    expect(input.type).toBe('time');
    expect(input.getAttribute('aria-label')).toBe('Start time');
    expect(field.el.querySelector('[role="listbox"]')).toBe(null);

    field.value = '09:30';
    expect(input.value).toBe('09:30');
    expect(field.el.dataset.value).toBe('09:30');

    const onChange = vi.fn();
    field.addEventListener('change', onChange);
    input.value = '10:00';
    fire(input, 'change');
    expect(field.value).toBe('10:00');
    expect(field.el.dataset.value).toBe('10:00');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('chooses the native input only for coarse pointers', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn((q) => ({ matches: q === '(pointer: coarse)' }));
    try {
      const touch = createTimeField({ label: 'T' });
      expect(touch.input.type).toBe('time');
    } finally {
      window.matchMedia = original;
    }
    const desktop = createTimeField({ label: 'T' });
    expect(desktop.input.getAttribute('role')).toBe('combobox');
  });
});

describe('formatDuration', () => {
  it('labels a span in hours and minutes, spelled out for a screen reader', () => {
    expect(formatDuration(15)).toBe('15 min');
    expect(formatDuration(60)).toBe('1 hr');
    expect(formatDuration(90)).toBe('1 hr 30 min');
    expect(formatDuration(23 * 60 + 45)).toBe('23 hr 45 min');
    expect(formatDuration(1, { long: true })).toBe('1 minute');
    expect(formatDuration(60, { long: true })).toBe('1 hour');
    expect(formatDuration(2 * 60 + 5, { long: true })).toBe('2 hours 5 minutes');
  });
});

describe('time field — choices after a start time', () => {
  const span = (opt) => opt.querySelector('.time-field__duration')?.textContent ?? null;

  it('runs from the first slot after `after` around the clock, each labeled with its span', () => {
    const { field, input, options, highlighted } = mount({ label: 'End time', after: '09:00' });
    field.value = '10:00';
    fire(input, 'focus');
    const shown = options();
    // 9:00 itself would make an empty span: it is not on offer.
    expect(shown).toHaveLength(95);
    expect(shown.some((o) => o.dataset.min === String(9 * 60))).toBe(false);
    expect(shown[0].dataset.min).toBe(String(9 * 60 + 15));
    expect(shown[0].firstChild.textContent).toBe('9:15 AM');
    expect(span(shown[0])).toBe('15 min');
    expect(shown[0].getAttribute('aria-label')).toBe('9:15 AM, 15 minutes');
    expect(highlighted()).toBe(shown[3]);
    expect(highlighted().dataset.min).toBe(String(10 * 60));
    expect(span(highlighted())).toBe('1 hr');
    expect(input.getAttribute('aria-activedescendant')).toBe(highlighted().id);
    // Past midnight the list keeps going, so the next morning comes last —
    // after 11:45 PM, not before the start.
    const midnight = shown.find((o) => o.dataset.min === '0');
    expect(shown.indexOf(midnight)).toBe(59);
    expect(span(midnight)).toBe('15 hr');
    expect(shown[94].dataset.min).toBe(String(8 * 60 + 45));
    expect(span(shown[94])).toBe('23 hr 45 min');
    expect(shown[94].getAttribute('aria-label')).toBe('8:45 AM, 23 hours 45 minutes');
  });

  it('keeps every slot when `after` is off the grid', () => {
    const { input, options } = mount({ after: '09:07' });
    fire(input, 'focus');
    const shown = options();
    expect(shown).toHaveLength(96);
    expect(shown[0].dataset.min).toBe(String(9 * 60 + 15));
    expect(span(shown[0])).toBe('8 min');
    expect(shown[95].dataset.min).toBe(String(9 * 60));
    expect(span(shown[95])).toBe('23 hr 53 min');
  });

  it('steps and picks in list order, across midnight, clamped at both ends', () => {
    const { field, input, highlighted } = mount({ after: '22:00' });
    field.value = '23:45';
    key(input, 'ArrowDown');
    expect(highlighted().dataset.min).toBe('0');
    expect(span(highlighted())).toBe('2 hr');
    key(input, 'ArrowUp');
    expect(highlighted().dataset.min).toBe(String(23 * 60 + 45));
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(field.value).toBe('00:00');
    expect(input.value).toBe('12:00 AM');
    // The first choice after the start is the top of the list...
    field.value = '22:15';
    fire(input, 'blur');
    key(input, 'ArrowUp');
    expect(highlighted().dataset.min).toBe(String(22 * 60 + 15));
    // ...and the last slot before it is the bottom.
    field.value = '21:45';
    fire(input, 'blur');
    key(input, 'ArrowDown');
    expect(highlighted().dataset.min).toBe(String(21 * 60 + 45));
  });

  it('follows typed text in list order', () => {
    const { field, input, highlighted } = mount({ after: '09:00' });
    field.value = '10:00';
    fire(input, 'focus');
    input.value = '8';
    fire(input, 'input');
    expect(highlighted().dataset.min).toBe(String(8 * 60));
    expect(span(highlighted())).toBe('23 hr');
    // The start itself is not a choice, so nothing lights up for it.
    input.value = '9';
    fire(input, 'input');
    expect(highlighted()).toBe(null);
    // From just after the start, Down lands on the first choice.
    input.value = '9:07';
    fire(input, 'input');
    expect(highlighted()).toBe(null);
    key(input, 'ArrowDown');
    expect(highlighted().dataset.min).toBe(String(9 * 60 + 15));
  });

  it('picks a next-morning choice by click or hover like any other', () => {
    const { field, input, options, highlighted } = mount({ after: '22:00' });
    field.value = '23:00';
    const onChange = vi.fn();
    field.addEventListener('change', onChange);
    fire(input, 'focus');
    const one = options().find((o) => o.dataset.min === String(60));
    one.dispatchEvent(new Event('pointermove', { bubbles: true }));
    expect(highlighted()).toBe(one);
    one.click();
    expect(field.value).toBe('01:00');
    expect(input.value).toBe('1:00 AM');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('re-reads a live `after` on each open, and is a plain list without one', () => {
    let after = '09:00';
    const { field, input, options, highlighted } = mount({ after: () => after });
    field.value = '10:00';
    fire(input, 'focus');
    expect(options()).toHaveLength(95);
    fire(input, 'blur');

    after = '';
    fire(input, 'focus');
    const shown = options();
    expect(shown).toHaveLength(96);
    expect(shown[0].dataset.min).toBe('0');
    expect(shown[0].textContent).toBe('12:00 AM');
    expect(shown[0].hasAttribute('aria-label')).toBe(false);
    expect(span(shown[0])).toBe(null);
    expect(highlighted().dataset.min).toBe(String(10 * 60));
    expect(highlighted().textContent).toBe('10:00 AM');
    fire(input, 'blur');

    after = '13:00';
    fire(input, 'focus');
    expect(options()[0].dataset.min).toBe(String(13 * 60 + 15));
    expect(options()[0].getAttribute('aria-label')).toBe('1:15 PM, 15 minutes');
    // The field's own 10:00 is still a choice — now as the next morning.
    expect(highlighted().dataset.min).toBe(String(10 * 60));
    expect(span(highlighted())).toBe('21 hr');
    expect(options().indexOf(highlighted())).toBe(83);
  });
});
