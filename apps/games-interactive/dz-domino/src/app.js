/**
 * DZ-Domino UI controller — chain rendering, hand interaction, AI seats.
 * Game logic lives in modules/engine.js and modules/ai.js (pure & tested).
 */

import {
  newGameState, legalMoves, makeMove, ends, nextRound
} from './modules/engine.js';
import { chooseMove } from './modules/ai.js';
import { I18N } from './i18n.js';
import { sfx } from './audio.js';

// ---------------------------------------------------------------- state
const config = { players: 2, difficulty: 'medium', target: 100 };
const settings = { lang: 'ar', theme: 'light', muted: false };
let state = null;
let aiTimer = null;

const PIP_CELLS = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

const $ = (id) => document.getElementById(id);
const t = () => I18N[settings.lang];

function seatName(seat) {
  if (seat === 0) return t().you;
  return `${t().computer} ${seat}`;
}

// ---------------------------------------------------------------- settings
function loadSettings() {
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem('dz_domino_prefs') || '{}'));
  } catch { /* fresh start */ }
  sfx.setMuted(settings.muted);
}

function saveSettings() {
  localStorage.setItem('dz_domino_prefs', JSON.stringify(settings));
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
function newMatch(skipConfirm = false) {
  if (!skipConfirm && state && !confirm(t().confirmNew)) return;
  state = newGameState({ players: config.players, target: config.target });
  renderAll();
  aiTurns();
}

function nextRoundClick() {
  if (!state || !state.roundResult || state.gameOver) return;
  state = nextRound(state);
  sfx.click();
  renderAll();
  aiTurns();
}

function humanMove(move) {
  if (!state || state.turn !== 0 || state.roundResult) return;
  const legal = legalMoves(state);
  if (!legal.some((m) => m.type === move.type && m.tileId === move.tileId && m.end === move.end)) return;
  applyMove(move);
}

function applyMove(move) {
  const wasDraw = move.type === 'draw';
  makeMove(state, move);
  if (move.type === 'place') sfx.move();
  else if (wasDraw) sfx.click();
  else sfx.lose();
  renderAll();

  if (state.roundResult) {
    if (state.roundResult.winner === 0) sfx.win();
    else if (state.roundResult.winner !== null) sfx.lose();
    else sfx.draw();
  }
}

function aiTurns() {
  if (aiTimer) clearTimeout(aiTimer);
  if (!state || state.roundResult || state.gameOver) return;
  if (state.turn === 0) return;

  aiTimer = setTimeout(() => {
    const res = chooseMove(state, config.difficulty);
    if (res && res.move) {
      applyMove(res.move);
      aiTurns(); // the next seat may also be an AI
    }
  }, 700);
}

// ---------------------------------------------------------------- rendering
function tileHTML(tile, cls = '') {
  const cells = (v) => Array.from({ length: 9 }, (_, i) =>
    `<i class="${PIP_CELLS[v].includes(i) ? 'pip' : ''}"></i>`).join('');
  return `<div class="domino ${cls}"><div class="half">${cells(tile.a)}</div><div class="half">${cells(tile.b)}</div></div>`;
}

function renderChain() {
  const zone = $('chainZone');
  zone.innerHTML = '';
  if (!state) return;
  const e = ends(state);
  state.chain.forEach((tile, idx) => {
    const isEnd = idx === 0 || idx === state.chain.length - 1;
    zone.innerHTML += tileHTML(tile, isEnd ? 'chain-end' : '');
  });
  $('endsLabel').textContent = state.chain.length ? `${e.left} | ${e.right}` : '—';
}

function renderHand() {
  const hand = $('handZone');
  hand.innerHTML = '';
  if (!state) return;
  const legal = state.turn === 0 ? legalMoves(state) : [];
  const playableIds = new Set(legal.filter((m) => m.type === 'place').map((m) => m.tileId));

  state.hands[0].forEach((tile) => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = tileHTML(tile, playableIds.has(tile.id) ? 'playable' : 'dimmed');
    const el = wrapper.firstElementChild;
    if (playableIds.has(tile.id)) {
      el.addEventListener('click', () => {
        const options = legal.filter((m) => m.type === 'place' && m.tileId === tile.id);
        if (options.length === 1) humanMove(options[0]);
        else if (options.length > 1) chooseEnd(tile, options);
      });
    }
    hand.appendChild(el);
  });

  const canDraw = state.turn === 0 && legal.some((m) => m.type === 'draw');
  const canPass = state.turn === 0 && legal.some((m) => m.type === 'pass');
  const hasRoundEnded = !!state.roundResult && !state.gameOver;
  $('drawBtn').disabled = !canDraw;
  $('passBtn').disabled = !canPass;
  $('drawBtn').style.display = hasRoundEnded ? 'none' : 'inline-block';
  $('passBtn').style.display = hasRoundEnded ? 'none' : 'inline-block';
  $('nextRoundBtn').style.display = hasRoundEnded ? 'inline-block' : 'none';
}

