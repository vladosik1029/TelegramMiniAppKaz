// ─── Мультиплеерные столы ────────────────────────────────────────────────────
// Стол = комната с одной игрой (пока рулетка). Создатель задаёт бай-ин: при входе
// бай-ин списывается с основного баланса в «банк стола» участника, ставки идут
// из этого банка, при выходе остаток возвращается на основной баланс (кэшаут).
//
// Состояние живёт в памяти (Map) и пишется в SQLite на каждом изменении:
// rooms / room_members (банки) / room_bets (ставки текущего раунда).
// При рестарте сервера bootRooms() поднимает столы и возвращает несыгранные
// ставки в банки игроков. Рассылку по WebSocket делает ws.js через onRoomChange().

import crypto from 'node:crypto';
import { db, tx, balanceOf, changeBalance, addHistory } from './db.js';
import { env } from './telegram.js';
import * as roulette from './games/roulette.js';
import {
  CARD_GAMES, bindCardTables, newRound, disposeRound, cardBet, cardClear, cardReady, cardAct,
  cardLeave, cardPresence, cardView, stakeOf,
} from './cardtables.js';

export const ROOM_GAMES = {
  roulette: { title: 'Рулетка', icon: '🎡', ready: true },
  blackjack: { title: 'Blackjack', icon: '🂡', ready: true },
  ochko: { title: 'Очко', icon: '♠️', ready: true },
  poker: { title: 'Покер', icon: '🂱', ready: true },
};

export const MAX_PLAYERS = 8;
export const MIN_BUYIN = 10;
export const MAX_BUYIN = 1_000_000;
const SPIN_MS = 5200;           // сколько клиенты крутят колесо — ставки на это время закрыты
const MAX_BETS_PER_PLAYER = 20; // разных позиций за раунд
const RECENT_NUMBERS = 12;

export const ROOM_ERRORS = {
  ROOM_NOT_FOUND: 'Стол не найден или уже закрыт',
  ROOM_FULL: 'За столом нет свободных мест',
  NOT_IN_ROOM: 'Ты не сидишь за этим столом',
  ROOM_BUSY: 'Колесо крутится — ставки закрыты',
  NO_BETS: 'Ещё никто не поставил',
  NO_MY_BETS: 'Сначала сделай ставку, потом жми «Готов»',
  HAND_RUNNING: 'Идёт раздача — дождись следующей',
  NOT_YOUR_TURN: 'Сейчас не твой ход',
  CANT_RAISE: 'Повышать больше нельзя',
  NEED_ANTE: 'В банке стола не хватает фишек на анте',
  BANK_LOW: 'В банке стола не хватает фишек',
  BAD_ROOM: 'Некорректные параметры стола',
  GAME_SOON: 'Эта игра для столов пока в разработке',
  TOO_MANY_BETS: 'Слишком много разных ставок за раунд',
};

/** @type {Map<string, any>} */
const rooms = new Map();
/** roomId -> Map<userId, число открытых сокетов> */
const online = new Map();

let notify = () => {};
/** ws.js подписывается сюда: вызывается после каждого изменения стола */
export function onRoomChange(fn) { notify = fn; }

const fail = (code) => { throw new Error(code); };
const isCards = (room) => CARD_GAMES.has(room.game);

bindCardTables({
  notify: (room, event) => notify(room, event),
  isOnline: (room, userId) => !!online.get(room.id)?.get(userId),
  isAlive: (room) => rooms.get(room.id) === room,
  setBank: (room, m) => setBank(room, m),
});

function mustRoom(id) {
  const room = rooms.get(String(id));
  if (!room) fail('ROOM_NOT_FOUND');
  return room;
}
function mustMember(room, userId) {
  const m = room.members.get(userId);
  if (!m) fail('NOT_IN_ROOM');
  return m;
}
/** Окно анимации прошло — стол снова принимает ставки */
function syncStatus(room) {
  if (room.status === 'spinning' && Date.now() >= room.spinUntil) room.status = 'open';
}

