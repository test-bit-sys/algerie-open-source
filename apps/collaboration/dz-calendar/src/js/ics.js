/**
 * iCalendar (RFC 5545) import/export for calendar events.
 *
 * Times are emitted as *floating* local date-times (no TZID, no Z), which
 * matches the app's local-time model and avoids shipping VTIMEZONE data — an
 * event stays at the same wall-clock time wherever it is imported. All-day
 * events use DATE values with an exclusive DTEND, per the spec.
 *
 * Recurring series export as one VEVENT with an RRULE (+ EXDATE for cancelled
 * occurrences), plus one extra VEVENT per per-occurrence override carrying a
 * RECURRENCE-ID. Import groups VEVENTs by UID to reassemble that structure.
 */
import {
  materializeOccurrence,
  nthWeekdayInfo,
  normalizeRecurrence,
  firstScheduledStart,
  nthScheduledStart,
} from './recurrence.js';
import {
  startOfDay,
  endOfDay,
  addDays,
  isValidTimeZone,
  zonedTimeToUTC,
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
} from './date-utils.js';
import { resolveTzid } from './windows-zones.js';

const PRODID = '-//Calendar//Puter//EN';
const ICS_WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// RSVP participation status, app <-> RFC 5545 PARTSTAT.
const PARTSTAT_OUT = {
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  tentative: 'TENTATIVE',
  'needs-action': 'NEEDS-ACTION',
};
const PARTSTAT_IN = {
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  TENTATIVE: 'tentative',
  'NEEDS-ACTION': 'needs-action',
  // A delegated invite still awaits a real answer from someone.
  DELEGATED: 'needs-action',
};

/* ---- Export ----------------------------------------------------------- */

/**
 * The events as an iCalendar document. `method` writes an RFC 5545 METHOD —
 * a downloaded file has none (it is just a calendar); a file MAILED to a
 * guest carries REQUEST, a real iTIP invitation, so their mail client's own
 * Yes / No / Maybe buttons work (invites.js sets it, with the two below).
 *
 * `tzid` names the IANA zone the wall-clock digits are in. A downloaded file
 * stays floating on purpose — re-importing reproduces the same wall clock —
 * but a MAILED event must pin the actual instant, or a guest in another zone
 * files it at the host's wall-clock time in their OWN zone, hours off. The
 * TZID= parameter is emitted without a VTIMEZONE block: IANA names are what
 * Google, Outlook and Apple resolve in practice.
 *
 * `sequence` is the iTIP revision counter: a calendar holding an earlier
 * copy of this UID ignores an update whose SEQUENCE did not grow.
 *
 * `status` writes an RFC 5545 STATUS on every VEVENT. Only a cancellation
 * sets it (STATUS:CANCELLED, alongside METHOD:CANCEL — invites.js again):
 * some clients retract the event on the METHOD alone, others want the
 * per-event property, so a whole-event cancellation carries both. Withdrawing
 * particular attendees omits STATUS because the event itself is still on.
 *
 * `recurrenceId` exports only that occurrence of each supplied master, using
 * the master's UID and the original slot's value type (even if it was moved).
 * `recurrenceRange: 'THISANDFUTURE'` extends that withdrawal to later slots.
 */
