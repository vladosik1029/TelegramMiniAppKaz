// ─── Слоты (3 барабана, 1 линия) ────────────────────────────────────────────
// Каждый барабан — одна и та же лента символов; сервер выбирает позицию
// каждого барабана (crypto.randomInt), линия выплаты — средний ряд.
// Выплаты (returnMult): три одинаковых — по таблице PAYS, две вишни — ×2,
// одна вишня — ×1 (возврат). RTP ≈ 97.8% (проверяется в smoke.js).

import crypto from 'node:crypto';

// Лента барабана: частые символы встречаются чаще
export const STRIP = [
  '🍒', '🍋', '🍊', '🍒', '🍇', '🍋', '🔔', '🍊',
  '🍒', '🍋', '⭐', '🍊', '🍇', '🍒', '🍋', '💎',
  '🍊', '🍒', '🍇', '🔔', '🍋', '🍊', '7️⃣', '🍇',
];

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

export function start() {
  const stops = [0, 1, 2].map(() => crypto.randomInt(0, STRIP.length));
  const line = stops.map(i => STRIP[i]);
  const { mult, combo } = evaluate(line);
  return {
    finished: true,
    outcome: mult > 1 ? 'win' : mult === 1 ? 'push' : 'lose',
    returnMult: mult,
    state: {},
    view: { stops, line, combo, mult, strip: STRIP },
    message: combo,
  };
}
