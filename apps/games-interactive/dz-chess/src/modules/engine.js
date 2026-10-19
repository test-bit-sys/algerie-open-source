/**
 * DZ-Chess: Pure FIDE-rules chess engine — zero DOM, zero dependencies.
 * Board: 64-length array, index 0 = a8 ... index 63 = h1.
 * Pieces: 'PNBRQK' (white), 'pnbrqk' (black), '' (empty).
 * Fully validated against standard perft positions (see tests/engine.test.js).
 */

export const WHITE = 'w';
export const BLACK = 'b';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ---------------------------------------------------------------- squares
export const sq = (rank, file) => rank * 8 + file; // rank 0 = 8th rank (top)
export const sqRank = (i) => i >> 3;
export const sqFile = (i) => i & 7;
export const toAN = (i) => 'abcdefgh'[sqFile(i)] + (8 - sqRank(i));
export const fromAN = (an) => sq(8 - Number(an[1]), 'abcdefgh'.indexOf(an[0]));

export const colorOf = (p) => (p === '' ? '' : p === p.toUpperCase() ? 'w' : 'b');

// ---------------------------------------------------------------- FEN
export function fromFEN(fen) {
  const parts = fen.trim().split(/\s+/);
  const board = new Array(64).fill('');
  let i = 0;
  for (const ch of parts[0]) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') i += Number(ch);
    else board[i++] = ch;
  }
  return {
    board,
    turn: parts[1] === 'b' ? 'b' : 'w',
    castling: {
      wk: parts[2].includes('K'),
      wq: parts[2].includes('Q'),
      bk: parts[2].includes('k'),
      bq: parts[2].includes('q')
    },
    ep: parts[3] && parts[3] !== '-' ? fromAN(parts[3]) : null,
    halfmove: Number(parts[4]) || 0,
    fullmove: Number(parts[5]) || 1
  };
}

export function toFEN(state) {
  let placement = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = state.board[sq(r, f)];
      if (p === '') empty++;
      else {
        if (empty) { placement += empty; empty = 0; }
        placement += p;
      }
    }
    if (empty) placement += empty;
    if (r < 7) placement += '/';
  }
  const c = state.castling;
  const rights = `${c.wk ? 'K' : ''}${c.wq ? 'Q' : ''}${c.bk ? 'k' : ''}${c.bq ? 'q' : ''}` || '-';
  return `${placement} ${state.turn} ${rights} ${state.ep === null ? '-' : toAN(state.ep)} ${state.halfmove} ${state.fullmove}`;
}

export const initialState = () => fromFEN(START_FEN);

// ---------------------------------------------------------------- attacks
const KNIGHT_DELTAS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_DELTAS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/** Is `square` attacked by any piece of `byColor` in `state`? */
export function isAttacked(state, square, byColor) {
  const { board } = state;
  const r = sqRank(square);
  const f = sqFile(square);

  // Pawns: a white pawn on (r+1, f±1) attacks (r, f); black on (r-1, f±1).
  const pr = byColor === 'w' ? r + 1 : r - 1;
  const pawn = byColor === 'w' ? 'P' : 'p';
  if (pr >= 0 && pr < 8) {
    if (f > 0 && board[sq(pr, f - 1)] === pawn) return true;
    if (f < 7 && board[sq(pr, f + 1)] === pawn) return true;
  }

  for (const [dr, df] of KNIGHT_DELTAS) {
    const rr = r + dr, ff = f + df;
    if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
      const p = board[sq(rr, ff)];
      if (colorOf(p) === byColor && (p === 'N' || p === 'n')) return true;
    }
  }

  for (const [dr, df] of KING_DELTAS) {
    const rr = r + dr, ff = f + df;
    if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
      const p = board[sq(rr, ff)];
      if (colorOf(p) === byColor && (p === 'K' || p === 'k')) return true;
    }
  }

  for (const [dr, df] of ROOK_DIRS) {
    let rr = r + dr, ff = f + df;
    while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
      const p = board[sq(rr, ff)];
      if (p !== '') {
        if (colorOf(p) === byColor && (p.toUpperCase() === 'R' || p.toUpperCase() === 'Q')) return true;
        break;
      }
      rr += dr; ff += df;
    }
  }

  for (const [dr, df] of BISHOP_DIRS) {
    let rr = r + dr, ff = f + df;
    while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
      const p = board[sq(rr, ff)];
      if (p !== '') {
        if (colorOf(p) === byColor && (p.toUpperCase() === 'B' || p.toUpperCase() === 'Q')) return true;
        break;
      }
      rr += dr; ff += df;
    }
  }

  return false;
}

