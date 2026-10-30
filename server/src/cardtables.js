// ─── Карточные столы: Blackjack, Очко, Покер ─────────────────────────────────
// Раунд стола живёт в room.round и проходит фазы:
//
//   Blackjack / Очко (все против крупье-бота):
//     betting → playing (ходы по очереди) → results → betting …
//     Ставка ставится фишками в фазе betting и сразу уходит из банка стола в
//     room_bets (при рестарте сервера вернётся). Раздача начинается, когда
//     «Готов» нажали все игроки онлайн, у которых есть фишки, либо через
//     BET_WAIT_MS после первого «Готов» — тогда играют все, кто успел поставить.
//
//   Покер (пятикарточный дро, игроки друг против друга, без бота):
//     betting (кто «Готов» — садится в раздачу, платит анте) → bet1 → draw →
//     bet2 → results. Лимитные торги: ставка/рейз фиксированного размера
//     (2 анте до обмена, 4 анте после), не больше 4 повышений за круг.
//     Вклад каждого за раздачу ограничен самым маленьким банком среди
//     участников, поэтому коллировать может любой и сайд-поты не нужны.
//
// Ход: TURN_MS на действие (OFFLINE_TURN_MS, если игрок отключился). По таймауту
// сервер ходит сам: Blackjack/Очко — «Хватит», покер — чек или фолд, обмен — без
// обмена. Ушедший из-за стола посреди раздачи: в Blackjack/Очко его рука
// останавливается и доигрывается, выигрыш идёт сразу на основной баланс; в
// покере — фолд, вклад остаётся в банке раздачи.
//
// Provably Fair: у каждой раздачи свой server seed, его хэш виден с начала фазы
// ставок. Колоду тасует лента HMAC(seed, client_seed:номер_раздачи), где
// client_seed — склейка client seed участников и свежих чисел из их «Готов»
// (fair/index.js combineSeeds). После раздачи сид раскрывается и каждому
// участнику пишется раунд в историю проверки.

import { db, tx, changeBalance, addHistory } from './db.js';
import { draw, handTotal } from './cards.js';
import { deck52, deck36, cardStr } from './fair/games.js';
import { rngFor, commitSeed, combineSeeds, cleanEntropy, revealSeed, openRound } from './fair/index.js';
import { evaluate, cmpVec } from './games/poker.js';
import {
  MAX_DURAK, durakStakeOf, durakDeal, durakAct, durakAuto, durakLeave, durakPayouts, durakView,
  durakActions,
} from './durak.js';

export const CARD_GAMES = new Set(['blackjack', 'ochko', 'poker', 'durak']);
/** Игры, где игроки играют друг против друга и «Готов» = сесть в партию */
const PVP = new Set(['poker', 'durak']);

// тайминги можно ужать через env для тестов (test/cards.js)
const ms = (name, def) => Number(process.env[name]) || def;
const BET_WAIT_MS = ms('TABLE_BET_WAIT_MS', 15_000); // после первого «Готов» остальные успевают поставить
const TURN_MS = ms('TABLE_TURN_MS', 20_000);
const OFFLINE_TURN_MS = ms('TABLE_OFFLINE_TURN_MS', 5_000);
const RESULT_MS = ms('TABLE_RESULT_MS', 6_000);
const POKER_RESULT_MS = ms('TABLE_POKER_RESULT_MS', 8_000);
const MAX_RAISES = 4;           // бет + 3 рейза за круг торгов

let hooks = {
  notify: () => {}, isOnline: () => false, isAlive: () => false, setBank: () => {},
};
/** rooms.js передаёт сюда рассылку, онлайн-статус и запись банка */
export function bindCardTables(h) { hooks = { ...hooks, ...h }; }

const fail = (code) => { throw new Error(code); };
const total = (cards) => handTotal(cards).total;
const isTwentyOne = (cards) => cards.length === 2 && total(cards) === 21;
const isPanPan = (cards) => cards.length === 2 && cards.every(c => c.s === '♠');

/** Анте покерного стола: 5% бай-ина, минимум 1; в дураке — ставка за партию */
export const anteOf = (room) => (room.game === 'durak' ? durakStakeOf(room) : Math.max(1, Math.floor(room.buyIn / 20)));

