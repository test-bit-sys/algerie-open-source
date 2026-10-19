/**
 * DZ-Othello UI controller — board, interaction, AI turns, counters.
 * Game logic lives in modules/engine.js and modules/ai.js (pure & tested).
 */

import { initialState, legalMoves, makeMove, gameStatus, countDiscs, SIZE } from './modules/engine.js';
import { chooseMove } from './modules/ai.js';
import { I18N } from './i18n.js';
import { sfx } from './audio.js';

let state = initialState();
let states = [state];
let lastMove = null;
let busy = false;
let passNotice = 0;

const config = { mode: 'ai', humanColor: 1, difficulty: 'medium' };
const settings = { lang: 'ar', theme: 'light', muted: false };

const $ = (id) => document.getElementById(id);
const t = () => I18N[settings.lang];

function loadSettings() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem('dz_othello_prefs') || '{}'));
  } catch { /* fresh start */ }
  sfx.setMuted(settings.muted);
}

function saveSettings() {
  localStorage.setItem('dz_othello_prefs', JSON.stringify(settings));
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

function statusText() {
  const s = gameStatus(state);
  if (s === 'win-black') return t().blackWins;
  if (s === 'win-white') return t().whiteWins;
  if (s === 'draw') return t().draw;
  return state.turn === 1 ? t().blackToMove : t().whiteToMove;
}

const isGameOver = () => !!state.gameOver;
const isAITurn = () => config.mode === 'ai' && state.turn !== config.humanColor;

function playMove(move) {
  if (busy || isGameOver() || isAITurn()) return;
  const legal = legalMoves(state);
  if (!legal.some((m) => m.row === move.row && m.col === move.col)) return;

  const before = state.turn;
  states.push(state);
  state = makeMove(state, legal.find((m) => m.row === move.row && m.col === move.col));
  lastMove = move;
  sfx.move();

  if (state.turn === before) {
    // Opponent had to pass automatically.
    passNotice = 2;
    sfx.check();
  }

  if (state.gameOver) {
    const winner = gameStatus(state);
    if (winner === 'draw') sfx.draw();
    else if (config.mode !== 'ai') sfx.win();
    else if (winner === (config.humanColor === 1 ? 'win-black' : 'win-white')) sfx.win();
    else sfx.lose();
  }

  renderAll();
  if (!isGameOver()) maybeAI();
}

function maybeAI() {
  if (isGameOver() || !isAITurn() || busy) return;
  busy = true;
  renderStatus(true);
  setTimeout(() => {
    const res = chooseMove(state, config.difficulty);
    busy = false;
    if (!res) return;
    const before = state.turn;
    states.push(state);
    state = makeMove(state, res.move);
    lastMove = res.move;
    sfx.move();
    if (state.turn === before) passNotice = 2;
    if (state.gameOver) {
      const winner = gameStatus(state);
      if (winner === 'draw') sfx.draw();
      else if (winner === (config.humanColor === 1 ? 'win-black' : 'win-white')) sfx.win();
      else sfx.lose();
    }
    renderAll();
  }, 420);
}

function undo() {
  if (busy || states.length <= 1) return;
  const plies = config.mode === 'ai' ? 2 : 1;
  for (let i = 0; i < plies && states.length > 1; i++) state = states.pop();
  lastMove = null;
  passNotice = 0;
  sfx.click();
  renderAll();
  maybeAI();
}

function newGame(skipConfirm = false) {
  if (!skipConfirm && states.length > 1 && !confirm(t().confirmNew)) return;
  state = initialState();
  states = [state];
  lastMove = null;
  passNotice = 0;
  busy = false;
  renderAll();
  maybeAI();
}

// ---------------------------------------------------------------- rendering
function render() {
  const board = $('board');
  board.innerHTML = '';
  const legal = isGameOver() || isAITurn() ? [] : legalMoves(state);
  const legalMap = new Map(legal.map((m) => [`${m.row},${m.col}`, m]));
  const counts = countDiscs(state);

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const key = `${r},${c}`;
      if (legalMap.has(key)) cell.classList.add('legal');
      if (lastMove && lastMove.row === r && lastMove.col === c) cell.classList.add('last');

      const v = state.grid[r][c];
      if (v) {
        const disc = document.createElement('span');
        disc.className = `disc d${v}`;
        cell.appendChild(disc);
      } else if (legalMap.has(key)) {
        const hint = document.createElement('span');
        hint.className = `hint-dot h${state.turn}`;
        cell.appendChild(hint);
      }

      cell.addEventListener('click', () => playMove({ row: r, col: c }));
      board.appendChild(cell);
    }
  }

  $('blackCount').textContent = counts.black;
  $('whiteCount').textContent = counts.white;
}

function renderStatus(thinking = false) {
  const el = $('statusText');
  let text = busy || thinking ? t().thinking : statusText();
  if (passNotice > 0 && !isGameOver()) {
    text += ` \u2014 ${t().passed}`;
    passNotice--;
  }
  el.textContent = text;
  el.classList.toggle('over', isGameOver());
  $('turnDot').className = `turn-dot d${state.turn}`;

  const banner = $('gameOver');
  if (isGameOver()) {
    const { black, white } = countDiscs(state);
    $('bannerText').textContent = `${statusText()} (${black} \u2013 ${white})`;
    banner.classList.add('active');
  } else {
    banner.classList.remove('active');
  }
}

function renderAll() {
  render();
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
    config.humanColor = Number(e.target.value);
    newGame(true);
  };
  $('diffSelect').onchange = (e) => { config.difficulty = e.target.value; };

  $('bannerClose').onclick = () => $('gameOver').classList.remove('active');
}

// ---------------------------------------------------------------- boot
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  bindEvents();
  applyLanguage(settings.lang);
  applyTheme();
  $('modeSelect').value = config.mode;
  $('colorSelect').value = String(config.humanColor);
  $('diffSelect').value = config.difficulty;
  $('soundBtn').classList.toggle('muted', settings.muted);
  renderAll();
});

