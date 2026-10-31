// ─── Башня ───────────────────────────────────────────────────────────────────
// 8 этажей. На каждом этаже несколько клеток, среди них мины (сколько — по
// сложности). Выбрал безопасную — поднимаешься выше, множитель растёт; можно
// забрать в любой момент. Наступил на мину — ставка сгорает.
// Множитель после k этажей = 0.99 · (клеток / безопасных)^k.

import { towerBombs, TOWER_FLOORS, TOWER_LEVELS } from '../fair/games.js';
import { randomRng } from '../fair/node.js';

const EDGE = 0.99;
export const FLOORS = TOWER_FLOORS;
export const LEVELS = TOWER_LEVELS;

export function multAfter(level, k) {
  if (!k) return 1;
  const { cells, bombs } = LEVELS[level];
  return Math.floor(EDGE * (cells / (cells - bombs)) ** k * 100) / 100;
}

export function start(bet, opts, rng = randomRng()) {
  const level = opts?.level;
  if (!LEVELS[level]) throw new Error('BAD_ACTION');
  const state = { level, bombs: towerBombs(rng, level), picks: [] };
  return { finished: false, state, view: view(state), fair: { params: { level }, record: { bombs: state.bombs } } };
}

export function act(state, action) {
  const k = state.picks.length;
  if (action === 'cashout') {
    if (!k) throw new Error('BAD_ACTION');
    return finish(state, 'cashout', multAfter(state.level, k));
  }
  const m = /^pick:(\d+)$/.exec(String(action));
  if (!m) throw new Error('BAD_ACTION');
  const cell = Number(m[1]);
  if (cell >= LEVELS[state.level].cells) throw new Error('BAD_ACTION');

  state.picks.push(cell);
  if (state.bombs[k].includes(cell)) {
    state.boom = k;
    return finish(state, 'boom', 0);
  }
  if (state.picks.length === FLOORS) return finish(state, 'top', multAfter(state.level, FLOORS));
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
  const k = state.picks.length - (state.boom != null ? 1 : 0);
  const { cells, bombs } = LEVELS[state.level];
  return {
    level: state.level, cells, bombsPerFloor: bombs, floors: FLOORS,
    picks: state.picks,
    floor: k,
    mult: multAfter(state.level, k),
    nextMult: k < FLOORS ? multAfter(state.level, k + 1) : null,
    // открытые этажи показываем всегда, остальные — в конце раунда
    bombs: reveal ? state.bombs : state.bombs.slice(0, k),
    boom: state.boom ?? null,
  };
}
