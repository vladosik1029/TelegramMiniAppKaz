// ─── Provably Fair: сиды, раунды и история (серверная часть) ────────────────
//
// Одиночные игры (у каждого игрока своя пара сидов):
//   • server_seed — 32 случайных байта из CSPRNG (crypto.randomBytes). Игроку
//     заранее показан только его SHA-256, сам сид раскрывается при смене.
//   • next_seed — следующий server seed; его хэш тоже виден заранее, поэтому
//     сервер не может подобрать новый сид после того, как узнал client seed.
//   • client_seed — задаёт игрок (по умолчанию браузер генерирует случайный).
//   • nonce — номер ставки на этой паре, +1 за каждую игру.
//   Исход раунда = DERIVE[game](лента HMAC-SHA256(server_seed, client_seed:nonce:cursor)).
//
// Столы и Ракета (общий исход на всех): сид раунда фиксируется (виден его хэш)
// ДО ставок, а client seed раунда — склейка client seed всех участников и
// свежих случайных чисел, которые их браузеры прислали вместе со ставкой /
// «Готов». Ни сервер, ни отдельный игрок не знают итог заранее.
// Сид раунда стола раскрывается сразу после раздачи.
//
// Таблицы создаются сами (CREATE TABLE IF NOT EXISTS) — ручная миграция не нужна.

import { db } from '../db.js';
import { rngFor, randomHex, sha256 } from './node.js';

export { rngFor, randomHex, sha256 };

db.exec(`
CREATE TABLE IF NOT EXISTS fair_users (
  user_id INTEGER PRIMARY KEY,
  server_seed TEXT NOT NULL,
  next_seed TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  client_by_player INTEGER NOT NULL DEFAULT 0,
  nonce INTEGER NOT NULL DEFAULT 0
);
-- раскрытые server seed: по хэшу из истории раунда можно взять сам сид
CREATE TABLE IF NOT EXISTS fair_seeds (
  hash TEXT PRIMARY KEY,
  seed TEXT NOT NULL,
  revealed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- каждый сыгранный раунд: чем и из чего посчитан исход
CREATE TABLE IF NOT EXISTS fair_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  game TEXT NOT NULL,
  room_id TEXT,
  seed_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  nonce INTEGER NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  record TEXT,
  summary TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fair_rounds_user ON fair_rounds(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_fair_rounds_game ON fair_rounds(game, id DESC);
`);

export const FAIR_ERRORS = {
  BAD_CLIENT_SEED: 'Client seed: от 1 до 64 символов — латиница, цифры, «-» и «_»',
  FAIR_ACTIVE_GAME: 'Сначала доиграй начатую игру — иначе по раскрытому сиду можно было бы узнать её исход',
};

const fail = (code) => { throw new Error(code); };
const CLIENT_SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ENTROPY_RE = /^[0-9a-f]{8,64}$/;

/** Новый сид для общего раунда: сам сид держим в секрете, хэш показываем сразу */
export function commitSeed() {
  const seed = randomHex();
  return { seed, hash: sha256(seed) };
}

export function revealSeed(seed) {
  db.prepare('INSERT OR IGNORE INTO fair_seeds (hash, seed) VALUES (?, ?)').run(sha256(seed), seed);
}

// ─── пара сидов игрока ───────────────────────────────────────────────────────

function pairOf(userId) {
  let row = db.prepare('SELECT * FROM fair_users WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO fair_users (user_id, server_seed, next_seed, client_seed) VALUES (?, ?, ?, ?)')
      .run(userId, randomHex(), randomHex(), randomHex(8));
    row = db.prepare('SELECT * FROM fair_users WHERE user_id = ?').get(userId);
  }
  return row;
}

export const clientSeedOf = (userId) => pairOf(userId).client_seed;

/** Одиночная игра: взять сиды и следующий nonce (вызывать внутри tx ставки) */
export function takeNonce(userId) {
  const p = pairOf(userId);
  db.prepare('UPDATE fair_users SET nonce = nonce + 1 WHERE user_id = ?').run(userId);
  return {
    serverSeed: p.server_seed, hash: sha256(p.server_seed), clientSeed: p.client_seed, nonce: p.nonce,
    rng: rngFor(p.server_seed, p.client_seed, p.nonce),
  };
}

const hasActiveGame = (userId) =>
  !!db.prepare('SELECT 1 FROM sessions WHERE user_id = ? LIMIT 1').get(userId);

export function fairState(userId) {
  const p = pairOf(userId);
  return {
    serverSeedHash: sha256(p.server_seed),
    nextServerSeedHash: sha256(p.next_seed),
    clientSeed: p.client_seed,
    clientSeedByPlayer: !!p.client_by_player,
    nonce: p.nonce,
    activeGame: hasActiveGame(userId),
  };
}

