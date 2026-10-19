/**
 * DZ-Chess UI controller — board rendering, interaction, AI turns, panels.
 * All game logic lives in modules/engine.js (pure) and modules/ai.js (pure).
 */

import {
  initialState, generateMoves, makeMove, gameStatus, toSAN,
  positionKey, inCheck, colorOf, sqRank, sqFile
} from './modules/engine.js';
import { chooseMove } from './modules/ai.js';
import { I18N } from './i18n.js';
import { sfx } from './audio.js';

// ---------------------------------------------------------------- state
let state = initialState();
let states = [initialState()];   // undo chain (states[0] = initial position)
let sans = [];                    // SAN per ply, aligned with states[1..]
let selected = null;
let lastMove = null;
let flipped = false;
let busy = false;

const config = { mode: 'ai', humanColor: 'w', difficulty: 'medium' };
const settings = { lang: 'ar', theme: 'light', muted: false };

const PIECE_VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const GLYPHS = {
  P: '\u265F', N: '\u265E', B: '\u265D', R: '\u265C', Q: '\u265B', K: '\u265A',
  p: '\u265F', n: '\u265E', b: '\u265D', r: '\u265C', q: '\u265B', k: '\u265A'
};

const $ = (id) => document.getElementById(id);
const t = () => I18N[settings.lang];

// ---------------------------------------------------------------- settings
function loadSettings() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem('dz_chess_prefs') || '{}'));
  } catch {
    /* fresh start */
  }
  sfx.setMuted(settings.muted);
}

function saveSettings() {
  localStorage.setItem('dz_chess_prefs', JSON.stringify(settings));
}

function applyLanguage(lang) {
  settings.lang = I18N[lang] ? lang : 'ar';
  document.documentElement.lang = settings.lang;
  document.documentElement.dir = settings.lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t()[el.dataset.i18n] || el.textContent;
  });
  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === settings.lang);
  });
  renderAll();
  saveSettings();
}

function applyTheme() {
  const dark = settings.theme === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  $('themeBtn').textContent = dark ? '\u2600' : '\u263D';
  saveSettings();
}

// ---------------------------------------------------------------- game flow
function repCount() {
  const key = positionKey(state);
  let count = 1; // the live state
  for (const s of states) if (positionKey(s) === key) count++;
  return count;
}

function currentStatus() {
  return gameStatus(state, repCount());
}

function isGameOver() {
  const s = currentStatus();
  return s !== 'playing' && s !== 'check';
}

function statusText() {
  switch (currentStatus()) {
    case 'checkmate': return (state.turn === 'w' ? t().blackWins : t().whiteWins) + ' \u2014 ' + t().checkmate;
    case 'stalemate': return t().stalemate;
    case 'fifty': return t().fifty;
    case 'repetition': return t().repetition;
    case 'material': return t().material;
    case 'check': return (state.turn === 'w' ? t().whiteToMove : t().blackToMove) + ' \u2014 ' + t().check;
    default: return state.turn === 'w' ? t().whiteToMove : t().blackToMove;
  }
}

function isAITurn() {
  return config.mode === 'ai' && state.turn !== config.humanColor;
}

function maybeAI() {
  if (isGameOver() || !isAITurn() || busy) return;
  busy = true;
  renderStatus(true);
  setTimeout(() => {
    const res = chooseMove(state, config.difficulty);
    busy = false;
    if (res && res.move) executeMove(res.move);
  }, 380);
}

function executeMove(move) {
  const san = toSAN(state, move);
  states.push(state);
  sans.push(san);
  movesArr.push(move);
  state = makeMove(state, move);
  lastMove = move;
  selected = null;

  if (move.captured) sfx.capture();
  else sfx.move();

  const status = currentStatus();
  if (status === 'check') sfx.check();
  if (status === 'checkmate') {
    if (config.mode !== 'ai') sfx.win();
    else if (state.turn === config.humanColor) sfx.lose();
    else sfx.win();
  } else if (status === 'stalemate' || status === 'fifty' || status === 'repetition' || status === 'material') {
    sfx.draw();
  }

  renderAll();
  if (!isGameOver()) maybeAI();
}

function undo() {
  if (busy || states.length <= 1) return;
  const plies = config.mode === 'ai' ? 2 : 1;
  for (let i = 0; i < plies && states.length > 1; i++) {
    state = states.pop();
    sans.pop();
    movesArr.pop();
  }
  selected = null;
  lastMove = null; // last-move highlight resets cleanly on undo
  sfx.click();
  renderAll();
  maybeAI();
}

function newGame(skipConfirm = false) {
  if (!skipConfirm && sans.length > 0 && !confirm(t().confirmNew)) return;
  state = initialState();
  states = [state];
  sans = [];
  movesArr = [];
  selected = null;
  lastMove = null;
  busy = false;
  renderAll();
  maybeAI();
}

let movesArr = []; // move objects aligned with sans (for captured-panel + undo)