export function newRound(room, prev = null) {
  room.ready.clear();
  if (prev?.fair?.revealed) room.lastFair = prev.fair;
  return {
    phase: 'betting', hand: prev?.hand ?? 0, stakes: new Map(), rows: new Map(),
    deadline: 0, timer: null, seats: [], turn: -1, dealer: [],
    fair: commitSeed(), entropy: new Map(), // сид раздачи (хэш виден до ставок) и свежие числа из «Готов»
  };
}

// ─── таймеры ─────────────────────────────────────────────────────────────────

function schedule(room, ms, fn) {
  const r = room.round;
  clearTimeout(r.timer);
  r.deadline = Date.now() + ms;
  r.timer = setTimeout(() => {
    if (!hooks.isAlive(room) || room.round !== r) return;
    r.timer = null;
    try { fn(); } catch (e) { console.error('card table timer', e); }
    hooks.notify(room, 'round');
  }, ms);
}

function unschedule(r) {
  clearTimeout(r.timer);
  r.timer = null;
  r.deadline = 0;
}

/** Комната закрывается — гасим таймер */
export function disposeRound(room) { if (room.round) unschedule(room.round); }

// ─── деньги раунда: из банка стола в room_bets (вызывать внутри tx) ─────────

function pay(room, m, amount) {
  const r = room.round;
  m.bank -= amount;
  hooks.setBank(room, m);
  const rowId = r.rows.get(m.id);
  if (rowId) {
    db.prepare('UPDATE room_bets SET amount = amount + ? WHERE id = ?').run(amount, rowId);
  } else {
    const x = db.prepare('INSERT INTO room_bets (room_id, user_id, type, value, amount) VALUES (?, ?, ?, NULL, ?)')
      .run(room.id, m.id, room.game, amount);
    r.rows.set(m.id, Number(x.lastInsertRowid));
  }
}

/** Итог раздачи: выплаты в банки (ушедшим — на баланс), история, очистка room_bets */
function settle(room, entries) {
  tx(() => {
    for (const e of entries) {
      const m = room.members.get(e.id);
      if (m) {
        m.bank += e.payout;
        hooks.setBank(room, m);
      } else if (e.payout > 0) {
        changeBalance(e.id, e.payout);
      }
      addHistory(e.id, `${room.game}_room`, e.staked, e.payout - e.staked);
    }
    db.prepare('DELETE FROM room_bets WHERE room_id = ?').run(room.id);
    revealFair(room, entries);
  });
  room.round.rows.clear();
}

/** Раздача сыграна: раскрываем сид и пишем раунд каждому участнику (внутри tx) */
function revealFair(room, entries) {
  const r = room.round;
  const f = r.fair;
  if (!f?.record || f.revealed) return;
  revealSeed(f.seed);
  f.revealed = true;
  for (const e of entries) {
    const label = r.seats.find(s => s.id === e.id)?.result?.label ?? '';
    const net = e.payout - e.staked;
    openRound({
      userId: e.id, game: `${room.game}_room`, roomId: room.id, hash: f.hash, clientSeed: f.clientSeed,
      nonce: f.nonce, record: f.record, done: true, summary: `${label} · ${net >= 0 ? '+' : ''}${net}`,
    });
  }
}

const sortedMembers = (room) => [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);

// ─── фаза ставок ─────────────────────────────────────────────────────────────

export function cardBet(room, m, amount) {
  const r = room.round;
  if (PVP.has(room.game)) fail('BAD_ACTION');
  if (r.phase !== 'betting') fail('HAND_RUNNING');
  amount = Math.floor(Number(amount));
  if (!Number.isInteger(amount) || amount < 1) fail('BAD_BET');
  if (amount > m.bank) fail('BANK_LOW');
  tx(() => pay(room, m, amount));
  r.stakes.set(m.id, (r.stakes.get(m.id) ?? 0) + amount);
  room.ready.delete(m.id); // ставка изменилась — «Готов» заново
  hooks.notify(room, 'bet');
  maybeStart(room);
}

export function cardClear(room, m) {
  const r = room.round;
  if (r.phase !== 'betting') fail('HAND_RUNNING');
  const stake = r.stakes.get(m.id) ?? 0;
  if (stake) {
    tx(() => {
      m.bank += stake;
      hooks.setBank(room, m);
      db.prepare('DELETE FROM room_bets WHERE room_id = ? AND user_id = ?').run(room.id, m.id);
    });
  }
  r.stakes.delete(m.id);
  r.rows.delete(m.id);
  room.ready.delete(m.id);
  hooks.notify(room, 'bet');
  maybeStart(room);
}

