// ─── Плинко ──────────────────────────────────────────────────────────────────
// Мгновенная игра: шарик падает через 12 рядов колышков, на каждом отскакивает
// влево или вправо (crypto.randomInt), и попадает в одну из 13 лунок внизу.
// Номер лунки = число отскоков вправо, распределение биномиальное — края редкие.
// Игрок выбирает риск: чем выше, тем жирнее края и беднее середина.
// Средний возврат каждой таблицы ≈ 0.99 (1% — дом), проверяется в smoke.js.

import crypto from 'node:crypto';

export const ROWS = 12;

const sym = (half) => [...half, ...half.slice(0, -1).reverse()];
export const TABLES = {
  low: sym([10, 3, 1.6, 1.4, 1.1, 1, 0.5]),
  medium: sym([33, 11, 4, 2, 1.1, 0.6, 0.3]),
  high: sym([170, 24, 8.1, 2, 0.7, 0.2, 0.2]),
};

export function start(bet, opts) {
  const risk = opts?.risk;
  if (!Object.hasOwn(TABLES, risk)) throw new Error('BAD_ACTION');

  const path = Array.from({ length: ROWS }, () => crypto.randomInt(0, 2)); // 0 — влево, 1 — вправо
  const slot = path.reduce((s, x) => s + x, 0);
  const mult = TABLES[risk][slot];

  return {
    finished: true,
    outcome: mult > 1 ? 'win' : mult === 1 ? 'push' : 'lose',
    returnMult: mult,
    state: {},
    view: { path, slot, mult, risk },
    message: `Лунка ×${mult}`,
  };
}
