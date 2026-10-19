/**
 * DZ-Tawla: pure Backgammon engine — zero DOM, zero deps.
 * points[1..24]: positive = white checkers, negative = black checkers.
 * White marches 24 -> 1 and bears off from home (1..6), entering at 25 - die.
 * Black marches 1 -> 24, home 19..24, entering at die.
 */

export function initialState() {
  const points = new Array(25).fill(0);
  points[24] = 2; points[13] = 5; points[8] = 3; points[6] = 5;     // white
  points[1] = -2; points[12] = -5; points[17] = -3; points[19] = -5; // black
  return {
    points,
    bar: { w: 0, b: 0 },
    off: { w: 0, b: 0 },
    turn: 'w',
    dice: null,
    remaining: [],
    rolled: false
  };
}

export const clone = (s) => ({
  points: s.points.slice(),
  bar: { ...s.bar },
  off: { ...s.off },
  turn: s.turn,
  dice: s.dice,
  remaining: s.remaining.slice(),
  rolled: s.rolled
});

export function rollDice(state, rng = Math.random) {
  const d1 = 1 + Math.floor(rng() * 6);
  const d2 = 1 + Math.floor(rng() * 6);
  state.dice = [d1, d2];
  state.remaining = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
  state.rolled = true;
  return state;
}

const isWhite = (s) => s.turn === 'w';
const ownCount = (s, p) => (isWhite(s) ? Math.max(0, s.points[p]) : Math.max(0, -s.points[p]));
const oppCount = (s, p) => (isWhite(s) ? Math.max(0, -s.points[p]) : Math.max(0, s.points[p]));
const canLand = (s, p) => oppCount(s, p) <= 1;

/** Pip count: total distance to bear off, bar checkers cost 25. */
export function pipCount(state, color) {
  let pip = 0;
  for (let p = 1; p <= 24; p++) {
    const count = color === 'w' ? Math.max(0, state.points[p]) : Math.max(0, -state.points[p]);
    if (count) pip += count * (color === 'w' ? p : 25 - p);
  }
  pip += state.bar[color] * 25;
  return pip;
}

/** True when every checker of the side to move is inside its home board. */
function allHome(state) {
  const white = isWhite(state);
  for (let p = 1; p <= 24; p++) {
    const v = state.points[p];
    if (white ? v > 0 : v < 0) {
      const inHome = white ? p <= 6 : p >= 19;
      if (!inHome) return false;
    }
  }
  return true;
}

/** All single moves allowed for one die value. */
function singleMoves(state, die) {
  const moves = [];
  const white = isWhite(state);

  // 1) Entering from the bar is mandatory while checkers sit there.
  if (state.bar[white ? 'w' : 'b'] > 0) {
    const entry = white ? 25 - die : die;
    if (canLand(state, entry)) {
      moves.push({ kind: 'enter', from: 'bar', to: entry, die, hit: oppCount(state, entry) === 1 });
    }
    return moves;
  }

  // 2) Bear-off (exact die, or a higher die when nothing farther remains).
  if (allHome(state)) {
    const exact = white ? die : 25 - die;
    if (ownCount(state, exact) > 0) {
      moves.push({ kind: 'off', from: exact, to: 'off', die, hit: false });
    } else {
      if (white) {
        for (let p = 6; p >= 1; p--) {
          if (ownCount(state, p) > 0) {
            if (p < die) moves.push({ kind: 'off', from: p, to: 'off', die, hit: false });
            break;
          }
        }
      } else {
        for (let p = 19; p <= 24; p++) {
          if (ownCount(state, p) > 0) {
            if (p > 25 - die) moves.push({ kind: 'off', from: p, to: 'off', die, hit: false });
            break;
          }
        }
      }
    }
    // Within-home moves below remain fully legal even when bearing off is possible.
  }

  // 3) Regular point-to-point moves.
  for (let p = 1; p <= 24; p++) {
    if (ownCount(state, p) === 0) continue;
    const target = white ? p - die : p + die;
    if (target >= 1 && target <= 24 && canLand(state, target)) {
      moves.push({ kind: 'move', from: p, to: target, die, hit: oppCount(state, target) === 1 });
    }
  }
  return moves;
}