export function cardReady(room, userId, ready, entropy) {
  const r = room.round;
  if (r.phase !== 'betting') fail('HAND_RUNNING');
  if (ready === false) {
    room.ready.delete(userId);
  } else {
    const m = room.members.get(userId);
    if (PVP.has(room.game)) {
      if (m.bank < anteOf(room)) fail('NEED_ANTE');
    } else if (!(r.stakes.get(userId) > 0)) fail('NO_MY_BETS');
    room.ready.add(userId);
    if (cleanEntropy(entropy)) r.entropy.set(userId, entropy);
  }
  hooks.notify(room, 'ready');
  maybeStart(room);
}

/** Кто сядет в раздачу, если начать её прямо сейчас */
function participants(room, onlyReady) {
  const r = room.round;
  if (PVP.has(room.game)) {
    const ante = anteOf(room);
    const ready = sortedMembers(room).filter(m => room.ready.has(m.id) && m.bank >= ante);
    return room.game === 'durak' ? ready.slice(0, MAX_DURAK) : ready;
  }
  return sortedMembers(room).filter(m => r.stakes.get(m.id) > 0 && (!onlyReady || room.ready.has(m.id)));
}

/** Кто держит раздачу: онлайн и есть чем играть */
function mustBeReady(room) {
  const r = room.round;
  const need = PVP.has(room.game) ? anteOf(room) : 1;
  return sortedMembers(room).filter(m => hooks.isOnline(room, m.id) && (m.bank >= need || r.stakes.get(m.id) > 0));
}

function maybeStart(room) {
  const r = room.round;
  if (r.phase !== 'betting') return;
  const min = PVP.has(room.game) ? 2 : 1;
  const readyPlayers = participants(room, true);
  if (readyPlayers.length < min) { unschedule(r); return; }
  if (mustBeReady(room).every(m => room.ready.has(m.id))) { deal(room); return; }
  if (!r.timer) {
    schedule(room, BET_WAIT_MS, () => {
      if (participants(room, false).length >= min) deal(room);
      else unschedule(r);
    });
  }
}

function deal(room) {
  dealCards(room);
  hooks.notify(room, 'deal');
}

function dealCards(room) {
  const r = room.round;
  unschedule(r);
  const players = participants(room, false);
  r.hand += 1;
  // колода из ленты Provably Fair: сид раздачи + сиды всех, кто сел играть
  const f = r.fair;
  f.clientSeed = combineSeeds(players.map(m => ({ id: m.id, entropy: r.entropy.get(m.id) })));
  f.nonce = r.hand;
  const rng = rngFor(f.seed, f.clientSeed, f.nonce);
  r.deck = room.game === 'durak' ? deck36(rng) : deck52(rng);
  f.record = { deck: r.deck.map(cardStr) };
  room.ready.clear();
  if (room.game === 'poker') return pokerDeal(room, players);
  if (room.game === 'durak') return durakDeal(room, players, durakCtx);

  r.dealer = [draw(r.deck), draw(r.deck)];
  r.seats = players.map(m => ({
    id: m.id, name: m.name, cards: [draw(r.deck), draw(r.deck)],
    stake: r.stakes.get(m.id), units: 1, status: 'play', left: false,
  }));
  r.phase = 'playing';

  if (room.game === 'blackjack') {
    for (const s of r.seats) if (isTwentyOne(s.cards)) s.status = 'bj';
    if (isTwentyOne(r.dealer)) return finishHand(room); // крупье подсмотрел блэкджек
  } else {
    for (const s of r.seats) {
      if (isPanPan(s.cards)) s.status = 'pan';
      else if (isTwentyOne(s.cards)) s.status = 'ochko';
    }
    if (isPanPan(r.dealer) || isTwentyOne(r.dealer)) return finishHand(room);
  }
  nextTurn(room, -1);
}

// ─── Blackjack / Очко ────────────────────────────────────────────────────────

const turnMs = (room, seat) => (hooks.isOnline(room, seat.id) && !seat.left ? TURN_MS : OFFLINE_TURN_MS);

function nextTurn(room, from) {
  const r = room.round;
  const i = r.seats.findIndex((s, idx) => idx > from && s.status === 'play');
  if (i < 0) return finishHand(room);
  r.turn = i;
  schedule(room, turnMs(room, r.seats[i]), () => autoAct(room));
}

