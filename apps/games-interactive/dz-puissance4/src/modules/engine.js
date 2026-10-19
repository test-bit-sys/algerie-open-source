/**
 * DZ-Puissance4: pure Connect-Four engine — zero DOM, zero deps.
 * grid[row][col]: 0 empty | 1 red (P1) | 2 yellow (P2). row 0 = top.
 */

export const ROWS = 6;
export const COLS = 7;
export const WIN_LEN = 4;

export const initialState = () => ({
  grid: Array.from({ length: ROWS }, () => new Array(COLS).fill(0)),
  turn: 1,
  moves: 0
});

/** Columns where a disc can legally land (gravity: top row must be free). */
export function legalColumns(state) {
  const cols = [];
  for (let c = 0; c < COLS; c++) if (state.grid[0][c] === 0) cols.push(c);
  return cols;
}

/** Finds the winning line through (row, col) for `player`, or null. */
export function winLine(grid, row, col, player) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const line = [[row, col]];
    for (const sign of [1, -1]) {
      let r = row + sign * dr;
      let c = col + sign * dc;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && grid[r][c] === player) {
        line.push([r, c]);
        r += sign * dr;
        c += sign * dc;
      }
    }
    if (line.length >= WIN_LEN) return line;
  }
  return null;
}

/**
 * Drops a disc for the side to move. Returns a NEW state plus the landing
 * row, the winning line (if any) and the resulting status.
 * status: 'playing' | 'win-1' | 'win-2' | 'draw'
 */
export function drop(state, col) {
  if (col < 0 || col >= COLS || state.grid[0][col] !== 0) return null;
  let row = ROWS - 1;
  while (state.grid[row][col] !== 0) row--;

  const player = state.turn;
  const grid = state.grid.map((r) => r.slice());
  grid[row][col] = player;

  const line = winLine(grid, row, col, player);
  const moves = state.moves + 1;
  const full = moves >= ROWS * COLS;

  return {
    state: {
      grid,
      turn: player === 1 ? 2 : 1,
      moves
    },
    row,
    win: !!line,
    line,
    status: line ? `win-${player}` : full ? 'draw' : 'playing'
  };
}

/** Status recomputation for an arbitrary state (UI restore). */
export function status(state) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = state.grid[r][c];
      if (p && winLine(state.grid, r, c, p)) return `win-${p}`;
    }
  }
  if (state.moves >= ROWS * COLS) return 'draw';
  return 'playing';
}
