/**
 * DZ-Puissance4 UI controller — board, interaction, AI turns.
 * Game logic lives in modules/engine.js and modules/ai.js (pure & tested).
 */

import { initialState, legalColumns, drop, ROWS, COLS } from './modules/engine.js';
import { chooseColumn } from './modules/ai.js';
import { I18N } from './i18n.js';
import { sfx } from './audio.js';

let state = initialState();
let states = [state];   // undo chain
let lastRes = null;     // last drop result (for win-line highlight)
let busy = false;

const config = { mode: 'ai', humanColor: 1, difficulty: 'medium' };
const settings = { lang: 'ar', theme: 'light', muted: false };

const $ = (id) => document.getElementById(id);
const t = () => I18N[settings.lang];

function loadSettings() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem('dz_p4_prefs') || '{}'));
  } catch { /* fresh start */ }
  sfx.setMuted(settings.muted);
}

function saveSettings() {
  localStorage.setItem('dz_p4_prefs', JSON.stringify(settings));
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
  if (lastRes && lastRes.win) {
    const winner = lastRes.status === 'win-1' ? t().redWins : t().yellowWins;
    return winner;
  }
  if (lastRes && lastRes.status === 'draw') return t().draw;
  return state.turn === 1 ? t().redToMove : t().yellowToMove;
}

function isGameOver() {
  return !!lastRes && lastRes.status !== 'playing';
}

function isAITurn() {
  return config.mode === 'ai' && state.turn !== config.humanColor;
}

function playColumn(col) {
  if (busy || isGameOver()) return;
  if (!legalColumns(state).includes(col)) return;
  if (isAITurn()) return;

  const res = drop(state, col);
  states.push(state);
  state = res.state;
  lastRes = res;

  sfx.move();
  if (res.win) (config.mode !== 'ai' || state.turn === config.humanColor) ? sfx.win() : sfx.lose();
  if (res.status === 'draw') sfx.draw();

  renderAll();
  if (!isGameOver()) maybeAI();
}

function maybeAI() {
  if (isGameOver() || !isAITurn() || busy) return;
  busy = true;
  renderStatus(true);
  setTimeout(() => {
    const res = chooseColumn(state, config.difficulty);
    busy = false;
    if (!res) return;

    const outcome = drop(state, res.column);
    states.push(state);
    state = outcome.state;
    lastRes = outcome;

    sfx.move();
    if (outcome.win) {
      if (state.turn === config.humanColor) sfx.lose();
      else sfx.win();
    } else if (outcome.status === 'draw') sfx.draw();

    renderAll();
  }, 400);
}

function undo() {
  if (busy || states.length <= 1) return;
  const plies = config.mode === 'ai' ? 2 : 1;
  for (let i = 0; i < plies && states.length > 1; i++) {
    state = states.pop();
  }
  // Recompute the last result from the restored state.
  lastRes = { status: 'playing', win: false, line: null };
  sfx.click();
  renderAll();
}

function newGame(skipConfirm = false) {
  if (!skipConfirm && states.length > 1 && !confirm(t().confirmNew)) return;
  state = initialState();
  states = [state];
  lastRes = null;
  busy = false;
  renderAll();
  maybeAI();
}

// ---------------------------------------------------------------- rendering
function render() {
  const board = $('board');
  board.innerHTML = '';
  const legal = new Set(isGameOver() || isAITurn() ? [] : legalColumns(state));
  const winCells = new Set(
    lastRes && lastRes.line ? lastRes.line.map(([r, c]) => r * COLS + c) : []
  );

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const value = state.grid[r][c];
      if (value) {
        const disc = document.createElement('span');
        disc.className = `disc p${value}`;
        if (winCells.has(r * COLS + c)) disc.classList.add('winning');
        cell.appendChild(disc);
      }
      if (legal.has(c)) cell.classList.add('clickable');
      cell.addEventListener('click', () => playColumn(c));
      board.appendChild(cell);
    }
  }
}

function renderStatus(thinking = false) {
  const el = $('statusText');
  el.textContent = busy || thinking ? t().thinking : statusText();
  el.classList.toggle('over', isGameOver());
  $('turnDot').className = `turn-dot p${state.turn}`;

  const banner = $('gameOver');
  if (isGameOver()) {
    $('bannerText').textContent = statusText();
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
  document.addEventListener('keydown', (e) => {
    if (e.key >= '1' && e.key <= '7') playColumn(Number(e.key) - 1);
  });
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