export function toICS(events, { now = Date.now(), method = '', tzid = '', sequence = null, status = '', recurrenceId = null, recurrenceRange = '', uid = '' } = {}) {
  if (recurrenceRange && (recurrenceRange !== 'THISANDFUTURE' || recurrenceId == null)) {
    throw new Error('Invalid recurrence range.');
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN'];
  if (method) lines.push(`METHOD:${method}`);
  // The TZID lands inside property parameters — only an IANA-shaped name may
  // pass, or the parameter (and the whole line) would be corrupt. STATUS is a
  // property VALUE, but the same shape guard keeps a stray newline out.
  const tz = /^[A-Za-z0-9_+/-]{1,80}$/.test(tzid) ? tzid : '';
  const st = /^[A-Za-z-]{1,40}$/.test(status) ? status.toUpperCase() : '';
  const seq = Number.isFinite(sequence) ? Math.max(0, Math.floor(sequence)) : null;
  const stamp = fmtUTC(now);
  // A UID override for a reply to mail we did not originate: the organizer's
  // calendar matches a REPLY by the UID THEY assigned, so an iTIP reply to a
  // mail-detected invitation must carry their UID, not our synthesized one
  // (see store.js's invite.uid). Sanitized the same way every other value
  // here guards against a stray control character corrupting the line; an
  // override that sanitizes to nothing falls back to the default per-event UID.
  const uidOverride = String(uid || '').replace(/\p{Cc}/gu, '').trim().slice(0, 255);
  // Reminders travel as VALARM only in a plain calendar file — a backup of your
  // own calendar, where losing them loses something you configured. A file
  // MAILED to a guest (any METHOD) deliberately carries none: the host's
  // "notify me 10 minutes before" is their own preference, not an alarm to
  // install in every guest's calendar, whose client applies its default.
  const alarms = !method;
  for (const ev of events) writeEvent(lines, ev, stamp, tz, seq, st, alarms, recurrenceId, recurrenceRange, uidOverride);
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function writeEvent(lines, ev, stamp, tzid, sequence, status, alarms, recurrenceId, recurrenceRange, uidOverride) {
  const uid = uidOverride || `${ev.id}@calendar.puter.com`;
  if (recurrenceId != null) {
    const occ = Number.isFinite(recurrenceId) && materializeOccurrence(ev, recurrenceId);
    if (!occ) throw new Error('Cannot export this occurrence.');
    emitVevent(lines, occ, { uid, stamp, tzid, sequence, status, alarms, recurrenceId, recurrenceRange, isOverride: true, masterAllDay: ev.allDay });
    return;
  }
  emitVevent(lines, ev, { uid, stamp, tzid, sequence, status, alarms });

  if (ev.recurrence && ev.overrides) {
    for (const key of Object.keys(ev.overrides)) {
      const rid = Number(key);
      if (!Number.isFinite(rid)) continue;
      const occ = materializeOccurrence(ev, rid);
      if (occ) emitVevent(lines, occ, { uid, stamp, tzid, sequence, status, alarms, recurrenceId: rid, isOverride: true, masterAllDay: ev.allDay });
    }
  }
}

function emitVevent(lines, ev, { uid, stamp, tzid, sequence, status, alarms, recurrenceId, recurrenceRange, isOverride, masterAllDay }) {
  // DATE values (all-day) are zone-less; only DATE-TIMEs carry the TZID.
  const tzp = tzid ? `;TZID=${tzid}` : '';
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${uid}`);
  lines.push(`DTSTAMP:${stamp}`);
  if (sequence != null) lines.push(`SEQUENCE:${sequence}`);
  if (status) lines.push(`STATUS:${status}`);

  if (recurrenceId != null) {
    // RECURRENCE-ID identifies the ORIGINAL scheduled slot, so its DATE vs
    // DATE-TIME form must follow the series master — not this override, which
    // may have flipped all-day (a timed master's 14:00 slot must not collapse
    // to a bare DATE, or the id no longer matches on re-import).
    const ridAllDay = masterAllDay != null ? masterAllDay : ev.allDay;
    const range = recurrenceRange ? `;RANGE=${recurrenceRange}` : '';
    lines.push(ridAllDay ? `RECURRENCE-ID;VALUE=DATE${range}:${fmtDate(recurrenceId)}` : `RECURRENCE-ID${tzp}${range}:${fmtLocal(recurrenceId)}`);
  }

  // A recurring master's DTSTART must itself be an occurrence: RFC 5545
  // §3.8.5.3 makes DTSTART always count, so an off-pattern anchor (a weekly
  // rule whose byWeekday excludes the anchor's weekday — the app clips it to
  // the next selected day) would give conformant readers a phantom first event
  // on the wrong day and, with COUNT, drop the real last occurrence. Emit the
  // first scheduled occurrence instead, carrying the duration across.
  let start = ev.start;
  let end = ev.end;
  if (!isOverride && ev.recurrence) {
    const first = firstScheduledStart(ev.recurrence, ev.start);
    if (first !== ev.start) {
      if (ev.allDay) {
        // Carry the span as a DAY COUNT, not raw ms: if the first occurrence
        // lands on a DST transition day, the anchor's ms span is an hour off
        // a whole day there and the DATE DTEND would gain or lose a day.
        const days = Math.max(1, Math.round((ev.end - ev.start) / MS_PER_DAY));
        end = endOfDay(addDays(startOfDay(new Date(first)), days - 1)).getTime();
      } else {
        end = first + (ev.end - ev.start);
      }
      start = first;
    }
  }

  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${fmtDate(start)}`);
    // DTEND is exclusive for DATE values: the day after the last covered day.
    lines.push(`DTEND;VALUE=DATE:${fmtDate(addDays(startOfDay(new Date(end)), 1).getTime())}`);
  } else {
    lines.push(`DTSTART${tzp}:${fmtLocal(start)}`);
    lines.push(`DTEND${tzp}:${fmtLocal(end)}`);
  }

  lines.push(`SUMMARY:${escapeText(ev.title || '')}`);
  // The meeting link is written FOUR ways, because clients disagree on where a
  // joinable URL lives: URL is RFC 5545's own answer (Apple reads it);
  // X-GOOGLE-CONFERENCE is what Google Calendar / Gmail render as a proper
  // conference row; CONFERENCE is RFC 7986's standard spelling of the same;
  // and a trailing "Join:" line in the DESCRIPTION covers Outlook.com and
  // anything else. The link deliberately never fills LOCATION: Gmail draws a
  // location as a physical place — map pin, a Directions button, and clicks
  // open Google Maps. Import (blockToEvent) reverses the synthesized copies —
  // including the LOCATION mirror this app's older exports wrote — so our own
  // files round-trip without them sticking.
  const meetingUrl = (ev.meeting && ev.meeting.url) || '';
  const description = meetingUrl
    ? `${ev.description ? `${ev.description}\n\n` : ''}Join: ${meetingUrl}`
    : ev.description;
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  // URL and the conference properties are URI values (RFC 5545 §3.3.13), not
  // TEXT — backslash-escaping does not apply to them. An escaped comma or
  // semicolon (URL:…\,…) reaches other clients as a literal backslash in the
  // link, breaking it. Emit the URI raw; the store guarantees an http(s) URL,
  // and stripping whitespace/control characters keeps a malformed stored
  // value from injecting a property line.
  if (meetingUrl) {
    const uri = meetingUrl.replace(/[\s\u0000-\u001f]/g, '');
    lines.push(`URL:${uri}`);
    lines.push(`X-GOOGLE-CONFERENCE:${uri}`);
    lines.push(`CONFERENCE;VALUE=URI;FEATURE=VIDEO:${uri}`);
  }

  if (ev.organizer && ev.organizer.email) {
    lines.push(`ORGANIZER${cnParam(ev.organizer.name)}:mailto:${ev.organizer.email}`);
  }
  for (const g of ev.guests || []) {
    if (!g || !g.email) continue;
    lines.push(
      `ATTENDEE${cnParam(g.name)};PARTSTAT=${PARTSTAT_OUT[g.status] || 'NEEDS-ACTION'};RSVP=TRUE:mailto:${g.email}`,
    );
  }

  if (!isOverride && ev.recurrence) {
    const rule = buildRRule(ev, tzid);
    if (rule) lines.push(`RRULE:${rule}`);
    const ex = ev.exdates || [];
    if (ex.length) {
      lines.push(
        ev.allDay
          ? `EXDATE;VALUE=DATE:${ex.map(fmtDate).join(',')}`
          : `EXDATE${tzp}:${ex.map(fmtLocal).join(',')}`,
      );
    }
  }

  // Sub-components come after every property (RFC 5545 §3.6.1). One DISPLAY
  // alarm per stored offset, written as a negative duration from the start —
  // the exact shape the importer reads back, and what Google, Apple and
  // Outlook emit.
  if (alarms) {
    for (const min of Array.isArray(ev.reminders) ? ev.reminders : []) {
      if (!Number.isFinite(min) || min < 0) continue;
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      // "-PT0M" is legal but reads as a typo; PT0S is how "at the time of the
      // event" is conventionally written.
      lines.push(`TRIGGER:${min > 0 ? `-PT${Math.round(min)}M` : 'PT0S'}`);
      lines.push(`DESCRIPTION:${escapeText(ev.title || 'Reminder')}`);
      lines.push('END:VALARM');
    }
  }

  lines.push('END:VEVENT');
}