const checkClientSeed = (s) => {
  s = String(s ?? '').trim();
  if (!CLIENT_SEED_RE.test(s)) fail('BAD_CLIENT_SEED');
  return s;
};

/**
 * Сменить client seed. Активный server seed не меняется: его хэш игрок видел
 * раньше, чем выбрал новый client seed, — значит, подогнать сид под него нельзя.
 */
export function setClientSeed(userId, clientSeed) {
  const s = checkClientSeed(clientSeed);
  pairOf(userId);
  db.prepare('UPDATE fair_users SET client_seed = ?, client_by_player = 1 WHERE user_id = ?').run(s, userId);
  return fairState(userId);
}

/**
 * Сменить server seed: текущий раскрывается (все сыгранные на нём раунды можно
 * проверить), следующий (хэш которого был виден) становится активным, nonce = 0.
 */
export function rotateSeed(userId, clientSeed) {
  const s = clientSeed == null || clientSeed === '' ? null : checkClientSeed(clientSeed);
  const p = pairOf(userId);
  if (hasActiveGame(userId)) fail('FAIR_ACTIVE_GAME');
  revealSeed(p.server_seed);
  db.prepare(`UPDATE fair_users SET server_seed = ?, next_seed = ?, nonce = 0,
      client_seed = COALESCE(?, client_seed), client_by_player = CASE WHEN ? IS NULL THEN client_by_player ELSE 1 END
    WHERE user_id = ?`).run(p.next_seed, randomHex(), s, s, userId);
  return { revealed: { serverSeed: p.server_seed, hash: sha256(p.server_seed), nonces: p.nonce }, state: fairState(userId) };
}

// ─── общие раунды: client seed из сидов всех участников ─────────────────────

export const cleanEntropy = (x) => (ENTROPY_RE.test(String(x ?? '')) ? String(x) : '');

/**
 * Client seed общего раунда: «id=client_seed/свежее_число» участников по
 * возрастанию id через запятую. Символы «= / , :» в client seed запрещены,
 * поэтому склейку нельзя подделать.
 */
export function combineSeeds(entries) {
  return [...entries]
    .sort((a, b) => a.id - b.id)
    .map(e => `${e.id}=${clientSeedOf(e.id)}/${cleanEntropy(e.entropy)}`)
    .join(',');
}

// ─── история раундов ─────────────────────────────────────────────────────────

export function openRound({ userId = null, game, roomId = null, hash, clientSeed, nonce, params = {}, record = null, summary = null, done = false }) {
  const r = db.prepare(`INSERT INTO fair_rounds (user_id, game, room_id, seed_hash, client_seed, nonce, params, record, summary, done)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    userId, game, roomId, hash, clientSeed, nonce, JSON.stringify(params),
    record == null ? null : JSON.stringify(record), summary, done ? 1 : 0,
  );
  return Number(r.lastInsertRowid);
}

export function closeRound(id, { params, record, summary }) {
  db.prepare(`UPDATE fair_rounds SET done = 1,
      params = COALESCE(?, params), record = COALESCE(?, record), summary = COALESCE(?, summary)
    WHERE id = ?`).run(
    params == null ? null : JSON.stringify(params), record == null ? null : JSON.stringify(record), summary ?? null, id,
  );
}

const roundRow = (r) => ({
  id: r.id, game: r.game, roomId: r.room_id, createdAt: r.created_at,
  serverSeedHash: r.seed_hash,
  serverSeed: r.seed ?? null, // null — сид ещё не раскрыт (раскроется при смене)
  clientSeed: r.client_seed, nonce: r.nonce,
  params: JSON.parse(r.params || '{}'),
  record: r.done ? JSON.parse(r.record || 'null') : null,
  summary: r.summary, done: !!r.done,
});

export function fairHistory(userId, limit = 30) {
  limit = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 30));
  return db.prepare(`SELECT r.*, s.seed FROM fair_rounds r LEFT JOIN fair_seeds s ON s.hash = r.seed_hash
    WHERE r.user_id = ? ORDER BY r.id DESC LIMIT ?`).all(userId, limit).map(roundRow);
}

/** Общие раунды игры (Ракета): user_id IS NULL */
export function publicRounds(game, limit = 30) {
  limit = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 30));
  return db.prepare(`SELECT r.*, s.seed FROM fair_rounds r LEFT JOIN fair_seeds s ON s.hash = r.seed_hash
    WHERE r.user_id IS NULL AND r.game = ? ORDER BY r.id DESC LIMIT ?`).all(game, limit).map(roundRow);
}
