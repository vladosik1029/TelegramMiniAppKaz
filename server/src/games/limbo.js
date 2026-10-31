// ─── Лимбо ───────────────────────────────────────────────────────────────────
// Игрок задаёт целевой множитель (×1.01 … ×10 000). Сервер выбрасывает число
// по формуле Ракеты: точка = 0.99 / (1 − r). Если точка ≥ цели — выплата ×цель.
// Шанс ≈ 0.99 / цель, так что возврат ≈ 99% при любой цели.

import { DERIVE } from '../fair/games.js';
import { randomRng } from '../fair/node.js';

export const MIN_TARGET = 1.01;
export const MAX_TARGET = 10000;

export function start(bet, opts, rng = randomRng()) {
  const target = Math.round(Number(opts?.target) * 100) / 100;
  if (!Number.isFinite(target) || target < MIN_TARGET || target > MAX_TARGET) throw new Error('BAD_ACTION');

  const record = DERIVE.limbo(rng);
  const win = record.point >= target;
  return {
    finished: true,
    outcome: win ? 'win' : 'lose',
    returnMult: win ? target : 0,
    state: {},
    view: { point: record.point, target, chance: Math.min(1, 0.99 / target) },
    message: `Цель ×${target.toFixed(2)} → ×${record.point.toFixed(2)}`,
    fair: { record },
  };
}
