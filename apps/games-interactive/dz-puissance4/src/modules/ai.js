/**
 * DZ-Puissance4 AI — negamax with alpha-beta pruning, window-based scoring
 * and center-first ordering. Pure, Node-testable.
 */

import { initialState, legalColumns, drop, ROWS, COLS } from './engine.js';

const ORDER = [3, 2, 4, 1, 5, 0, 6]; // center columns first

/** Scores every 4-length window on the board for `player`. */
function windowScore(state, player) {
  const { grid } = state;
  const foe = player === 1 ? 2 : 1;
  let score = 0;

  const evalWindow = (cells) => {
    const mine = cells.filter((v) => v === player).length;
    const theirs = cells.filter((v) => v === foe).length;
    const empty = cells.length - mine - theirs;
    if (mine === 4) return 100000;
    if (theirs === 4) return -100000;
    if (mine === 3 && empty === 1) return 60;
    if (theirs === 3 && empty === 1) return -80;
    if (mine === 2 && empty === 2) return 8;
    if (theirs === 2 && empty === 2) return -6;
    return 0;
  };

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 3 < COLS) score += evalWindow([grid[r][c], grid[r][c + 1], grid[r][c + 2], grid[r][c + 3]]);
      if (r + 3 < ROWS) score += evalWindow([grid[r][c], grid[r + 1][c], grid[r + 2][c], grid[r + 3][c]]);
      if (r + 3 < ROWS && c + 3 < COLS) {
        score += evalWindow([grid[r][c], grid[r + 1][c + 1], grid[r + 2][c + 2], grid[r + 3][c + 3]]);
      }
      if (r + 3 < ROWS && c - 3 >= 0) {
        score += evalWindow([grid[r][c], grid[r + 1][c - 1], grid[r + 2][c - 2], grid[r + 3][c - 3]]);
      }
    }
  }
  // Center control bonus.
  for (let r = 0; r < ROWS; r++) if (grid[r][3] === player) score += 3;
  return score;
}

function negamax(state, depth, alpha, beta) {
  const cols = legalColumns(state);
  if (cols.length === 0) return 0; // draw
  if (depth === 0) {
    const s = windowScore(state, state.turn);
    return state.turn === 1 ? s : -s;
  }

  let best = -Infinity;
  for (const col of ORDER) {
    if (!cols.includes(col)) continue;
    const res = drop(state, col);
    let score;
    if (res.win) score = 100000 + depth * 1000; // win sooner = better
    else if (res.status === 'draw') score = 0;
    else score = -negamax(res.state, depth - 1, -beta, -alpha);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * difficulty: 'easy' (depth 2, human randomness) | 'medium' (5) | 'hard' (8)
 * Returns { column, score } or null when the board is full.
 */
export function chooseColumn(state, difficulty = 'medium') {
  const depth = { easy: 2, medium: 5, hard: 8 }[difficulty] ?? 5;
  const cols = legalColumns(state);
  if (cols.length === 0) return null;

  let bestCol = cols[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;

  for (const col of ORDER) {
    if (!cols.includes(col)) continue;
    const res = drop(state, col);
    let score;
    if (res.win) score = 100000 + depth * 1000;
    else if (res.status === 'draw') score = 0;
    else score = -negamax(res.state, depth - 1, -Infinity, -alpha);

    if (difficulty === 'easy') score += Math.floor(Math.random() * 40) - 20;

    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
    if (score > alpha) alpha = score;
  }
  return { column: bestCol, score: bestScore };
}
