/**
 * DZ-Dama: pure English-draughts (checkers) engine — zero DOM, zero deps.
 * Board 64; playable squares are the dark ones: (rank + file) % 2 === 1.
 * Pieces: 'w' white man, 'W' white king, 'b' black man, 'B' black king.
 */

export const sq = (r, f) => r * 8 + f;
export const sqRank = (i) => i >> 3;
export const sqFile = (i) => i & 7;
export const toAN = (i) => 'abcdefgh'[sqFile(i)] + (8 - sqRank(i));
export const colorOf = (p) => (p === '' ? '' : p === 'w' || p === 'W' ? 'w' : 'b');
export const isKing = (p) => p === 'W' || p === 'B';

const FORWARD = { w: -1, b: 1 };
const PROMO_ROW = { w: 0, b: 7 };
const ALL_DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

export function initialState(forcedCaptures = true) {
  const board = new Array(64).fill('');
  for (let r = 0; r < 3; r++) {
    for (let f = 0; f < 8; f++) if ((r + f) % 2 === 1) board[sq(r, f)] = 'b';
  }
  for (let r = 5; r < 8; r++) {
    for (let f = 0; f < 8; f++) if ((r + f) % 2 === 1) board[sq(r, f)] = 'w';
  }
  return { board, turn: 'w', forcedCaptures, quiet: 0 };
}

/** Applies a move (possibly a multi-jump chain) and returns a NEW state. */
export function makeMove(state, move) {
  const board = state.board.slice();
  const piece = board[move.from];
  const landing = move.path[move.path.length - 1];
  board[move.from] = '';

  let promoted = false;
  if (!isKing(piece) && sqRank(landing) === PROMO_ROW[colorOf(piece)]) {
    board[landing] = colorOf(piece) === 'w' ? 'W' : 'B';
    promoted = true;
  } else {
    board[landing] = piece;
  }

  for (const cap of move.captured) board[cap] = '';

  return {
    board,
    turn: state.turn === 'w' ? 'b' : 'w',
    forcedCaptures: state.forcedCaptures,
    quiet: move.captured.length > 0 || promoted ? 0 : state.quiet + 1
  };
}

function pieceDirs(piece) {
  if (isKing(piece)) return ALL_DIAG;
  const dr = FORWARD[colorOf(piece)];
  return [[dr, -1], [dr, 1]];
}

/**
 * All capture sequences for one piece.
 * Captured pieces are removed as jumped (official rule: they can neither be
 * jumped twice nor block later landings of the same chain).
 * A man promoted mid-chain stops its move immediately.
 */
function findCaptures(board, from) {
  const piece = board[from];
  const color = colorOf(piece);
  const dirs = pieceDirs(piece);
  const work = board.slice();
  work[from] = ''; // the piece is lifted for the whole move

  const results = [];
  const dfs = (pos, captured, path, promoted) => {
    if (promoted) {
      results.push({ from, to: pos, path: [...path], captured: [...captured] });
      return;
    }
    let extended = false;
    const r = sqRank(pos);
    const f = sqFile(pos);
    for (const [dr, df] of dirs) {
      const mr = r + dr, mf = f + df;
      const lr = r + 2 * dr, lf = f + 2 * df;
      if (lr < 0 || lr > 7 || lf < 0 || lf > 7) continue;
      const mid = sq(mr, mf);
      const land = sq(lr, lf);
      if (work[mid] !== '' && colorOf(work[mid]) !== color && work[land] === '') {
        const jumped = work[mid];
        work[mid] = '';
        const nowPromoted = !isKing(piece) && sqRank(land) === PROMO_ROW[color];
        dfs(land, [...captured, mid], [...path, land], nowPromoted);
        work[mid] = jumped;
        extended = true;
      }
    }
    if (!extended && captured.length > 0) {
      results.push({ from, to: pos, path: [...path], captured: [...captured] });
    }
  };

  dfs(from, [], [from], false);
  return results;
}

function findSteps(board, from) {
  const piece = board[from];
  const moves = [];
  const r = sqRank(from);
  const f = sqFile(from);
  for (const [dr, df] of pieceDirs(piece)) {
    const rr = r + dr, ff = f + df;
    if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue;
    const to = sq(rr, ff);
    if (board[to] === '') moves.push({ from, to, path: [from, to], captured: [] });
  }
  return moves;
}

/** Legal moves for the side to move (captures are forced by default). */
export function generateMoves(state) {
  const captures = [];
  const steps = [];
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (p === '' || colorOf(p) !== state.turn) continue;
    const caps = findCaptures(state.board, i);
    if (caps.length) captures.push(...caps);
    steps.push(...findSteps(state.board, i)); // quiet steps of every piece
  }
  if (captures.length) return state.forcedCaptures ? captures : [...captures, ...steps];
  return steps;
}

/** 'playing' | 'win-w' | 'win-b' | 'draw' (60 quiet plies) */
export function gameStatus(state) {
  if (generateMoves(state).length === 0) {
    return state.turn === 'w' ? 'win-b' : 'win-w';
  }
  if (state.quiet >= 60) return 'draw';
  return 'playing';
}

/** Pretty move label: c3×e5×g7 (chain) or c3-d4 (step). */
export function moveToLabel(move) {
  return move.path.map(toAN).join(move.captured.length ? '\u00D7' : '-');
}