function autoAct(room) {
  const r = room.round;
  if (room.game === 'durak') return durakAuto(room, durakCtx);
  if (room.game === 'poker') {
    const s = r.seats[r.turn];
    if (r.phase === 'draw') return pokerAct(room, s, { action: 'draw', discard: [] });
    return pokerAct(room, s, { action: s.roundBet === r.curBet ? 'check' : 'fold' });
  }
  const s = r.seats[r.turn];
  s.status = 'stand';
  nextTurn(room, r.turn);
}

export function cardAct(room, userId, msg = {}) {
  const r = room.round;
  const s = r.seats[r.turn];
  if (!['playing', 'bet1', 'draw', 'bet2'].includes(r.phase) || !s) fail('BAD_ACTION');
  if (s.id !== userId) fail('NOT_YOUR_TURN');
  if (room.game === 'poker') pokerAct(room, s, msg);
  else if (room.game === 'durak') durakAct(room, s, msg, durakCtx);
  else bjAct(room, s, String(msg.action || ''));
  hooks.notify(room, 'act');
}

function bjAct(room, s, action) {
  const r = room.round;
  if (s.status !== 'play') fail('BAD_ACTION');
  if (action === 'hit') {
    s.cards.push(draw(r.deck));
    const t = total(s.cards);
    if (t > 21) { s.status = 'bust'; return nextTurn(room, r.turn); }
    if (t === 21) { s.status = 'stand'; return nextTurn(room, r.turn); }
    return schedule(room, turnMs(room, s), () => autoAct(room)); // новый отсчёт на следующее действие
  }
  if (action === 'stand' || action === 'stop') {
    s.status = 'stand';
    return nextTurn(room, r.turn);
  }
  if (action === 'double' && room.game === 'blackjack') {
    const m = room.members.get(s.id);
    if (s.cards.length !== 2 || !m || m.bank < s.stake) fail('BANK_LOW');
    tx(() => pay(room, m, s.stake));
    s.units = 2;
    s.cards.push(draw(r.deck));
    s.status = total(s.cards) > 21 ? 'bust' : 'stand';
    return nextTurn(room, r.turn);
  }
  fail('BAD_ACTION');
}

/** Множитель возврата на единицу ставки и подпись итога */
function bjOutcome(game, s, dealer) {
  const p = total(s.cards);
  const d = total(dealer);
  if (game === 'blackjack') {
    const dBJ = isTwentyOne(dealer);
    if (s.status === 'bj') return dBJ ? [1, 'Ничья: оба BlackJack'] : [2.5, 'BlackJack! 3:2'];
    if (s.status === 'bust') return [0, 'Перебор'];
    if (dBJ) return [0, 'У крупье BlackJack'];
    if (d > 21) return [2, 'Крупье перебрал'];
    if (p > d) return [2, 'Победа'];
    if (p === d) return [1, 'Ничья'];
    return [0, 'Проигрыш'];
  }
  const dPan = isPanPan(dealer);
  const d21 = !dPan && isTwentyOne(dealer);
  if (s.status === 'pan') return dPan ? [1, 'Ничья: оба пан-пан'] : [3, 'Пан-пан! 3:1'];
  if (dPan) return [0, 'У крупье пан-пан'];
  if (s.status === 'ochko') return d21 ? [1, 'Ничья: оба очко'] : [2, 'Очко!'];
  if (s.status === 'bust') return [0, 'Перебор'];
  if (d21) return [0, 'У крупье очко'];
  if (d > 21) return [2, 'Крупье перебрал'];
  if (p > d) return [2, 'Победа'];
  if (p === d) return [1, 'Ничья'];
  return [0, 'Проигрыш'];
}

function finishHand(room) {
  const r = room.round;
  unschedule(r);
  // крупье добирает, только если кому-то ещё есть с кем играть
  const naturalStop = room.game === 'blackjack'
    ? isTwentyOne(r.dealer)
    : isPanPan(r.dealer) || isTwentyOne(r.dealer);
  const anyLive = r.seats.some(s => s.status === 'stand');
  if (!naturalStop && anyLive) while (total(r.dealer) < 17) r.dealer.push(draw(r.deck));

  const entries = r.seats.map(s => {
    const [mult, label] = bjOutcome(room.game, s, r.dealer);
    const staked = s.stake * s.units;
    const payout = Math.floor(staked * mult);
    s.result = { payout, net: payout - staked, label, outcome: mult > 1 ? 'win' : mult === 1 ? 'push' : 'lose' };
    if (s.status === 'play') s.status = 'stand';
    return { id: s.id, staked, payout };
  });
  settle(room, entries);
  r.phase = 'results';
  r.turn = -1;
  schedule(room, RESULT_MS, () => { room.round = newRound(room, r); });
}