function buildRRule(ev, tzid) {
  const norm = normalizeRecurrence(ev.recurrence, ev.start);
  if (!norm) return null;
  const parts = [`FREQ=${norm.freq.toUpperCase()}`];
  if (norm.interval > 1) parts.push(`INTERVAL=${norm.interval}`);
  if (norm.freq === 'weekly' && norm.byWeekday) {
    parts.push(`BYDAY=${norm.byWeekday.map((d) => ICS_WEEKDAYS[d]).join(',')}`);
    // The recurrence engine anchors weeks on the rule's wkst (Sunday unless an
    // import carried another). RFC 5545 §3.3.10 defaults WKST to MO, which only
    // matters when INTERVAL > 1: with a different anchor, a BYDAY that spans
    // the week boundary lands in a different week and a conformant reader
    // expands the series to different dates. Emit the rule's own anchor so
    // other calendars reproduce the exact occurrences this app shows.
    if (norm.interval > 1) parts.push(`WKST=${ICS_WEEKDAYS[norm.wkst || 0]}`);
  }
  if (norm.freq === 'monthly') {
    if (norm.monthlyMode === 'weekday') {
      const { nth, weekday } = nthWeekdayInfo(new Date(ev.start));
      // An explicit ordinal (-1 = last) overrides the one derived from the
      // start date, so "last Friday" round-trips as BYDAY=-1FR.
      const n = norm.monthlyNth != null ? norm.monthlyNth : nth;
      parts.push(`BYDAY=${n}${ICS_WEEKDAYS[weekday]}`);
    } else {
      parts.push(`BYMONTHDAY=${new Date(ev.start).getDate()}`);
    }
  }
  if (norm.count != null) parts.push(`COUNT=${norm.count}`);
  else if (norm.until != null) {
    // RFC 5545 §3.3.10: with a zoned DTSTART, UNTIL MUST be in UTC.
    parts.push(
      `UNTIL=${ev.allDay ? fmtDate(norm.until) : tzid ? fmtUTC(norm.until) : fmtLocal(norm.until)}`,
    );
  }
  return parts.join(';');
}

/* ---- Import ----------------------------------------------------------- */

/**
 * Scan an iCalendar document into its calendar-level METHOD plus one block
 * (an array of properties, with a `.alarms` side list) per VEVENT. Shared by
 * `parseICS` (which groups blocks into events/overrides) and `parseITIP`
 * (which reads iTIP semantics off the same blocks without that grouping).
 */
function readBlocks(text) {
  const lines = unfold(String(text));
  const blocks = [];
  let cur = null;
  // Depth of nested sub-components (VALARM, and any future inner block) inside
  // the current VEVENT. Their properties (a VALARM's own DESCRIPTION, SUMMARY,
  // DURATION, …) must never bleed into the event, or a reminder-bearing event —
  // the shape Google/Apple/Outlook export constantly — gets the alarm's text as
  // its description and the alarm's DURATION as its length.
  let sub = 0;
  // The VALARM currently open directly inside this VEVENT, if any. Its own
  // properties stay out of `cur` (above) but the TRIGGER is the one thing worth
  // keeping: it is where every other calendar stores "notify me N before", so
  // dropping it made the app's own .ics backup lossy for a field the user set.
  // Only depth 1 is collected — an alarm nested deeper isn't this event's.
  let alarm = null;
  // The calendar-level METHOD. A METHOD:CANCEL file — the attachment this app
  // itself mails when an invited event is deleted — retracts events; nothing
  // in it is an event to add.
  let method = '';
  for (const line of lines) {
    if (!cur && /^METHOD[;:]/i.test(line)) {
      method = line.slice(line.indexOf(':') + 1).trim().toUpperCase();
    } else if (/^BEGIN:VEVENT$/i.test(line)) {
      // Component names are case-insensitive (RFC 5545 §3.1), so a file that
      // spells them in lowercase must not import as zero events.
      cur = [];
      cur.alarms = [];
      sub = 0;
      alarm = null;
    } else if (/^END:VEVENT$/i.test(line)) {
      if (cur) blocks.push(cur);
      cur = null;
      sub = 0;
      alarm = null;
    } else if (cur) {
      if (/^BEGIN:/i.test(line)) {
        sub++;
        if (sub === 1 && /^BEGIN:VALARM$/i.test(line)) alarm = [];
      } else if (/^END:/i.test(line)) {
        if (sub === 1 && alarm) {
          cur.alarms.push(alarm);
          alarm = null;
        }
        if (sub > 0) sub--;
      } else if (sub === 0) {
        const p = parseLine(line);
        if (p) cur.push(p);
      } else if (sub === 1 && alarm) {
        const p = parseLine(line);
        if (p) alarm.push(p);
      }
    }
  }
  return { method, blocks };
}

