import { Router } from 'express';
import {
  db, tx, balanceOf, changeBalance, addHistory,
} from './db.js';
import { env, parseInitData, MIN_BET, MAX_BET } from './telegram.js';
import * as blackjack from './games/blackjack.js';
import * as ochko from './games/ochko.js';
import * as poker from './games/poker.js';
import * as roulette from './games/roulette.js';
import * as dice from './games/dice.js';
import * as plinko from './games/plinko.js';
import * as baccarat from './games/baccarat.js';
import * as slots from './games/slots.js';
import * as mines from './games/mines.js';
import * as hilo from './games/hilo.js';
import {
  ROOM_GAMES, ROOM_ERRORS, MAX_PLAYERS, MIN_BUYIN, MAX_BUYIN,
  createRoom, joinRoom, leaveRoom, placeBet, clearBets, setReady, playAction,
  getRoom, listRooms, roomPreview, roomState,
} from './rooms.js';
import { CRASH_ERRORS, crashFair } from './crash.js';
import {
  FAIR_ERRORS, takeNonce, openRound, closeRound, fairState, setClientSeed, rotateSeed, fairHistory, publicRounds,
} from './fair/index.js';
import { admin } from './admin.js';

export const api = Router();

// ─── аутентификация ──────────────────────────────────────────────────────────
function getUser(req) {
  const header = req.headers['authorization'] || '';
  const initData = header.startsWith('tma ') ? header.slice(4) : '';
  return userFromInitData(initData);
}

/**
 * Пользователь по Telegram initData (REST-заголовок или ?t= у WebSocket).
 * В DEV_MODE пустая строка = dev-игрок, «dev:<id>» — мок-игрок
 * (для локальной проверки стола вдвоём). В проде (DEV_MODE=0) — только подпись Telegram.
 */
export function userFromInitData(initData) {
  const tgUser = parseInitData(initData);
  if (tgUser) {
    return {
      id: tgUser.id,
      username: tgUser.username || null,
      first_name: tgUser.first_name || tgUser.username || 'Игрок',
      isAdmin: env.ADMIN_IDS.has(tgUser.id),
    };
  }
  if (env.DEV_MODE && !initData) {
    return {
      id: env.DEV_USER_ID,
      username: 'dev_user',
      first_name: 'Dev-пользователь',
      isAdmin: env.ADMIN_IDS.has(env.DEV_USER_ID),
      dev: true,
    };
  }
  if (env.DEV_MODE && /^dev:\d{1,12}$/.test(initData)) {
    const id = Number(initData.slice(4));
    return { id, username: null, first_name: `Dev${id}`, isAdmin: env.ADMIN_IDS.has(id), dev: true };
  }
  return null;
}

function auth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Не удалось проверить вас как пользователя Telegram' });
  req.user = user;
  next();
}

export function ensureUser(user) {
  db.prepare(`
    INSERT INTO users (id, username, first_name, balance, last_seen)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_seen = excluded.last_seen
  `).run(user.id, user.username, user.first_name, env.START_BALANCE);
}

api.use(auth);
api.use((req, res, next) => { ensureUser(req.user); next(); });

// ─── профиль / кошелёк ───────────────────────────────────────────────────────
api.route('/init').post(initHandler).get(initHandler);

function initHandler(req, res) {
  res.json(me(req.user));
}

function me(user) {
  const balance = balanceOf(user.id);
  const history = db.prepare(
    'SELECT game, bet, net, created_at FROM history WHERE user_id = ? ORDER BY id DESC LIMIT 30'
  ).all(user.id);
  return {
    id: user.id,
    username: user.username,
    firstName: user.first_name,
    balance,
    isAdmin: !!user.isAdmin,
    dev: !!user.dev,
    botUsername: env.BOT_USERNAME,
    history,
  };
}

// ─── игровой движок ──────────────────────────────────────────────────────────
const GAMES = { blackjack, ochko, poker, roulette, dice, slots, mines, hilo, plinko, baccarat };

