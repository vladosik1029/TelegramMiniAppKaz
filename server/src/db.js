import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Путь к базе можно переопределить переменной DB_PATH (используется в docker-контейнере,
// чтобы база жила в volume и переживала пересоздание контейнера)
const DB_FILE = process.env.DB_PATH || path.join(__dirname, '..', 'casino.db');
export const db = new DatabaseSync(DB_FILE);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  user_id INTEGER NOT NULL,
  game TEXT NOT NULL,
  state TEXT NOT NULL,
  bet INTEGER NOT NULL,
  PRIMARY KEY (user_id, game)
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  game TEXT NOT NULL,
  bet INTEGER NOT NULL,
  net INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, id DESC);

-- Мультиплеерные столы: у каждого участника свой «банк стола» (бай-ин),
-- ставки раунда живут в room_bets до спина (при рестарте возвращаются в банк)
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  game TEXT NOT NULL,
  host_id INTEGER NOT NULL,
  is_public INTEGER NOT NULL,
  buy_in INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  bank INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS room_bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  value INTEGER,
  amount INTEGER NOT NULL
);
`);

// last_seen появился позже — добавляем колонку в старые базы
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'last_seen')) {
  db.exec('ALTER TABLE users ADD COLUMN last_seen TEXT');
}
// тема оформления приложения (только внешний вид, на игры не влияет)
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'theme')) {
  db.exec('ALTER TABLE users ADD COLUMN theme TEXT');
}

/** Транзакция: fn выполняется внутри BEGIN/COMMIT, при ошибке — ROLLBACK */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

export const balanceOf = (userId) =>
  db.prepare('SELECT balance FROM users WHERE id = ?').get(userId)?.balance ?? null;

export function changeBalance(userId, delta) {
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(delta, userId);
  if ((balanceOf(userId)) < 0) throw new Error('BALANCE_TOO_LOW');
}

export const setBalance = (userId, value) =>
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(Math.max(0, Math.round(value)), userId);

export function addHistory(userId, game, bet, net) {
  db.prepare('INSERT INTO history (user_id, game, bet, net) VALUES (?, ?, ?, ?)')
    .run(userId, game, bet, net);
}