/** Pseudo-legal moves (king safety NOT yet filtered) for the side to move. */
function generatePseudo(state) {
  const { board, turn } = state;
  const moves = [];
  const white = turn === 'w';

  const push = (from, to, extra = {}) => {
    const piece = board[from];
    const captured = extra.ep ? (white ? 'p' : 'P') : board[to];
    moves.push({ from, to, piece, captured: captured || '', ...extra });
  };

  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (piece === '' || colorOf(piece) !== turn) continue;
    const r = sqRank(from);
    const f = sqFile(from);
    const upper = piece.toUpperCase();

    if (upper === 'P') {
      const dir = white ? -1 : 1;             // white marches toward rank 0
      const startRank = white ? 6 : 1;
      const promoRank = white ? 0 : 7;
      const one = sq(r + dir, f);
      if (r + dir >= 0 && r + dir < 8 && board[one] === '') {
        if (r + dir === promoRank) {
          for (const promo of ['Q', 'R', 'B', 'N']) push(from, one, { promotion: promo });
        } else {
          push(from, one);
          if (r === startRank && board[sq(r + 2 * dir, f)] === '') {
            push(from, sq(r + 2 * dir, f), { double: true });
          }
        }
      }
      for (const df of [-1, 1]) {
        const ff = f + df;
        const rr = r + dir;
        if (ff < 0 || ff > 7 || rr < 0 || rr > 7) continue;
        const target = sq(rr, ff);
        const victim = board[target];
        if (victim !== '' && colorOf(victim) !== turn) {
          if (rr === promoRank) {
            for (const promo of ['Q', 'R', 'B', 'N']) push(from, target, { promotion: promo });
          } else push(from, target);
        } else if (victim === '' && state.ep === target) {
          push(from, target, { ep: true });
        }
      }
      continue;
    }

    if (upper === 'N' || upper === 'K') {
      const deltas = upper === 'N' ? KNIGHT_DELTAS : KING_DELTAS;
      for (const [dr, df] of deltas) {
        const rr = r + dr, ff = f + df;
        if (rr < 0 || rr > 7 || ff < 0 || ff > 7) continue;
        const target = sq(rr, ff);
        const victim = board[target];
        if (victim === '' || colorOf(victim) !== turn) push(from, target);
      }
      if (upper === 'K') {
        // Castling: intermediate squares must be empty, the king square and
        // the crossed square must not be attacked (landing is checked by the
        // legality filter). Rook presence is verified on the board.
        if (white) {
          if (state.castling.wk && board[61] === '' && board[62] === '' && board[63] === 'R'
            && !isAttacked(state, 60, 'b') && !isAttacked(state, 61, 'b')) push(from, 62, { castle: 'K' });
          if (state.castling.wq && board[59] === '' && board[58] === '' && board[57] === '' && board[56] === 'R'
            && !isAttacked(state, 60, 'b') && !isAttacked(state, 59, 'b')) push(from, 58, { castle: 'Q' });
        } else {
          if (state.castling.bk && board[5] === '' && board[6] === '' && board[7] === 'r'
            && !isAttacked(state, 4, 'w') && !isAttacked(state, 5, 'w')) push(from, 6, { castle: 'K' });
          if (state.castling.bq && board[3] === '' && board[2] === '' && board[1] === '' && board[0] === 'r'
            && !isAttacked(state, 4, 'w') && !isAttacked(state, 3, 'w')) push(from, 2, { castle: 'Q' });
        }
      }
      continue;
    }

    const dirs = upper === 'R' ? ROOK_DIRS
      : upper === 'B' ? BISHOP_DIRS
      : [...ROOK_DIRS, ...BISHOP_DIRS];
    for (const [dr, df] of dirs) {
      let rr = r + dr, ff = f + df;
      while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
        const target = sq(rr, ff);
        const victim = board[target];
        if (victim === '') push(from, target);
        else {
          if (colorOf(victim) !== turn) push(from, target);
          break;
        }
        rr += dr; ff += df;
      }
    }
  }

  return moves;
}

export const findKing = (state, color) => state.board.indexOf(color === 'w' ? 'K' : 'k');

