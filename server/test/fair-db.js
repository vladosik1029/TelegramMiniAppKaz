// Перепроверка ВСЕХ сыгранных раундов в базе кодом браузерного верификатора.
// Запуск: node test/fair-db.js [путь к casino.db]  (по умолчанию DB_PATH или ./casino.db)
// Удобно после E2E-тестов (cards.js, durak.js, crash.js) и на боевой базе:
// раунды с ещё не раскрытым сидом (до смены сида игроком) пропускаются.

import { DatabaseSync } from 'node:sqlite';
import { verifyRound } from '../src/fair/verify.js';

const file = process.argv[2] || process.env.DB_PATH || 'casino.db';
const db = new DatabaseSync(file, { readOnly: true });
const rows = db.prepare(`SELECT r.*, s.seed FROM fair_rounds r LEFT JOIN fair_seeds s ON s.hash = r.seed_hash
  WHERE r.done = 1 ORDER BY r.id`).all();

const stat = {};
let bad = 0;
for (const r of rows) {
  const s = (stat[r.game] ??= { ok: 0, bad: 0, hidden: 0 });
  if (!r.seed) { s.hidden++; continue; }
  const v = await verifyRound({
    game: r.game, serverSeed: r.seed, serverSeedHash: r.seed_hash, clientSeed: r.client_seed, nonce: r.nonce,
    params: JSON.parse(r.params), record: JSON.parse(r.record),
  });
  if (v.ok && v.recordOk) s.ok++;
  else { s.bad++; bad++; console.log('✗ раунд', r.id, r.game, v); }
}
console.log(`База ${file}: раундов ${rows.length}`);
console.table(stat);
console.log(bad ? `\nНЕ СОШЛИСЬ: ${bad}` : '\nВсе раскрытые раунды сошлись');
process.exit(bad ? 1 : 0);
