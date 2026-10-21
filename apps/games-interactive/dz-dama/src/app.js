/**
 * DZ-Dama UI controller — board rendering, interaction, AI turns, panels.
 * Game logic lives in modules/engine.js and modules/ai.js (pure & tested).
 */

import {
  initialState, generateMoves, makeMove, gameStatus, moveToLabel,
  colorOf, isKing, sqRank, sqFile
} from './modules/engine.js';
import { chooseMove } from './modules/ai.js';
import { I18N } from './i18n.js';
import { sfx } from './audio.js';

// ---------------------------------------------------------------- state
let state = initialState(true);
let states = [state];
let labels = [];
let movesArr = [];
let selected = null;
let lastMove = null;
let flipped = false;
let busy = false;

const config = { mode: 'ai', humanColor: 'w', difficulty: 'medium', forced: true };
const settings = { lang: 'ar', theme: 'light', muted: false };

const $ = (id) => document.getElementById(id);
const t = () => I18N[settings.lang];

// ---------------------------------------------------------------- settings
function loadSettings() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem('dz_dama_prefs') || '{}'));
  } catch {
    /* fresh start */
  }
  sfx.setMuted(settings.muted);
}

function saveSettings() {
  localStorage.setItem('dz_dama_prefs', JSON.stringify(settings));
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

function applySound() {
  $('soundBtn').textContent = settings.muted ? '🔇' : '🔊';
  $('soundBtn').classList.toggle('muted', settings.muted);
}

// ---------------------------------------------------------------- game flow
function statusText() {
  switch (gameStatus(state)) {
    case 'win-w': return t().whiteWins;
    case 'win-b': return t().blackWins;
    case 'draw': return t().draw;
    default: return state.turn === 'w' ? t().whiteToMove : t().blackToMove;
  }
}

function isGameOver() {
  return gameStatus(state) !== 'playing';
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
  }, 360);
}

function executeMove(move) {
  labels.push(moveToLabel(move));
  movesArr.push(move);
  states.push(state);
  state = makeMove(state, move);
  lastMove = move;
  selected = null;

  if (move.captured.length) sfx.capture();
  else sfx.move();
  if (isGameOver()) {
    if (gameStatus(state) === 'draw') sfx.draw();
    else if (config.mode !== 'ai') sfx.win();
    else if (state.turn === config.humanColor) sfx.lose();
    else sfx.win();
  }

  renderAll();
  if (!isGameOver()) maybeAI();
}

function undo() {
  if (busy || states.length <= 1) return;
  const plies = config.mode === 'ai' ? 2 : 1;
  for (let i = 0; i < plies && states.length > 1; i++) {
    state = states.pop();
    labels.pop();
    movesArr.pop();
  }
  selected = null;
  lastMove = null;
  sfx.click();
  renderAll();
  maybeAI();
}

function newGame(skipConfirm = false) {
  if (!skipConfirm && labels.length > 0 && !confirm(t().confirmNew)) return;
  state = initialState(config.forced);
  states = [state];
  labels = [];
  movesArr = [];
  selected = null;
  lastMove = null;
  busy = false;
  renderAll();
  maybeAI();
}

// ---------------------------------------------------------------- board
function render() {
  const board = $('board');
  board.innerHTML = '';
  const legal = generateMoves(state);

  const order = [];
  for (let i = 0; i < 64; i++) order.push(flipped ? 63 - i : i);

  const candidate = selected !== null ? legal.filter((m) => m.from === selected) : [];
  const targets = new Set(candidate.map((m) => m.to));
  const doomed = new Set(candidate.flatMap((m) => m.captured));

  for (const i of order) {
    const r = sqRank(i);
    const f = sqFile(i);
    const cell = document.createElement('div');
    cell.className = `square ${(r + f) % 2 === 0 ? 'light' : 'dark'}`;
    cell.dataset.sq = i;

    const landing = lastMove ? lastMove.path[lastMove.path.length - 1] : -1;
    if (lastMove && (i === lastMove.from || i === landing)) cell.classList.add('last');
    if (i === selected) cell.classList.add('selected');
    if (doomed.has(i)) cell.classList.add('doomed');
    if (targets.has(i)) cell.classList.add('target');

    const piece = state.board[i];
    if (piece !== '') {
      const disc = document.createElement('span');
      disc.className = `disc ${colorOf(piece)}${isKing(piece) ? ' king' : ''}`;
      cell.appendChild(disc);
    }

    if ((r + f) % 2 === 1) cell.addEventListener('click', () => onSquareClick(i));
    board.appendChild(cell);
  }
}

// ---------------------------------------------------------------- interaction
function onSquareClick(sqIdx) {
  if (busy || isGameOver() || isAITurn()) return;

  const legal = generateMoves(state);
  if (selected !== null) {
    const candidates = legal.filter((m) => m.from === selected && m.to === sqIdx);
    if (candidates.length > 0) {
      // Multiple chains landing on the same square: play the longest capture.
      candidates.sort((a, b) => b.captured.length - a.captured.length);
      return executeMove(candidates[0]);
    }
  }

  const piece = state.board[sqIdx];
  if (piece !== '' && colorOf(piece) === state.turn) {
    selected = sqIdx;
    sfx.click();
  } else {
    selected = null;
  }
  render();
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
  for (let i = 0; i < labels.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const num = document.createElement('span');
    num.className = 'move-num';
    num.textContent = i / 2 + 1 + '.';
    const w = document.createElement('span');
    w.textContent = labels[i] || '';
    row.append(num, w);
    if (labels[i + 1]) {
      const b = document.createElement('span');
      b.textContent = labels[i + 1];
      row.appendChild(b);
    }
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}

/** White always opens in dama: even plies belong to White. */
function renderCaptured() {
  const byWhite = movesArr.filter((_, i) => i % 2 === 0).reduce((n, mv) => n + mv.captured.length, 0);
  const byBlack = movesArr.filter((_, i) => i % 2 === 1).reduce((n, mv) => n + mv.captured.length, 0);
  $('whiteScore').textContent = byWhite;
  $('blackScore').textContent = byBlack;
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
  $('themeBtn').onclick = () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
  };
  $('soundBtn').onclick = () => {
    settings.muted = !settings.muted;
    sfx.setMuted(settings.muted);
    applySound();
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
  $('forcedCheck').onchange = (e) => {
    config.forced = e.target.checked;
    state.forcedCaptures = config.forced; // applies to the live game too
    selected = null;
    renderAll();
    maybeAI();
  };

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
  applySound();
  $('modeSelect').value = config.mode;
  $('colorSelect').value = config.humanColor;
  $('diffSelect').value = config.difficulty;
  $('forcedCheck').checked = config.forced;
  renderAll();
  maybeAI();
});