/** Applies a move and returns a NEW immutable state (original untouched). */
export function makeMove(state, move) {
  const board = state.board.slice();
  const castling = { ...state.castling };
  const white = state.turn === 'w';
  const piece = move.piece;

  board[move.from] = '';
  board[move.to] = move.promotion
    ? (white ? move.promotion : move.promotion.toLowerCase())
    : piece;

  if (move.ep) board[move.to + (white ? 8 : -8)] = '';

  if (move.castle === 'K') {
    if (white) { board[63] = ''; board[61] = 'R'; } else { board[7] = ''; board[5] = 'r'; }
  } else if (move.castle === 'Q') {
    if (white) { board[56] = ''; board[59] = 'R'; } else { board[0] = ''; board[3] = 'r'; }
  }

  if (piece === 'K') { castling.wk = false; castling.wq = false; }
  if (piece === 'k') { castling.bk = false; castling.bq = false; }
  if (move.from === 63 || move.to === 63) castling.wk = false;
  if (move.from === 56 || move.to === 56) castling.wq = false;
  if (move.from === 7 || move.to === 7) castling.bk = false;
  if (move.from === 0 || move.to === 0) castling.bq = false;

  return {
    board,
    turn: white ? 'b' : 'w',
    castling,
    ep: move.double ? move.from + (white ? -8 : 8) : null,
    halfmove: piece.toUpperCase() === 'P' || move.captured ? 0 : state.halfmove + 1,
    fullmove: white ? state.fullmove : state.fullmove + 1
  };
}

/** Fully legal moves: filters any move leaving the mover's king attacked. */
export function generateMoves(state) {
  const color = state.turn;
  const enemy = color === 'w' ? 'b' : 'w';
  return generatePseudo(state).filter((m) => {
    const next = makeMove(state, m);
    return !isAttacked(next, findKing(next, color), enemy);
  });
}

export const inCheck = (state) =>
  isAttacked(state, findKing(state, state.turn), state.turn === 'w' ? 'b' : 'w');

/** Repetition-detection key (board + turn + rights + ep). */
export const positionKey = (state) =>
  state.board.join('') + state.turn +
  (state.castling.wk ? 'K' : '') + (state.castling.wq ? 'Q' : '') +
  (state.castling.bk ? 'k' : '') + (state.castling.bq ? 'q' : '') +
  (state.ep ?? '-');

export function insufficientMaterial(state) {
  const minors = { w: 0, b: 0 };
  for (const p of state.board) {
    if (p === '') continue;
    const u = p.toUpperCase();
    if (u === 'P' || u === 'R' || u === 'Q') return false;
    if (u === 'B' || u === 'N') minors[p === u ? 'w' : 'b']++;
  }
  return minors.w <= 1 && minors.b <= 1;
}

/** 'playing' | 'check' | 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material' */
export function gameStatus(state, repetitionCount = 1) {
  if (generateMoves(state).length === 0) return inCheck(state) ? 'checkmate' : 'stalemate';
  if (state.halfmove >= 100) return 'fifty';
  if (repetitionCount >= 3) return 'repetition';
  if (insufficientMaterial(state)) return 'material';
  return inCheck(state) ? 'check' : 'playing';
}

// ---------------------------------------------------------------- SAN
function sanSuffix(state, move) {
  const next = makeMove(state, move);
  if (!inCheck(next)) return '';
  return generateMoves(next).length === 0 ? '#' : '+';
}

/** Standard Algebraic Notation for a legal move in `state`. */
export function toSAN(state, move) {
  if (move.castle) {
    return (move.castle === 'K' ? 'O-O' : 'O-O-O') + sanSuffix(state, move);
  }
  const piece = move.piece.toUpperCase();
  let text = '';
  if (piece === 'P') {
    text = move.captured ? 'abcdefgh'[sqFile(move.from)] + 'x' : '';
    text += toAN(move.to);
    if (move.promotion) text += '=' + move.promotion;
  } else {
    text = piece;
    const rivals = generateMoves(state).filter(
      (m) => m.piece === move.piece && m.to === move.to && m.from !== move.from
    );
    if (rivals.length) {
      const sameFile = rivals.some((m) => sqFile(m.from) === sqFile(move.from));
      const sameRank = rivals.some((m) => sqRank(m.from) === sqRank(move.from));
      if (!sameFile) text += 'abcdefgh'[sqFile(move.from)];
      else if (!sameRank) text += (8 - sqRank(move.from));
      else text += toAN(move.from);
    }
    if (move.captured) text += 'x';
    text += toAN(move.to);
  }
  return text + sanSuffix(state, move);
}

// ---------------------------------------------------------------- perft
/** Standard move-generation node counter used to validate correctness. */
export function perft(state, depth) {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of generateMoves(state)) {
    nodes += perft(makeMove(state, move), depth - 1);
  }
  return nodes;
}