export function parseICS(text) {
  const { method, blocks } = readBlocks(text);

  // A cancelled VEVENT is a retraction, not an event: STATUS:CANCELLED is how
  // a cancellation names the event it withdraws (and how some exporters keep
  // a deleted event in a feed). Importing it as a live event put a meeting
  // back on the calendar that its organizer had called off — including from
  // the cancellation .ics this app mails, which carries exactly that STATUS.
  const cancelled = (b) =>
    method === 'CANCEL' || (valueOf(b, 'STATUS') || '').trim().toUpperCase() === 'CANCELLED';

  // Group by UID so overrides (RECURRENCE-ID) reattach to their master.
  const groups = new Map();
  const loose = [];
  for (const b of blocks) {
    const uid = valueOf(b, 'UID');
    const isOverride = Boolean(propOf(b, 'RECURRENCE-ID'));
    if (!uid) {
      loose.push(b);
      continue;
    }
    if (!groups.has(uid)) groups.set(uid, { master: null, overrides: [] });
    const g = groups.get(uid);
    if (isOverride) g.overrides.push(b);
    else if (!g.master) g.master = b;
    else loose.push(b);
  }

  const events = [];
  for (const g of groups.values()) {
    // A cancelled series takes its exceptions with it.
    if (g.master && cancelled(g.master)) continue;
    const ev = g.master ? blockToEvent(g.master) : null;
    // Overrides can only reattach to a recurring master. If the master is a
    // recurring series, fold them in as per-occurrence overrides.
    const canAttach = ev && ev.recurrence;
    if (canAttach && g.overrides.length) {
      ev.overrides = {};
      for (const ob of g.overrides) {
        const ridProp = propOf(ob, 'RECURRENCE-ID');
        // An all-day series keys its occurrences by local day; a RECURRENCE-ID
        // written as a DATE-TIME (non-conformant for a DATE master, but real
        // exporters do it) must name that day, not an instant that matches no
        // occurrence — the override would be dropped on the floor. Same
        // treatment UNTIL already gets (see parseRRule). A timed zoned series
        // matches by calendar-day distance instead (see exceptionSlotMs).
        const masterStart = propOf(g.master, 'DTSTART');
        const rid = ev.allDay
          ? parseDateTime(ridProp ? { value: ridProp.value, params: 'VALUE=DATE' } : ridProp).ms
          : exceptionSlotMs(ridProp, sourceZoneOf(masterStart), masterStart, ev.start);
        // A cancelled occurrence of a live series is an exception date, which
        // is what this app's own export writes for one (EXDATE); other
        // producers spell the same thing as a RECURRENCE-ID block with
        // STATUS:CANCELLED.
        if (cancelled(ob)) {
          if (Number.isFinite(rid)) (ev.exdates || (ev.exdates = [])).push(rid);
          continue;
        }
        const oev = blockToEvent(ob);
        // Keep only what this occurrence actually differs on. An exception
        // VEVENT is a WHOLE event on the wire — it repeats the summary,
        // description, location and alarms it merely inherited — so copying
        // every field pinned them: after a backup/restore, editing the series'
        // description updated every occurrence except the exceptions, which
        // silently kept the text they had at export time.
        const patch = {};
        for (const key of ['title', 'description', 'location', 'allDay']) {
          if (oev[key] !== ev[key]) patch[key] = oev[key];
        }
        if (JSON.stringify(oev.reminders ?? null) !== JSON.stringify(ev.reminders ?? null)) {
          patch.reminders = oev.reminders || [];
        }
        // The instants always travel: stating them is what a RECURRENCE-ID
        // VEVENT is for, and they must not drift with the master's duration.
        if (Number.isFinite(oev.start)) patch.start = oev.start;
        if (Number.isFinite(oev.end)) patch.end = oev.end;
        ev.overrides[rid] = patch;
      }
    }
    if (ev) events.push(ev);
    // Overrides with no recurring master to attach to (missing or non-recurring
    // master) are surfaced as standalone events rather than silently dropped —
    // previously only the first such block survived.
    if (!canAttach) for (const ob of g.overrides) if (!cancelled(ob)) events.push(blockToEvent(ob));
  }
  for (const b of loose) if (!cancelled(b)) events.push(blockToEvent(b));
  return events;
}

/**
 * iTIP semantics on top of the same block scanner `parseICS` uses: one item
 * per VEVENT, with no master/override folding — a REQUEST/CANCEL naming a
 * RECURRENCE-ID addresses a single occurrence, and the caller (mail-intake.js)
 * decides what that means rather than this module reassembling a series.
 */
export function parseITIP(text) {
  const { method, blocks } = readBlocks(text);
  return { method, items: blocks.map((b) => itemFromBlock(b, method)) };
}

function itemFromBlock(b, method) {
  const status = (valueOf(b, 'STATUS') || '').trim().toUpperCase();
  const ridProp = propOf(b, 'RECURRENCE-ID');
  const rid = ridProp ? parseDateTime(ridProp) : null;
  const range = ridProp ? (paramOf(ridProp.params, 'RANGE') || '').toUpperCase() : '';
  const dtstamp = parseDateTime(propOf(b, 'DTSTAMP')).ms;
  const seq = parseInt(valueOf(b, 'SEQUENCE'), 10);

  const orgProp = propOf(b, 'ORGANIZER');
  let organizer = null;
  if (orgProp) {
    const email = mailtoEmail(orgProp.value);
    if (email) {
      const name = paramOf(orgProp.params, 'CN');
      organizer = name ? { email, name } : { email };
    }
  }

  const attendees = [];
  for (const p of propsOf(b, 'ATTENDEE')) {
    const email = mailtoEmail(p.value);
    if (!email) continue;
    const partstat = (paramOf(p.params, 'PARTSTAT') || '').toUpperCase();
    attendees.push({
      email,
      name: paramOf(p.params, 'CN') || '',
      status: PARTSTAT_IN[partstat] || 'needs-action',
      rsvp: (paramOf(p.params, 'RSVP') || '').toUpperCase() === 'TRUE',
      role: (paramOf(p.params, 'ROLE') || '').toUpperCase(),
    });
  }

  return {
    uid: (valueOf(b, 'UID') || '').trim().slice(0, 255),
    sequence: Number.isFinite(seq) && seq >= 0 ? seq : 0,
    dtstamp: Number.isFinite(dtstamp) ? dtstamp : 0,
    status,
    cancelled: method === 'CANCEL' || status === 'CANCELLED',
    recurrenceId: rid && Number.isFinite(rid.ms) ? { ms: rid.ms, dateOnly: rid.dateOnly } : null,
    recurrenceRange: range === 'THISANDFUTURE' ? 'THISANDFUTURE' : '',
    organizer,
    attendees,
    comment: unescapeText(valueOf(b, 'COMMENT') || '').slice(0, 500),
    event: blockToEvent(b),
  };
}

