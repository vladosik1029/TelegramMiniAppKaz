// ─── Краш (Ракета) ───────────────────────────────────────────────────────────
// Один общий раунд на всех, кто открыл игру. Цикл:
//   betting (BET_MS) → flying (множитель растёт, пока не «взорвётся») → crashed (PAUSE_MS) → …
// Множитель: m(t) = e^(RATE·t), t в секундах (×2 ≈ за 8.7 с, ×10 ≈ за 29 с).
// Точка взрыва выбирается в начале полёта и до взрыва никуда не уходит:
//   crash = floor(100 · 0.99 / (1 − r)) / 100, r ∈ [0, 1) — 1% преимущество дома.
//
// Provably Fair — цепочка хэшей (как у bustabit):
//   h[0] — 32 случайных байта, h[i] = SHA-256(h[i−1]), i = 1…L; публикуется h[L].
//   Раунд j цепочки играет на сиде h[L−j]. Его SHA-256 = h[L−j+1] — это сид
//   прошлого раунда (для первого — сама публикация h[L]), он виден ещё до ставок.
//   Значит, все точки взрыва зафиксированы заранее: сервер не может подстроить
//   раунд под ставки. r берётся из HMAC-SHA256(h[L−j], client_seed:j:0), где
//   client_seed — склейка client seed и свежих случайных чисел всех, кто
//   поставил (fair/index.js combineSeeds): так и заранее построенную цепочку
//   нельзя «подобрать» под будущие раунды.
// Ставка списывается с баланса сразу и лежит в crash_bets (при рестарте вернётся).
// Забрать можно в любой момент полёта (или автоматически на заданном множителе).

import { db, tx, balanceOf, changeBalance, addHistory } from './db.js';
import { MIN_BET, MAX_BET } from './telegram.js';
import { crashPoint } from './fair/games.js';
import { rngFor, randomHex, sha256, combineSeeds, cleanEntropy, openRound, revealSeed } from './fair/index.js';

const ms = (name, def) => Number(process.env[name]) || def;
const BET_MS = ms('CRASH_BET_MS', 8_000);
const PAUSE_MS = ms('CRASH_PAUSE_MS', 3_000);
const TICK_MS = 50;
export const RATE = 0.08;
const MAX_POINT = 1000;
const HISTORY = 16;
const CHAIN_LEN = ms('CRASH_CHAIN_LEN', 10_000); // ~2–3 суток раундов, потом новая цепочка

