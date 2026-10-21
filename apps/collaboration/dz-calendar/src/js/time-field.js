/**
 * Time field — a text box with a dropdown of quarter-hour choices that opens
 * scrolled to, and highlighting, the field's own time. Adjusting a 9:30 start
 * to 10:00 is then a glance and a click, not a scroll down from midnight.
 *
 * Why not <input type="time"> + <datalist>: Chrome renders a datalist top-down
 * with no notion of the current value and offers no way to scroll or highlight
 * it, so the dropdown always opened on 00:00 (and it ignores `step` besides,
 * crbug.com/40705754). This replaces the picker on pointer devices only: on a
 * touch screen the platform's own wheel/dial already opens on the current time
 * and ignores datalists anyway, so the native input stays there.
 *
 * Whichever control it holds, the field speaks "HH:MM" (24h) on `value` like a
 * native time input and fires `change` when the user commits a different time,
 * so callers never need to know which one they got. Typing stays free-form —
 * "9", "930", "9:30p", "21:30" all land — and an off-grid time (an imported
 * 9:07) is shown and kept as typed, never snapped to the 15-minute list.
 *
 * An end field can be told what it follows (`after`: the start time). Its
 * list then runs from the first slot after that time around the clock, each
 * choice labeled with the span it makes ("10:00 AM  1 hr"), so the times past
 * midnight sit at the bottom and read as the next morning (a 10 PM – 1 AM
 * party) instead of as times before the start. A slot equal to `after` is no
 * choice at all and is left out. Still choices, not constraints: any time can
 * be typed, and the caller decides what an earlier one means.
 */
import { el } from './dom.js';

const DEFAULT_STEP = 15;
const MINUTES_PER_DAY = 24 * 60;
/** Rows of earlier times kept visible above the anchored slot when the list
 *  opens, so "a little earlier" is on screen as well as "a little later". */
const CONTEXT_ROWS = 2;

let seq = 0;

/** Touch-first devices: the platform's own time picker is the better control. */
export function prefersNativeTimePicker() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

/** Does an Escape aimed at `target` belong to it rather than to the dialog
 *  around it? True for a combobox whose popup is open — the field closes its
 *  list; the dialog stays. For the dialogs' document-level capture handlers,
 *  which run before the field's own and so can't be stopped by it. */
export function ownsEscape(target) {
  return Boolean(
    target && typeof target.getAttribute === 'function' && target.getAttribute('aria-expanded') === 'true',
  );
}

/**
 * Free-form time text → minutes since midnight, or null when it isn't a time.
 * Accepts 24h ("9", "09:30", "21:30", "2130") and 12h ("9a", "9:30 pm",
 * "930p", "9 a.m."), a dot as the separator, and "noon" / "midnight". A bare
 * hour with no suffix reads as 24h — "2" is 2:00 AM, as in Google Calendar.
 */
export function parseTimeText(raw) {
  // Only the gap before an am/pm suffix is optional ("9 pm"); anywhere else a
  // space means it isn't one time ("1 2" is not 12).
  let s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+(?=[ap])/g, '');
  if (!s) return null;
  if (s === 'noon') return 12 * 60;
  if (s === 'midnight') return 0;
  // "9.30" → "9:30"; then any dots left belong to "a.m." / "p.m.".
  s = s.replace(/(\d)\.(\d)/g, '$1:$2').replace(/\./g, '');
  const m = /^(\d{1,2})(?::(\d{1,2}))?(am?|pm?)?$/.exec(s) || /^(\d{1,2})(\d{2})(am?|pm?)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3][0] === 'p' ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return h * 60 + min;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** Minutes since midnight → what the field shows: "9:30 AM" or "09:30". Always
 *  with minutes (unlike the calendar's "9 AM" labels) so an edit can start
 *  from the digits that are there. */
export function formatTimeText(minutes, hour12 = true) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!hour12) return `${pad2(h)}:${pad2(m)}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A span in minutes as the list labels it — "15 min", "1 hr", "1 hr 30 min" —
 *  or spelled out ("1 hour 30 minutes") for a screen reader, which would
 *  otherwise read the abbreviations letter by letter. */
export function formatDuration(minutes, { long = false } = {}) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [];
  if (h) parts.push(long ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${h} hr`);
  if (m || !h) parts.push(long ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : `${m} min`);
  return parts.join(' ');
}

/** "HH:MM" → minutes, or null. Only the wire format: free-form text goes
 *  through parseTimeText, the way a native input's `value` setter takes only
 *  a well-formed time and treats anything else as empty. */
