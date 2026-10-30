// ─── Баккара (пунто-банко) ───────────────────────────────────────────────────
// Мгновенная игра: шу из 6 колод, раздача по классическим правилам третьей карты.
// Ставка на Игрока (×2), Банкира (×1.95 — 5% комиссия) или Ничью (×9).
// При ничьей ставки на Игрока и Банкира возвращаются.

import { baccaratShoe, cardStr } from '../fair/games.js';
import { randomRng } from '../fair/node.js';

export const PAYS = { player: 2, banker: 1.95, tie: 9 };
const NAMES = { player: 'Игрок', banker: 'Банкир', tie: 'Ничья' };

export const pointOf = (c) => (c.r === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(c.r) ? 0 : Number(c.r));
export const totalOf = (cards) => cards.reduce((s, c) => s + pointOf(c), 0) % 10;

/** Берёт ли банкир третью карту: его сумма и третья карта игрока (null — игрок не брал) */
export function bankerDraws(b, p3) {
  if (p3 == null) return b <= 5;
  if (b <= 2) return true;
  if (b === 3) return p3 !== 8;
  if (b === 4) return p3 >= 2 && p3 <= 7;
  if (b === 5) return p3 >= 4 && p3 <= 7;
  if (b === 6) return p3 === 6 || p3 === 7;
  return false;
}

/** Раздача по правилам; deck — массив, карты снимаются с конца */
export function deal(deck) {
  const player = [deck.pop(), deck.pop()];
  const banker = [deck.pop(), deck.pop()];
  // порядок раздачи для анимации: И, Б, И, Б, затем третьи карты
  const order = ['player', 'banker', 'player', 'banker'];
  const p = totalOf(player), b = totalOf(banker);
  if (p < 8 && b < 8) {
    let p3 = null;
    if (p <= 5) { const c = deck.pop(); player.push(c); p3 = pointOf(c); order.push('player'); }
    if (bankerDraws(b, p3)) { banker.push(deck.pop()); order.push('banker'); }
  }
  const pt = totalOf(player), bt = totalOf(banker);
  return { player, banker, order, pt, bt, winner: pt > bt ? 'player' : bt > pt ? 'banker' : 'tie' };
}

export function start(bet, opts, rng = randomRng()) {
  const side = opts?.side;
  if (!Object.hasOwn(PAYS, side)) throw new Error('BAD_ACTION');

  const shoe = baccaratShoe(rng);
  const fair = { record: { deck: shoe.map(cardStr) } };
  const d = deal([...shoe]);

  let returnMult, outcome;
  if (d.winner === side) { returnMult = PAYS[side]; outcome = 'win'; }
  else if (d.winner === 'tie') { returnMult = 1; outcome = 'push'; }
  else { returnMult = 0; outcome = 'lose'; }

  return {
    finished: true,
    outcome,
    returnMult,
    state: {},
    view: { ...d, side },
    message: `${NAMES[d.winner]}: ${d.pt} — ${d.bt}`,
    fair,
  };
}
