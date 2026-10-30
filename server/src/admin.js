// ─── Админ-панель: игроки, балансы, журнал действий ─────────────────────────
// Подключается в routes.js под /admin ПОСЛЕ проверки req.user.isAdmin
// (а он берётся только из ADMIN_IDS и подписанного Telegram initData).

import { Router } from 'express';
import { db, tx, balanceOf, changeBalance, setBalance } from './db.js';
import { env } from './telegram.js';

export const admin = Router();

// Журнал изменений баланса админами. undo_of — запись, которую отменили этой;
// undone_by — какой записью отменена эта.
db.exec(`
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  amount INTEGER NOT NULL,
  before INTEGER NOT NULL,
  after INTEGER NOT NULL,
  comment TEXT,
  undo_of INTEGER,
  undone_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_log_user ON admin_log(user_id, id DESC);
`);

// SQLite lower()/LIKE не понимают кириллицу — свой регистронезависимый поиск
db.function('ulower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));

const MAX_AMOUNT = 1_000_000_000;
const PAGE_MAX = 100;

const SORTS = {
  balance_desc: 'balance DESC, id',
  balance_asc: 'balance ASC, id',
  seen: 'last_seen DESC, id DESC',
  new: 'created_at DESC, id DESC',
  net_desc: 'total_net DESC, id',
  net_asc: 'total_net ASC, id',
  games: 'games DESC, id',
};

// Игроки с агрегатами по истории игр; WHERE/ORDER подставляются только из белых списков
const USERS_CTE = `
WITH p AS (
  SELECT u.id, u.username, u.first_name, u.balance, u.created_at,
    COALESCE(u.last_seen, u.created_at) AS last_seen,
    COALESCE(h.games, 0) AS games, COALESCE(h.net, 0) AS total_net,
    COALESCE(h.wagered, 0) AS wagered, h.last_game,
    COALESCE(b.banks, 0) AS in_tables
  FROM users u
  LEFT JOIN (
    SELECT user_id, COUNT(*) AS games, SUM(net) AS net, SUM(bet) AS wagered, MAX(created_at) AS last_game
    FROM history GROUP BY user_id
  ) h ON h.user_id = u.id
  LEFT JOIN (SELECT user_id, SUM(bank) AS banks FROM room_members GROUP BY user_id) b ON b.user_id = u.id
)`;

const adminIdsSql = () => [...env.ADMIN_IDS].map(Number).filter(Number.isSafeInteger).join(',') || '0';

function usersWhere(q, filter) {
  const where = [];
  const params = [];
  q = String(q || '').trim().replace(/^@/, '').toLowerCase().slice(0, 64);
  if (q) {
    const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const cond = [`ulower(username) LIKE ? ESCAPE '\\'`, `ulower(first_name) LIKE ? ESCAPE '\\'`];
    params.push(like, like);
    if (/^\d+$/.test(q)) { cond.push(`CAST(id AS TEXT) LIKE ?`); params.push(q + '%'); }
    where.push('(' + cond.join(' OR ') + ')');
  }
  switch (filter) {
    case 'active': where.push(`last_seen >= datetime('now', '-1 day')`); break;
    case 'new': where.push(`created_at >= datetime('now', '-7 days')`); break;
    case 'zero': where.push('balance = 0'); break;
    case 'tables': where.push('in_tables > 0'); break;
    case 'admins': where.push(`id IN (${adminIdsSql()})`); break;
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

const withAdmin = (u) => ({ ...u, isAdmin: env.ADMIN_IDS.has(u.id) });

// GET /admin/users?q=&filter=&sort=&offset=&limit=
admin.get('/users', (req, res) => {
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(req.query.limit) || 30));
  const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
  const order = SORTS[req.query.sort] || SORTS.seen;
  const { sql, params } = usersWhere(req.query.q, req.query.filter);

  const total = db.prepare(`${USERS_CTE} SELECT COUNT(*) AS n FROM p ${sql}`).get(...params).n;
  const users = db.prepare(`${USERS_CTE} SELECT * FROM p ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset).map(withAdmin);

  const stats = db.prepare(`
    SELECT COUNT(*) AS players, COALESCE(SUM(balance), 0) AS chips,
      SUM(COALESCE(last_seen, created_at) >= datetime('now', '-1 day')) AS active,
      SUM(created_at >= datetime('now', '-1 day')) AS fresh
    FROM users
  `).get();
  stats.inTables = db.prepare('SELECT COALESCE(SUM(bank), 0) AS n FROM room_members').get().n;

  res.json({ users, total, offset, limit, stats });
});

// GET /admin/users/:id — карточка игрока
admin.get('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = Number.isSafeInteger(id) && db.prepare(`${USERS_CTE} SELECT * FROM p WHERE id = ?`).get(id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const best = db.prepare('SELECT MAX(net) AS win, MIN(net) AS loss, SUM(net > 0) AS wins FROM history WHERE user_id = ?').get(id);
  const perGame = db.prepare(`
    SELECT game, COUNT(*) AS games, SUM(net) AS net, SUM(bet) AS wagered
    FROM history WHERE user_id = ? GROUP BY game ORDER BY games DESC
  `).all(id);
  const history = db.prepare('SELECT game, bet, net, created_at FROM history WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(id);
  const tables = db.prepare(`
    SELECT r.id, r.name, r.game, m.bank FROM room_members m JOIN rooms r ON r.id = m.room_id
    WHERE m.user_id = ? ORDER BY m.joined_at DESC
  `).all(id);

  res.json({
    user: withAdmin(user),
    stats: { wins: best.wins || 0, bestWin: Math.max(0, best.win || 0), worstLoss: Math.min(0, best.loss || 0) },
    perGame, history, tables,
    log: logRows('WHERE l.user_id = ?', [id], 15, 0),
  });
});

function logRows(where, params, limit, offset) {
  return db.prepare(`
    SELECT l.*, u.first_name, u.username, a.first_name AS admin_name
    FROM admin_log l
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN users a ON a.id = l.admin_id
    ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
}

// GET /admin/log?userId=&offset=&limit=
admin.get('/log', (req, res) => {
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(req.query.limit) || 30));
  const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
  const userId = Number(req.query.userId);
  const [where, params] = Number.isSafeInteger(userId) && userId > 0 ? ['WHERE l.user_id = ?', [userId]] : ['', []];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM admin_log l ${where}`).get(...params).n;
  res.json({ entries: logRows(where, params, limit, offset), total, offset, limit });
});

function writeLog(adminId, userId, mode, amount, before, after, comment, undoOf = null) {
  const r = db.prepare(`
    INSERT INTO admin_log (admin_id, user_id, mode, amount, before, after, comment, undo_of)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(adminId, userId, mode, amount, before, after, comment, undoOf);
  return Number(r.lastInsertRowid);
}

const cleanComment = (c) => String(c ?? '').trim().slice(0, 200) || null;

// POST /admin/balance { userId, mode: set|add|sub, amount, comment? }
admin.post('/balance', (req, res) => {
  const { userId, mode, amount } = req.body || {};
  const amt = Math.floor(Number(amount));
  if (!['set', 'add', 'sub'].includes(mode)) return res.status(400).json({ error: 'Некорректный режим' });
  if (!Number.isInteger(amt) || amt < (mode === 'set' ? 0 : 1) || amt > MAX_AMOUNT) {
    return res.status(400).json({ error: 'Некорректная сумма' });
  }

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(userId));
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

  try {
    const entry = tx(() => {
      const before = balanceOf(target.id);
      if (mode === 'set') setBalance(target.id, amt);
      else if (mode === 'add') changeBalance(target.id, amt);
      else changeBalance(target.id, -amt);
      const after = balanceOf(target.id);
      return writeLog(req.user.id, target.id, mode, amt, before, after, cleanComment(req.body.comment));
    });
    const row = db.prepare('SELECT before, after FROM admin_log WHERE id = ?').get(entry);
    res.json({ ok: true, balance: row.after, before: row.before, logId: entry });
  } catch (e) {
    if (e.message === 'BALANCE_TOO_LOW') return res.status(400).json({ error: 'Баланс не может уйти в минус' });
    throw e;
  }
});

// POST /admin/log/:id/undo — вернуть баланс на разницу из записи журнала
admin.post('/log/:id/undo', (req, res) => {
  const entry = db.prepare('SELECT * FROM admin_log WHERE id = ?').get(Number(req.params.id));
  if (!entry) return res.status(404).json({ error: 'Запись не найдена' });
  if (entry.mode === 'undo') return res.status(400).json({ error: 'Отмену отменить нельзя' });
  if (entry.undone_by) return res.status(400).json({ error: 'Уже отменено' });

  const delta = entry.before - entry.after;
  try {
    const result = tx(() => {
      const before = balanceOf(entry.user_id);
      if (before == null) throw new Error('NO_USER');
      changeBalance(entry.user_id, delta);
      const after = balanceOf(entry.user_id);
      const id = writeLog(req.user.id, entry.user_id, 'undo', Math.abs(delta), before, after, `Отмена #${entry.id}`, entry.id);
      db.prepare('UPDATE admin_log SET undone_by = ? WHERE id = ?').run(id, entry.id);
      return { balance: after, logId: id };
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e.message === 'BALANCE_TOO_LOW') {
      return res.status(400).json({ error: 'У игрока уже меньше фишек, чем нужно списать для отмены' });
    }
    if (e.message === 'NO_USER') return res.status(404).json({ error: 'Пользователь не найден' });
    throw e;
  }
});
