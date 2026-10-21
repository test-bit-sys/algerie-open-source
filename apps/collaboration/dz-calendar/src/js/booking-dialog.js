/**
 * Booking link editor — the host's side of a booking page (see booking.js for
 * the data/sync side, public/book.html for what guests see).
 *
 * One dialog covers create and edit: what the meeting is (title, duration,
 * location, description, color), when it can be booked (weekly hours with
 * multiple intervals per day, a rolling window, minimum notice, buffers, a
 * per-day cap, the time zone the hours are written in), and the share link
 * itself. Follows the app's other dialogs: mounted on a focus-trapping scrim
 * (mountDialog), closes on Escape/backdrop, resolves through callbacks.
 */
import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { mountDialog } from './recurrence-dialog.js';
import { EVENT_COLORS, categoryLabel } from './colors.js';
import { isBlocked } from './offline.js';
import { track } from './analytics.js';
import { requestUserEmail } from './auth.js';
import { BOOKING_DURATIONS, defaultHours, DISPLAY_NAME_MAX } from './booking.js';
import { fetchSharePicture } from './profile.js';
import {
  orderedWeekdays,
  WEEKDAYS_LONG,
  tzPickerGroups,
  tzOffsetLabel,
} from './date-utils.js';
import { createTimeField } from './time-field.js';

const MIN_NOTICE_CHOICES = [
  [0, 'No minimum'],
  [60, '1 hour'],
  [120, '2 hours'],
  [240, '4 hours'],
  [720, '12 hours'],
  [1440, '1 day'],
  [2880, '2 days'],
];

const ADVANCE_CHOICES = [
  [7, '1 week'],
  [14, '2 weeks'],
  [30, '30 days'],
  [60, '60 days'],
  [90, '90 days'],
];