// ---------------------------------------------------------------- board
function render() {
  const board = $('board');
  board.innerHTML = '';
  const legal = generateMoves(state);
  const kingSq = inCheck(state)
    ? state.board.indexOf(state.turn === 'w' ? 'K' : 'k')
    : -1;

  const order = [];
  for (let i = 0; i < 64; i++) order.push(flipped ? 63 - i : i);

  for (const i of order) {
    const r = sqRank(i);
    const f = sqFile(i);
    const cell = document.createElement('div');
    cell.className = `square ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
    cell.dataset.sq = i;

    if (lastMove && (i === lastMove.from || i === lastMove.to)) cell.classList.add('last');
    if (i === kingSq) cell.classList.add('in-check');
    if (i === selected) cell.classList.add('selected');

    const piece = state.board[i];
    if (piece !== '') {
      const span = document.createElement('span');
      span.className = `piece ${colorOf(piece)}`;
      span.textContent = GLYPHS[piece];
      cell.appendChild(span);
    }

    if (selected !== null && legal.some((m) => m.from === selected && m.to === i)) {
      cell.classList.add(piece !== '' ? 'capture-target' : 'target');
    }

    cell.addEventListener('click', () => onSquareClick(i));
    board.appendChild(cell);
  }

  renderCoords();
}

function renderCoords() {
  const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const files = $('fileCoords');
  const ranks = $('rankCoords');
  files.innerHTML = '';
  ranks.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const f = document.createElement('span');
    f.textContent = flipped ? letters[7 - i] : letters[i];
    files.appendChild(f);
    const r = document.createElement('span');
    r.textContent = flipped ? i + 1 : 8 - i;
    ranks.appendChild(r);
  }
}

// ---------------------------------------------------------------- interaction
function onSquareClick(sq) {
  if (busy || isGameOver() || isAITurn()) return;

  const legal = generateMoves(state);
  if (selected !== null) {
    const candidates = legal.filter((m) => m.from === selected && m.to === sq);
    if (candidates.length > 0) {
      if (candidates[0].promotion) return askPromotion(candidates);
      return executeMove(candidates[0]);
    }
  }

  const piece = state.board[sq];
  if (piece !== '' && colorOf(piece) === state.turn) {
    selected = sq;
    sfx.click();
  } else {
    selected = null;
  }
  render();
}

/** Shows the promotion picker, then plays the chosen variant. */
function askPromotion(candidates) {
  const overlay = $('promoOverlay');
  overlay.querySelector('.promo-title').textContent = t().promoteTo;
  overlay.classList.add('active');
  overlay.querySelectorAll('[data-promo]').forEach((btn) => {
    btn.onclick = () => {
      overlay.classList.remove('active');
      const move = candidates.find((m) => m.promotion === btn.dataset.promo);
      if (move) executeMove(move);
    };
  });
}

// ---------------------------------------------------------------- panels
function renderStatus(thinking = false) {
  const el = $('statusText');
  const over = isGameOver();
  el.textContent = busy || thinking ? t().thinking : statusText();
  el.classList.toggle('over', over);
  $('turnDot').className = `turn-dot ${state.turn}`;
  const banner = $('gameOver');
  if (over) {
    $('bannerText').textContent = statusText();
    banner.classList.add('active');
  } else {
    banner.classList.remove('active');
  }
}

function renderMoves() {
  const list = $('movesList');
  list.innerHTML = '';
  for (let i = 0; i < sans.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const num = document.createElement('span');
    num.className = 'move-num';
    num.textContent = i / 2 + 1 + '.';
    const w = document.createElement('span');
    w.textContent = sans[i] || '';
    row.append(num, w);
    if (sans[i + 1]) {
      const b = document.createElement('span');
      b.textContent = sans[i + 1];
      row.appendChild(b);
    }
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}

function renderCaptured() {
  const blackLost = [];  // black pieces captured by white
  const whiteLost = [];
  let balance = 0;
  for (const mv of movesArr) {
    if (!mv.captured) continue;
    const u = mv.captured.toUpperCase();
    const blackPiece = colorOf(mv.captured) === 'b';
    balance += blackPiece ? PIECE_VALUE[u] : -PIECE_VALUE[u];
    (blackPiece ? blackLost : whiteLost).push(mv.captured);
  }
  const byValue = (a, b) => PIECE_VALUE[b.toUpperCase()] - PIECE_VALUE[a.toUpperCase()];
  $('capturedByWhite').textContent = blackLost.sort(byValue).map((p) => GLYPHS[p]).join(' ');
  $('capturedByBlack').textContent = whiteLost.sort(byValue).map((p) => GLYPHS[p]).join(' ');
  const adv = $('advantageText');
  adv.textContent = balance === 0 ? '\u00B10' : balance > 0 ? '+' + balance : String(balance);
  adv.style.color = balance > 0 ? 'var(--accent)' : balance < 0 ? 'var(--danger)' : 'var(--muted)';
}

function renderAll() {
  render();
  renderMoves();
  renderCaptured();
  renderStatus();
}

// ---------------------------------------------------------------- bindings
function bindEvents() {
  $('newGameBtn').onclick = () => newGame();
  $('undoBtn').onclick = undo;
  $('flipBtn').onclick = () => { flipped = !flipped; render(); };
  $('themeBtn').onclick = () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  };
  $('soundBtn').onclick = () => {
    settings.muted = !settings.muted;
    sfx.setMuted(settings.muted);
    $('soundBtn').classList.toggle('muted', settings.muted);
    saveSettings();
  };
  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.onclick = () => applyLanguage(b.dataset.lang);
  });

  $('modeSelect').onchange = (e) => {
    config.mode = e.target.value;
    $('colorRow').style.display = config.mode === 'ai' ? '' : 'none';
    $('diffRow').style.display = config.mode === 'ai' ? '' : 'none';
    newGame();
  };
  $('colorSelect').onchange = (e) => {
    config.humanColor = e.target.value;
    flipped = config.humanColor === 'b';
    newGame(true);
  };
  $('diffSelect').onchange = (e) => { config.difficulty = e.target.value; };

  $('bannerClose').onclick = () => $('gameOver').classList.remove('active');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { selected = null; render(); }
  });
}

// ---------------------------------------------------------------- boot
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  bindEvents();
  applyLanguage(settings.lang);
  applyTheme();
  $('modeSelect').value = config.mode;
  $('colorSelect').value = config.humanColor;
  $('diffSelect').value = config.difficulty;
  $('soundBtn').classList.toggle('muted', settings.muted);
  renderAll();
  maybeAI();
});