// ─── Покер ───────────────────────────────────────────────────────────────────

function pokerDeal(room, players) {
  const r = room.round;
  const ante = anteOf(room);
  // кнопка смещается каждую раздачу — первым ходит следующий за ней
  room.pokerButton = ((room.pokerButton ?? -1) + 1) % players.length;
  const order = [...players.slice(room.pokerButton), ...players.slice(0, room.pokerButton)];
  r.cap = Math.min(...order.map(m => m.bank));
  tx(() => { for (const m of order) pay(room, m, ante); });
  r.seats = order.map(m => ({
    id: m.id, name: m.name, cards: Array.from({ length: 5 }, () => draw(r.deck)),
    contrib: ante, roundBet: 0, acted: false, folded: false, drawn: false, discards: null, left: false,
  }));
  r.pot = ante * order.length;
  r.ante = ante;
  startBettingRound(room, 'bet1', ante * 2);
}

function startBettingRound(room, phase, betSize) {
  const r = room.round;
  r.phase = phase;
  r.curBet = 0;
  r.raises = 0;
  r.betSize = betSize;
  for (const s of r.seats) { s.roundBet = 0; s.acted = false; }
  pokerNext(room, -1);
}

const activeSeats = (r) => r.seats.filter(s => !s.folded);

/** Следующий, кому ходить, начиная после from (по кругу); никого — следующая фаза */
function pokerNext(room, from) {
  const r = room.round;
  if (activeSeats(r).length <= 1) return showdown(room);
  const n = r.seats.length;
  const needs = r.phase === 'draw'
    ? (s) => !s.folded && !s.drawn
    : (s) => !s.folded && (!s.acted || s.roundBet < r.curBet);
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (needs(r.seats[i])) {
      r.turn = i;
      return schedule(room, turnMs(room, r.seats[i]), () => autoAct(room));
    }
  }
  if (r.phase === 'bet1') {
    r.phase = 'draw';
    return pokerNext(room, -1);
  }
  if (r.phase === 'draw') return startBettingRound(room, 'bet2', r.ante * 4);
  return showdown(room);
}

/** Сколько ещё можно вложить, не превысив общий лимит раздачи */
const raiseNeed = (r, s) => r.curBet + r.betSize - s.roundBet;
const canRaise = (r, s) => r.raises < MAX_RAISES && s.contrib + raiseNeed(r, s) <= r.cap;

function pokerAct(room, s, msg) {
  const r = room.round;
  const action = String(msg.action || '');
  const m = room.members.get(s.id);
  const put = (amount) => {
    if (amount <= 0) return;
    if (!m || m.bank < amount) fail('BANK_LOW');
    tx(() => pay(room, m, amount));
    s.contrib += amount;
    s.roundBet += amount;
    r.pot += amount;
  };

  if (r.phase === 'draw') {
    if (action !== 'draw') fail('BAD_ACTION');
    const idx = [...new Set((Array.isArray(msg.discard) ? msg.discard : [])
      .filter(i => Number.isInteger(i) && i >= 0 && i < 5))];
    for (const i of idx) s.cards[i] = draw(r.deck);
    s.drawn = true;
    s.discards = idx.length;
    return pokerNext(room, r.turn);
  }

  const toCall = r.curBet - s.roundBet;
  if (action === 'check') {
    if (toCall > 0) fail('BAD_ACTION');
  } else if (action === 'call') {
    if (toCall <= 0) fail('BAD_ACTION');
    put(toCall);
  } else if (action === 'raise') {
    if (!canRaise(r, s)) fail('CANT_RAISE');
    put(raiseNeed(r, s));
    r.curBet = s.roundBet;
    r.raises += 1;
    for (const o of r.seats) if (o !== s) o.acted = false;
  } else if (action === 'fold') {
    s.folded = true;
  } else {
    fail('BAD_ACTION');
  }
  s.acted = true;
  return pokerNext(room, r.turn);
}

