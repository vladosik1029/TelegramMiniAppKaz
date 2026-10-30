// ─── Слоты (3 барабана, 1 линия) ────────────────────────────────────────────
// Каждый барабан — одна и та же лента символов; сервер выбирает позицию
// каждого барабана (лента Provably Fair, fair/), линия выплаты — средний ряд.
// Выплаты (returnMult): три одинаковых — по таблице PAYS, две вишни — ×2,
// одна вишня — ×1 (возврат). RTP ≈ 97.8% (проверяется в smoke.js).

import { DERIVE, SLOT_STRIP } from '../fair/games.js';
import { randomRng } from '../fair/node.js';

// Лента барабана (fair/games.js): частые символы встречаются чаще
export const STRIP = SLOT_STRIP;

export const PAYS = {
  '7️⃣': 200, '💎': 100, '⭐': 50, '🔔': 25, '🍇': 15, '🍊': 10, '🍋': 8, '🍒': 12,
};

export function evaluate(line) {
  const [a, b, c] = line;
  if (a === b && b === c) return { mult: PAYS[a], combo: 'three' };
  const cherries = line.filter(s => s === '🍒').length;
  if (cherries === 2) return { mult: 2, combo: 'two_cherry' };
  if (cherries === 1) return { mult: 1, combo: 'one_cherry' };
  return { mult: 0, combo: 'none' };
}

export function start(bet, opts, rng = randomRng()) {
  const record = DERIVE.slots(rng);
  const stops = record.stops;
  const line = stops.map(i => STRIP[i]);
  const { mult, combo } = evaluate(line);
  return {
    finished: true,
    outcome: mult > 1 ? 'win' : mult === 1 ? 'push' : 'lose',
    returnMult: mult,
    state: {},
    view: { stops, line, combo, mult, strip: STRIP },
    message: combo,
    fair: { record },
  };
}
