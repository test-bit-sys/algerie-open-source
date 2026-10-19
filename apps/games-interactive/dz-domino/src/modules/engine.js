/**
 * DZ-Domino: pure Draw-Dominoes engine (double-six) — zero DOM, zero deps.
 * Tiles: { id, a, b } with 0 <= a <= b <= 6. 28-tile deck.
 * Chain: ordered list of oriented halves [{ a, b, id }]; the open ends are
 * chain[0].a (left) and chain[chain.length - 1].b (right).
 */

export const TILE_SET = (() => {
  const tiles = [];
  let id = 0;
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) tiles.push({ id: id++, a, b });
  }
  return tiles;
})();

export function shuffle(array, rng = Math.random) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const pipsOf = (hand) => hand.reduce((sum, t) => sum + t.a + t.b, 0);
export const tilePips = (t) => t.a + t.b;

export const ends = (state) => state.chain.length
  ? { left: state.chain[0].a, right: state.chain[state.chain.length - 1].b }
  : { left: null, right: null };

/**
 * Starts a fresh match (or the next round keeping the scores).
 * The opening play is automatic and official: the holder of the highest
 * double opens with it; if nobody holds a double, the heaviest tile opens.
 */
export function newGameState({ players = 2, target = 100, scores = null, rng = Math.random } = {}) {
  const deck = shuffle(TILE_SET, rng);
  const hands = [];
  for (let i = 0; i < players; i++) hands.push(deck.splice(0, 7));

  const state = {
    players,
    target,
    hands,
    boneyard: deck,
    chain: [],
    turn: 0,
    passed: 0,
    scores: scores ?? new Array(players).fill(0),
    roundResult: null,
    gameOver: false,
    log: []
  };

  // --- automatic opening play
  let opener = -1;
  let openingTile = null;
  for (let v = 6; v >= 0 && !openingTile; v--) {
    for (let seat = 0; seat < players; seat++) {
      const found = hands[seat].find((t) => t.a === v && t.b === v);
      if (found) { opener = seat; openingTile = found; break; }
    }
  }
  if (!openingTile) {
    let heaviest = -1;
    for (let seat = 0; seat < players; seat++) {
      for (const t of hands[seat]) {
        if (tilePips(t) > heaviest) { heaviest = tilePips(t); opener = seat; openingTile = t; }
      }
    }
  }

  hands[opener] = hands[opener].filter((t) => t.id !== openingTile.id);
  state.chain.push({ ...openingTile });
  state.turn = (opener + 1) % players;
  state.log.push({ seat: opener, action: 'open', tile: openingTile });
  return state;
}

/**
 * Legal moves for the side to move:
 *   place (tile + end) | draw (boneyard non-empty, nothing matches) | pass.
 */
export function legalMoves(state) {
  const moves = [];
  if (state.roundResult) return moves;

  const hand = state.hands[state.turn];
  const e = ends(state);
  for (const tile of hand) {
    if (e.left !== null && (tile.a === e.left || tile.b === e.left)) {
      moves.push({ type: 'place', tileId: tile.id, end: 'left' });
    }
    if (e.right !== null && (tile.a === e.right || tile.b === e.right)) {
      moves.push({ type: 'place', tileId: tile.id, end: 'right' });
    }
  }
  if (moves.length === 0 && state.boneyard.length > 0) moves.push({ type: 'draw' });
  if (moves.length === 0 && state.boneyard.length === 0) moves.push({ type: 'pass' });
  return moves;
}

const nextTurn = (state) => {
  state.turn = (state.turn + 1) % state.players;
};

/** Applies a move IN PLACE (the UI keeps a clone chain for undo). */
export function makeMove(state, move) {
  const seat = state.turn;

  if (move.type === 'draw') {
    const tile = state.boneyard.pop();
    state.hands[seat].push(tile);
    state.log.push({ seat, action: 'draw' });
    return state; // same seat continues (must keep drawing or play)
  }

  if (move.type === 'pass') {
    state.passed += 1;
    state.log.push({ seat, action: 'pass' });
    if (state.passed >= state.players) {
      resolveBlocked(state);
      return state;
    }
    nextTurn(state);
    return state;
  }

  // --- place
  const hand = state.hands[seat];
  const tile = hand.find((t) => t.id === move.tileId);
  if (!tile) return state; // defensive: unknown tile
  const e = ends(state);
  let oriented;
  if (move.end === 'left') {
    oriented = tile.b === e.left ? { a: tile.a, b: tile.b, id: tile.id } : { a: tile.b, b: tile.a, id: tile.id };
    state.chain.unshift(oriented);
  } else {
    oriented = tile.a === e.right ? { a: tile.a, b: tile.b, id: tile.id } : { a: tile.b, b: tile.a, id: tile.id };
    state.chain.push(oriented);
  }
  state.hands[seat] = hand.filter((t) => t.id !== tile.id);
  state.passed = 0;
  state.log.push({ seat, action: 'place', tile, end: move.end });

  if (state.hands[seat].length === 0) {
    const points = state.hands.reduce(
      (sum, h, i) => (i === seat ? sum : sum + pipsOf(h)), 0
    );
    state.scores[seat] += points;
    state.roundResult = { winner: seat, points, blocked: false };
    state.gameOver = state.scores[seat] >= state.target;
  } else {
    nextTurn(state);
  }
  return state;
}

/** Blocked round: lightest hand wins the sum of the opponents' pips. */
function resolveBlocked(state) {
  const totals = state.hands.map(pipsOf);
  const lowest = Math.min(...totals);
  const winners = totals.map((v, i) => (v === lowest ? i : -1)).filter((i) => i >= 0);

  if (winners.length === 1) {
    const seat = winners[0];
    const points = totals.reduce((sum, v, i) => (i === seat ? sum : sum + v), 0);
    state.scores[seat] += points;
    state.roundResult = { winner: seat, points, blocked: true };
    state.gameOver = state.scores[seat] >= state.target;
  } else {
    state.roundResult = { winner: null, points: 0, blocked: true };
  }
}

/** Deep clone for UI undo. */
export const clone = (state) => JSON.parse(JSON.stringify(state));

/** Starts the next round, carrying the scores over. */
export function nextRound(state, rng = Math.random) {
  if (state.gameOver) return state;
  const fresh = newGameState({
    players: state.players,
    target: state.target,
    scores: state.scores.slice(),
    rng
  });
  fresh.log = [{ seat: -1, action: 'newround' }];
  return fresh;
}

