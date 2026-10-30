// ─── Выше / Ниже (Hi-Lo) ─────────────────────────────────────────────────────
// Открыта карта; игрок угадывает, будет ли следующая «выше или равна» или
// «ниже или равна». Каждое попадание умножает банк раунда на 0.97 / шанс.
// Забрать выигрыш можно после первого угаданного шага. Ошибся — ставка сгорает.
// Колода бесконечная (каждая карта — независимое число 0…51 из ленты Provably
// Fair), поэтому шансы всегда считаются только по рангу текущей карты.
// Карты открываются по одной, но все они — продолжение одной ленты раунда:
// k-я карта = k-е число ленты HMAC(server_seed, client_seed:nonce), в сессии
// лежат сиды раунда (сессия на сервере, клиенту не отдаётся).

import { HILO_RANKS, hiloCard, cardStr } from '../fair/games.js';
import { rngFor, randomHex } from '../fair/node.js';

// Порядок по старшинству: 2 младшая, туз старший
export const RANKS = HILO_RANKS;
const EDGE = 0.97;
const MAX_MULT = 5000;

/** Следующая карта ленты раунда: перематываем ленту на уже открытые карты */
function drawCard(state) {
  const { serverSeed, clientSeed, nonce } = state.seeds;
  const rng = rngFor(serverSeed, clientSeed, nonce);
  let card;
  for (let k = 0; k <= state.cards.length; k++) card = hiloCard(rng);
  return card;
}
const rankIdx = (c) => RANKS.indexOf(c.r); // 0..12

/** Шанс (0..1) того, что следующая карта будет ≥ (hi) или ≤ (lo) текущей */
export function chance(card, dir) {
  const i = rankIdx(card);
  return dir === 'hi' ? (13 - i) / 13 : (i + 1) / 13;
}
export const stepMult = (card, dir) => EDGE / chance(card, dir);

export function start(bet, opts, rng, round) {
  const seeds = round
    ? { serverSeed: round.serverSeed, clientSeed: round.clientSeed, nonce: round.nonce }
    : { serverSeed: randomHex(), clientSeed: 'local', nonce: 0 };
  const state = { seeds, cards: [], mult: 1 };
  state.cards.push(drawCard(state));
  return { finished: false, state, view: view(state) };
}

export function act(state, action) {
  const cur = state.cards[state.cards.length - 1];

  if (action === 'cashout') {
    if (state.cards.length - 1 - (state.skips ?? 0) < 1) throw new Error('BAD_ACTION');
    return finish(state, 'cashout', state.mult);
  }
  if (action === 'skip') {
    // пропуск карты без изменения банка — не больше 3 раз за раунд
    if ((state.skips ?? 0) >= 3) throw new Error('BAD_ACTION');
    state.skips = (state.skips ?? 0) + 1;
    state.cards.push(drawCard(state));
    state.skipped = [...(state.skipped ?? []), state.cards.length - 1];
    return { finished: false, state, view: view(state) };
  }
  if (action !== 'hi' && action !== 'lo') throw new Error('BAD_ACTION');

  const next = drawCard(state);
  state.cards.push(next);
  const ok = action === 'hi' ? rankIdx(next) >= rankIdx(cur) : rankIdx(next) <= rankIdx(cur);
  if (!ok) return finish(state, 'miss', 0);

  state.mult = Math.min(MAX_MULT, Math.floor(state.mult * stepMult(cur, action) * 100) / 100);
  return { finished: false, state, view: view(state) };
}

function finish(state, how, mult) {
  return {
    finished: true,
    outcome: mult > 1 ? 'win' : mult === 1 ? 'push' : 'lose',
    returnMult: mult,
    state,
    view: view(state),
    message: how,
    fair: { params: { cards: state.cards.length }, record: { cards: state.cards.map(cardStr) } },
  };
}

export function view(state) {
  const cur = state.cards[state.cards.length - 1];
  return {
    cards: state.cards.slice(-6),
    skipped: (state.skipped ?? []).map(i => i - Math.max(0, state.cards.length - 6)).filter(i => i >= 0),
    mult: state.mult,
    steps: state.cards.length - 1 - (state.skips ?? 0),
    skipsLeft: 3 - (state.skips ?? 0),
    hi: { chance: chance(cur, 'hi'), mult: Math.floor(state.mult * stepMult(cur, 'hi') * 100) / 100 },
    lo: { chance: chance(cur, 'lo'), mult: Math.floor(state.mult * stepMult(cur, 'lo') * 100) / 100 },
  };
}