function validateBet(bet) {
  bet = Math.floor(Number(bet));
  if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) throw new Error('BAD_BET');
  return bet;
}

api.post('/games/:game/start', (req, res) => {
  const game = req.params.game;
  const mod = GAMES[game];
  if (!mod) return res.status(404).json({ error: 'Такой игры нет' });

  try {
    const bet = validateBet(req.body?.bet);
    const result = tx(() => {
      const balance = balanceOf(req.user.id);
      if (balance < bet) throw new Error('INSUFFICIENT');
      changeBalance(req.user.id, -bet);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND game = ?').run(req.user.id, game);

      // Provably Fair: исход считается из сидов игрока и следующего nonce
      const round = takeNonce(req.user.id);
      const started = mod.start(bet, req.body?.opts ?? null, round.rng, round);
      const fairId = openRound({
        userId: req.user.id, game, hash: round.hash, clientSeed: round.clientSeed, nonce: round.nonce,
        params: started.fair?.params, record: started.fair?.record,
      });
      const fair = { roundId: fairId, serverSeedHash: round.hash, clientSeed: round.clientSeed, nonce: round.nonce };
      if (started.finished) {
        return { ...settle(req.user.id, game, bet, started, fairId), fair };
      }
      db.prepare('INSERT INTO sessions (user_id, game, state, bet) VALUES (?, ?, ?, ?)')
        .run(req.user.id, game, JSON.stringify({ ...started.state, _bet: bet, _fair: fairId }), bet);
      return { finished: false, view: started.view, fair };
    });
    res.json(formatResponse(req.user, game, bet, result));
  } catch (e) { handleError(e, res); }
});

api.post('/games/:game/action', (req, res) => {
  const game = req.params.game;
  const mod = GAMES[game];
  if (!mod) return res.status(404).json({ error: 'Такой игры нет' });

  try {
    const result = tx(() => {
      const sess = db.prepare('SELECT * FROM sessions WHERE user_id = ? AND game = ?')
        .get(req.user.id, game);
      if (!sess) throw new Error('NO_SESSION');
      const state = JSON.parse(sess.state);
      const action = req.body?.action;

      // дабл в блэкджеке требует дополнительного списания
      if (game === 'blackjack' && action === 'double' && state.betUnits === 1) {
        const balance = balanceOf(req.user.id);
        if (balance < sess.bet) throw new Error('INSUFFICIENT');
        changeBalance(req.user.id, -sess.bet);
      }

      const acted = mod.act(state, action);

      if (acted.finished) {
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND game = ?').run(req.user.id, game);
        return settle(req.user.id, game, sess.bet, acted, state._fair);
      }
      db.prepare('UPDATE sessions SET state = ? WHERE user_id = ? AND game = ?')
        .run(JSON.stringify({ ...acted.state, _bet: sess.bet, _fair: state._fair }), req.user.id, game);
      return { finished: false, view: acted.view };
    });
    res.json(formatResponse(req.user, game, null, result));
  } catch (e) { handleError(e, res); }
});

/** Начисление выплаты и запись истории при завершении раунда */
function settle(userId, game, bet, result, fairId) {
  // returnMult уже умножен на betUnits (дабл в блэкджеке) — выплата считается от исходной ставки
  const betUnits = result.state?.betUnits ?? 1;
  const returnMult = result.returnMult ?? 0;
  const stakedTotal = bet * betUnits;
  const payout = Math.round(bet * returnMult);
  changeBalance(userId, payout);
  addHistory(userId, game, stakedTotal, payout - stakedTotal);
  if (fairId) {
    closeRound(fairId, {
      params: result.fair?.params, record: result.fair?.record,
      summary: `${result.message ?? result.outcome} · ${payout - stakedTotal >= 0 ? '+' : ''}${payout - stakedTotal}`,
    });
  }
  return { finished: true, outcome: result.outcome, net: payout - stakedTotal, view: result.view, message: result.message ?? null };
}

function formatResponse(user, game, bet, result) {
  const balance = balanceOf(user.id);
  return { ...result, balance };
}