db.exec(`
CREATE TABLE IF NOT EXISTS crash_bets (
  user_id INTEGER PRIMARY KEY,
  amount INTEGER NOT NULL
);
-- цепочки хэшей Ракеты: terminal = h[0] (секрет, раскрывается раундами), commitment = h[L]
CREATE TABLE IF NOT EXISTS crash_chains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terminal TEXT NOT NULL,
  length INTEGER NOT NULL,
  commitment TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

// ─── цепочка хэшей ───────────────────────────────────────────────────────────

/** h[0…L]: h[i] = SHA-256(h[i−1]) */
function buildChain(terminal, length) {
  const h = [terminal];
  for (let i = 1; i <= length; i++) h.push(sha256(h[i - 1]));
  return h;
}

const chain = { id: 0, length: 0, commitment: '', used: 0, hashes: [] };

function loadChain() {
  let row = db.prepare('SELECT * FROM crash_chains WHERE used < length ORDER BY id DESC LIMIT 1').get();
  if (!row) {
    const terminal = randomHex();
    const hashes = buildChain(terminal, CHAIN_LEN);
    const r = db.prepare('INSERT INTO crash_chains (terminal, length, commitment) VALUES (?, ?, ?)')
      .run(terminal, CHAIN_LEN, hashes[CHAIN_LEN]);
    row = db.prepare('SELECT * FROM crash_chains WHERE id = ?').get(Number(r.lastInsertRowid));
    Object.assign(chain, { hashes });
  } else {
    chain.hashes = buildChain(row.terminal, row.length);
  }
  Object.assign(chain, { id: row.id, length: row.length, commitment: row.commitment, used: row.used });
}

/** Следующий раунд цепочки: номер записывается сразу — сид не переиграть даже после рестарта */
function nextChainRound() {
  if (!chain.hashes.length || chain.used >= chain.length) loadChain();
  chain.used += 1;
  db.prepare('UPDATE crash_chains SET used = ? WHERE id = ?').run(chain.used, chain.id);
  const seed = chain.hashes[chain.length - chain.used];
  return { chainId: chain.id, commitment: chain.commitment, idx: chain.used, seed, hash: sha256(seed) };
}

/** Что показать про честность Ракеты (экран «Проверка честности») */
export function crashFair() {
  return {
    chainId: chain.id, chainLength: chain.length, commitment: chain.commitment,
    round: state.fair ? { idx: state.fair.idx, hash: state.fair.hash } : null,
  };
}

const state = {
  round: 0,
  phase: 'betting',
  phaseEnds: 0,     // betting/crashed: когда фаза закончится
  startedAt: 0,     // flying: момент старта
  point: 0,         // точка взрыва (секрет до взрыва)
  bets: new Map(),  // userId -> { name, amount, auto, cashedAt, payout, entropy }
  recent: [],
  fair: null,       // { chainId, idx, seed (секрет до взрыва), hash, clientSeed }
  lastFair: null,   // раскрытый прошлый раунд
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
  loadChain();
  startBetting();
  clearInterval(timer);
  timer = setInterval(tick, TICK_MS);
}

function startBetting() {
  state.round += 1;
  state.phase = 'betting';
  state.phaseEnds = Date.now() + BET_MS;
  state.bets = new Map();
  state.fair = nextChainRound(); // хэш сида раунда виден до ставок
  notify('betting');
}

function startFlight() {
  state.phase = 'flying';
  state.startedAt = Date.now();
  // ставки закрыты — склеиваем сиды поставивших и считаем точку взрыва
  const f = state.fair;
  f.clientSeed = combineSeeds([...state.bets.entries()].map(([id, b]) => ({ id, entropy: b.entropy })));
  state.point = crashPoint(rngFor(f.seed, f.clientSeed, f.idx));
  notify('flying');
}

function crash() {
  state.phase = 'crashed';
  state.phaseEnds = Date.now() + PAUSE_MS;
  // кто не успел забрать — проиграл
  const f = state.fair;
  tx(() => {
    for (const [uid, b] of state.bets) {
      if (b.cashedAt == null) addHistory(uid, 'crash', b.amount, -b.amount);
    }
    db.prepare('DELETE FROM crash_bets').run();
    // раскрываем сид раунда и пишем историю для проверки: общий раунд + каждому поставившему
    revealSeed(f.seed);
    const round = {
      game: 'crash', hash: f.hash, clientSeed: f.clientSeed, nonce: f.idx, done: true,
      params: { chainId: f.chainId, idx: f.idx, commitment: f.commitment },
      record: { point: state.point },
    };
    openRound({ ...round, summary: `×${state.point.toFixed(2)}` });
    for (const [uid, b] of state.bets) {
      const net = b.cashedAt == null ? -b.amount : b.payout - b.amount;
      openRound({ ...round, userId: uid, summary: `×${state.point.toFixed(2)} · ${net >= 0 ? '+' : ''}${net}` });
    }
  });
  state.lastFair = { idx: f.idx, hash: f.hash, seed: f.seed, clientSeed: f.clientSeed, point: state.point };
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
  state.bets.set(user.id, { name, amount, auto, cashedAt: null, payout: 0, entropy: cleanEntropy(opts.entropy) });
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
    // Provably Fair: хэш сида текущего раунда (виден до ставок) и раскрытый прошлый
    fair: {
      idx: state.fair?.idx ?? null, hash: state.fair?.hash ?? null,
      commitment: chain.commitment, chainId: chain.id,
      last: state.lastFair,
    },
    bets: [...state.bets.entries()]
      .map(([id, b]) => ({ id, name: b.name, amount: b.amount, cashedAt: b.cashedAt, payout: b.payout }))
      .sort((a, b) => b.amount - a.amount),
    you: mine
      ? { amount: mine.amount, auto: mine.auto, cashedAt: mine.cashedAt, payout: mine.payout }
      : null,
    balance: balanceOf(userId),
  };
}
