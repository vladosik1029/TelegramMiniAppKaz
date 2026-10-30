// ─── Рулетка (европейская, 37 лунок) ─────────────────────────────────────────
// Мгновенная игра: игрок выбирает тип ставки, сервер крутит колесо и сразу
// возвращает результат. European wheel order (одна «зелёная» лунка 0).
// Выплаты (returnMult — сколько вернёшь всего): равные шансы ×2, дюжины/колонки ×3,
// число ×36. Ноль («зеро») проигрывает все внешние ставки.

import crypto from 'node:crypto';

// Порядок лунок на европейском колесе (по кругу)
const ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const colorOf = (num) => (num === 0 ? 'green' : RED.has(num) ? 'red' : 'black');

const TYPES = [
  'red', 'black', 'even', 'odd', 'low', 'high',
  'd1', 'd2', 'd3', 'c1', 'c2', 'c3', 'num',
];
const LABEL = {
  red: 'Красное', black: 'Чёрное', even: 'Чётное', odd: 'Нечётное',
  low: 'Меньшее (1–18)', high: 'Большее (19–36)',
  d1: 'Первая дюжина', d2: 'Вторая дюжина', d3: 'Третья дюжина',
  c1: 'Первая колонка', c2: 'Вторая колонка', c3: 'Третья колонка',
  num: 'Прямая ставка на число',
};

export function start(bet, opts) {
  const { type, value } = parseOpts(opts);
  const idx = crypto.randomInt(0, ORDER.length); // 0..36 равновероятно
  const num = ORDER[idx];

  const win = wins(type, value, num);
  const mult = win ? multOf(type) : 0;

  return {
    finished: true,
    outcome: mult > 0 ? 'win' : 'lose',
    returnMult: mult,
    state: { lastIdx: idx },
    view: { number: num, color: colorOf(num), pocketIdx: idx, betType: type, betValue: value ?? null },
    message: `${LABEL[type]} → число ${num}`,
  };
}

function parseOpts(o = {}) {
  const type = o?.type;
  if (!TYPES.includes(type)) throw new Error('BAD_ACTION');
  if (type === 'num') {
    const v = Math.floor(Number(o?.value));
    if (!Number.isInteger(v) || v < 0 || v > 36) throw new Error('BAD_ACTION');
    return { type, value: v };
  }
  return { type, value: null };
}

function multOf(type) {
  if (type === 'num') return 36;
  if (['d1', 'd2', 'd3', 'c1', 'c2', 'c3'].includes(type)) return 3;
  return 2; // red/black/even/odd/low/high
}

function wins(type, value, num) {
  switch (type) {
    case 'red': return num !== 0 && RED.has(num);
    case 'black': return num !== 0 && !RED.has(num);
    case 'even': return num !== 0 && num % 2 === 0;
    case 'odd': return num % 2 === 1;
    case 'low': return num >= 1 && num <= 18;
    case 'high': return num >= 19 && num <= 36;
    case 'd1': return num >= 1 && num <= 12;
    case 'd2': return num >= 13 && num <= 24;
    case 'd3': return num >= 25 && num <= 36;
    case 'c1': return num > 0 && num % 3 === 1;
    case 'c2': return num > 0 && num % 3 === 2;
    case 'c3': return num > 0 && num % 3 === 0;
    case 'num': return num === value;
    default: return false;
  }
}
