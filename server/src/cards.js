// Общие вспомогательные функции для карточных игр

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Свежая перемешанная колода из 52 карт. Карта: { s: '♠', r: 'A' } */
export function freshDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ s, r });
  return shuffle(deck);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
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