function blockToEvent(b) {
  const dtStart = propOf(b, 'DTSTART');
  const dtEnd = propOf(b, 'DTEND');
  const start = parseDateTime(dtStart);
  const allDay = start.dateOnly;

  const ev = {
    title: unescapeText(valueOf(b, 'SUMMARY') || ''),
    description: unescapeText(valueOf(b, 'DESCRIPTION') || ''),
    location: unescapeText(valueOf(b, 'LOCATION') || ''),
    allDay,
    start: start.ms,
  };

  // The meeting link. The conference properties are asked first: they mean
  // "join this" specifically — X-GOOGLE-CONFERENCE in Google Calendar's own
  // exports of Meet/Zoom events, CONFERENCE as RFC 7986's spelling — whereas
  // URL (RFC 5545 §3.8.4.6) is a generic "more about this event" link that
  // some producers point at an event PAGE, which must not shadow a join link
  // sitting right next to it. RFC 7986 allows several CONFERENCE entries
  // (dial-in and video side by side) and non-web URIs (tel:, xmpp:), so every
  // value is scanned and only the first http(s) one is taken — the same guard
  // URL gets, since only http(s) survives the store's validation anyway.
  const webUrl = (v) => (/^https?:\/\//i.test(v) ? v : '');
  const confUrl = (name) =>
    propsOf(b, name)
      .map((p) => webUrl(unescapeText(p.value || '').trim()))
      .find(Boolean) || '';
  const urlProp = webUrl(unescapeText(valueOf(b, 'URL') || '').trim());
  const url = confUrl('X-GOOGLE-CONFERENCE') || confUrl('CONFERENCE') || urlProp;
  if (url) {
    ev.meeting = { url };
    // Export mirrors the link into a trailing "Join:" description line (and,
    // in files this app wrote before the conference properties, into an empty
    // LOCATION) for the clients that ignore URL. Peel those synthesized copies
    // back off — but only out of files that carry the link in URL too, the
    // signature of this app's own exports: in a foreign file (say Google's
    // export of a Zoom event, which puts the join link in LOCATION and
    // X-GOOGLE-CONFERENCE but not URL) the location is that producer's real
    // data and stays, as does any location or join line naming any OTHER url.
    if (urlProp === url) {
      if (ev.location === url) ev.location = '';
      const join = `Join: ${url}`;
      if (ev.description === join) ev.description = '';
      else if (ev.description.endsWith(`\n\n${join}`)) {
        ev.description = ev.description.slice(0, -(join.length + 2));
      }
    }
  }

  if (dtEnd) {
    const e = parseDateTime(dtEnd);
    // DATE DTEND is exclusive → last covered day is one day earlier.
    ev.end = allDay ? endOfDay(addDays(startOfDay(new Date(e.ms)), -1)).getTime() : e.ms;
  } else {
    // No DTEND: honour a DURATION if present (RFC 5545 allows either), else fall
    // back to the spec default — one covered day for DATE, zero length for a
    // DATE-TIME.
    const durMs = parseDuration(valueOf(b, 'DURATION'));
    if (durMs != null && durMs > 0) {
      if (allDay) {
        const days = Math.max(1, Math.round(durMs / MS_PER_DAY));
        ev.end = endOfDay(addDays(startOfDay(new Date(start.ms)), days - 1)).getTime();
      } else {
        ev.end = start.ms + durMs;
      }
    } else if (allDay) {
      ev.end = endOfDay(new Date(start.ms)).getTime();
    } else {
      ev.end = start.ms;
    }
  }

  const org = propOf(b, 'ORGANIZER');
  if (org) {
    const email = mailtoEmail(org.value);
    if (email) {
      const name = paramOf(org.params, 'CN');
      ev.organizer = name ? { email, name } : { email };
    }
  }
  const attendees = propsOf(b, 'ATTENDEE');
  if (attendees.length) {
    const guests = [];
    for (const p of attendees) {
      const email = mailtoEmail(p.value);
      if (!email) continue;
      const name = paramOf(p.params, 'CN');
      const partstat = (paramOf(p.params, 'PARTSTAT') || '').toUpperCase();
      const g = { email, status: PARTSTAT_IN[partstat] || 'needs-action' };
      if (name) g.name = name;
      guests.push(g);
    }
    if (guests.length) ev.guests = guests;
  }

  const reminders = remindersFromAlarms(b.alarms);
  if (reminders.length) ev.reminders = reminders;

  const rrule = valueOf(b, 'RRULE');
  if (rrule) {
    const rule = parseRRule(rrule, allDay, dtStart.value);
    if (rule) {
      // BYDAY names weekdays in the DTSTART's OWN zone. Converting a Z/TZID
      // DTSTART to the local instant can land on the adjacent local calendar
      // day (a Monday 16:00Z standup is Tuesday 04:00 in Auckland), and the
      // recurrence engine expands byWeekday against LOCAL days — unrotated,
      // the whole series lands a week off its true instants, the first real
      // occurrence vanishes, and every EXDATE / RECURRENCE-ID stops matching.
      // Rotate the list by the day the conversion crossed. Floating and
      // same-day conversions yield rot 0 (no change).
      if (
        rule.freq === 'weekly' &&
        Array.isArray(rule.byWeekday) &&
        rule.byWeekday.length &&
        Number.isFinite(ev.start) &&
        !allDay
      ) {
        const rot = (new Date(ev.start).getDay() - weekdayOfDigits(dtStart.value) + 7) % 7;
        if (rot) {
          rule.byWeekday = rule.byWeekday.map((d) => (d + rot) % 7).sort((a, b) => a - b);
          // WKST anchors which week each BYDAY day falls in; rotate it with the
          // days (interval >= 2 only, where parseRRule sets it) or the whole
          // series lands a week off — real occurrences vanish, phantoms appear.
          if (rule.wkst != null) rule.wkst = (rule.wkst + rot) % 7;
        }
      }
      // The engine holds a count of at most 999; a bigger COUNT was silently
      // truncated there — and re-exported as COUNT=999, corrupting the file on
      // a round trip. A count is a date in disguise: find the occurrence it
      // ends on and bound the series there. One so large the enumeration cap
      // can't reach it is, for every practical purpose, never-ending.
      if (rule.count != null && rule.count > 999 && Number.isFinite(ev.start)) {
        const last = nthScheduledStart(rule, ev.start, rule.count);
        delete rule.count;
        if (last != null) rule.until = endOfDay(new Date(last)).getTime();
      }
      ev.recurrence = rule;
      const exdates = [];
      const srcTz = allDay ? '' : sourceZoneOf(dtStart);
      for (const p of propsOf(b, 'EXDATE')) {
        for (const token of p.value.split(',')) {
          // Force DATE parsing for an all-day series so a DATE-TIME EXDATE
          // names the local day it cancels, not an instant no occurrence has
          // (which left the cancelled day on the calendar).
          const prop = { value: token.trim(), params: allDay ? 'VALUE=DATE' : p.params };
          const ms = allDay ? parseDateTime(prop).ms : exceptionSlotMs(prop, srcTz, dtStart, ev.start);
          if (Number.isFinite(ms)) exdates.push(ms);
        }
      }
      if (exdates.length) ev.exdates = exdates;
    }
  }
  return ev;
}

/**
 * An RRULE as this app's recurrence rule — or null when the file's rule has a
 * shape the engine cannot express. Null imports the event as a one-off on its
 * DTSTART: the honest reading. Quietly ignoring a part it didn't understand
 * fabricated a DIFFERENT series than the file describes — "last day of every
 * month" (BYMONTHDAY=-1) became "the 31st", skipping every short month;
 * BYMONTHDAY=15 under a DTSTART on the 5th became "the 5th"; Thanksgiving
 * (FREQ=YEARLY;BYDAY=-1TH;BYMONTH=11) became a fixed date — and a re-export
 * then wrote the wrong rule out as if it were the file's.
 *
 * `dtstart` is the DTSTART value's own digits (YYYYMMDD…): BYMONTHDAY and
 * BYMONTH are checked against the day the file names, not against the local
 * conversion of a zoned start, which can sit on the neighbouring date.
 */
function parseRRule(str, allDay, dtstart = '') {
  const map = {};
  for (const kv of str.split(';')) {
    const eq = kv.indexOf('=');
    if (eq === -1) continue;
    map[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  let freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[
    (map.FREQ || '').toUpperCase()
  ];
  if (!freq) return null;

  // Sub-day and week/year-of-day parts have no counterpart here at all.
  if (map.BYHOUR || map.BYMINUTE || map.BYSECOND || map.BYWEEKNO || map.BYYEARDAY) return null;
  // BYMONTHDAY / BYMONTH may only restate the DTSTART, which is all the
  // engine's monthly-by-date and yearly rules ever repeat — and only under a
  // FREQ where that IS a restatement: BYMONTHDAY under MONTHLY or YEARLY,
  // BYMONTH under YEARLY. Under any other FREQ the same part is a filter
  // ("every day that is the 15th", "Tuesdays in March") the engine has no
  // shape for, and dropping it fabricated a plain daily / weekly series.
  const digits = /^(\d{4})(\d{2})(\d{2})/.exec(String(dtstart).trim());
  const restates = (part, digit, freqs) => {
    if (!map[part]) return true;
    if (!freqs.includes(freq)) return false;
    const values = map[part].split(',').map((v) => parseInt(v, 10));
    return values.length === 1 && Boolean(digits) && values[0] === parseInt(digits[digit], 10);
  };
  if (!restates('BYMONTHDAY', 3, ['monthly', 'yearly']) || !restates('BYMONTH', 2, ['yearly'])) {
    return null;
  }
  // BYSETPOS picks from a period's candidates; the only pick expressible here
  // is one ordinal of one weekday in a month (handled below).
  if (map.BYSETPOS && freq !== 'monthly') return null;
  // "Every weekday" is often written as a DAILY rule filtered by BYDAY. With
  // INTERVAL=1 that is exactly a weekly rule on those days; with a larger
  // interval it is a comb the engine has no teeth for.
  if (freq === 'daily' && map.BYDAY) {
    if ((parseInt(map.INTERVAL, 10) || 1) !== 1) return null;
    freq = 'weekly';
  }
  // A yearly rule by weekday, or a monthly rule on several weekdays, has no
  // shape here either.
  if (freq === 'yearly' && map.BYDAY) return null;
  if (freq === 'monthly' && map.BYDAY && map.BYDAY.split(',').length > 1) return null;

  const rule = { freq, interval: Math.max(1, parseInt(map.INTERVAL, 10) || 1) };
  if (freq === 'weekly' && map.BYDAY) {
    rule.byWeekday = map.BYDAY.split(',')
      .map((tok) => ICS_WEEKDAYS.indexOf(tok.replace(/^[+-]?\d+/, '').toUpperCase()))
      .filter((i) => i >= 0);
  }
  if (freq === 'weekly' && rule.interval >= 2) {
    // WKST decides which week each BYDAY day belongs to, so with INTERVAL>=2
    // a BYDAY spanning the week boundary lands a whole week off under the
    // wrong anchor. RFC 5545 defaults WKST to MO — our own exports pin SU.
    const w = ICS_WEEKDAYS.indexOf((map.WKST || '').toUpperCase());
    rule.wkst = w >= 0 ? w : 1;
  }
  if (freq === 'monthly') {
    rule.monthlyMode = map.BYDAY ? 'weekday' : 'date';
    // Carry the BYDAY ordinal through explicitly: "-1FR" is "the LAST Friday",
    // which deriving from DTSTART cannot express — a fourth-and-last Friday
    // would silently become "the 4th" (wrong in five-Friday months) and a
    // fifth-and-last would skip every month without five. Ordinals the engine
    // can't represent (-2 and below) fall back to deriving from DTSTART.
    if (map.BYDAY) {
      const m = /^([+-]?\d{1,2})?[A-Za-z]{2}$/.exec(map.BYDAY.split(',')[0].trim());
      let nth = m && m[1] ? parseInt(m[1], 10) : NaN;
      // Outlook/Exchange write "the last Friday" as BYDAY=FR;BYSETPOS=-1 —
      // the ordinal lives in BYSETPOS, not in the BYDAY token. Same
      // representable set, so it feeds the same monthlyNth. A BYSETPOS list
      // ("1,3") names two Fridays a month; parseInt would quietly read it as
      // the first alone.
      if (!Number.isFinite(nth) && map.BYSETPOS) {
        nth = /^[+-]?\d+$/.test(map.BYSETPOS.trim()) ? parseInt(map.BYSETPOS, 10) : NaN;
      }
      // No ordinal anywhere means EVERY such weekday of the month (RFC 5545:
      // BYDAY=FR under MONTHLY is every Friday) — not "the one the DTSTART
      // falls on", which deriving the nth from DTSTART used to fabricate. An
      // ordinal the engine can't hold (-2 and below) is likewise not "some
      // other ordinal". Both are one-offs, per the policy above.
      if (!(nth === -1 || (nth >= 1 && nth <= 5))) return null;
      rule.monthlyNth = nth;
    }
  }
  if (map.COUNT) rule.count = Math.max(1, parseInt(map.COUNT, 10) || 1);
  else if (map.UNTIL) {
    // An all-day series' UNTIL bounds a whole calendar day. Force DATE parsing so
    // a non-conformant DATE-TIME/UTC UNTIL (e.g. "20260714T235959Z" — which
    // RFC 5545 forbids for a DATE DTSTART, but real exporters still emit) is read
    // as that local day's end, not a raw UTC instant. Without this the instant in
    // a positive-offset zone lands on the next local day and admits one extra
    // occurrence. (The `allDay` argument existed for this and was going unused.)
    const u = parseDateTime({ value: map.UNTIL, params: allDay ? 'VALUE=DATE' : '' });
    rule.until = u.dateOnly ? endOfDay(new Date(u.ms)).getTime() : u.ms;
  }
  return rule;
}

/* ---- Low-level formatting / parsing ---------------------------------- */

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}
function fmtLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function fmtUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    // Normalize every line break — CRLF, lone LF, and lone CR — to an escaped
    // \n. A bare CR left on the wire is turned into a line split by `unfold`
    // (which maps \r -> \n), orphaning the tail into a line with no ':' that
    // `parseLine` drops — silently truncating the value on import.
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}
function unescapeText(v) {
  let out = '';
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '\\' && i + 1 < v.length) {
      const n = v[++i];
      out += n === 'n' || n === 'N' ? '\n' : n;
    } else {
      out += v[i];
    }
  }
  return out;
}