function chooseEnd(tile, options) {
  const overlay = $('endOverlay');
  overlay.querySelector('.end-title').textContent = `${t().hint}`;
  const leftBtn = overlay.querySelector('[data-end="left"]');
  const rightBtn = overlay.querySelector('[data-end="right"]');
  leftBtn.disabled = !options.some((m) => m.end === 'left');
  rightBtn.disabled = !options.some((m) => m.end === 'right');
  const handler = (btn) => {
    overlay.classList.remove('active');
    const move = options.find((m) => m.end === btn.dataset.end);
    if (move) humanMove(move);
    leftBtn.onclick = rightBtn.onclick = null;
  };
  leftBtn.onclick = () => handler(leftBtn);
  rightBtn.onclick = () => handler(rightBtn);
  overlay.classList.add('active');
}

function renderSeats() {
  const zone = $('seatsZone');
  zone.innerHTML = '';
  if (!state) return;
  for (let seat = 0; seat < state.players; seat++) {
    const card = document.createElement('div');
    card.className = `seat ${state.turn === seat && !state.roundResult ? 'active' : ''}`;
    const tiles = seat === 0
      ? `${t().yourHand}: ${state.hands[0].length}`
      : '\u25AE'.repeat(Math.min(state.hands[seat].length, 10)) + (state.hands[seat].length > 10 ? ` +${state.hands[seat].length - 10}` : '');
    card.innerHTML = `
      <div class="seat-name">${seatName(seat)}</div>
      <div class="seat-tiles">${tiles}</div>
      <div class="seat-score">${t().scores}: <b>${state.scores[seat]}</b></div>`;
    zone.appendChild(card);
  }
  $('boneyardCount').textContent = state.boneyard.length;
}

function renderStatus() {
  const el = $('statusText');
  if (!state) { el.textContent = '…'; return; }
  if (state.gameOver) {
    const champ = state.scores.indexOf(Math.max(...state.scores));
    el.textContent = `${t().matchWinner}: ${seatName(champ)}`;
    $('gameOver').classList.add('active');
    $('bannerText').textContent = `${t().matchWinner}: ${seatName(champ)}`;
    return;
  }
  $('gameOver').classList.remove('active');
  if (state.roundResult) {
    const r = state.roundResult;
    if (r.winner === null) el.textContent = `${t().blockedRound}`;
    else el.textContent = `${seatName(r.winner)} ${t().roundWon} (+${r.points} ${t().pointsShort}) ${r.blocked ? '\u2014 ' + t().blockedRound : '\u2014 ' + t().domino}`;
    return;
  }
  el.textContent = state.turn === 0 ? t().yourTurn : `${seatName(state.turn)}: ${t().thinking}`;
}

function renderAll() {
  renderChain();
  renderHand();
  renderSeats();
  renderStatus();
}

// ---------------------------------------------------------------- bindings
function bindEvents() {
  $('newMatchBtn').onclick = () => newMatch();
  $('nextRoundBtn').onclick = nextRoundClick;
  $('drawBtn').onclick = () => humanMove({ type: 'draw' });
  $('passBtn').onclick = () => humanMove({ type: 'pass' });
  $('playersSelect').onchange = (e) => { config.players = Number(e.target.value); newMatch(true); };
  $('targetSelect').onchange = (e) => { config.target = Number(e.target.value); newMatch(true); };
  $('diffSelect').onchange = (e) => { config.difficulty = e.target.value; };

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
}

// ---------------------------------------------------------------- boot
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  bindEvents();
  applyLanguage(settings.lang);
  applyTheme();
  applySound();
  newMatch(true);
});

