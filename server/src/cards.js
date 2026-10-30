// Общие вспомогательные функции для карточных игр

import { SUITS, RANKS, deck52 } from './fair/games.js';
import { randomRng } from './fair/node.js';

export { SUITS, RANKS };

/**
 * Свежая перемешанная колода из 52 карт. Карта: { s: '♠', r: 'A' }.
 * rng — лента Provably Fair раунда (fair/), карты снимаются с конца.
 */
export const freshDeck = (rng = randomRng()) => deck52(rng);

export const draw = (deck) => deck.pop();

/**
 * Сумма руки для Blackjack/Очко: туз = 11, затем красиво «смягчается» до 1.
 * Возвращает { total, soft } — soft = true, если туз сейчас считается как 11.
 */
export function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === 'A') { total += 11; aces++; }
    else if (['K', 'Q', 'J', '10'].includes(c.r)) total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

/** Убранная скрытая карта — для клиента */
export const HIDDEN = { hidden: true };
