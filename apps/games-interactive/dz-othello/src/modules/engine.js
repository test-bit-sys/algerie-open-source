/**
 * DZ-Othello: pure Reversi engine — zero DOM, zero deps.
 * grid[row][col]: 0 empty | 1 black (first) | 2 white.
 */

export const SIZE = 8;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export const initialState = () => {
  const grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  grid[3][3] = 2; // d4 white
  grid[3][4] = 1; // e4 black
  grid[4][3] = 1; // d5 black
  grid[4][4] = 2; // e5 white
  return { grid, turn: 1, passes: 0, moves: 0 };
};

/** Cells flipped if `player` places on (row, col); [] when illegal. */
export function flipsFor(grid, row, col, player) {
  if (grid[row][col] !== 0) return [];
  const foe = player === 1 ? 2 : 1;
  const all = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && grid[r][c] === foe) {
      line.push([r, c]);
      r += dr;
      c += dc;
    }
    if (line.length && r >= 0 && r < SIZE && c >= 0 && c < SIZE && grid[r][c] === player) {
      all.push(...line);
    }
  }
  return all;
}

/** All legal moves for the side to move: [{ row, col, flips }]. */
export function legalMoves(state) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const flips = flipsFor(state.grid, r, c, state.turn);
      if (flips.length) moves.push({ row: r, col: c, flips });
    }
  }
  return moves;
}

export const countDiscs = (state) => {
  let black = 0;
  let white = 0;
  for (const row of state.grid) {
    for (const v of row) {
      if (v === 1) black++;
      else if (v === 2) white++;
    }
  }
  return { black, white };
};

/**
 * Applies a legal move. Returns the NEXT state: the turn switches, and if
 * the new side has no move it passes (passes counter). Game ends when both
 * sides pass consecutively or the board is full.
 */
export function makeMove(state, move) {
  const grid = state.grid.map((r) => r.slice());
  grid[move.row][move.col] = state.turn;
  for (const [r, c] of move.flips) grid[r][c] = state.turn;

  let turn = state.turn === 1 ? 2 : 1;
  let passes = 0;
  const moves = state.moves + 1;
  const full = grid.every((row) => row.every((v) => v !== 0));

  const nextState = { grid, turn, passes, moves };

  if (!full && legalMoves({ ...nextState }).length === 0) {
    // The opponent must pass — skip back to the mover.
    turn = state.turn;
    passes = state.passes + 1;
  }

  const done = full || passes >= 2;
  return { grid, turn, passes, moves, gameOver: done };
}

/** 'playing' | 'win-black' | 'win-white' | 'draw' */
export function gameStatus(state) {
  if (!state.gameOver) return 'playing';
  const { black, white } = countDiscs(state);
  if (black > white) return 'win-black';
  if (white > black) return 'win-white';
  return 'draw';
}

export const clone = (state) => JSON.parse(JSON.stringify(state));
