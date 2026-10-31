// Профиль игрока и таблица лидеров. Всё считается из таблицы history,
// отдельного хранения нет: уровень = сколько всего поставлено, значки = факты из истории.

import { db } from './db.js';

db.exec('CREATE INDEX IF NOT EXISTS idx_history_time ON history(created_at)');

// ─── уровни ──────────────────────────────────────────────────────────────────
// Опыт = сумма всех ставок. Порог уровня n: 500·(2^(n−1) − 1) → 0, 500, 1 500, 3 500, 7 500…
const TITLES = ['Новичок', 'Игрок', 'Завсегдатай', 'Азартный', 'Хайроллер', 'VIP', 'Акула', 'Кит', 'Магнат', 'Легенда'];
const xpFor = (n) => 500 * (2 ** (n - 1) - 1);

export function levelOf(xp) {
  let n = 1;
  while (n < 60 && xp >= xpFor(n + 1)) n++;
  const from = xpFor(n), to = xpFor(n + 1);
  return {
    level: n,
    title: TITLES[Math.min(TITLES.length - 1, Math.floor((n - 1) / 2))],
    xp, from, to,
    progress: Math.min(1, (xp - from) / (to - from)),
  };
}

// ─── значки ──────────────────────────────────────────────────────────────────
const BADGES = [
  { id: 'first_win', icon: '🎉', title: 'Первая победа', hint: 'Выиграй любой раунд', test: s => s.wins >= 1 },
  { id: 'rounds_100', icon: '💯', title: 'Сотня', hint: 'Сыграй 100 раундов', test: s => s.rounds >= 100 },
  { id: 'rounds_1000', icon: '🏅', title: 'Тысячник', hint: 'Сыграй 1 000 раундов', test: s => s.rounds >= 1000 },
  { id: 'x10', icon: '🔥', title: 'Иксы', hint: 'Выиграй ×10 за раунд', test: s => s.bestMult >= 10 },
  { id: 'x100', icon: '🚀', title: 'Сотка иксов', hint: 'Выиграй ×100 за раунд', test: s => s.bestMult >= 100 },
  { id: 'explorer', icon: '🧭', title: 'Исследователь', hint: 'Сыграй в 6 разных игр', test: s => s.games >= 6 },
  { id: 'social', icon: '👥', title: 'Душа компании', hint: 'Сыграй за столом с друзьями', test: s => s.tableRounds >= 1 },
  { id: 'big_win', icon: '💰', title: 'Куш', hint: 'Выиграй 100 000 за раунд', test: s => s.bestWin >= 100000 },
  { id: 'highroller', icon: '🎩', title: 'Хайроллер', hint: 'Поставь 1 000 000 за раунд', test: s => s.maxBet >= 1000000 },
  { id: 'million', icon: '💎', title: 'Миллионер', hint: 'Поставь в сумме 10 000 000', test: s => s.wagered >= 10000000 },
];

export function profileStats(userId) {
  const t = db.prepare(`
    SELECT COUNT(*) AS rounds, COALESCE(SUM(bet), 0) AS wagered, COALESCE(SUM(net), 0) AS net,
           COALESCE(SUM(net > 0), 0) AS wins, COALESCE(MAX(bet), 0) AS maxBet,
           COALESCE(MAX(CASE WHEN net > 0 THEN net END), 0) AS bestWin,
           COALESCE(MAX(CASE WHEN net > 0 AND bet > 0 THEN (net + bet) * 1.0 / bet END), 0) AS bestMult,
           COUNT(DISTINCT REPLACE(game, '_room', '')) AS games,
           COALESCE(SUM(game LIKE '%_room'), 0) AS tableRounds
    FROM history WHERE user_id = ?`).get(userId);
  const stats = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Number(v)]));

  const byGame = db.prepare(`
    SELECT game, COUNT(*) AS rounds, SUM(bet) AS wagered, SUM(net) AS net, MAX(net) AS best
    FROM history WHERE user_id = ? GROUP BY game ORDER BY rounds DESC`).all(userId)
    .map(r => ({ game: r.game, rounds: Number(r.rounds), wagered: Number(r.wagered), net: Number(r.net), best: Number(r.best) }));

  const best = db.prepare(`SELECT game, bet, net, created_at FROM history
    WHERE user_id = ? AND net > 0 ORDER BY net DESC LIMIT 1`).get(userId) ?? null;

  return {
    stats: { ...stats, bestMult: Math.round(stats.bestMult * 100) / 100 },
    level: levelOf(stats.wagered),
    badges: BADGES.map(b => ({ id: b.id, icon: b.icon, title: b.title, hint: b.hint, got: !!b.test(stats) })),
    byGame,
    best,
  };
}

// ─── таблица лидеров ─────────────────────────────────────────────────────────
// week — с понедельника текущей недели (UTC); all — за всё время.
// by: net — сумма выигрышей минус проигрыши; best — крупнейший выигрыш за раунд.
const SINCE = {
  week: "date('now', 'weekday 0', '-6 days')",
  all: "'0000-01-01'",
};

export function leaderboard(userId, { period = 'week', by = 'net', limit = 20 } = {}) {
  const since = SINCE[period] ?? SINCE.week;
  const score = by === 'best' ? 'MAX(h.net)' : 'SUM(h.net)';
  const rows = db.prepare(`
    SELECT h.user_id AS id, COALESCE(u.first_name, u.username, 'Игрок') AS name,
           ${score} AS score, COUNT(*) AS rounds, SUM(h.bet) AS wagered
    FROM history h LEFT JOIN users u ON u.id = h.user_id
    WHERE h.created_at >= ${since}
    GROUP BY h.user_id
    HAVING ${score} > 0
    ORDER BY score DESC, wagered DESC`).all();
  const all = rows.map((r, i) => ({
    place: i + 1, name: r.name, score: Number(r.score),
    rounds: Number(r.rounds), me: Number(r.id) === userId,
  }));
  const mine = all.find(r => r.me) ?? null;
  return { period, by, top: all.slice(0, limit), me: mine, total: all.length };
}