/** Fold a content line to <=75 octets with CRLF + space continuations
 *  (RFC 5545 §3.1). Folds on UTF-8 octet boundaries and never splits a
 *  multi-byte character / surrogate pair — a naive 75-UTF-16-unit slice can cut
 *  an emoji in half, and the lone surrogates then corrupt to U+FFFD once the
 *  string is UTF-8 encoded for download. For plain ASCII this yields the same
 *  fold points as a 75/74 character split. Each continuation line begins with a
 *  space, which counts toward its 75-octet budget. */
function foldLine(line) {
  const octets = (cp) => (cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4);
  let out = '';
  let lineBytes = 0;
  for (const ch of line) {
    const b = octets(ch.codePointAt(0));
    if (lineBytes + b > 75) {
      out += '\r\n ';
      lineBytes = 1; // the leading space of the continuation line
    }
    out += ch;
    lineBytes += b;
  }
  return out;
}

function unfold(text) {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else if (line.length) {
      out.push(line);
    }
  }
  return out;
}

function parseLine(line) {
  // Split on the value delimiter: the first ':' that is NOT inside a quoted
  // parameter value. RFC 5545 §3.2 lets a quoted param value carry a COLON — a
  // Windows/Outlook TZID such as `TZID="(UTC-05:00) Eastern Time"` is the common
  // case. Splitting on the first raw ':' would cut inside the quotes, so
  // DTSTART/DTEND then parse to NaN and the whole event is silently dropped on
  // import. A line with no quoted params (all of this app's own exports, and
  // most others) has its first ':' outside any quote, so this matches the old
  // indexOf(':') exactly. The name/params split at the first ';' stays correct:
  // the property name precedes every parameter, so no quote can appear before it.
  let idx = -1;
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;
  const left = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const semi = left.indexOf(';');
  return {
    name: (semi === -1 ? left : left.slice(0, semi)).toUpperCase(),
    params: semi === -1 ? '' : left.slice(semi + 1),
    value,
  };
}