const BUFFER_CHOICES = [0, 5, 10, 15, 30, 45, 60];
const PER_DAY_CHOICES = [0, 1, 2, 3, 4, 5, 6, 8, 10];
const INCREMENT_CHOICES = [
  ['', 'Same as duration'],
  ['10', '10 minutes'],
  ['15', '15 minutes'],
  ['20', '20 minutes'],
  ['30', '30 minutes'],
  ['60', '1 hour'],
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function minutesToTimeValue(min) {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

function timeValueToMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return NaN;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= 0 && minutes < 1440 ? minutes : NaN;
}

function describeDuration(min) {
  if (min % 60 === 0) {
    const h = min / 60;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return `${min} minutes`;
}

/** A labeled <select> from [value, label] pairs; keeps an off-list current
 *  value visible rather than silently showing the first option. */
function buildSelect(ariaLabel, choices, current) {
  const select = el('select', { class: 'select', 'aria-label': ariaLabel });
  const values = choices.map(([v]) => String(v));
  if (current != null && !values.includes(String(current))) {
    select.append(el('option', { value: String(current), text: String(current), selected: true }));
  }
  for (const [value, label] of choices) {
    const opt = el('option', { value: String(value), text: label });
    if (String(value) === String(current)) opt.selected = true;
    select.append(opt);
  }
  return select;
}

function buildTzSelect(current) {
  const select = el('select', { class: 'select', 'aria-label': 'Availability time zone' });
  select.append(el('option', { value: 'UTC', text: 'UTC', selected: current === 'UTC' }));
  tzPickerGroups(current).forEach(({ label, zones }) => {
    select.append(
      el(
        'optgroup',
        { label },
        zones.map((z) =>
          el('option', {
            value: z.id,
            text: `${z.city} (${tzOffsetLabel(z.offset)})`,
            selected: z.id === current,
          }),
        ),
      ),
    );
  });
  return select;
}

export function openBookingEditor({
  booking,
  store,
  user = null,
  page = null,
  onDone,
  requestEmail = requestUserEmail,
  readPicture = fetchSharePicture,
} = {}) {
  if (isBlocked()) {
    toast("You're offline — reconnect to change booking links");
    return null;
  }
  // The worker emails the host about new bookings and cancellations only if
  // the sync can push their address — and getUser() withholds it until the
  // one-time email-read grant. Opening the editor is the deliberate moment to
  // ask (the same lazy pattern as the event modal's guest field); the grant
  // persists, the next sync pass picks the address up, and a denial simply
  // means no host emails — bookings themselves are unaffected.
  Promise.resolve()
    .then(() => requestEmail())
    .then((email) => {
      // A grant that just landed should reach the worker now, not at the next
      // poll — a refresh pass re-reads getUser() and re-pushes the config
      // (digest-gated, so it's a no-op when nothing changed).
      if (email && booking && typeof booking.refresh === 'function') booking.refresh();
    })
    .catch(() => {});
  const editing = Boolean(page);
  const settings = store.getSettings();

  // Deep-copied working state for the hours editor.
  const hours = {};
  const source = page ? page.hours : defaultHours();
  for (let day = 0; day < 7; day++) {
    const list = (source && (source[day] || source[String(day)])) || [];
    hours[day] = list.map((iv) => ({ start: iv.start, end: iv.end }));
  }

  let color = (page && page.color) || 'blue';

  /* ---- What the meeting is ---------------------------------------------- */

  const titleInput = el('input', {
    class: 'input input--title',
    type: 'text',
    placeholder: '30 minute meeting',
    autocomplete: 'off',
    'aria-label': 'Booking link name',
    value: (page && page.title) || '',
  });
  const durationSelect = buildSelect(
    'Duration',
    BOOKING_DURATIONS.map((min) => [min, describeDuration(min)]),
    (page && page.durationMin) || 30,
  );
  const locationInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Add a place or call link (shared once booked)',
    autocomplete: 'off',
    'aria-label': 'Location',
    value: (page && page.location) || '',
  });
  const descInput = el('textarea', {
    class: 'textarea',
    rows: '2',
    placeholder: 'Shown on your booking page',
    'aria-label': 'Description',
    value: (page && page.description) || '',
  });

  const swatches = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Event color' });
  EVENT_COLORS.forEach((c) => {
    // The user's category name, the same one the sidebar and the event editor
    // show for this color.
    const label = categoryLabel(c.key, settings.categoryNames);
    const sw = el('button', {
      class: 'swatch',
      type: 'button',
      role: 'radio',
      title: label,
      'aria-label': label,
      style: { background: c.hex, '--swatch-color': c.hex },
      on: {
        click: () => {
          color = c.key;
          syncSwatches();
        },
      },
    });
    sw.dataset.color = c.key;
    swatches.append(sw);
  });
  function syncSwatches() {
    swatches.querySelectorAll('.swatch').forEach((sw) => {
      sw.setAttribute('aria-checked', String(sw.dataset.color === color));
    });
  }
  syncSwatches();

  /* ---- Weekly hours ------------------------------------------------------ */

  const errorEl = el('div', {
    class: 'field__label modal__error',
    style: { color: 'var(--danger-ink)', display: 'none' },
    role: 'alert',
  });
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = msg ? 'block' : 'none';
    // The dialog is tall enough to scroll on a laptop, and this element sits
    // mid-form — without this, a failed save can render its message entirely
    // outside the body's viewport and the submit looks like a dead button.
    // (Guarded: jsdom has no scrollIntoView.)
    if (msg && typeof errorEl.scrollIntoView === 'function') {
      errorEl.scrollIntoView({ block: 'nearest' });
    }
  }

  const hoursWrap = el('div', { class: 'bk-hours', role: 'group', 'aria-label': 'Weekly hours' });

  function renderHours() {
    clear(hoursWrap);
    orderedWeekdays(settings.weekStartsOn).forEach((day) => {
      const on = hours[day].length > 0;
      const dayToggle = el('input', {
        type: 'checkbox',
        role: 'switch',
        checked: on,
        'aria-label': `Available on ${WEEKDAYS_LONG[day]}`,
        on: {
          change: (e) => {
            hours[day] = e.target.checked ? [{ start: 9 * 60, end: 17 * 60 }] : [];
            renderHours();
          },
        },
      });
      const head = el('label', { class: 'bk-day__head' }, [
        el('span', { class: 'switch' }, [
          dayToggle,
          el('span', { class: 'switch__track' }),
          el('span', { class: 'switch__thumb' }),
        ]),
        el('span', { class: 'bk-day__name', text: WEEKDAYS_LONG[day] }),
      ]);

      const body = el('div', { class: 'bk-day__body' });
      if (!on) {
        body.append(el('span', { class: 'bk-day__off', text: 'Unavailable' }));
      }
      hours[day].forEach((iv, i) => {
        // The time fields open their 15-minute list on the time they hold (see
        // time-field.js); the 23:59 rendering of a midnight end stays as-is.
        // On touch devices the field is a native time input, which commits ''
        // for a cleared or half-typed value. Keeping the old minute silently
        // would leave the field showing blank while the page saved 09:00 —
        // put the value the interval actually holds back on screen instead,
        // so the field never lies about it.
        const commit = (edge, field, shown) => {
          const min = timeValueToMinutes(field.value);
          if (Number.isFinite(min)) iv[edge] = min;
          else field.value = shown();
        };
        const startShown = () => minutesToTimeValue(iv.start);
        const endShown = () => minutesToTimeValue(iv.end === 1440 ? 1439 : iv.end);
        const startField = createTimeField({
          label: `${WEEKDAYS_LONG[day]} start time`,
          hour12: settings.hour12,
          className: 'bk-time',
        });
        startField.value = startShown();
        startField.addEventListener('change', () => commit('start', startField, startShown));
        const endField = createTimeField({
          label: `${WEEKDAYS_LONG[day]} end time`,
          hour12: settings.hour12,
          className: 'bk-time',
        });
        endField.value = endShown();
        endField.addEventListener('change', () => commit('end', endField, endShown));
        const remove = el('button', {
          class: 'icon-btn reminders__remove',
          type: 'button',
          'aria-label': `Remove ${WEEKDAYS_LONG[day]} interval`,
          title: 'Remove interval',
          html: icon('close', { size: 'sm' }),
          on: {
            click: () => {
              hours[day].splice(i, 1);
              renderHours();
            },
          },
        });
        body.append(
          el('div', { class: 'bk-interval' }, [
            startField.el,
            el('span', { class: 'bk-interval__dash', text: '–' }),
            endField.el,
            remove,
          ]),
        );
      });
      // Another interval needs room left in the day AFTER the last one: seeded
      // on or inside it, normalizeHours would fuse the pair back together and
      // the row the host just added would be gone by the time they reopened
      // the editor. (The old seed did exactly that on any day ending at 22:00
      // or later.) Read live at click time, not from this render: editing a
      // time doesn't rebuild the row, so a value typed since would be missed.
      const roomAfter = (list) => (list.length ? 1440 - list[list.length - 1].end : 1440);
      if (on && hours[day].length < 6 && roomAfter(hours[day]) > 15) {
        body.append(
          el('button', {
            class: 'btn btn--ghost bk-day__add',
            type: 'button',
            html: icon('plus', { size: 'sm' }) + '<span>Add interval</span>',
            on: {
              click: () => {
                // The day may have filled up since this button was drawn — the
                // re-render then simply takes it away.
                if (roomAfter(hours[day]) <= 15) return renderHours();
                // An hour's gap after the last block, pulled back only as far
                // as the day allows — never onto or inside it.
                const start = Math.min(hours[day][hours[day].length - 1].end + 60, 1440 - 15);
                hours[day].push({ start, end: Math.min(start + 60, 1440) });
                renderHours();
              },
            },
          }),
        );
      }
      hoursWrap.append(el('div', { class: 'bk-day' }, [head, body]));
    });
  }
  renderHours();

  /* ---- Scheduling rules --------------------------------------------------- */

  const advanceSelect = buildSelect('How far ahead people can book', ADVANCE_CHOICES, (page && page.maxAdvanceDays) || 60);
  const noticeSelect = buildSelect('Minimum notice', MIN_NOTICE_CHOICES, page ? page.minNoticeMin : 120);
  const bufferBeforeSelect = buildSelect(
    'Buffer before',
    BUFFER_CHOICES.map((min) => [min, min === 0 ? 'None' : `${min} min`]),
    (page && page.bufferBeforeMin) || 0,
  );
  const bufferAfterSelect = buildSelect(
    'Buffer after',
    BUFFER_CHOICES.map((min) => [min, min === 0 ? 'None' : `${min} min`]),
    (page && page.bufferAfterMin) || 0,
  );
  const perDaySelect = buildSelect(
    'Maximum bookings per day',
    PER_DAY_CHOICES.map((n) => [n, n === 0 ? 'No limit' : String(n)]),
    (page && page.maxPerDay) || 0,
  );
  const incrementSelect = buildSelect(
    'Start time increments',
    INCREMENT_CHOICES,
    page && page.incrementMin !== page.durationMin ? String(page.incrementMin) : '',
  );
  const tzSelect = buildTzSelect((page && page.tz) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

  /* ---- Accepting bookings + share ------------------------------------------ */

  const enabledToggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    checked: page ? page.enabled !== false : true,
  });
  const enabledRow = el('label', { class: 'inline-field', style: { cursor: 'pointer' } }, [
    el('span', { class: 'field__label', text: 'Accepting bookings' }),
    el('span', { class: 'switch' }, [
      enabledToggle,
      el('span', { class: 'switch__track' }),
      el('span', { class: 'switch__thumb' }),
    ]),
  ]);

  // Each booking gets its own Puter Meetings room, minted by the worker at
  // booking time and carried through the guest's confirmation, the .ics, and
  // the calendar event. On by default — an in-person page turns it off.
  const meetToggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    checked: page ? page.meet !== false : true,
  });
  const meetRow = el('label', { class: 'inline-field', style: { cursor: 'pointer' } }, [
    el('span', { class: 'field__label', text: 'Puter Meetings link' }),
    el('span', { class: 'switch' }, [
      meetToggle,
      el('span', { class: 'switch__track' }),
      el('span', { class: 'switch__thumb' }),
    ]),
  ]);

  /* ---- The host's picture -------------------------------------------------- */

  // Whether guests see the host's Puter profile picture at the top of the page.
  // ON for a new page — a face is what a booking page normally leads with, and
  // the switch is right here to be turned off — but a page saved before this
  // existed stays as its host left it (normalizePage reads absent as OFF): the
  // page's link is already out there, and quietly adding the host's face to it
  // is not an upgrade to make on their behalf.
  const avatarToggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    checked: page ? page.avatar === true : true,
  });
  // Filled in once we know what (if anything) there is to publish, so the host
  // sees the picture guests will get rather than trusting a switch.
  const avatarPreview = el('span', { class: 'bk-avatar' });
  const avatarNote = el('span', { class: 'bk-hint' });
  const avatarRow = el('label', { class: 'inline-field', style: { cursor: 'pointer' } }, [
    el('span', { class: 'field__label', text: 'Profile picture' }),
    el('span', { class: 'bk-avatar-row' }, [
      el('span', { class: 'switch' }, [
        avatarToggle,
        el('span', { class: 'switch__track' }),
        el('span', { class: 'switch__thumb' }),
      ]),
      avatarPreview,
      avatarNote,
    ]),
  ]);
  // Strictly decoration on a switch that works either way: a read that fails,
  // or a browser that can't shrink the picture for publishing, leaves the row
  // exactly as it started rather than claiming there is no picture.
  Promise.resolve()
    .then(() => readPicture(user))
    .then((res) => {
      if (!res || !avatarRow.isConnected) return;
      if (res.state === 'found') {
        const img = el('img', { class: 'bk-avatar__img', alt: '', draggable: false });
        img.addEventListener('error', () => img.remove(), { once: true });
        img.src = res.picture;
        avatarPreview.replaceChildren(img);
      } else if (res.state === 'none') {
        avatarNote.textContent = 'No picture is available from your Puter account';
      }
    })
    .catch(() => {});

  /* ---- The host's name ----------------------------------------------------- */

  // What guests see the host called — on every booking page and in every
  // booking email, not just this link's (it is a calendar setting; see
  // displayName in booking.js). The field shows the name as it stands, so
  // editing it is editing what guests already see; cleared, it goes back to
  // the username. Older booking stubs without the API simply get no field.
  const canName = typeof booking.displayName === 'function' && typeof booking.setDisplayName === 'function';
  const nameAtOpen = canName ? booking.displayName() || '' : '';
  const username = (user && typeof user.username === 'string' && user.username) || '';
  const nameInput = el('input', {
    class: 'input bk-name',
    type: 'text',
    maxlength: String(DISPLAY_NAME_MAX),
    autocomplete: 'off',
    placeholder: username || 'Your name',
    'aria-label': 'Your name, as guests see it',
    value: nameAtOpen,
  });
  const nameRow = canName
    ? el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Your name' }),
        nameInput,
        el('span', {
          class: 'bk-hint',
          text: username
            ? `Shown to guests on all your booking links. Leave blank to use your username, ${username}.`
            : 'Shown to guests on all your booking links.',
        }),
      ])
    : null;

  /** Save the host's name — only when it was actually edited: the page save is
   *  the action here, and an untouched name must not become a settings write
   *  (and a worker push) on every save. A name that fails to save is its own
   *  message, never a failed page save — the page is already saved. */
  async function saveName() {
    if (!canName || nameInput.value.trim() === nameAtOpen) return;
    try {
      await booking.setDisplayName(nameInput.value);
    } catch (err) {
      toast((err && err.message) || 'Could not save your name.', { variant: 'danger' });
    }
  }

  // Torn down when the dialog closes (see mountDialog below).
  let unsubscribeShare = null;

  /** The share row, kept live while the dialog is open: on a page's first
   *  open the link often doesn't exist yet (the worker deploy is still
   *  propagating, or a version upgrade is verifying), and the pending note
   *  promises the link "will appear here in a moment" — a promise only a
   *  re-render can keep; without one the dialog had to be closed and
   *  reopened. Rebuilt only when the URL actually changes, so a background
   *  refresh can't yank a half-made selection out of the URL input. */
  function shareSection() {
    if (!editing) return null;
    const wrap = el('div');
    let shown; // the URL the current render shows ('' = the pending note)
    const render = () => {
      shown = booking.linkFor(page.id) || '';
      wrap.replaceChildren(shareField(shown));
    };
    render();
    unsubscribeShare = booking.onUpdate(() => {
      if ((booking.linkFor(page.id) || '') !== shown) render();
    });
    return wrap;
  }

  function shareField(url) {
    if (!url) {
      return el('div', { class: 'field' }, [
        el('span', { class: 'field__label', text: 'Share' }),
        el('span', {
          class: 'bk-share__pending',
          text: 'Your link is being prepared. It will appear here in a moment.',
        }),
      ]);
    }
    const urlInput = el('input', {
      class: 'input bk-share__url',
      type: 'text',
      readOnly: true,
      value: url,
      'aria-label': 'Booking link URL',
      on: { focus: (e) => e.target.select() },
    });
    const copyBtn = el('button', {
      class: 'btn',
      type: 'button',
      html: icon('copy', { size: 'sm' }) + '<span>Copy</span>',
      on: {
        click: () => {
          const write =
            navigator.clipboard && navigator.clipboard.writeText
              ? navigator.clipboard.writeText(url)
              : Promise.reject(new Error('clipboard unavailable'));
          write
            .then(() => toast('Booking link copied', { variant: 'success' }))
            .catch(() => toast('Could not copy — clipboard access was blocked.', { variant: 'danger' }));
        },
      },
    });
    return el('div', { class: 'field' }, [
      el('span', { class: 'field__label', text: 'Share' }),
      el('div', { class: 'bk-share' }, [urlInput, copyBtn]),
      el('span', {
        class: 'bk-hint',
        text: 'Anyone with this link can book the times you are free.',
      }),
    ]);
  }

  /* ---- Save / delete -------------------------------------------------------- */

  function readPagePayload() {
    // The hours editor edits `hours` in place; validate before handing it on.
    for (let day = 0; day < 7; day++) {
      for (const iv of hours[day]) {
        if (!Number.isFinite(iv.start) || !Number.isFinite(iv.end) || iv.end <= iv.start) {
          showError(`${WEEKDAYS_LONG[day]}: each interval needs an end after its start.`);
          return null;
        }
      }
      // Overlapping intervals are FUSED by normalizeHours, so saving them
      // quietly deletes a row the host filled in. Say so instead. Intervals
      // that merely touch (…–12:00, 12:00–…) fuse into exactly the same
      // availability, so those stay allowed — nothing is lost.
      const sorted = [...hours[day]].sort((a, b) => a.start - b.start);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].start < sorted[i - 1].end) {
          showError(`${WEEKDAYS_LONG[day]}: two of these intervals overlap. Move them apart, or make them one.`);
          return null;
        }
      }
    }
    if (![0, 1, 2, 3, 4, 5, 6].some((day) => hours[day].length)) {
      showError('Add at least one weekly interval so people have times to pick.');
      return null;
    }
    const durationMin = Number(durationSelect.value);
    // A slot has to fit ENTIRELY inside one interval, so a meeting longer than
    // every interval makes a page that can never offer a single time — and the
    // host would learn that from whoever they shared the link with. Catch it
    // at the one moment they can still fix it.
    let longest = 0;
    for (let day = 0; day < 7; day++) {
      for (const iv of hours[day]) longest = Math.max(longest, iv.end - iv.start);
    }
    if (longest < durationMin) {
      showError(
        `A ${describeDuration(durationMin)} meeting needs an interval at least that long — your longest is ${describeDuration(longest)}. Lengthen an interval, or shorten the meeting.`,
      );
      return null;
    }
    return {
      id: page ? page.id : undefined,
      title: titleInput.value.trim(),
      description: descInput.value.trim(),
      location: locationInput.value.trim(),
      durationMin,
      incrementMin: incrementSelect.value === '' ? durationMin : Number(incrementSelect.value),
      bufferBeforeMin: Number(bufferBeforeSelect.value),
      bufferAfterMin: Number(bufferAfterSelect.value),
      minNoticeMin: Number(noticeSelect.value),
      maxAdvanceDays: Number(advanceSelect.value),
      maxPerDay: Number(perDaySelect.value),
      tz: tzSelect.value,
      hours,
      color,
      meet: meetToggle.checked,
      avatar: avatarToggle.checked,
      enabled: enabledToggle.checked,
    };
  }

  function handleDelete() {
    const upcoming = booking.upcomingCount(page.id);
    const confirmDialog = el(
      'form',
      { class: 'modal rr-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bk-del-title' },
      [
        el('div', { class: 'modal__head' }, [
          el('h2', { class: 'modal__title', id: 'bk-del-title', text: 'Delete booking link?' }),
        ]),
        el('div', { class: 'modal__body' }, [
          el('p', {
            text:
              'The page stops working immediately, and anyone holding the link sees that it is gone.' +
              (upcoming
                ? ` Your ${upcoming === 1 ? 'upcoming booking stays' : `${upcoming} upcoming bookings stay`} on your calendar.`
                : ''),
          }),
        ]),
        el('div', { class: 'modal__foot' }, [
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn', type: 'button', text: 'Keep it', on: { click: () => closeConfirm() } }),
          el('button', { class: 'btn btn--danger', type: 'submit', text: 'Delete link' }),
        ]),
      ],
    );
    confirmDialog.addEventListener('submit', (e) => {
      e.preventDefault();
      closeConfirm();
      Promise.resolve(booking.deletePage(page.id))
        .then(() => {
          toast('Booking link deleted');
          close();
          onDone && onDone(null);
        })
        .catch((err) => toast(err.message || 'Could not delete the booking link.', { variant: 'danger' }));
    });
    const closeConfirm = mountDialog(confirmDialog);
    requestAnimationFrame(() => confirmDialog.querySelector('.btn--danger').focus());
  }

  const dialog = el(
    'form',
    {
      class: 'modal modal--editor modal--booking',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'bk-title',
    },
    [
      el('div', { class: 'modal__head' }, [
        el('h2', {
          class: 'modal__title',
          id: 'bk-title',
          text: editing ? 'Edit booking link' : 'New booking link',
        }),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': 'Close',
          html: icon('close'),
          on: { click: () => close() },
        }),
      ]),
      el('div', { class: 'modal__body' }, [
        el('div', { class: 'field field--title' }, [titleInput]),
        shareSection(),
        enabledRow,
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Duration' }), durationSelect]),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Location' }), locationInput]),
        meetRow,
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Description' }), descInput]),
        avatarRow,
        nameRow,
        el('hr', { class: 'modal__sep' }),
        el('div', { class: 'field' }, [
          el('span', { class: 'field__label', text: 'Weekly hours' }),
          hoursWrap,
          errorEl,
        ]),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Time zone' }), tzSelect]),
        el('hr', { class: 'modal__sep' }),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Book ahead' }), advanceSelect]),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Min notice' }), noticeSelect]),
        el('div', { class: 'field' }, [
          el('span', { class: 'field__label', text: 'Buffers' }),
          el('div', { class: 'bk-two' }, [
            el('div', { class: 'bk-two__cell' }, [el('span', { class: 'bk-hint', text: 'Before' }), bufferBeforeSelect]),
            el('div', { class: 'bk-two__cell' }, [el('span', { class: 'bk-hint', text: 'After' }), bufferAfterSelect]),
          ]),
        ]),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Per day' }), perDaySelect]),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Increments' }), incrementSelect]),
        el('div', { class: 'field' }, [el('span', { class: 'field__label', text: 'Color' }), swatches]),
      ]),
      el('div', { class: 'modal__foot' }, [
        editing
          ? el('button', {
              class: 'btn btn--danger',
              type: 'button',
              html: icon('trash', { size: 'sm' }) + '<span>Delete</span>',
              on: { click: handleDelete },
            })
          : null,
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => close() } }),
        el('button', { class: 'btn btn--primary', type: 'submit', text: editing ? 'Save' : 'Create link' }),
      ]),
    ],
  );

  // Saving goes to the network, so unlike the event editor this dialog stays
  // open until the save lands — which leaves a window where the second click
  // of a double-click would create a second, duplicate page. Lock the footer
  // for the duration; a failure unlocks it for the retry.
  let saving = false;
  function setSaving(on) {
    saving = on;
    dialog.querySelectorAll('.modal__foot button').forEach((b) => {
      b.disabled = on;
    });
    const save = dialog.querySelector('button[type="submit"]');
    save.textContent = on ? 'Saving…' : editing ? 'Save' : 'Create link';
    if (on) save.setAttribute('aria-busy', 'true');
    else save.removeAttribute('aria-busy');
  }

  dialog.addEventListener('submit', (e) => {
    e.preventDefault();
    if (saving) return;
    showError('');
    const payload = readPagePayload();
    if (!payload) return;
    setSaving(true);
    Promise.resolve(booking.savePage(payload))
      .then(async (saved) => {
        await saveName();
        const url = booking.linkFor(saved.id);
        if (!editing) track('Booking Link Created');
        toast(
          editing ? 'Booking link saved' : url ? 'Booking link created' : 'Booking link created. Preparing your link…',
          url
            ? {
                variant: 'success',
                action: {
                  label: 'Copy link',
                  onClick: () =>
                    navigator.clipboard && navigator.clipboard.writeText
                      ? navigator.clipboard
                          .writeText(url)
                          .then(() => toast('Booking link copied', { variant: 'success' }))
                          .catch(() => {})
                      : undefined,
                },
              }
            : { variant: 'success' },
        );
        close();
        onDone && onDone(saved);
      })
      .catch((err) => {
        setSaving(false);
        toast(err.message || 'Could not save the booking link.', { variant: 'danger' });
      });
  });

  const close = mountDialog(dialog, () => {
    if (unsubscribeShare) unsubscribeShare();
  });
  requestAnimationFrame(() => titleInput.focus());
  return close;
}