function showdown(room) {
  const r = room.round;
  unschedule(r);
  const alive = activeSeats(r);
  let winners;
  if (alive.length === 1) {
    winners = alive;
  } else {
    for (const s of alive) s.eval = evaluate(s.cards);
    const best = alive.reduce((b, s) => (!b || s.eval.cat > b.eval.cat
      || (s.eval.cat === b.eval.cat && cmpVec(s.eval.tiebreak, b.eval.tiebreak) > 0) ? s : b), null);
    winners = alive.filter(s => s.eval.cat === best.eval.cat && cmpVec(s.eval.tiebreak, best.eval.tiebreak) === 0);
  }
  r.showdown = alive.length > 1;
  const share = Math.floor(r.pot / winners.length);
  const extra = r.pot - share * winners.length; // остаток от деления — первому по очереди
  const entries = r.seats.map(s => {
    const wi = winners.indexOf(s);
    const payout = wi < 0 ? 0 : share + (wi === 0 ? extra : 0);
    const net = payout - s.contrib;
    const label = s.folded ? 'Пас'
      : wi >= 0 ? (r.showdown ? `Победа: ${s.eval.name}` : 'Все спасовали — банк твой')
        : s.eval?.name ?? '';
    s.result = { payout, net, label, outcome: net > 0 ? 'win' : net === 0 ? 'push' : 'lose' };
    return { id: s.id, staked: s.contrib, payout };
  });
  settle(room, entries);
  r.phase = 'results';
  r.turn = -1;
  schedule(room, POKER_RESULT_MS, () => { room.round = newRound(room, r); });
}

// ─── Дурак: таймеры и деньги для durak.js ────────────────────────────────────

const durakCtx = {
  payAll(room, players, stake) { tx(() => { for (const m of players) pay(room, m, stake); }); },
  scheduleTurn(room, seat) { schedule(room, turnMs(room, seat), () => autoAct(room)); },
  finish(room, loser) { durakFinish(room, loser); },
};

function durakFinish(room, loser) {
  const r = room.round;
  unschedule(r);
  const entries = durakPayouts(r, loser).map(({ s, payout, label }) => {
    s.result = { payout, net: payout - s.stake, label, outcome: payout > s.stake ? 'win' : payout === s.stake ? 'push' : 'lose' };
    return { id: s.id, staked: s.stake, payout };
  });
  settle(room, entries);
  r.loserId = loser?.id ?? null;
  r.phase = 'results';
  r.turn = -1;
  schedule(room, POKER_RESULT_MS, () => { room.round = newRound(room, r); });
}

// ─── выход и онлайн ──────────────────────────────────────────────────────────

/**
 * Игрок уходит из-за стола (вызывается ДО удаления из room.members).
 * Возвращает, сколько вернуть ему на баланс сверх банка (несыгранная ставка).
 */
export function cardLeave(room, userId) {
  const r = room.round;
  if (r.phase === 'betting') {
    const stake = r.stakes.get(userId) ?? 0;
    r.stakes.delete(userId);
    r.rows.delete(userId);
    room.ready.delete(userId);
    return stake;
  }
  const s = r.seats.find(x => x.id === userId);
  if (!s || r.phase === 'results') return 0;
  s.left = true;
  const myTurn = r.seats[r.turn] === s;
  const last = room.members.size === 1;

  if (room.game === 'durak') {
    durakLeave(room, s, durakCtx);
  } else if (room.game === 'poker') {
    if (!s.folded) {
      const others = activeSeats(r).filter(x => x !== s);
      if (others.length) {
        s.folded = true;
        s.acted = true;
        if (myTurn || others.length === 1) pokerNext(room, r.turn);
      } else {
        showdown(room); // остался один в раздаче — банк его
      }
    }
  } else {
    if (s.status === 'play') s.status = 'stand';
    if (last) finishHand(room);       // за столом никого — доигрываем сразу
    else if (myTurn) nextTurn(room, r.turn);
  }
  // если раздача закончилась прямо сейчас, выигрыш уже в банке — вернётся с кэшаутом
  return 0;
}

/** Изменился онлайн: проверить старт и ускорить ход отключившегося */
export function cardPresence(room) {
  const r = room.round;
  if (r.phase === 'betting') return maybeStart(room);
  const s = r.seats[r.turn];
  if (s && r.timer && !hooks.isOnline(room, s.id) && r.deadline - Date.now() > OFFLINE_TURN_MS) {
    schedule(room, OFFLINE_TURN_MS, () => autoAct(room));
  }
}