function minutesFromValue(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function valueFromMinutes(minutes) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

class TimeField extends EventTarget {
  /**
   * @param {object} opts
   * @param {string} opts.label       accessible name of the field
   * @param {boolean|() => boolean} [opts.hour12]  12-hour display; a function
   *        is re-read whenever the field renders, so a settings change shows
   *        up the next time the field is opened
   * @param {number} [opts.step]      minutes between dropdown choices
   * @param {string|() => string} [opts.after]  "HH:MM" the choices follow (an
   *        end field's start time): the list runs from the first slot after it
   *        around the clock, each choice labeled with its span from it, and
   *        the slot equal to it is left out. '' or null for a plain list. A
   *        function is re-read whenever the list opens. Ignored by the native
   *        input, which has no list.
   * @param {string} [opts.className] extra classes for the root element
   * @param {boolean} [opts.native]   force the native <input type="time">
   *        (default: only on coarse-pointer devices)
   */
  constructor({
    label,
    hour12 = true,
    step = DEFAULT_STEP,
    after = null,
    className = '',
    native = prefersNativeTimePicker(),
  } = {}) {
    super();
    this._hour12 = hour12;
    this._after = after;
    this._step = step;
    this._native = native;
    this._minutes = null;
    this.el = el('div', { class: `time-field${className ? ` ${className}` : ''}` });
    if (native) this._buildNative(label);
    else this._buildCombobox(label);
    this._render();
  }

  /** "HH:MM" (24h), or '' when the field holds no time. Text typed but not yet
   *  committed counts, as it does for a native input, so a save fired from the
   *  keyboard while still in the field takes the time on screen; text that
   *  isn't a time falls back to the last committed time. */
  get value() {
    if (this._native) return this.input.value;
    const minutes = parseTimeText(this.input.value) ?? this._minutes;
    return minutes == null ? '' : valueFromMinutes(minutes);
  }
  set value(v) {
    if (this._native) {
      this.input.value = v ?? '';
    } else {
      this._minutes = minutesFromValue(v);
    }
    this._render();
  }

  get hidden() {
    return this.el.hidden;
  }
  set hidden(v) {
    this.el.hidden = Boolean(v);
  }

  focus() {
    this.input.focus();
  }

  /* ---- native (touch) ------------------------------------------------ */

  _buildNative(label) {
    this.input = el('input', { class: 'input time-field__input', type: 'time', 'aria-label': label });
    this.input.addEventListener('change', () => {
      this._render();
      this.dispatchEvent(new Event('change'));
    });
    this.el.append(this.input);
  }

  /* ---- combobox (pointer) -------------------------------------------- */

  _buildCombobox(label) {
    const listId = `time-field-list-${++seq}`;
    this.input = el('input', {
      class: 'input time-field__input',
      type: 'text',
      role: 'combobox',
      autocomplete: 'off',
      'aria-label': label,
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-autocomplete': 'none',
      'aria-controls': listId,
    });
    this.input.setAttribute('spellcheck', 'false');
    this.list = el('div', {
      class: 'time-field__list',
      id: listId,
      role: 'listbox',
      hidden: true,
      'aria-label': label ? `${label} choices` : 'Time choices',
    });
    this.options = [];
    for (let min = 0; min < MINUTES_PER_DAY; min += this._step) {
      const i = this.options.length;
      const opt = el('div', {
        class: 'time-field__option',
        role: 'option',
        id: `${listId}-${i}`,
        'aria-selected': 'false',
        dataset: { min: String(min) },
      });
      opt.addEventListener('click', () => {
        this._commitMinutes(min);
        this._close();
      });
      opt.addEventListener('pointermove', () => {
        const pos = this._posOf[i];
        if (pos >= 0 && this._active !== pos) this._setActive(pos, { reveal: false });
      });
      this.options.push(opt);
      this.list.append(opt);
    }
    // The list as shown: slot indices in display order (rotated to start after
    // `after`, when set), and each slot's position in it (-1: left out). The
    // highlight is a position in this order, not a slot.
    this._order = this.options.map((_, i) => i);
    this._posOf = this._order.slice();
    this._afterMinutes = null;
    this._layoutKey = null; // hour12 + after the options were last laid out for
    this._active = -1;

    // The list floats in the top layer where the browser has one: a dialog
    // body that scrolls (both editors' do) would otherwise clip a list hanging
    // off a field near its bottom edge. It is positioned from the input's
    // rect on open and follows it while anything scrolls. Without the Popover
    // API the list falls back to hanging inside the wrapper (see the CSS).
    this._floats = typeof this.list.showPopover === 'function';
    if (this._floats) this.list.setAttribute('popover', 'manual');
    this._reposition = (e) => {
      if (e && e.target === this.list) return; // the list's own scrolling
      if (!this.el.isConnected) this._close();
      else this._position();
    };

    // Pressing inside the list must not take focus off the input: that blur
    // would close the list under the pointer before the click could land.
    this.list.addEventListener('pointerdown', (e) => e.preventDefault());

    // Focus opens the list on the field's own time and selects the text, so
    // typing replaces rather than appends. The mouseup that follows a click's
    // focus would collapse that selection to a caret; swallow it once.
    let selectOnMouseUp = false;
    this.input.addEventListener('focus', () => {
      this.input.select();
      selectOnMouseUp = true;
      this._open();
    });
    this.input.addEventListener('mouseup', (e) => {
      if (selectOnMouseUp) e.preventDefault();
      selectOnMouseUp = false;
    });
    // A click on an already-focused field (say after Escape) reopens the list.
    this.input.addEventListener('click', () => this._open());
    // The list follows what is being typed: an exact quarter-hour highlights,
    // anything else just scrolls the list to the nearest earlier slot.
    this.input.addEventListener('input', () => {
      this._open();
      this._showMinutes(parseTimeText(this.input.value));
    });
    this.input.addEventListener('keydown', (e) => this._onKeydown(e));
    // The native change (Enter, or leaving the field with edits) is the
    // commit of typed text; blur then closes the list either way.
    this.input.addEventListener('change', () => this._commitText());
    this.input.addEventListener('blur', () => {
      this._close();
      this._render();
    });

    this.el.append(this.input, this.list);
  }

  _resolveHour12() {
    return typeof this._hour12 === 'function' ? Boolean(this._hour12()) : Boolean(this._hour12);
  }

  _render() {
    if (!this._native) {
      this.input.value = this._minutes == null ? '' : formatTimeText(this._minutes, this._resolveHour12());
    }
    this.el.dataset.value = this.value;
  }

  _resolveAfter() {
    return minutesFromValue(typeof this._after === 'function' ? this._after() : this._after);
  }

  /** Where a time sits in list order: minutes since midnight for a plain list;
   *  with `after`, minutes forward from it around the clock, so 01:00 is 180
   *  after 22:00 and comes after 23:45, not before 22:15. */
  _offset(minutes) {
    if (this._afterMinutes == null) return minutes;
    return (minutes - this._afterMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  }

  /** Position of the last choice at or before `minutes` in list order, or -1
   *  when every choice comes after it. */
  _positionAtOrBefore(minutes) {
    const target = this._offset(minutes);
    let pos = -1;
    for (let i = 0; i < this._order.length && this._offset(this._order[i] * this._step) <= target; i++) pos = i;
    return pos;
  }

  /** Lay the options out for the current hour12 and `after`: their order,
   *  labels and which are shown. A no-op while neither has changed. */
  _layout() {
    const hour12 = this._resolveHour12();
    const after = this._resolveAfter();
    const key = `${hour12}|${after}`;
    if (key === this._layoutKey) return;
    this._setActive(-1);
    this._layoutKey = key;
    this._afterMinutes = after;
    const slots = this.options.map((_, i) => i);
    if (after == null) {
      this._order = slots;
    } else {
      // From the first slot after `after` around the clock. The slot equal to
      // it would make an empty span, so it is not offered at all.
      this._order = slots
        .filter((i) => i * this._step !== after)
        .sort((a, b) => this._offset(a * this._step) - this._offset(b * this._step));
    }
    this._posOf = slots.map(() => -1);
    this._order.forEach((slot, pos) => (this._posOf[slot] = pos));
    for (const slot of this._order) {
      const opt = this.options[slot];
      const min = slot * this._step;
      const time = formatTimeText(min, hour12);
      opt.textContent = time;
      if (after == null) {
        opt.removeAttribute('aria-label');
      } else {
        const span = this._offset(min);
        opt.append(el('span', { class: 'time-field__duration', text: formatDuration(span) }));
        opt.setAttribute('aria-label', `${time}, ${formatDuration(span, { long: true })}`);
      }
    }
    this.list.replaceChildren(...this._order.map((slot) => this.options[slot]));
  }

  _open() {
    if (!this.list.hidden) return;
    this._layout();
    this.list.hidden = false;
    if (this._floats) {
      this.list.showPopover();
      this._position();
      document.addEventListener('scroll', this._reposition, true);
      window.addEventListener('resize', this._reposition);
    }
    this.input.setAttribute('aria-expanded', 'true');
    this._showMinutes(this._minutes);
  }

  _close() {
    if (this.list.hidden) return;
    this.list.hidden = true;
    if (this._floats) {
      if (this.list.matches(':popover-open')) this.list.hidePopover();
      document.removeEventListener('scroll', this._reposition, true);
      window.removeEventListener('resize', this._reposition);
    }
    this.input.setAttribute('aria-expanded', 'false');
    this._setActive(-1);
  }

  /** Place the floating list under the input — or above it when the viewport
   *  has more room there — at least as wide as the input, and wider when the
   *  choices' span labels need it, kept inside the viewport. */
  _position() {
    const r = this.input.getBoundingClientRect();
    const gap = 4;
    this.list.style.minWidth = `${r.width}px`;
    // Room for the widest choice beside the vertical scrollbar, which sits
    // inside the box and would otherwise cover the end of the label.
    const need = this.list.scrollWidth + (this.list.offsetWidth - this.list.clientWidth);
    if (need > this.list.offsetWidth) this.list.style.minWidth = `${need}px`;
    const width = this.list.offsetWidth;
    const height = this.list.offsetHeight;
    const roomBelow = window.innerHeight - r.bottom - gap;
    const flip = roomBelow < height && r.top - gap > roomBelow;
    this.list.style.left = `${Math.max(0, Math.min(r.left, window.innerWidth - gap - width))}px`;
    this.list.style.top = `${flip ? r.top - gap - height : r.bottom + gap}px`;
  }

  /** Point the open list at a time: its slot highlighted when it is one of the
   *  choices, and the list scrolled so the nearest earlier slot sits a couple
   *  of rows down. With no time at all, the list opens around right now. */
  _showMinutes(minutes) {
    const anchor = minutes == null ? nowMinutes() : minutes;
    const anchorOpt = this.options[this._order[Math.max(0, this._positionAtOrBefore(anchor))]];
    this.list.scrollTop = Math.max(0, anchorOpt.offsetTop - CONTEXT_ROWS * anchorOpt.offsetHeight);
    const exact = minutes != null && minutes % this._step === 0 ? this._posOf[minutes / this._step] : -1;
    this._setActive(exact, { reveal: false });
  }

  /** Highlight the choice at position `i` in list order (-1: none). */
  _setActive(i, { reveal = true } = {}) {
    if (this._active >= 0) this.options[this._order[this._active]].setAttribute('aria-selected', 'false');
    this._active = i;
    if (i < 0) {
      this.input.removeAttribute('aria-activedescendant');
      return;
    }
    const opt = this.options[this._order[i]];
    opt.setAttribute('aria-selected', 'true');
    this.input.setAttribute('aria-activedescendant', opt.id);
    if (reveal) this._reveal(opt);
  }

  /** Scroll the list just enough to bring an option fully into view. */
  _reveal(opt) {
    const top = opt.offsetTop;
    const bottom = top + opt.offsetHeight;
    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (bottom > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = bottom - this.list.clientHeight;
  }

  /** Move the highlight one slot; from an off-grid time (or none), Down goes to
   *  the next slot after it and Up to the one before, so 9:07 steps to 9:15 or
   *  9:00 rather than skipping a quarter hour. */
  _move(dir) {
    this._open();
    let next;
    if (this._active >= 0) {
      next = this._active + dir;
    } else {
      const typed = parseTimeText(this.input.value);
      const from = typed ?? this._minutes ?? nowMinutes();
      const at = this._positionAtOrBefore(from);
      const exact = at >= 0 && this._offset(this._order[at] * this._step) === this._offset(from);
      next = dir > 0 && !exact ? at + 1 : at;
    }
    this._setActive(Math.max(0, Math.min(this._order.length - 1, next)));
  }

  _onKeydown(e) {
    // Mid-IME composition the keys belong to the input method's own candidate
    // list. (keyCode 229 covers engines that don't set isComposing.)
    if (e.isComposing || e.keyCode === 229) return;
    const open = !this.list.hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this._move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      if (!open) {
        // Closed list: commit what was typed and let the form's own Enter
        // handling (submit) proceed.
        this._commitText();
        return;
      }
      // Open list: Enter picks — it must not also submit the form.
      e.preventDefault();
      if (this._active >= 0) this._commitMinutes(this._order[this._active] * this._step);
      else this._commitText();
      this._close();
    } else if (e.key === 'Escape' && open) {
      // Ours, not the dialog's: drop any half-typed text and close the list
      // only. (The dialogs' document-level Escape handlers defer to an
      // expanded combobox for the same reason.)
      e.preventDefault();
      e.stopPropagation();
      this._render();
      this._close();
    }
  }

  /** Commit the text as typed: a time lands, anything else reverts to the
   *  last committed time rather than leaving the field lying. */
  _commitText() {
    const min = parseTimeText(this.input.value);
    if (min == null) this._render();
    else this._commitMinutes(min);
  }

  _commitMinutes(minutes) {
    const changed = minutes !== this._minutes;
    this._minutes = minutes;
    this._render();
    if (changed) this.dispatchEvent(new Event('change'));
  }
}

export function createTimeField(opts) {
  return new TimeField(opts);
}
