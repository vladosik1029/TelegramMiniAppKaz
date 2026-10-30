// ─── BlackJack ────────────────────────────────────────────────────────────────
// Правила: стандартный блэкджек с S17 (крупье добирает до 17, на 17+ стоит).
// BlackJack (21 с двух карт) платит 3:2. Ничья — возврат ставки. Есть дабл.
//
// Модуль возвращает серверу множитель ВОЗВРАТА (returnMult) на единицу ставки:
//   0 = проигрыш, 1 = ничья (возврат), 2 = обычный выигрыш, 2.5 = BlackJack.
// При дабле ставка удваивается (betUnits = 2), множитель умножается на 2.

import { freshDeck, draw, handTotal, HIDDEN } from '../cards.js';
import { cardStr } from '../fair/games.js';

const isBJ = (cards) => cards.length === 2 && handTotal(cards).total === 21;

export function start(bet, opts, rng) {
  const deck = freshDeck(rng);
  const fair = { record: { deck: deck.map(cardStr) } };
  const player = [draw(deck), draw(deck)];
  const dealer = [draw(deck), draw(deck)];
  const state = { deck, player, dealer, stage: 'player', betUnits: 1 };
  // Если у игрока сразу BlackJack — клиент отправляет stand (dealerPlay)
  if (isBJ(player)) state.stage = 'done';
  return { state, view: view(state), finished: false, fair };
}

export function act(state, action) {
  const { player, dealer } = state;

  if (action === 'hit') {
    if (state.stage !== 'player') throw new Error('BAD_ACTION');
    player.push(draw(state.deck));
    const { total } = handTotal(player);
    if (total > 21) return finish(state, 'bust');
    return { state, view: view(state), finished: false };
  }

  if (action === 'double') {
    if (state.stage !== 'player' || player.length !== 2) throw new Error('BAD_ACTION');
    state.betUnits = 2;
    player.push(draw(state.deck));
    if (handTotal(player).total > 21) return finish(state, 'bust');
    return dealerPlay(state);
  }

  if (action === 'stand') {
    if (state.stage !== 'player' && !(state.stage === 'done' && isBJ(player))) throw new Error('BAD_ACTION');
    return dealerPlay(state);
  }

  throw new Error('BAD_ACTION');
}

function dealerPlay(state) {
  const { player, dealer } = state;
  while (handTotal(dealer).total < 17) dealer.push(draw(state.deck));
  const p = handTotal(player).total;
  const d = handTotal(dealer).total;
  if (isBJ(player) || dealer.length === 2 && d === 21) {
    // натуральные блэкджеки
    if (isBJ(player) && dealer.length === 2 && d === 21) return finish(state, 'push');
    if (isBJ(player)) return finish(state, 'bj');
    return finish(state, 'lose');
  }
  if (d > 21) return finish(state, 'dealer_bust');
  if (p > d) return finish(state, 'win');
  if (p === d) return finish(state, 'push');
  return finish(state, 'lose');
}

function finish(state, outcome) {
  const mult = {
    bust: 0, lose: 0, dealer_bust: 2, push: 1, bj: 2.5, win: 2,
  }[outcome];
  return {
    finished: true,
    outcome: mult === 0 ? 'lose' : mult === 1 ? 'push' : 'win',
    returnMult: mult * state.betUnits,
    state,
    view: view(state, true),
  };
}

export function view(state, reveal = false) {
  // дилер раскрывается только в финальном ответе (reveal = true)
  const showDealer = reveal;
  return {
    player: state.player,
    dealer: showDealer ? state.dealer : [state.dealer[0], HIDDEN],
    playerTotal: handTotal(state.player).total,
    dealerTotal: showDealer ? handTotal(state.dealer).total : handTotal([state.dealer[0]]).total,
    stage: state.stage,
    canDouble: state.stage === 'player' && state.player.length === 2,
    betUnits: state.betUnits,
  };
}