const displayName = (user) =>
  String(user.first_name || user.firstName || user.username || 'Игрок').slice(0, 32);

const setBank = (room, m) =>
  db.prepare('UPDATE room_members SET bank = ? WHERE room_id = ? AND user_id = ?').run(m.bank, room.id, m.id);

// ─── жизненный цикл ──────────────────────────────────────────────────────────

export function createRoom(user, params = {}) {
  const game = String(params.game || '');
  if (!ROOM_GAMES[game]) fail('BAD_ROOM');
  if (!ROOM_GAMES[game].ready) fail('GAME_SOON');
  const buyIn = Math.floor(Number(params.buyIn));
  if (!Number.isInteger(buyIn) || buyIn < MIN_BUYIN || buyIn > MAX_BUYIN) fail('BAD_ROOM');
  const name = String(params.name || '').trim().slice(0, 40) || `Стол ${displayName(user)}`;
  const isPublic = params.isPublic !== false;

  const id = crypto.randomBytes(6).toString('base64url'); // 8 символов, не перебрать
  const now = Date.now();
  tx(() => {
    if ((balanceOf(user.id) ?? 0) < buyIn) fail('INSUFFICIENT');
    changeBalance(user.id, -buyIn);
    db.prepare('INSERT INTO rooms (id, name, game, host_id, is_public, buy_in) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, game, user.id, isPublic ? 1 : 0, buyIn);
    db.prepare('INSERT INTO room_members (room_id, user_id, name, bank, joined_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, user.id, displayName(user), buyIn, now);
  });

  const room = {
    id, name, game, hostId: user.id, isPublic, buyIn,
    members: new Map([[user.id, { id: user.id, name: displayName(user), bank: buyIn, joinedAt: now }]]),
    bets: [], ready: new Set(), status: 'open', spinUntil: 0, lastSpin: null, recent: [], seq: 0,
  };
  if (isCards(room)) room.round = newRound(room);
  rooms.set(id, room);
  return room;
}

export function joinRoom(user, roomId) {
  const room = mustRoom(roomId);
  if (room.members.has(user.id)) return room; // уже за столом — просто вернуть состояние
  if (room.members.size >= MAX_PLAYERS) fail('ROOM_FULL');

  const now = Date.now();
  tx(() => {
    if ((balanceOf(user.id) ?? 0) < room.buyIn) fail('INSUFFICIENT');
    changeBalance(user.id, -room.buyIn);
    db.prepare('INSERT INTO room_members (room_id, user_id, name, bank, joined_at) VALUES (?, ?, ?, ?, ?)')
      .run(room.id, user.id, displayName(user), room.buyIn, now);
  });
  room.members.set(user.id, { id: user.id, name: displayName(user), bank: room.buyIn, joinedAt: now });
  notify(room, 'join');
  return room;
}

/** Выход из-за стола: несыгранные ставки возвращаются в банк, банк — на баланс */
export function leaveRoom(userId, roomId) {
  const room = mustRoom(roomId);
  const m = mustMember(room, userId);

  // карточный стол: ставка до раздачи возвращается; посреди раздачи рука
  // доигрывается без игрока (выигрыш — сразу на баланс), в покере — фолд
  const unplayed = isCards(room)
    ? cardLeave(room, userId)
    : room.bets.filter(b => b.userId === userId).reduce((s, b) => s + b.amount, 0);
  const cashout = m.bank + unplayed;
  const handRunning = isCards(room) && room.round.phase !== 'betting' && room.round.rows.has(userId);
  tx(() => {
    if (!handRunning) db.prepare('DELETE FROM room_bets WHERE room_id = ? AND user_id = ?').run(room.id, userId);
    db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(room.id, userId);
    if (cashout > 0) changeBalance(userId, cashout);
  });
  room.bets = room.bets.filter(b => b.userId !== userId);
  room.members.delete(userId);
  room.ready.delete(userId);

  if (!room.members.size) {
    if (isCards(room)) disposeRound(room);
    db.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);
    rooms.delete(room.id);
    online.delete(room.id);
    notify(room, 'closed');
  } else {
    if (room.hostId === userId) {
      // хост переходит к тому, кто сидит дольше всех
      const next = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      room.hostId = next.id;
      db.prepare('UPDATE rooms SET host_id = ? WHERE id = ?').run(next.id, room.id);
    }
    notify(room, 'leave');
    if (isCards(room)) cardPresence(room);
    else maybeSpin(room); // ушёл последний «неготовый» — можно крутить
  }
  return { cashout, balance: balanceOf(userId) };
}

// ─── ставки и спин (рулетка) ─────────────────────────────────────────────────

export function placeBet(userId, roomId, bet = {}) {
  const room = mustRoom(roomId);
  const m = mustMember(room, userId);
  if (isCards(room)) { cardBet(room, m, bet.amount); return room; }
  syncStatus(room);
  if (room.status !== 'open') fail('ROOM_BUSY');

  const { type, value } = roulette.parseOpts(bet);
  const amount = Math.floor(Number(bet.amount));
  if (!Number.isInteger(amount) || amount < 1) fail('BAD_BET');
  if (amount > m.bank) fail('BANK_LOW');

  // одинаковые позиции складываются в одну ставку
  const same = room.bets.find(b => b.userId === userId && b.type === type && b.value === value);
  if (!same && room.bets.filter(b => b.userId === userId).length >= MAX_BETS_PER_PLAYER) fail('TOO_MANY_BETS');

  tx(() => {
    m.bank -= amount;
    setBank(room, m);
    if (same) {
      same.amount += amount;
      db.prepare('UPDATE room_bets SET amount = ? WHERE id = ?').run(same.amount, same.id);
    } else {
      const r = db.prepare('INSERT INTO room_bets (room_id, user_id, type, value, amount) VALUES (?, ?, ?, ?, ?)')
        .run(room.id, userId, type, value, amount);
      room.bets.push({ id: Number(r.lastInsertRowid), userId, type, value, amount });
    }
  });
  room.ready.delete(userId); // ставки изменились — «Готов» нужно нажать заново
  notify(room, 'bet');
  return room;
}

/** Снять все свои ставки раунда (пока колесо не запущено) */
export function clearBets(userId, roomId) {
  const room = mustRoom(roomId);
  const m = mustMember(room, userId);
  if (isCards(room)) { cardClear(room, m); return room; }
  syncStatus(room);
  if (room.status !== 'open') fail('ROOM_BUSY');

  const mine = room.bets.filter(b => b.userId === userId);
  if (!mine.length) return room;
  tx(() => {
    m.bank += mine.reduce((s, b) => s + b.amount, 0);
    setBank(room, m);
    db.prepare('DELETE FROM room_bets WHERE room_id = ? AND user_id = ?').run(room.id, userId);
  });
  room.bets = room.bets.filter(b => b.userId !== userId);
  room.ready.delete(userId);
  notify(room, 'bet');
  return room;
}

/**
 * Кто должен нажать «Готов», чтобы колесо закрутилось: игроки онлайн, у которых
 * есть чем играть (фишки в банке или ставки). Офлайн-игроки и игроки с пустым
 * банком раунд не держат; ставки офлайн-игрока при этом всё равно играют.
 */
function mustBeReady(room) {
  const on = online.get(room.id);
  const staked = new Set(room.bets.map(b => b.userId));
  return [...room.members.values()].filter(m => on?.get(m.id) && (m.bank > 0 || staked.has(m.id)));
}

/** Игрок жмёт «Готов» (или отменяет): когда готовы все — колесо крутится само */
export function setReady(userId, roomId, opts = {}) {
  const room = mustRoom(roomId);
  mustMember(room, userId);
  if (isCards(room)) { cardReady(room, userId, opts.ready); return room; }
  syncStatus(room);
  if (room.status !== 'open') fail('ROOM_BUSY');
  if (opts.ready === false) {
    room.ready.delete(userId);
  } else {
    if (!room.bets.some(b => b.userId === userId)) fail('NO_MY_BETS');
    room.ready.add(userId);
  }
  notify(room, 'ready');
  maybeSpin(room);
  return room;
}

/** Ход в карточной игре: hit/stand/double, hit/stop, check/call/raise/fold, draw */
export function playAction(userId, roomId, msg = {}) {
  const room = mustRoom(roomId);
  mustMember(room, userId);
  if (!isCards(room)) fail('BAD_ACTION');
  cardAct(room, userId, msg);
  return room;
}

function maybeSpin(room) {
  if (rooms.get(room.id) !== room) return;
  syncStatus(room);
  if (room.status !== 'open' || !room.bets.length || !room.ready.size) return;
  if (mustBeReady(room).every(m => room.ready.has(m.id))) spinRoulette(room);
}

/** Колесо: один исход на всех, выплаты сразу в банки стола */
function spinRoulette(room) {
  const idx = crypto.randomInt(0, roulette.ORDER.length);
  const number = roulette.ORDER[idx];

  const results = {}; // userId -> { staked, payout, net }
  for (const b of room.bets) {
    const r = (results[b.userId] ??= { staked: 0, payout: 0, net: 0 });
    r.staked += b.amount;
    if (roulette.wins(b.type, b.value, number)) r.payout += b.amount * roulette.multOf(b.type);
  }

  tx(() => {
    for (const [uid, r] of Object.entries(results)) {
      const m = room.members.get(Number(uid));
      r.net = r.payout - r.staked;
      m.bank += r.payout;
      setBank(room, m);
      addHistory(m.id, 'roulette_room', r.staked, r.net);
    }
    db.prepare('DELETE FROM room_bets WHERE room_id = ?').run(room.id);
  });

  room.seq += 1;
  room.lastSpin = {
    seq: room.seq, idx, number, color: roulette.colorOf(number), at: Date.now(),
    bets: room.bets.map(b => ({ userId: b.userId, type: b.type, value: b.value, amount: b.amount })),
    results,
  };
  room.bets = [];
  room.ready.clear();
  room.recent = [number, ...room.recent].slice(0, RECENT_NUMBERS);
  room.status = 'spinning';
  room.spinUntil = Date.now() + SPIN_MS;
  setTimeout(() => {
    if (rooms.get(room.id) !== room) return;
    syncStatus(room);
    notify(room, 'open');
  }, SPIN_MS + 50);

  notify(room, 'spin');
  return room;
}

// ─── чтение ──────────────────────────────────────────────────────────────────

export const getRoom = (id) => rooms.get(String(id)) || null;

export const inviteLink = (room) => `https://t.me/${env.BOT_USERNAME}?startapp=room_${room.id}`;

export function listRooms(userId) {
  return [...rooms.values()]
    .filter(r => r.isPublic || r.members.has(userId))
    .map(r => ({
      id: r.id, name: r.name, game: r.game, isPublic: r.isPublic, buyIn: r.buyIn,
      players: r.members.size, max: MAX_PLAYERS,
      online: online.get(r.id)?.size ?? 0,
      hostName: r.members.get(r.hostId)?.name ?? '',
      mine: r.members.has(userId),
    }))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || b.online - a.online || b.players - a.players);
}

