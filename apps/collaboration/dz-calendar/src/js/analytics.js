/**
 * Thin wrapper around Plausible custom events (the snippet lives in index.html).
 *
 * Analytics is strictly non-essential and best-effort: if the script was blocked
 * (ad/tracker blocker), hasn't loaded yet, or the beacon fails, track() is a
 * silent no-op and never throws — it must never change app behavior. The inline
 * snippet defines `window.plausible` as a queue stub immediately, so calls made
 * before the async script arrives are buffered rather than lost.
 *
 * We track only the few moments a user gets real value from the calendar, each
 * fired ONLY after the underlying action succeeds (so nothing counts while
 * offline, where writes are gated):
 *   - 'Event Created'        — scheduled something new (the core job).
 *   - 'Reminder Set'         — armed the app to notify them (started relying on it).
 *   - 'Calendar Imported'    — brought an existing calendar in (activation).
 *   - 'Booking Link Created' — published a page others can book them through.
 */
export function track(event, props) {
  try {
    if (typeof window === 'undefined' || typeof window.plausible !== 'function') return;
    window.plausible(event, props ? { props } : undefined);
  } catch {
    /* analytics must never break the app */
  }
}
