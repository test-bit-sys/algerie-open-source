/**
 * DZ-Chess engine correctness suite — standard perft + full FIDE rules.
 * If generateMoves/makeMove are wrong in ANY way, these counts won't match.
 * Run: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, fromFEN, generateMoves, makeMove, gameStatus,
  perft, toSAN, toAN, fromAN, insufficientMaterial
} from '../src/modules/engine.js';
import { evaluate, chooseMove } from '../src/modules/ai.js';

const moveTo = (s, fromAN_, toAN_) =>
  generateMoves(s).find((m) => toAN(m.from) === fromAN_ && toAN(m.to) === toAN_);

test('perft: initial position matches the standard node table', () => {
  const s = initialState();
  assert.equal(perft(s, 1), 20);
  assert.equal(perft(s, 2), 400);
  assert.equal(perft(s, 3), 8902);
  assert.equal(perft(s, 4), 197281);
});

test('perft: Kiwipete — castling, en passant and pin torture position', () => {
  const s = fromFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(perft(s, 1), 48);
  assert.equal(perft(s, 2), 2039);
  assert.equal(perft(s, 3), 97862);
});

test('perft: position 3 — en passant discovered check / pins', () => {
  const s = fromFEN('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.equal(perft(s, 1), 14);
  assert.equal(perft(s, 2), 191);
  assert.equal(perft(s, 3), 2812);
  assert.equal(perft(s, 4), 43238);
});

test('perft: position 4 — promotions and discovered checks', () => {
  const s = fromFEN('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
  assert.equal(perft(s, 1), 6);
  assert.equal(perft(s, 2), 264);
  assert.equal(perft(s, 3), 9467);
});

test('en passant capture removes the bypassed pawn', () => {
  const s = fromFEN('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1');
  const epMove = generateMoves(s).find((m) => m.ep);
  assert.ok(epMove, 'en passant move must be generated');
  const next = makeMove(s, epMove);
  assert.equal(next.board[fromAN('e3')], 'p');
  assert.equal(next.board[fromAN('e4')], '');
});

test('castling: legal when clear, forbidden through attacked squares', () => {
  const s = fromFEN('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const moves = generateMoves(s);
  assert.ok(moves.some((m) => m.castle === 'K'), 'O-O must be legal');
  assert.ok(moves.some((m) => m.castle === 'Q'), 'O-O-O must be legal');
  const oo = makeMove(s, moves.find((m) => m.castle === 'K'));
  assert.equal(oo.board[fromAN('g1')], 'K');
  assert.equal(oo.board[fromAN('f1')], 'R');
  assert.equal(oo.board[fromAN('h1')], '');

  const blocked = fromFEN('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1'); // rook f8 guards f1
  assert.ok(!generateMoves(blocked).some((m) => m.castle === 'K'), 'cannot cross an attacked square');
  assert.ok(generateMoves(blocked).some((m) => m.castle === 'Q'));
});

test('promotion offers and applies all four piece choices', () => {
  const s = fromFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const promos = generateMoves(s).filter((m) => toAN(m.from) === 'a7');
  assert.equal(promos.length, 4);
  const q = makeMove(s, promos.find((m) => m.promotion === 'Q'));
  assert.equal(q.board[fromAN('a8')], 'Q');
});

test("fool's mate: checkmate status and SAN '#'", () => {
  let s = initialState();
  s = makeMove(s, moveTo(s, 'f2', 'f3'));
  s = makeMove(s, moveTo(s, 'e7', 'e5'));
  s = makeMove(s, moveTo(s, 'g2', 'g4'));
  const mate = moveTo(s, 'd8', 'h4');
  assert.equal(toSAN(s, mate), 'Qh4#');
  s = makeMove(s, mate);
  assert.equal(gameStatus(s), 'checkmate');
});

test('stalemate, insufficient material and the fifty-move rule', () => {
  assert.equal(gameStatus(fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')), 'stalemate');
  assert.equal(insufficientMaterial(fromFEN('8/8/4k3/8/2b5/8/8/4K3 w - - 0 1')), true);
  assert.equal(insufficientMaterial(fromFEN('8/8/4k3/8/8/8/8/4K1P1 w - - 0 1')), false);

  const s = fromFEN('4k3/8/8/8/8/8/8/4K2R w - - 99 60');
  const rookMove = generateMoves(s).find((m) => m.piece === 'R' && !m.captured);
  assert.equal(gameStatus(makeMove(s, rookMove)), 'fifty');
});

test('SAN: pawn captures, piece moves and file disambiguation', () => {
  let s = initialState();
  s = makeMove(s, moveTo(s, 'e2', 'e4'));
  s = makeMove(s, moveTo(s, 'd7', 'd5'));
  assert.equal(toSAN(s, moveTo(s, 'e4', 'd5')), 'exd5');

  assert.equal(toSAN(initialState(), moveTo(initialState(), 'g1', 'f3')), 'Nf3');

  const two = fromFEN('k7/8/8/8/8/8/8/N1N1K3 w - - 0 1');
  assert.equal(toSAN(two, moveTo(two, 'a1', 'b3')), 'Nab3');
  assert.equal(toSAN(two, moveTo(two, 'c1', 'b3')), 'Ncb3');
});

test('AI: finds mate in one and grabs a hanging queen', () => {
  const mateInOne = fromFEN('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1');
  const res = chooseMove(mateInOne, 'medium');
  assert.equal(toSAN(mateInOne, res.move), 'Re8#');

  const hanging = fromFEN('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1');
  const grab = chooseMove(hanging, 'easy');
  assert.equal(toAN(grab.move.to), 'd5');
});

test('AI: symmetric start evaluates to zero and never returns illegal moves', () => {
  assert.equal(evaluate(initialState()), 0);
  const res = chooseMove(initialState(), 'medium');
  assert.ok(res.move);
  assert.ok(generateMoves(initialState()).some(
    (m) => m.from === res.move.from && m.to === res.move.to
  ));
});