const moveKey = (m) => `${m.die}:${m.from}->${m.to}`;

/** Every distinct single move for every remaining die value. */
export function allSingleMoves(state) {
  const moves = [];
  const seen = new Set();
  for (const die of state.remaining) {
    for (const m of singleMoves(state, die)) {
      const k = moveKey(m);
      if (!seen.has(k)) {
        seen.add(k);
        moves.push(m);
      }
    }
  }
  return moves;
}

/** Applies ONE single move in place (mutating). */
export function applyMove(state, move) {
  const white = state.turn === 'w';

  if (move.kind === 'enter') {
    state.bar[white ? 'w' : 'b'] -= 1;
  } else {
    state.points[move.from] -= white ? 1 : -1;
  }

  if (move.to === 'off') {
    state.off[white ? 'w' : 'b'] += 1;
  } else if (move.hit) {
    state.bar[white ? 'b' : 'w'] += 1;
    state.points[move.to] = white ? 1 : -1;
  } else {
    state.points[move.to] += white ? 1 : -1;
  }

  const idx = state.remaining.indexOf(move.die);
  if (idx !== -1) state.remaining.splice(idx, 1);
  return state;
}

/**
 * Fully-legal moves for the CURRENT position of the turn:
 * only first-moves that belong to a sequence playing the MAXIMUM possible
 * number of dice. When exactly one die of a two-die roll can ever be
 * played — but both are individually playable — the HIGHER die is forced.
 */
export function turnMoves(state) {
  const moves = allSingleMoves(state);
  if (moves.length === 0 || state.remaining.length === 0) return [];

  const memo = new Map();
  const longestFrom = (st) => {
    const key = `${st.points.join(',')}|${st.bar.w}${st.bar.b}|${st.remaining.join(',')}`;
    if (memo.has(key)) return memo.get(key);
    if (st.remaining.length === 0) return 0;
    const singles = allSingleMoves(st);
    if (singles.length === 0) return 0;
    let best = 0;
    for (const m of singles) {
      const next = clone(st);
      applyMove(next, m);
      const len = 1 + longestFrom(next);
      if (len > best) best = len;
    }
    memo.set(key, best);
    return best;
  };

  const scored = moves.map((m) => {
    const next = clone(state);
    applyMove(next, m);
    return { m, len: 1 + longestFrom(next) };
  });
  const maxLen = Math.max(...scored.map((s) => s.len));
  let result = scored.filter((s) => s.len === maxLen).map((s) => s.m);

  // Two fresh dice, only one die will ever be played, both playable alone:
  // the higher die is forced by the official rules.
  const startOfTwo =
    state.dice && state.dice[0] !== state.dice[1] && state.remaining.length === 2;
  if (startOfTwo && maxLen === 1) {
    const diceUsed = new Set(result.map((m) => m.die));
    if (diceUsed.size === 2) {
      const hi = Math.max(state.dice[0], state.dice[1]);
      result = result.filter((m) => m.die === hi);
    }
  }
  return result;
}

/** 'playing' | winner with gammon/backgammon value. */
export function gameStatus(state) {
  if (state.off.w === 15) return { over: true, winner: 'w', value: gammonValue(state, 'w') };
  if (state.off.b === 15) return { over: true, winner: 'b', value: gammonValue(state, 'b') };
  return { over: false, winner: null, value: 0 };
}

function gammonValue(state, winner) {
  const loser = winner === 'w' ? 'b' : 'w';
  if (state.off[loser] > 0) return 1; // regular win
  // Backgammon: loser still owns a checker on the bar or in the winner's home.
  const deep =
    state.bar[loser] > 0 ||
    (winner === 'w'
      ? state.points.slice(1, 7).some((v) => v < 0)
      : state.points.slice(19, 25).some((v) => v > 0));
  return deep ? 3 : 2;
}

