/**
 * DZ-Tawla UI controller — board rendering, dice, interaction, AI turns.
 * Game logic lives in modules/engine.js and modules/ai.js (pure & tested).
 */

import {
  initialState, rollDice, clone, applyMove, turnMoves, gameStatus, pipCount
} from './modules/engine.js';
import { chooseTurnMoves } from './modules/ai.js';
import { I18N } from './i18n.js';
import { sfx } from './audio.js';

let state = initialState();
let turnSnapshot = null;  // state at the start of the current turn (undo)
let selected = null;       // selected source: point number | 'bar'
let lastMoves = [];        // moves played during the current turn (highlight)
let busy = false;

const config = { mode: 'ai', humanColor: 'w', difficulty: 'medium' };
const settings = { lang: 'ar', theme: 'light', muted: false };

const $ = (id) => document.getElementById(id);
const t = () => I18N[settings.lang];

// ---------------------------------------------------------------- settings
function loadSettings() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem('dz_tawla_prefs') || '{}'));
  } catch { /* fresh start */ }
  sfx.setMuted(settings.muted);
}

function saveSettings() {
  localStorage.setItem('dz_tawla_prefs', JSON.stringify(settings));
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

// ---------------------------------------------------------------- flow
const isGameOver = () => gameStatus(state).over;
const isAITurn = () => config.mode === 'ai' && state.turn !== config.humanColor;

function newGame(skipConfirm = false) {
  if (!skipConfirm && state.rolled && !confirm(t().confirmNew)) return;
  state = initialState();
  turnSnapshot = null;
  selected = null;
  lastMoves = [];
  busy = false;
  sfx.click();
  renderAll();
}

function roll() {
  if (busy || isGameOver() || state.rolled) return;
  rollDice(state);
  sfx.click();
  turnSnapshot = clone(state);
  selected = null;
  lastMoves = [];

  const moves = turnMoves(state);
  if (moves.length === 0) {
    // Completely blocked turn: show a notice then pass.
    sfx.lose();
    window.setTimeout(() => endTurn(), 900);
  }
  renderAll();
  if (moves.length > 0 && isAITurn()) aiTurn();
}

function legalFromSource(src) {
  return turnMoves(state).filter((m) =>
    src === 'bar' ? m.from === 'bar' : m.from === src
  );
}

function playMove(move) {
  if (busy || isGameOver() || !state.rolled) return;
  const legal = turnMoves(state);
  const match = legal.find((m) =>
    m.die === move.die && m.from === move.from && m.to === move.to
  );
  if (!match) return;

  applyMove(state, match);
  lastMoves.push(match);
  selected = null;
  if (match.hit) sfx.capture();
  else sfx.move();

  if (state.remaining.length === 0 || turnMoves(state).length === 0) {
    window.setTimeout(() => endTurn(), 300);
  } else if (isAITurn()) {
    aiTurn();
  }
  renderAll();
}

function endTurn() {
  const status = gameStatus(state);
  if (status.over) {
    if (status.winner === (config.mode === 'ai' ? config.humanColor : state.turn === 'w' ? 'w' : 'b')) sfx.win();
    else sfx.lose();
    renderAll();
    return;
  }
  state.turn = state.turn === 'w' ? 'b' : 'w';
  state.rolled = false;
  state.dice = null;
  state.remaining = [];
  selected = null;
  lastMoves = [];
  turnSnapshot = null;
  renderAll();
  // 2-player mode: the next player must roll manually; AI rolls itself.
  if (isAITurn()) window.setTimeout(() => { roll(); }, 650);
}

function aiTurn() {
  if (busy || isGameOver() || !isAITurn() || !state.rolled) return;
  busy = true;
  renderAll();
  window.setTimeout(() => {
    const plan = chooseTurnMoves(state, config.difficulty);
    busy = false;
    let delay = 0;
    const stepMove = (i) => {
      if (i >= plan.length) {
        window.setTimeout(() => endTurn(), 350);
        return;
      }
      const m = plan[i];
      applyMove(state, m);
      lastMoves.push(m);
      if (m.hit) sfx.capture();
      else sfx.move();
      renderAll();
      window.setTimeout(() => stepMove(i + 1), 480);
    };
    if (plan.length === 0) window.setTimeout(() => endTurn(), 500);
    else stepMove(0);
  }, 480);
}

function undoTurnMove() {
  if (busy || !turnSnapshot || isGameOver()) return;
  // Restore the whole current turn (dice already consumed are replayed).
  state = clone(turnSnapshot);
  selected = null;
  lastMoves = [];
  sfx.click();
  renderAll();
  if (isAITurn()) aiTurn();
}

// ---------------------------------------------------------------- rendering
const TOP_POINTS = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
const BOTTOM_POINTS = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

function pointCell(p, topHalf) {
  const v = state.points[p];
  const count = Math.abs(v);
  const color = v > 0 ? 'w' : 'b';

  const cell = document.createElement('div');
  cell.className = `point ${topHalf ? 'top' : 'bottom'}`;

  if (selected !== null) {
    if (legalFromSource(selected).some((m) => m.to === p)) cell.classList.add('dest');
  }
  if (selected === p) cell.classList.add('selected');
  if (lastMoves.some((m) => m.to === p || m.from === p)) cell.classList.add('touched');

  const shown = Math.min(count, 5);
  for (let i = 0; i < shown; i++) {
    const disc = document.createElement('span');
    disc.className = `checker ${color}`;
    cell.appendChild(disc);
  }
  if (count > 5) {
    const badge = document.createElement('span');
    badge.className = `checker-badge ${color}`;
    badge.textContent = count;
    cell.appendChild(badge);
  }

  cell.addEventListener('click', () => onPointClick(p));
  return cell;
}

function onPointClick(p) {
  if (busy || isGameOver() || !state.rolled || isAITurn()) return;

  // 1) Clicking a highlighted destination plays the matching move.
  if (selected !== null) {
    const candidates = legalFromSource(selected).filter((m) => m.to === p);
    if (candidates.length > 0) {
      playMove(candidates[0]);
      return;
    }
  }

  // 2) Otherwise select one of our own points as the new source.
  const v = state.points[p];
  const own = state.turn === 'w' ? v > 0 : v < 0;
  if (own) {
    selected = selected === p ? null : p;
    sfx.click();
  } else {
    selected = null;
  }
  renderAll();
}

function barCell() {
  const cell = document.createElement('div');
  cell.className = 'bar';

  if (state.bar.w > 0) {
    const w = document.createElement('span');
    w.className = `checker w ${selected === 'bar' ? 'sel' : ''}`;
    if (state.bar.w > 1) w.textContent = state.bar.w;
    cell.appendChild(w);
  }
  if (state.bar.b > 0) {
    const b = document.createElement('span');
    b.className = 'checker b';
    if (state.bar.b > 1) b.textContent = state.bar.b;
    cell.appendChild(b);
  }

  const mineBar = state.turn === 'w' ? state.bar.w : state.bar.b;
  if (mineBar > 0 && !isGameOver()) cell.classList.add('must-enter');
  cell.addEventListener('click', onBarClick);
  return cell;
}

function onBarClick() {
  if (busy || isGameOver() || !state.rolled || isAITurn()) return;
  const mineBar = state.turn === 'w' ? state.bar.w : state.bar.b;
  if (mineBar === 0) return;
  selected = 'bar';
  sfx.click();
  renderAll();
}

function renderBoard() {
  const top = $('topRow');
  const bottom = $('bottomRow');
  top.innerHTML = '';
  bottom.innerHTML = '';

  TOP_POINTS.forEach((p, i) => {
    top.appendChild(pointCell(p, true));
    if (i === 5) top.appendChild(barCell());
  });
  BOTTOM_POINTS.forEach((p, i) => {
    bottom.appendChild(pointCell(p, false));
    if (i === 5) bottom.appendChild(barCell());
  });
  renderTrays();
}

function renderTrays() {
  const blackTray = $('blackTray');
  const whiteTray = $('whiteTray');
  blackTray.innerHTML = `<b>${state.off.b}</b><span>${t().offLabel}</span>`;
  whiteTray.innerHTML = `<b>${state.off.w}</b><span>${t().offLabel}</span>`;

  const canOff = selected !== null && legalFromSource(selected).some((m) => m.to === 'off');
  const trayForTurn = state.turn === 'w' ? whiteTray : blackTray;
  trayForTurn.classList.toggle('dest', !!canOff);

  const wireTray = (tray) => {
    tray.onclick = () => {
      if (busy || isGameOver() || !state.rolled || isAITurn()) return;
      const off = legalFromSource(selected).find((m) => m.to === 'off');
      if (off) playMove(off);
    };
  };
  wireTray(blackTray);
  wireTray(whiteTray);
}

function renderDice() {
  const zone = $('diceZone');
  zone.innerHTML = '';
  if (!state.dice) return;

  const isDouble = state.dice[0] === state.dice[1];
  const total = isDouble ? 4 : 2;
  const usedCount = total - state.remaining.length;
  const faces = isDouble
    ? [state.dice[0], state.dice[0], state.dice[0], state.dice[0]]
    : [state.dice[0], state.dice[1]];

  faces.forEach((face, i) => {
    const die = document.createElement('span');
    die.className = `die ${i < usedCount ? 'used' : 'live'}`;
    die.textContent = face;
    zone.appendChild(die);
  });
}

function statusText() {
  const status = gameStatus(state);
  if (status.over) {
    let base = status.winner === 'w' ? t().whiteWins : t().blackWins;
    if (status.value === 2) base += ` \u2014 ${t().gammon}`;
    if (status.value === 3) base += ` \u2014 ${t().backgammon}`;
    return base;
  }
  if (!state.rolled) return state.turn === 'w' ? t().whiteToMove : t().blackToMove;
  if (busy) return t().thinking;
  if (turnMoves(state).length === 0) return t().noMoves;
  return state.turn === 'w' ? t().whitePlaying : t().blackPlaying;
}

function renderStatus() {
  $('statusText').textContent = statusText();
  $('statusText').classList.toggle('over', isGameOver());
  $('pipWhite').textContent = pipCount(state, 'w');
  $('pipBlack').textContent = pipCount(state, 'b');
  $('rollBtn').disabled = state.rolled || isGameOver() || busy || isAITurn();
  $('undoBtn').disabled = busy || !turnSnapshot;

  const banner = $('gameOver');
  if (isGameOver()) {
    $('bannerText').textContent = statusText();
    banner.classList.add('active');
  } else {
    banner.classList.remove('active');
  }
}

function renderAll() {
  renderBoard();
  renderDice();
  renderStatus();
}

// ---------------------------------------------------------------- bindings
function bindEvents() {
  $('newGameBtn').onclick = () => newGame();
  $('rollBtn').onclick = roll;
  $('undoBtn').onclick = undoTurnMove;
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
    newGame(true);
  };
  $('colorSelect').onchange = (e) => {
    config.humanColor = e.target.value;
    newGame(true);
  };
  $('diffSelect').onchange = (e) => { config.difficulty = e.target.value; };
  $('bannerClose').onclick = () => $('gameOver').classList.remove('active');
}

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
});


