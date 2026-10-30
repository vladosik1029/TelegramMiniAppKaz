// ─── Provably Fair: как из ленты байт получается исход каждой игры ───────────
// Одни и те же функции используют игры на сервере и проверка в браузере,
// поэтому «проверяющий» пересчитывает ровно тот код, что раздавал карты.
// Каждая derive-функция возвращает «запись исхода» — её сервер сохраняет
// в историю раунда, а проверка сравнивает с пересчитанной.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
/** Выше/Ниже: старшинство от двойки до туза */
export const HILO_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const DURAK_RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const BACCARAT_DECKS = 6;

// Порядок лунок европейского колеса (по кругу)
export const ROULETTE_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

// Лента барабана слотов: частые символы встречаются чаще
export const SLOT_STRIP = [
  '🍒', '🍋', '🍊', '🍒', '🍇', '🍋', '🔔', '🍊',
  '🍒', '🍋', '⭐', '🍊', '🍇', '🍒', '🍋', '💎',
  '🍊', '🍒', '🍇', '🔔', '🍋', '🍊', '7️⃣', '🍇',
];

export const PLINKO_ROWS = 12;
export const MINES_CELLS = 25;
export const CRASH_MAX = 1000;

/** Карта ↔ строка «10♥» (так колоды лежат в истории) */
export const cardStr = (c) => `${c.r}${c.s}`;
export const parseCard = (s) => ({ r: s.slice(0, -1), s: s.slice(-1) });

function orderedDeck(ranks, copies = 1) {
  const d = [];
  for (let k = 0; k < copies; k++) for (const s of SUITS) for (const r of ranks) d.push({ s, r });
  return d;
}

/** Колоды: карты снимаются с КОНЦА массива (deck.pop()) */
export const deck52 = (rng) => rng.shuffle(orderedDeck(RANKS));
export const deck36 = (rng) => rng.shuffle(orderedDeck(DURAK_RANKS));
export const baccaratShoe = (rng) => rng.shuffle(orderedDeck(RANKS, BACCARAT_DECKS));

/** Выше/Ниже: бесконечная колода, каждая карта — независимое число 0…51 */
export function hiloCard(rng) {
  const x = rng.int(52);
  return { r: HILO_RANKS[x % 13], s: SUITS[Math.floor(x / 13)] };
}

/** Сапёр: позиции мин частичным Фишером–Йетсом */
export function minePositions(rng, mines) {
  const cells = Array.from({ length: MINES_CELLS }, (_, i) => i);
  for (let i = 0; i < mines; i++) {
    const j = i + rng.int(MINES_CELLS - i);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, mines).sort((a, b) => a - b);
}

/** Ракета: r ∈ [0, 1) из 32 бит, точка = 0.99 / (1 − r), 1% — дому */
export function crashPoint(rng) {
  const r = rng.u32() / 2 ** 32;
  return Math.min(CRASH_MAX, Math.max(1, Math.floor(99 / (1 - r)) / 100));
}

const deckRecord = (deck) => ({ deck: deck.map(cardStr) });

/**
 * Запись исхода по игре. params — то, что выбрал игрок и что влияет на
 * количество случайности (число мин, сколько карт открыто в Выше/Ниже).
 * Игры столов называются `${game}_room` и считаются так же.
 */
export const DERIVE = {
  roulette: (rng) => ({ pocket: rng.int(ROULETTE_ORDER.length) }),
  dice: (rng) => ({ roll: rng.int(10000) }),
  slots: (rng) => ({ stops: [0, 1, 2].map(() => rng.int(SLOT_STRIP.length)) }),
  plinko: (rng) => ({ path: Array.from({ length: PLINKO_ROWS }, () => rng.int(2)) }),
  mines: (rng, p) => ({ bombs: minePositions(rng, p.mines) }),
  hilo: (rng, p) => ({ cards: Array.from({ length: p.cards }, () => cardStr(hiloCard(rng))) }),
  blackjack: (rng) => deckRecord(deck52(rng)),
  ochko: (rng) => deckRecord(deck52(rng)),
  poker: (rng) => deckRecord(deck52(rng)),
  baccarat: (rng) => deckRecord(baccaratShoe(rng)),
  crash: (rng) => ({ point: crashPoint(rng) }),
  roulette_room: (rng) => ({ pocket: rng.int(ROULETTE_ORDER.length) }),
  blackjack_room: (rng) => deckRecord(deck52(rng)),
  ochko_room: (rng) => deckRecord(deck52(rng)),
  poker_room: (rng) => deckRecord(deck52(rng)),
  durak_room: (rng) => deckRecord(deck36(rng)),
};

/** Человеческое описание исхода для экрана проверки */
export function describe(game, rec) {
  const base = game.replace(/_room$/, '');
  if (base === 'roulette') return `Число ${ROULETTE_ORDER[rec.pocket]}`;
  if (base === 'dice') return `Выпало ${(rec.roll / 100).toFixed(2)}`;
  if (base === 'slots') return rec.stops.map(i => SLOT_STRIP[i]).join(' ');
  if (base === 'plinko') return `Лунка ${rec.path.reduce((a, b) => a + b, 0)} (путь ${rec.path.map(x => (x ? '↘' : '↙')).join('')})`;
  if (base === 'mines') return `Мины в клетках ${rec.bombs.map(i => i + 1).join(', ')}`;
  if (base === 'hilo') return `Карты: ${rec.cards.join(' ')}`;
  if (base === 'crash') return `Взрыв на ×${rec.point.toFixed(2)}`;
  if (rec.deck) return `Порядок выдачи: ${[...rec.deck].reverse().slice(0, 16).join(' ')}${rec.deck.length > 16 ? ' …' : ''}`;
  return '';
}

/** Одинаковы ли две записи исхода */
export const sameRecord = (a, b) => JSON.stringify(a) === JSON.stringify(b);
