// ─── Краш (Ракета) ───────────────────────────────────────────────────────────
// Один общий раунд на всех, кто открыл игру. Цикл:
//   betting (BET_MS) → flying (множитель растёт, пока не «взорвётся») → crashed (PAUSE_MS) → …
// Множитель: m(t) = e^(RATE·t), t в секундах (×2 ≈ за 8.7 с, ×10 ≈ за 29 с).
// Точка взрыва выбирается в начале полёта и до взрыва никуда не уходит:
//   crash = floor(100 · 0.99 / (1 − r)) / 100, r ∈ [0, 1) — 1% преимущество дома.
// Ставка списывается с баланса сразу и лежит в crash_bets (при рестарте вернётся).
// Забрать можно в любой момент полёта (или автоматически на заданном множителе).

import crypto from 'node:crypto';
import { db, tx, balanceOf, changeBalance, addHistory } from './db.js';
import { MIN_BET, MAX_BET } from './telegram.js';

const ms = (name, def) => Number(process.env[name]) || def;
const BET_MS = ms('CRASH_BET_MS', 8_000);
const PAUSE_MS = ms('CRASH_PAUSE_MS', 3_000);
const TICK_MS = 50;
export const RATE = 0.08;
const MAX_POINT = 1000;
const HISTORY = 16;

db.exec(`
CREATE TABLE IF NOT EXISTS crash_bets (
  user_id INTEGER PRIMARY KEY,
  amount INTEGER NOT NULL
);
`);

export const CRASH_ERRORS = {
  CRASH_CLOSED: 'Ставки на этот раунд закрыты — дождись следующего',
  CRASH_ALREADY: 'Ты уже поставил в этом раунде',
  CRASH_NO_BET: 'В этом раунде у тебя нет ставки',
};

const fail = (code) => { throw new Error(code); };
export const multAt = (elapsedMs) => Math.floor(Math.exp(RATE * elapsedMs / 1000) * 100) / 100;
/** Через сколько мс множитель дойдёт до m */
const timeTo = (m) => Math.log(m) / RATE * 1000;

function rollPoint() {
  const r = crypto.randomInt(0, 2 ** 32) / 2 ** 32;
  return Math.min(MAX_POINT, Math.max(1, Math.floor(99 / (1 - r)) / 100));
}

const state = {
  round: 0,
  phase: 'betting',
  phaseEnds: 0,     // betting/crashed: когда фаза закончится
  startedAt: 0,     // flying: момент старта
  point: 0,         // точка взрыва (секрет до взрыва)
  bets: new Map(),  // userId -> { name, amount, auto, cashedAt, payout }
  recent: [],
};

let notify = () => {};
/** ws.js подписывается: рассылка состояния всем, кто открыл игру */
export function onCrashChange(fn) { notify = fn; }

let timer = null;

export function bootCrash() {
  // ставки раунда, который шёл во время рестарта, возвращаются на баланс
  tx(() => {
    for (const b of db.prepare('SELECT * FROM crash_bets').all()) changeBalance(b.user_id, b.amount);
    db.prepare('DELETE FROM crash_bets').run();
  });
  startBetting();
  clearInterval(timer);
  timer = setInterval(tick, TICK_MS);
}

function startBetting() {
  state.round += 1;
  state.phase = 'betting';
  state.phaseEnds = Date.now() + BET_MS;
  state.bets = new Map();
  notify('betting');
}

function startFlight() {
  state.phase = 'flying';
  state.startedAt = Date.now();
  state.point = rollPoint();
  notify('flying');
}

function crash() {
  state.phase = 'crashed';
  state.phaseEnds = Date.now() + PAUSE_MS;
  // кто не успел забрать — проиграл
  tx(() => {
    for (const [uid, b] of state.bets) {
      if (b.cashedAt == null) addHistory(uid, 'crash', b.amount, -b.amount);
    }
    db.prepare('DELETE FROM crash_bets').run();
  });
  state.recent = [state.point, ...state.recent].slice(0, HISTORY);
  notify('crashed');
}