function propOf(block, name) {
  return block.find((p) => p.name === name) || null;
}
function propsOf(block, name) {
  return block.filter((p) => p.name === name);
}
function valueOf(block, name) {
  const p = propOf(block, name);
  return p ? p.value : null;
}

/** Parse an iCal DATE or DATE-TIME property into { ms, dateOnly }. */
function parseDateTime(prop) {
  if (!prop || !prop.value) return { ms: NaN, dateOnly: false };
  const v = prop.value.trim();
  const dateOnly = /VALUE=DATE(;|$)/i.test(prop.params || '') || !v.includes('T');
  const y = Number(v.slice(0, 4));
  const mo = Number(v.slice(4, 6)) - 1;
  const d = Number(v.slice(6, 8));
  if (dateOnly) return { ms: new Date(y, mo, d).getTime(), dateOnly: true };
  const h = Number(v.slice(9, 11));
  const mi = Number(v.slice(11, 13));
  const s = Number(v.slice(13, 15)) || 0;
  // The UTC designator is 'Z' per RFC 5545; accept a lowercase 'z' too so a
  // non-conformant exporter's UTC time isn't silently read as floating local
  // (which would shift the instant by the local offset).
  if (/[zZ]$/.test(v)) return { ms: Date.UTC(y, mo, d, h, mi, s), dateOnly: false };
  // A TZID names the zone the wall-clock digits belong to; convert to the true
  // instant. An unknown/absent zone falls back to floating local time, which
  // matches how this module exports (no TZID, no Z).
  const tzid = tzidOf(prop.params);
  if (tzid && isValidTimeZone(tzid)) {
    const ms = zonedTimeToUTC(y, mo, d, h, mi, s, tzid);
    if (Number.isFinite(ms)) return { ms, dateOnly: false };
  }
  return { ms: new Date(y, mo, d, h, mi, s).getTime(), dateOnly: false };
}

/** A zone-free calendar-day index of yyyymmdd digits (days since the epoch of
 *  that calendar date), so two dates can be subtracted in whole days. */
