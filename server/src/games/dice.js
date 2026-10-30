// ─── Кости (Dice) ────────────────────────────────────────────────────────────
// Мгновенная игра: сервер бросает число 0.00–99.99 (crypto.randomInt).
// Игрок выбирает порог и направление: «меньше X» или «больше X».
// Шанс = доля чисел, которые выигрывают; выплата = 0.99 / шанс (1% — дом).

import crypto from 'node:crypto';

export const EDGE = 0.99;
const MIN_T = 2, MAX_T = 98;

/** Шанс выигрыша (0..1) для ставки «under/over target» */
export function chanceOf(dir, target) {
  return dir === 'under' ? target / 100 : (100 - target) / 100;
}

export const multOf = (dir, target) => Math.floor((EDGE / chanceOf(dir, target)) * 10000) / 10000;

export function start(bet, opts) {
  const dir = opts?.dir === 'over' ? 'over' : opts?.dir === 'under' ? 'under' : null;
  const target = Math.floor(Number(opts?.target));
  if (!dir || !Number.isInteger(target) || target < MIN_T || target > MAX_T) throw new Error('BAD_ACTION');

  const roll = crypto.randomInt(0, 10000); // 0..9999 → 0.00..99.99
  const win = dir === 'under' ? roll < target * 100 : roll >= target * 100;
  const mult = multOf(dir, target);

  return {
    finished: true,
    outcome: win ? 'win' : 'lose',
    returnMult: win ? mult : 0,
    state: {},
    view: { roll: roll / 100, dir, target, mult, chance: chanceOf(dir, target) },
    message: `${dir === 'under' ? 'Меньше' : 'Больше'} ${target} → ${(roll / 100).toFixed(2)}`,
  };
}