function tick() {
  const now = Date.now();
  if (state.phase === 'betting' && now >= state.phaseEnds) return startFlight();
  if (state.phase === 'crashed' && now >= state.phaseEnds) return startBetting();
  if (state.phase !== 'flying') return;

  const elapsed = now - state.startedAt;
  const crashAt = timeTo(state.point);
  // автозабор: всё, у кого цель ниже точки взрыва и уже достигнута
  let changed = false;
  for (const [uid, b] of state.bets) {
    if (b.cashedAt == null && b.auto && b.auto <= state.point && elapsed >= timeTo(b.auto)) {
      settleCashout(uid, b, b.auto);
      changed = true;
    }
  }
  if (elapsed >= crashAt) return crash();
  if (changed) notify('cashout');
}

function settleCashout(uid, b, mult) {
  const payout = Math.floor(b.amount * mult);
  tx(() => {
    changeBalance(uid, payout);
    db.prepare('DELETE FROM crash_bets WHERE user_id = ?').run(uid);
    addHistory(uid, 'crash', b.amount, payout - b.amount);
  });
  b.cashedAt = mult;
  b.payout = payout;
}

// ─── действия игрока ─────────────────────────────────────────────────────────

export function crashBet(user, opts = {}) {
  if (state.phase !== 'betting') fail('CRASH_CLOSED');
  if (state.bets.has(user.id)) fail('CRASH_ALREADY');
  const amount = Math.floor(Number(opts.amount));
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) fail('BAD_BET');
  let auto = opts.auto == null || opts.auto === '' ? null : Math.floor(Number(opts.auto) * 100) / 100;
  if (auto != null && !(auto >= 1.01 && auto <= MAX_POINT)) fail('BAD_ACTION');

  tx(() => {
    if ((balanceOf(user.id) ?? 0) < amount) fail('INSUFFICIENT');
    changeBalance(user.id, -amount);
    db.prepare('INSERT INTO crash_bets (user_id, amount) VALUES (?, ?)').run(user.id, amount);
  });
  const name = String(user.first_name || user.username || 'Игрок').slice(0, 32);
  state.bets.set(user.id, { name, amount, auto, cashedAt: null, payout: 0 });
  notify('bet');
}

/** Отменить ставку, пока ракета не взлетела */
export function crashCancel(user) {
  const b = state.bets.get(user.id);
  if (!b) fail('CRASH_NO_BET');
  if (state.phase !== 'betting') fail('CRASH_CLOSED');
  tx(() => {
    changeBalance(user.id, b.amount);
    db.prepare('DELETE FROM crash_bets WHERE user_id = ?').run(user.id);
  });
  state.bets.delete(user.id);
  notify('bet');
}

export function crashCashout(user) {
  const b = state.bets.get(user.id);
  if (!b || b.cashedAt != null) fail('CRASH_NO_BET');
  if (state.phase !== 'flying') fail('CRASH_CLOSED');
  const elapsed = Date.now() - state.startedAt;
  // опоздал на долю секунды до тика взрыва — уже взорвалось
  if (elapsed >= timeTo(state.point)) { crash(); fail('CRASH_CLOSED'); }
  settleCashout(user.id, b, Math.max(1, multAt(elapsed)));
  notify('cashout');
}

// ─── что видит игрок ─────────────────────────────────────────────────────────

export function crashView(userId) {
  const now = Date.now();
  const mine = state.bets.get(userId);
  return {
    round: state.round,
    phase: state.phase,
    serverNow: now,
    leftMs: state.phase === 'flying' ? 0 : Math.max(0, state.phaseEnds - now),
    elapsedMs: state.phase === 'flying' ? now - state.startedAt : 0,
    rate: RATE,
    point: state.phase === 'crashed' ? state.point : null,
    recent: state.recent,
    bets: [...state.bets.entries()]
      .map(([id, b]) => ({ id, name: b.name, amount: b.amount, cashedAt: b.cashedAt, payout: b.payout }))
      .sort((a, b) => b.amount - a.amount),
    you: mine
      ? { amount: mine.amount, auto: mine.auto, cashedAt: mine.cashedAt, payout: mine.payout }
      : null,
    balance: balanceOf(userId),
  };
}
