// ─── Сокровища: слот 5×3, 10 линий, вайлды, скаттеры и фриспины ─────────────
// Ставка — на все 10 линий сразу (ставка на линию = ставка / 10).
// Линия платит, если с первого барабана подряд идут одинаковые символы (≥3);
// 🃏 вайлд заменяет любой символ, кроме 💰. 💰 платит где угодно и при 3+
// запускает 8 / 12 / 20 бесплатных вращений, в которых все выигрыши ×2
// (3+ 💰 во фриспинах дают ещё +8). Весь раунд, включая фриспины,
// считается сразу из одной ленты Provably Fair. Возврат ≈ 96,5% (smoke.js).

import { DERIVE, treasureGrid, treasureScatters, TREASURE_FS, TREASURE_RETRIGGER } from '../fair/games.js';
import { randomRng } from '../fair/node.js';

export const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
];
// выплата за линию в ставках-на-линию: [3 подряд, 4, 5]
export const PAYS = {
  C: [12, 35, 90], L: [12, 35, 90], O: [17, 45, 140], G: [17, 45, 140],
  B: [30, 90, 300], S: [40, 120, 450], D: [60, 200, 750], 7: [100, 400, 2000], W: [120, 500, 2500],
};
// скаттер: множитель ко всей ставке
export const SCATTER_PAYS = { 3: 2, 4: 10, 5: 50 };
export const FREE_MULT = 2;
export const MAX_WIN = 5000; // потолок выигрыша за раунд, в ставках

const linePay = (sym, n) => (n >= 3 ? PAYS[sym][n - 3] : 0);

/** Выигрыши одного окна: линии (в ставках) и скаттер */
export function evaluate(grid) {
  const wins = [];
  LINES.forEach((L, li) => {
    const row = L.map((r, i) => grid[i][r]);
    const first = row.find(s => s !== 'W');
    let n = 0;
    if (first && first !== 'X') for (const s of row) { if (s === 'W' || s === first) n++; else break; }
    let wn = 0;
    for (const s of row) { if (s === 'W') wn++; else break; }
    const a = first && first !== 'X' ? linePay(first, n) : 0;
    const b = linePay('W', wn);
    if (a || b) {
      const useW = b > a;
      wins.push({ line: li, sym: useW ? 'W' : first, n: useW ? wn : n, mult: Math.max(a, b) / 10 });
    }
  });
  const scatters = treasureScatters(grid);
  return { wins, scatters, scatterMult: SCATTER_PAYS[Math.min(5, scatters)] ?? 0 };
}

export function start(bet, opts, rng = randomRng()) {
  const record = DERIVE.treasure(rng);
  const spins = record.spins.map((stops, i) => {
    const grid = treasureGrid(stops);
    const e = evaluate(grid);
    const mult = i === 0 ? 1 : FREE_MULT;
    const lineMult = e.wins.reduce((s, w) => s + w.mult, 0);
    const award = e.scatters >= 3 ? (i === 0 ? TREASURE_FS[Math.min(5, e.scatters)] : TREASURE_RETRIGGER) : 0;
    return { grid, wins: e.wins, scatters: e.scatters, scatterMult: e.scatterMult, award, mult, total: Math.round((lineMult + e.scatterMult) * mult * 100) / 100 };
  });
  const totalMult = Math.min(MAX_WIN, Math.round(spins.reduce((s, x) => s + x.total, 0) * 100) / 100);
  return {
    finished: true,
    outcome: totalMult > 1 ? 'win' : totalMult === 1 ? 'push' : 'lose',
    returnMult: totalMult,
    state: {},
    view: { spins, freeSpins: spins.length - 1, totalMult },
    message: spins.length > 1 ? `Фриспины: ${spins.length - 1} · ×${totalMult}` : `×${totalMult}`,
    fair: { record },
  };
}