/** Что видит приглашённый до входа: параметры стола и кто сидит */
export function roomPreview(roomId, userId) {
  const r = mustRoom(roomId);
  return {
    id: r.id, name: r.name, game: r.game, gameTitle: ROOM_GAMES[r.game].title,
    isPublic: r.isPublic, buyIn: r.buyIn, max: MAX_PLAYERS,
    hostName: r.members.get(r.hostId)?.name ?? '',
    players: [...r.members.values()].map(m => m.name),
    inRoom: r.members.has(userId),
  };
}

/** Полное состояние стола глазами конкретного игрока */
export function roomState(room, userId) {
  syncStatus(room);
  const staked = {};
  if (isCards(room)) for (const id of room.members.keys()) staked[id] = stakeOf(room, id);
  else for (const b of room.bets) staked[b.userId] = (staked[b.userId] ?? 0) + b.amount;
  const on = online.get(room.id);
  const me = room.members.get(userId);

  return {
    id: room.id, name: room.name, game: room.game, isPublic: room.isPublic,
    buyIn: room.buyIn, max: MAX_PLAYERS, hostId: room.hostId,
    status: room.status,
    spinLeftMs: room.status === 'spinning' ? Math.max(0, room.spinUntil - Date.now()) : 0,
    players: [...room.members.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(m => ({
        id: m.id, name: m.name, bank: m.bank, bet: staked[m.id] ?? 0,
        online: !!on?.get(m.id), isHost: m.id === room.hostId, ready: room.ready.has(m.id),
      })),
    bets: room.bets.map(b => ({ userId: b.userId, type: b.type, value: b.value, amount: b.amount })),
    lastSpin: room.lastSpin,
    recent: room.recent,
    round: isCards(room) ? cardView(room, userId) : null,
    you: { inRoom: !!me, isHost: room.hostId === userId, roomBalance: me?.bank ?? 0, ready: room.ready.has(userId) },
    invite: { link: inviteLink(room), code: `room_${room.id}` },
  };
}

// ─── онлайн-статус (ведёт ws.js) ─────────────────────────────────────────────

export function socketAttached(roomId, userId) {
  if (!rooms.has(roomId)) return;
  const map = online.get(roomId) ?? new Map();
  map.set(userId, (map.get(userId) ?? 0) + 1);
  online.set(roomId, map);
  notify(rooms.get(roomId), 'presence');
}

export function socketDetached(roomId, userId) {
  const map = online.get(roomId);
  if (!map) return;
  const n = (map.get(userId) ?? 0) - 1;
  if (n > 0) map.set(userId, n); else map.delete(userId);
  const room = rooms.get(roomId);
  if (room) { notify(room, 'presence'); if (isCards(room)) cardPresence(room); else maybeSpin(room); }
}

// ─── старт сервера ───────────────────────────────────────────────────────────

/** Поднимает столы из SQLite; ставки несыгранного раунда возвращаются в банки */
export function bootRooms() {
  let refunded = 0;
  tx(() => {
    for (const b of db.prepare('SELECT * FROM room_bets').all()) {
      const r = db.prepare('UPDATE room_members SET bank = bank + ? WHERE room_id = ? AND user_id = ?')
        .run(b.amount, b.room_id, b.user_id);
      // игрок ушёл посреди раздачи — его несыгранная ставка идёт на баланс
      if (!r.changes) changeBalance(b.user_id, b.amount);
      refunded++;
    }
    db.prepare('DELETE FROM room_bets').run();
    db.prepare('DELETE FROM rooms WHERE id NOT IN (SELECT DISTINCT room_id FROM room_members)').run();
  });

  rooms.clear();
  for (const r of db.prepare('SELECT * FROM rooms').all()) {
    const members = new Map();
    for (const m of db.prepare('SELECT * FROM room_members WHERE room_id = ?').all(r.id)) {
      members.set(m.user_id, { id: m.user_id, name: m.name, bank: m.bank, joinedAt: m.joined_at });
    }
    rooms.set(r.id, {
      id: r.id, name: r.name, game: r.game, hostId: r.host_id, isPublic: !!r.is_public, buyIn: r.buy_in,
      members, bets: [], ready: new Set(), status: 'open', spinUntil: 0, lastSpin: null, recent: [], seq: 0,
    });
    const room = rooms.get(r.id);
    if (isCards(room)) room.round = newRound(room);
  }
  console.log(`Столы: поднято ${rooms.size}, возвращено ставок в банки: ${refunded}`);
}