const ERRORS = {
  INSUFFICIENT: 'Недостаточно фишек на балансе',
  BAD_BET: 'Некорректная ставка',
  BAD_ACTION: 'Сейчас так нельзя — обновите игру',
  NO_SESSION: 'Активная игра не найдена — начните новую',
  BALANCE_TOO_LOW: 'Баланс не может уйти в минус',
  ...ROOM_ERRORS,
  ...CRASH_ERRORS,
  ...FAIR_ERRORS,
};

/** Текст ошибки для пользователя или null, если это неожиданное исключение */
export const errorText = (e) => ERRORS[e?.message] ?? null;

function handleError(e, res) {
  const text = errorText(e);
  if (text) return res.status(e.message === 'ROOM_NOT_FOUND' ? 404 : 400).json({ error: text });
  console.error(e);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
}

// ─── Provably Fair: сиды игрока, смена сида, история для проверки ───────────

api.get('/fair', (req, res) => {
  res.json({ ...fairState(req.user.id), crash: crashFair() });
});

api.post('/fair/client-seed', (req, res) => {
  try { res.json(setClientSeed(req.user.id, req.body?.clientSeed)); } catch (e) { handleError(e, res); }
});

api.post('/fair/rotate', (req, res) => {
  try { res.json(rotateSeed(req.user.id, req.body?.clientSeed)); } catch (e) { handleError(e, res); }
});

api.get('/fair/history', (req, res) => {
  res.json({ rounds: fairHistory(req.user.id, req.query.limit) });
});

api.get('/fair/crash', (req, res) => {
  res.json({ ...crashFair(), rounds: publicRounds('crash', req.query.limit) });
});

// ─── столы (мультиплеер) ─────────────────────────────────────────────────────
// Создание/вход/выход — REST; ставки и спин — по WebSocket (ws.js),
// но продублированы REST-ом как запасной путь (и для тестов).

api.get('/rooms', (req, res) => {
  res.json({
    rooms: listRooms(req.user.id),
    games: ROOM_GAMES,
    limits: { maxPlayers: MAX_PLAYERS, minBuyIn: MIN_BUYIN, maxBuyIn: MAX_BUYIN },
  });
});

api.post('/rooms', (req, res) => {
  try {
    const room = createRoom(req.user, req.body || {});
    res.json({ room: roomState(room, req.user.id), balance: balanceOf(req.user.id) });
  } catch (e) { handleError(e, res); }
});

api.get('/rooms/:id/preview', (req, res) => {
  try { res.json({ preview: roomPreview(req.params.id, req.user.id) }); } catch (e) { handleError(e, res); }
});

api.post('/rooms/:id/join', (req, res) => {
  try {
    const room = joinRoom(req.user, req.params.id);
    res.json({ room: roomState(room, req.user.id), balance: balanceOf(req.user.id) });
  } catch (e) { handleError(e, res); }
});

api.get('/rooms/:id', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return handleError(new Error('ROOM_NOT_FOUND'), res);
  if (!room.members.has(req.user.id)) return handleError(new Error('NOT_IN_ROOM'), res);
  res.json({ room: roomState(room, req.user.id) });
});

api.post('/rooms/:id/leave', (req, res) => {
  try { res.json(leaveRoom(req.user.id, req.params.id)); } catch (e) { handleError(e, res); }
});

const roomAction = (fn) => (req, res) => {
  try {
    const room = fn(req.user.id, req.params.id, req.body || {});
    res.json({ room: roomState(room, req.user.id) });
  } catch (e) { handleError(e, res); }
};
api.post('/rooms/:id/bet', roomAction(placeBet));
api.post('/rooms/:id/clear', roomAction(clearBets));
api.post('/rooms/:id/ready', roomAction(setReady));
api.post('/rooms/:id/act', roomAction(playAction));

// ─── админ: игроки, балансы, журнал (server/src/admin.js) ───────────────────
api.use('/admin', (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Только для админов' });
  next();
});

api.use('/admin', admin);