function dayIndexOfDigits(value) {
  const v = String(value).trim();
  return Math.round(Date.UTC(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8))) / MS_PER_DAY);
}

/** The calendar date of an instant in `tz`, as yyyymmdd digits. */
function digitsInZone(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}${get('month')}${get('day')}`;
}

/**
 * The zone a timed series' DTSTART is written in: its TZID, 'UTC' for a Z
 * value, or '' for a floating one.
 */
function sourceZoneOf(dtStart) {
  if (!dtStart || !dtStart.value) return '';
  const tzid = tzidOf(dtStart.params);
  if (tzid && isValidTimeZone(tzid)) return tzid;
  return /[zZ]$/.test(dtStart.value.trim()) ? 'UTC' : '';
}

/**
 * The recurrence id — the engine's slot — that an EXDATE / RECURRENCE-ID names
 * on a timed series.
 *
 * The engine repeats the master's LOCAL wall clock by calendar day. The true
 * instant of a zoned exception equals that wall clock only while the file's
 * zone and the browser's are the same distance apart as they were at DTSTART;
 * where their clock changes fall on different dates (Berlin's three weeks after
 * New York's), the two differ by an hour for those weeks — the cancelled
 * occurrence came back and the edited one lost its edit. So match the way the
 * engine schedules: the exception's calendar-day distance from DTSTART, in the
 * file's own zone, carried onto the master's local start. A floating series
 * has no zone to disagree with and keeps the plain instant.
 */
function exceptionSlotMs(prop, srcTz, dtStart, startMs) {
  const parsed = parseDateTime(prop);
  if (!Number.isFinite(parsed.ms) || !srcTz || !Number.isFinite(startMs)) return parsed.ms;
  const day = parsed.dateOnly ? dayIndexOfDigits(prop.value) : dayIndexOfDigits(digitsInZone(parsed.ms, srcTz));
  const delta = day - dayIndexOfDigits(dtStart.value);
  return addDays(new Date(startMs), delta).getTime();
}

/** Weekday (0-6) of the literal yyyymmdd digits of an iCal DATE/DATE-TIME
 *  value — i.e. the weekday of that calendar date in the value's OWN zone
 *  (a calendar date has the same weekday in every zone). */
function weekdayOfDigits(value) {
  const v = String(value).trim();
  return new Date(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8))).getDay();
}

/** Extract a `TZID` value from a property's raw params (handles quoting).
 *  Resolved through `resolveTzid` — Outlook's display names ("Eastern Standard
 *  Time") and Thunderbird's `/mozilla.org/<version>/<Olson name>` ids aren't
 *  IANA names on their own, and VTIMEZONE (which would otherwise define them)
 *  is dropped entirely (see the module header). Both callers of this function
 *  (`parseDateTime`, `sourceZoneOf`) get the fix from this one place. */
function tzidOf(params) {
  if (!params) return null;
  const m = /TZID=(?:"([^"]+)"|([^;]+))/i.exec(params);
  return m ? resolveTzid(m[1] || m[2]) : null;
}

/** Extract a named parameter's value from a property's raw params (handles
 *  quoting, e.g. `CN="Doe; Jane"`). Anchored at a param boundary so e.g.
 *  SENT-BY never matches a CN lookup. */
function paramOf(params, name) {
  if (!params) return null;
  const m = new RegExp(`(?:^|;)${name}=(?:"([^"]*)"|([^;]*))`, 'i').exec(params);
  const v = m ? (m[1] != null ? m[1] : m[2] || '').trim() : '';
  return v || null;
}

/** "mailto:jane@x.com" (any case, with stray quotes/space) -> "jane@x.com". */
function mailtoEmail(value) {
  return String(value || '')
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/^mailto:/i, '')
    .trim()
    .toLowerCase();
}

/** `;CN="…"` parameter for a display name, or '' when absent. Embedded quotes
 *  are dropped (RFC 5545 param values cannot contain a DQUOTE at all). */
function cnParam(name) {
  // Strip quotes AND control characters: an embedded newline (reachable via a
  // JSON import — single-line UI fields can't produce one) would break the
  // ATTENDEE/ORGANIZER line mid-property, and the unterminated quote makes
  // parsers drop the whole guest.
  const n =
    typeof name === 'string' ? name.replace(/["\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return n ? `;CN="${n}"` : '';
}

/**
 * Parse an RFC 5545 DURATION (an ISO-8601 subset, e.g. "PT1H30M", "P3D", "P1W",
 * "-PT15M") to milliseconds, or null if it isn't a well-formed duration.
 */
function parseDuration(v) {
  if (!v) return null;
  const m = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  if (!w && !d && !h && !mi && !s) return null; // "P" with no components
  let ms = 0;
  if (w) ms += Number(w) * 7 * MS_PER_DAY;
  if (d) ms += Number(d) * MS_PER_DAY;
  if (h) ms += Number(h) * MS_PER_HOUR;
  if (mi) ms += Number(mi) * MS_PER_MINUTE;
  if (s) ms += Number(s) * 1000;
  return sign === '-' ? -ms : ms;
}

/**
 * "Minutes before the start" for each VALARM this app can express. Only a
 * start-relative, non-positive DURATION trigger maps: RELATED=END is measured
 * from the wrong edge and an absolute DATE-TIME trigger is not an offset at
 * all, so both are skipped rather than turned into a notification at the wrong
 * time. The result is handed to the store, whose normalizeReminders dedupes,
 * sorts, caps the count and drops anything past its one-day ceiling.
 */
function remindersFromAlarms(alarms) {
  if (!Array.isArray(alarms) || !alarms.length) return [];
  const out = [];
  for (const alarm of alarms) {
    const trigger = alarm.find((p) => p.name === 'TRIGGER');
    if (!trigger) continue;
    const params = trigger.params || '';
    if (/RELATED=END/i.test(params) || /VALUE=DATE-TIME/i.test(params)) continue;
    const ms = parseDuration(trigger.value);
    // A positive duration fires AFTER the start — this app has no such offset.
    if (ms == null || ms > 0) continue;
    out.push(Math.round(-ms / MS_PER_MINUTE));
  }
  return out;
}
