import { Router } from 'express';
import {
  db, tx, balanceOf, changeBalance, setBalance, addHistory,
} from './db.js';
import { env, parseInitData, MIN_BET, MAX_BET } from './telegram.js';
import * as blackjack from './games/blackjack.js';
import * as ochko from './games/ochko.js';
import * as poker from './games/poker.js';
import * as roulette from './games/roulette.js';

export const api = Router();

// ─── аутентификация ──────────────────────────────────────────────────────────
function getUser(req) {
  const header = req.headers['authorization'] || '';
  const initData = header.startsWith('tma ') ? header.slice(4) : '';
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
  return null;
}

function auth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Не удалось проверить вас как пользователя Telegram' });
  req.user = user;
  next();
}

function ensureUser(user) {
  db.prepare(`
    INSERT INTO users (id, username, first_name, balance)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name
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
    history,
  };
}

// ─── игровой движок ──────────────────────────────────────────────────────────
const GAMES = { blackjack, ochko, poker, roulette };

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

      const started = mod.start(bet, req.body?.opts ?? null);
      if (started.finished) {
        return settle(req.user.id, game, bet, started);
      }
      db.prepare('INSERT INTO sessions (user_id, game, state, bet) VALUES (?, ?, ?, ?)')
        .run(req.user.id, game, JSON.stringify({ ...started.state, _bet: bet }), bet);
      return { finished: false, view: started.view };
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
        return settle(req.user.id, game, sess.bet, acted);
      }
      db.prepare('UPDATE sessions SET state = ? WHERE user_id = ? AND game = ?')
        .run(JSON.stringify({ ...acted.state, _bet: sess.bet }), req.user.id, game);
      return { finished: false, view: acted.view };
    });
    res.json(formatResponse(req.user, game, null, result));
  } catch (e) { handleError(e, res); }
});

/** Начисление выплаты и запись истории при завершении раунда */
function settle(userId, game, bet, result) {
  // returnMult уже умножен на betUnits (дабл в блэкджеке) — выплата считается от исходной ставки
  const betUnits = result.state?.betUnits ?? 1;
  const returnMult = result.returnMult ?? 0;
  const stakedTotal = bet * betUnits;
  const payout = Math.round(bet * returnMult);
  changeBalance(userId, payout);
  addHistory(userId, game, stakedTotal, payout - stakedTotal);
  return { finished: true, outcome: result.outcome, net: payout - stakedTotal, view: result.view, message: result.message ?? null };
}

function formatResponse(user, game, bet, result) {
  const balance = balanceOf(user.id);
  return { ...result, balance };
}

function handleError(e, res) {
  const map = {
    INSUFFICIENT: 'Недостаточно фишек на балансе',
    BAD_BET: 'Некорректная ставка',
    BAD_ACTION: 'Сейчас так нельзя — обновите игру',
    NO_SESSION: 'Активная игра не найдена — начните новую',
    BALANCE_TOO_LOW: 'Баланс не может уйти в минус',
  };
  if (map[e.message]) return res.status(400).json({ error: map[e.message] });
  console.error(e);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
}

// ─── админ: управление балансами ─────────────────────────────────────────────
api.use('/admin', (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Только для админов' });
  next();
});

api.get('/admin/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.first_name, u.balance, u.created_at,
      COALESCE(SUM(h.net), 0) AS total_net,
      COUNT(h.id) AS games
    FROM users u LEFT JOIN history h ON h.user_id = u.id
    GROUP BY u.id ORDER BY u.id
  `).all();
  res.json({ users });
});

api.post('/admin/balance', (req, res) => {
  const { userId, mode, amount } = req.body || {};
  const amt = Math.floor(Number(amount));
  if (!Number.isInteger(amt) || amt <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
  if (!['set', 'add', 'sub'].includes(mode)) return res.status(400).json({ error: 'Некорректный режим' });

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(userId));
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  try {
    tx(() => {
      if (mode === 'set') setBalance(target.id, amt);
      else if (mode === 'add') changeBalance(target.id, amt);
      else changeBalance(target.id, -amt);
    });
    res.json({ ok: true, balance: balanceOf(target.id) });
  } catch (e) {
    if (e.message === 'BALANCE_TOO_LOW') return res.status(400).json({ error: 'Баланс не может уйти в минус' });
    throw e;
  }
});
