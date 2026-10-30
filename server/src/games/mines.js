// ─── Сапёр (Mines) ───────────────────────────────────────────────────────────
// Поле 5×5, игрок выбирает число мин (1–24). Каждая открытая безопасная клетка
// растит множитель; в любой момент можно забрать выигрыш. Попал на мину —
// ставка сгорает. Позиции мин живут только в серверной сессии.
//
// Множитель после k безопасных клеток = 0.99 · Π (25−i)/(25−m−i), i = 0..k−1
// (честная обратная вероятность пройти k клеток, минус 1% дому).

import crypto from 'node:crypto';

export const CELLS = 25;
const EDGE = 0.99;
const MAX_MULT = 5000;

export function multAfter(mines, k) {
  let m = EDGE;
  for (let i = 0; i < k; i++) m *= (CELLS - i) / (CELLS - mines - i);
  return Math.min(MAX_MULT, Math.floor(m * 100) / 100);
}

export function start(bet, opts) {
  const mines = Math.floor(Number(opts?.mines));
  if (!Number.isInteger(mines) || mines < 1 || mines > 24) throw new Error('BAD_ACTION');

  // выбираем позиции мин частичным Фишером–Йетсом на crypto-рандоме
  const cells = Array.from({ length: CELLS }, (_, i) => i);
  for (let i = 0; i < mines; i++) {
    const j = i + crypto.randomInt(0, CELLS - i);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const state = { mines, bombs: cells.slice(0, mines).sort((a, b) => a - b), opened: [] };
  return { finished: false, state, view: view(state) };
}

export function act(state, action) {
  if (action === 'cashout') {
    if (!state.opened.length) throw new Error('BAD_ACTION');
    return finish(state, 'cashout', multAfter(state.mines, state.opened.length));
  }

  const m = /^open:(\d+)$/.exec(String(action));
  if (!m) throw new Error('BAD_ACTION');
  const cell = Number(m[1]);
  if (cell < 0 || cell >= CELLS || state.opened.includes(cell)) throw new Error('BAD_ACTION');

  if (state.bombs.includes(cell)) {
    state.boom = cell;
    return finish(state, 'boom', 0);
  }
  state.opened.push(cell);
  if (state.opened.length === CELLS - state.mines) {
    return finish(state, 'cleared', multAfter(state.mines, state.opened.length));
  }
  return { finished: false, state, view: view(state) };
}

function finish(state, how, mult) {
  return {
    finished: true,
    outcome: mult > 1 ? 'win' : mult === 1 ? 'push' : 'lose',
    returnMult: mult,
    state,
    view: view(state, true),
    message: how,
  };
}

export function view(state, reveal = false) {
  const k = state.opened.length;
  return {
    mines: state.mines,
    opened: state.opened,
    mult: k ? multAfter(state.mines, k) : 1,
    nextMult: k < CELLS - state.mines ? multAfter(state.mines, k + 1) : null,
    bombs: reveal ? state.bombs : null,
    boom: state.boom ?? null,
  };
}
