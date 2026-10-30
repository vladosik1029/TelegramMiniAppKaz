// ─── Очко ─────────────────────────────────────────────────────────────────────
// Русская игра «21» / «Очко». Крупье-бот против игрока.
// Значения: туз = 11 (или 1 при переборе), K/Q/J/10 = 10, остальные по номиналу.
// Цель — набрать 21 или больше соперника, не перебрав.
//
// Особые комбинации на раздатке (2 карты):
//   «Пан-пан» — обе карты пиковые (♠): мгновенная победа, выплата 3:1.
//   «Очко» — сумма ровно 21 (туз + десятка/картинка): мгновенная победа, 2:1.
// Крупье добирает, пока у него меньше 17.

import { freshDeck, draw, handTotal } from '../cards.js';

export function start() {
  const deck = freshDeck();
  const player = [draw(deck), draw(deck)];
  const dealer = [draw(deck), draw(deck)];
  const state = { deck, player, dealer };

  const pPan = player.every(c => c.s === '♠');
  const dPan = dealer.every(c => c.s === '♠');
  const p21 = handTotal(player).total === 21 && p21ok(player);
  const d21 = handTotal(dealer).total === 21 && d21ok(dealer) && dealer.length === 2;

  if (pPan || dPan || p21 || d21) {
    if (pPan && dPan) return finish(state, 'push', 1);
    if (pPan) return finish(state, 'pan_pan', 3);
    if (dPan) return finish(state, 'dealer_pan', 0);
    if (p21 && d21) return finish(state, 'push', 1);
    if (p21) return finish(state, 'ochko', 2);
    return finish(state, 'lose', 0);
  }

  state.stage = 'player';
  return { state, view: view(state), finished: false };
}

/** 21 с двух карт считается «очком», только если есть туз (иначе недостижимо, но проверим честно) */
const p21ok = (cards) => cards.some(c => c.r === 'A') || cards.some(c => c.r === 'A');
const d21ok = p21ok;

export function act(state, action) {
  if (action === 'hit') {
    if (state.stage !== 'player') throw new Error('BAD_ACTION');
    state.player.push(draw(state.deck));
    if (handTotal(state.player).total > 21) return finish(state, 'bust', 0);
    return { state, view: view(state), finished: false };
  }

  if (action === 'stop') {
    if (state.stage !== 'player') throw new Error('BAD_ACTION');
    while (handTotal(state.dealer).total < 17) state.dealer.push(draw(state.deck));
    const p = handTotal(state.player).total;
    const d = handTotal(state.dealer).total;
    if (d > 21) return finish(state, 'dealer_bust', 2);
    if (p > d) return finish(state, 'win', 2);
    if (p === d) return finish(state, 'push', 1);
    return finish(state, 'lose', 0);
  }

  throw new Error('BAD_ACTION');
}

function finish(state, outcome, mult) {
  return {
    finished: true,
    outcome: mult === 0 ? 'lose' : mult === 1 ? 'push' : 'win',
    returnMult: mult,
    state,
    view: view(state, true),
    message: outcome,
  };
}

export function view(state, reveal = false) {
  const showDealer = reveal || state.stage === 'done';
  return {
    player: state.player,
    dealer: showDealer ? state.dealer : [state.dealer[0], { hidden: true }],
    playerTotal: handTotal(state.player).total,
    dealerTotal: showDealer ? handTotal(state.dealer).total : handTotal([state.dealer[0]]).total,
    stage: state.stage,
  };
}
