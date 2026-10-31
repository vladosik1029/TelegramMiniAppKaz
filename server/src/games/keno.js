// ─── Кено ────────────────────────────────────────────────────────────────────
// Поле 1–40. Игрок отмечает от 1 до 10 чисел, сервер вытягивает 10 шаров.
// Выплата зависит от того, сколько отмеченных чисел совпало (таблица PAYS).
// Возврат по каждой строке таблицы — 97–99% (считается точно, см. test/fair.js).

import { DERIVE, KENO_NUMBERS } from '../fair/games.js';
import { randomRng } from '../fair/node.js';

// PAYS[сколько отмечено][сколько совпало] = множитель
export const PAYS = {
  1: { 1: 3.96 },
  2: { 1: 1.8, 2: 5.1 },
  3: { 2: 2.8, 3: 50 },
  4: { 2: 1.7, 3: 10, 4: 100 },
  5: { 2: 1.4, 3: 4, 4: 14, 5: 390 },
  6: { 3: 3, 4: 9, 5: 180, 6: 710 },
  7: { 3: 2, 4: 7, 5: 30, 6: 400, 7: 800 },
  8: { 3: 2, 4: 4, 5: 11, 6: 67, 7: 400, 8: 900 },
  9: { 3: 2, 4: 2.5, 5: 5, 6: 15, 7: 100, 8: 500, 9: 1000 },
  10: { 3: 1.6, 4: 2, 5: 4, 6: 7, 7: 26, 8: 100, 9: 500, 10: 1000 },
};

export function start(bet, opts, rng = randomRng()) {
  const picks = Array.isArray(opts?.picks) ? [...new Set(opts.picks.map(Number))] : [];
  if (picks.length < 1 || picks.length > 10 || picks.length !== (opts.picks?.length ?? 0)
    || picks.some(n => !Number.isInteger(n) || n < 1 || n > KENO_NUMBERS)) throw new Error('BAD_ACTION');
  picks.sort((a, b) => a - b);

  const record = DERIVE.keno(rng);
  const hits = picks.filter(n => record.drawn.includes(n));
  const mult = PAYS[picks.length][hits.length] ?? 0;
  return {
    finished: true,
    outcome: mult > 1 ? 'win' : mult === 1 ? 'push' : 'lose',
    returnMult: mult,
    state: {},
    view: { picks, drawn: record.drawn, hits, mult },
    message: `${hits.length} из ${picks.length} → ×${mult}`,
    fair: { record },
  };
}