// ─── что видит игрок ─────────────────────────────────────────────────────────

/** Сколько фишек игрок держит в текущем раунде */
export function stakeOf(room, userId) {
  const r = room.round;
  if (r.phase === 'betting') return r.stakes.get(userId) ?? 0;
  const s = r.seats.find(x => x.id === userId);
  if (!s) return 0;
  if (room.game === 'durak') return s.stake;
  return room.game === 'poker' ? s.contrib : s.stake * s.units;
}

const HIDDEN = { hidden: true };

/** Сид раздачи для экрана стола: хэш текущей и раскрытая прошлая */
export function cardFair(room) {
  const f = room.round.fair;
  return { current: f.revealed ? null : f.hash, last: f.revealed ? f : room.lastFair ?? null };
}

export function cardView(room, userId) {
  const r = room.round;
  const inTurn = ['playing', 'bet1', 'draw', 'bet2'].includes(r.phase);
  const results = r.phase === 'results';
  const turnSeat = inTurn ? r.seats[r.turn] : null;
  const me = r.seats.find(s => s.id === userId);
  const m = room.members.get(userId);

  const view = {
    phase: r.phase,
    hand: r.hand,
    deadlineMs: r.deadline ? Math.max(0, r.deadline - Date.now()) : 0,
    turnId: turnSeat?.id ?? null,
    turnTotalMs: turnSeat ? turnMs(room, turnSeat) : 0,
    seats: r.seats.map(s => {
      const own = s.id === userId;
      const seat = { id: s.id, name: s.name, left: s.left, result: results ? s.result : null };
      if (room.game === 'durak') {
        Object.assign(seat, {
          count: s.hand.length, out: s.out, place: s.place, stake: s.stake,
          // после партии видно, с чем остался дурак
          cards: results && s.hand.length ? s.hand : [],
        });
      } else if (room.game === 'poker') {
        const reveal = own || (results && r.showdown && !s.folded);
        Object.assign(seat, {
          cards: reveal ? s.cards : s.cards.map(() => HIDDEN),
          hand: reveal && (own || results) ? evaluate(s.cards).name : null,
          contrib: s.contrib, roundBet: s.roundBet, folded: s.folded,
          drawn: s.drawn, discards: s.discards,
        });
      } else {
        Object.assign(seat, {
          cards: s.cards, total: total(s.cards), status: s.status, stake: s.stake, units: s.units,
        });
      }
      return seat;
    }),
    you: { inHand: !!me, actions: [] },
  };

  if (room.game === 'durak') {
    view.ante = anteOf(room);
    view.durak = durakView(r, userId);
  } else if (room.game === 'poker') {
    Object.assign(view, {
      ante: anteOf(room), pot: r.pot ?? 0, curBet: r.curBet ?? 0, betSize: r.betSize ?? 0,
      cap: r.cap ?? 0, raises: r.raises ?? 0, maxRaises: MAX_RAISES,
    });
  } else {
    const hole = results ? r.dealer : r.dealer.slice(0, 1).concat(r.dealer.length ? [HIDDEN] : []);
    view.dealer = { cards: hole, total: r.dealer.length ? total(results ? r.dealer : r.dealer.slice(0, 1)) : null };
  }

  if (turnSeat && turnSeat.id === userId && !turnSeat.left) {
    if (room.game === 'durak') {
      view.you.actions = durakActions(r);
      view.you.canPlay = view.durak.playable.length > 0;
    } else if (room.game === 'poker') {
      if (r.phase === 'draw') view.you.actions = ['draw'];
      else {
        const toCall = r.curBet - turnSeat.roundBet;
        view.you.toCall = toCall;
        view.you.raiseTo = r.curBet + r.betSize;
        view.you.actions = [toCall > 0 ? 'call' : 'check', ...(canRaise(r, turnSeat) ? ['raise'] : []), 'fold'];
      }
    } else if (room.game === 'blackjack') {
      view.you.actions = ['hit', 'stand', ...(turnSeat.cards.length === 2 && m && m.bank >= turnSeat.stake ? ['double'] : [])];
    } else {
      view.you.actions = ['hit', 'stop'];
    }
  }
  return view;
}
