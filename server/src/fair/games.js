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

/** Лимбо: та же формула, что у Ракеты, но потолок выше */
export const LIMBO_MAX = 1000000;
export function limboPoint(rng) {
  const r = rng.u32() / 2 ** 32;
  return Math.min(LIMBO_MAX, Math.max(1, Math.floor(99 / (1 - r)) / 100));
}

/** Башня: уровни сложности — сколько клеток на этаже и сколько из них мины */
export const TOWER_FLOORS = 8;
export const TOWER_LEVELS = {
  easy: { cells: 4, bombs: 1 },
  medium: { cells: 3, bombs: 1 },
  hard: { cells: 2, bombs: 1 },
  expert: { cells: 3, bombs: 2 },
};
/** Мины на каждом этаже: частичный Фишер–Йетс по клеткам этажа */
export function towerBombs(rng, level) {
  const { cells, bombs } = TOWER_LEVELS[level];
  return Array.from({ length: TOWER_FLOORS }, () => {
    const c = Array.from({ length: cells }, (_, i) => i);
    for (let i = 0; i < bombs; i++) {
      const j = i + rng.int(cells - i);
      [c[i], c[j]] = [c[j], c[i]];
    }
    return c.slice(0, bombs).sort((a, b) => a - b);
  });
}

/** Кено: 10 шаров из 40 */
export const KENO_NUMBERS = 40;
export const KENO_DRAW = 10;
export function kenoDraw(rng) {
  const n = Array.from({ length: KENO_NUMBERS }, (_, i) => i + 1);
  for (let i = 0; i < KENO_DRAW; i++) {
    const j = i + rng.int(KENO_NUMBERS - i);
    [n[i], n[j]] = [n[j], n[i]];
  }
  return n.slice(0, KENO_DRAW); // порядок выпадения сохраняем — так шары и вылетают
}

// ─── Сокровища: 5 барабанов × 3 ряда с фриспинами ───────────────────────────
// Символы: C🍒 L🍋 O🍊 G🍇 B🔔 S⭐ D💎 7 — обычные, W🃏 — вайлд (барабаны 2–4),
// X💰 — скаттер (3+ где угодно запускают бесплатные вращения).
const TREASURE_BASE = { C: 6, L: 6, O: 5, G: 5, B: 4, S: 3, D: 2, 7: 1 };
/** Ровно раскладываем символы по ленте (детерминированно, чтобы клиент и сервер совпадали) */
function spreadStrip(counts) {
  const items = Object.entries(counts);
  const total = items.reduce((t, [, n]) => t + n, 0);
  const acc = items.map(([sym, n]) => ({ sym, n, a: 0 }));
  const out = [];
  for (let i = 0; i < total; i++) {
    let best = null;
    for (const b of acc) { b.a += b.n / total; if (!best || b.a > best.a) best = b; }
    best.a -= 1;
    out.push(best.sym);
  }
  return out;
}
export const TREASURE_STRIPS = [
  spreadStrip({ ...TREASURE_BASE, X: 1 }),
  spreadStrip({ ...TREASURE_BASE, W: 1, X: 1 }),
  spreadStrip({ ...TREASURE_BASE, W: 2, X: 1 }),
  spreadStrip({ ...TREASURE_BASE, W: 1, X: 1 }),
  spreadStrip({ ...TREASURE_BASE, X: 1 }),
];
export const TREASURE_FS = { 3: 8, 4: 12, 5: 20 }; // скаттеров → бесплатных вращений
export const TREASURE_RETRIGGER = 8;
export const TREASURE_MAX_FS = 100;
/** Окно 5×3 по остановкам барабанов: grid[барабан][ряд] */
export const treasureGrid = (stops) => stops.map((p, i) => {
  const s = TREASURE_STRIPS[i];
  return [0, 1, 2].map(r => s[(p + r) % s.length]);
});
export const treasureScatters = (grid) => grid.flat().filter(x => x === 'X').length;
/** Все вращения раунда: основное + бесплатные (их число зависит от скаттеров) */
export function treasureSpins(rng) {
  const stop = () => TREASURE_STRIPS.map(s => rng.int(s.length));
  const spins = [stop()];
  const sc = treasureScatters(treasureGrid(spins[0]));
  let left = sc >= 3 ? TREASURE_FS[Math.min(5, sc)] : 0;
  while (left > 0 && spins.length - 1 < TREASURE_MAX_FS) {
    left--;
    const st = stop();
    spins.push(st);
    if (treasureScatters(treasureGrid(st)) >= 3) left += TREASURE_RETRIGGER;
  }
  return spins;
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
  limbo: (rng) => ({ point: limboPoint(rng) }),
  tower: (rng, p) => ({ bombs: towerBombs(rng, p.level) }),
  keno: (rng) => ({ drawn: kenoDraw(rng) }),
  treasure: (rng) => ({ spins: treasureSpins(rng) }),
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
  if (base === 'limbo') return `Выпало ×${rec.point.toFixed(2)}`;
  if (base === 'tower') return `Мины по этажам (снизу): ${rec.bombs.map(f => f.map(i => i + 1).join('+')).join(' · ')}`;
  if (base === 'keno') return `Шары: ${rec.drawn.join(', ')}`;
  if (base === 'treasure') return `Остановки барабанов: ${rec.spins.map(st => st.join('-')).join(' · ')}${rec.spins.length > 1 ? ` (${rec.spins.length - 1} бесплатных)` : ''}`;
  if (rec.deck) return `Порядок выдачи: ${[...rec.deck].reverse().slice(0, 16).join(' ')}${rec.deck.length > 16 ? ' …' : ''}`;
  return '';
}

/** Одинаковы ли две записи исхода */
export const sameRecord = (a, b) => JSON.stringify(a) === JSON.stringify(b);
