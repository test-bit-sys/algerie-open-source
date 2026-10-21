/**
 * Meeting links for the Puter Meetings app (meetings.puter.com).
 *
 * Meetings publishes a stateless recipe for other apps ("Minting links from
 * other apps" in its README): an *open room code* is 12 crypto-random
 * lowercase letters grouped `abcd-efgh-ijkl`, wrapped in
 * `https://meetings.puter.com/#/m/<code>` — and that is the entire protocol.
 * No API call, no launch, no account: nothing is created anywhere at mint
 * time, so minting is synchronous, free, and works everywhere the calendar
 * runs — the open web included.
 *
 * Semantics the UI leans on:
 *
 *  - The link is inert until first use. Guests who open it early wait in
 *    Meetings' lobby and join automatically once the meeting starts.
 *  - Whoever starts the meeting first owns the link (Meetings claims the
 *    room atomically, so concurrent starters race safely). Practically: the
 *    organizer should be the one to press Start.
 *  - Codes never expire — one link serves a whole recurring series.
 *  - Until someone starts it, a discarded link was never more than twelve
 *    letters: there is nothing to release or clean up.
 *
 * The 12 letters are the security: 56 bits of crypto-randomness keep links
 * unguessable and collisions between uncoordinated minters negligible, which
 * is why minting must go through crypto.getRandomValues (and why available()
 * refuses to offer the feature anywhere that lacks it).
 */

const MEETINGS_ORIGIN = 'https://meetings.puter.com/';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const CODE_LETTERS = 12;
const GROUP_LETTERS = 4; // abcd-efgh-ijkl

/**
 * True when `value` is exactly a Puter Meetings room link — nothing more.
 * Meeting URLs reach the calendar from outside too (ICS import, the booking
 * worker's pull), and several surfaces render or mail whatever they're given
 * as a clickable "Join" link; each of those holds the URL to this shape so a
 * foreign link can never ride along under the calendar's name. Both room-code
 * forms are live: 3-4-3 (classic) and 4-4-4 (open, what mintLink makes).
 * The workers keep their own copy of this test — they deploy as single files.
 */
export function isMeetingUrl(value) {
  if (typeof value !== 'string' || value.length > 100) return false;
  return /^https:\/\/meetings\.puter\.com\/#\/m\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|[a-z]{4}-[a-z]{4}-[a-z]{4})$/.test(
    value,
  );
}

export function createMeetings({ origin = MEETINGS_ORIGIN } = {}) {
  return {
    /** True when links can be minted here — i.e. crypto randomness exists.
     *  The editor uses this to decide whether to offer the button at all. */
    available() {
      return typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
    },

    /**
     * Mint a meeting link: `{ code, url }`. Local and instant — the meeting
     * room springs into existence only when someone opens the URL and starts
     * the meeting.
     */
    mintLink() {
      // Rejection sampling — 256 % 26 !== 0, so a bare modulo would skew the
      // letter distribution (and shave entropy off the code).
      const limit = 256 - (256 % LETTERS.length);
      const letters = [];
      while (letters.length < CODE_LETTERS) {
        const bytes = crypto.getRandomValues(new Uint8Array(CODE_LETTERS - letters.length));
        for (const byte of bytes) {
          if (byte < limit) letters.push(LETTERS[byte % LETTERS.length]);
        }
      }
      const groups = [];
      for (let i = 0; i < CODE_LETTERS; i += GROUP_LETTERS) {
        groups.push(letters.slice(i, i + GROUP_LETTERS).join(''));
      }
      const code = groups.join('-');
      return { code, url: `${origin}#/m/${code}` };
    },
  };
}
