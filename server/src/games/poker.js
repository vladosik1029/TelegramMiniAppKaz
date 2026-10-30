// ─── Пятикарточный дро-покер ─────────────────────────────────────────────────
// Игрок и крупье-бот получают по 5 карт. Игрок выбирает карты для обмена
// (от 0 до 5), бот тоже сбрасывает слабые карты. Побеждает лучшая комбинация.
//
// Выплата (множитель возврата при ПОБЕДЕ, ставка возвращается внутри):
//   пара/старшая  2×, две пары 3×, сет 4×, стрит 5×, флеш 6×,
//   фулл-хаус 9×, каре 25×, стрит-флеш 50×. Ничья — возврат 1×.

import { freshDeck, draw } from '../cards.js';

const VAL = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

// категория руки: чем больше — тем старше
const CAT_NAMES = {
  8: 'Стрит-флеш', 7: 'Каре', 6: 'Фулл-хаус', 5: 'Флеш', 4: 'Стрит',
  3: 'Сет (тройка)', 2: 'Две пары', 1: 'Пара', 0: 'Старшая карта',
};

export { CAT_NAMES };

const evaluate = (cards) => {
  const vals = cards.map(c => VAL[c.r]).sort((a, b) => b - a);
  const suits = cards.map(c => c.s);
  const flush = suits.every(s => s === suits[0]);

  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([v, n]) => ({ v: Number(v), n }))
    .sort((a, b) => b.n - a.n || b.v - a.v);

  // стрит (учитываем колесо A-2-3-4-5)
  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[1] - uniq[4] === 3) straightHigh = 5;
  }

  let cat, tiebreak;
  if (flush && straightHigh) { cat = 8; tiebreak = [straightHigh]; }
  else if (groups[0].n === 4) { cat = 7; tiebreak = [groups[0].v, groups[1].v]; }
  else if (groups[0].n === 3 && groups[1]?.n === 2) { cat = 6; tiebreak = [groups[0].v, groups[1].v]; }
  else if (flush) { cat = 5; tiebreak = vals; }
  else if (straightHigh) { cat = 4; tiebreak = [straightHigh]; }
  else if (groups[0].n === 3) { cat = 3; tiebreak = [groups[0].v, ...groups.slice(1).map(g => g.v)]; }
  else if (groups[0].n === 2 && groups[1]?.n === 2) {
    const pairs = groups.filter(g => g.n === 2).map(g => g.v).sort((a, b) => b - a);
    const kicker = groups.find(g => g.n === 1)?.v;
    cat = 2; tiebreak = [...pairs, kicker];
  }
  else if (groups[0].n === 2) {
    cat = 1; tiebreak = [groups[0].v, ...groups.filter(g => g.n === 1).map(g => g.v)];
  }
  else { cat = 0; tiebreak = vals; }

  return { cat, tiebreak, name: CAT_NAMES[cat] };
};

const cmpVec = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
};

// выплата по категории при победе
const PAY = { 0: 2, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 9, 7: 25, 8: 50 };

export function start() {
  const deck = freshDeck();
  const player = []; const bot = [];
  for (let i = 0; i < 5; i++) { player.push(draw(deck)); bot.push(draw(deck)); }
  const state = { deck, player, bot, stage: 'draw' };
  return { state, view: view(state), finished: false };
}

export function act(state, action = {}) {
  if (state.stage !== 'draw') throw new Error('BAD_ACTION');

  const discard = (action.discard || [])
    .filter(i => Number.isInteger(i) && i >= 0 && i < 5);
  const unique = [...new Set(discard)];

  // замена карт игрока
  const playerNew = state.player.map((c, i) => unique.includes(i) ? draw(state.deck) : c);
  state.player = playerNew;

  // логика бота: сохраняет пары и сильные старшие карты, меняет остальное
  const botDiscard = botStrategy(state.bot);
  const botNew = state.bot.map((c, i) => botDiscard.includes(i) ? draw(state.deck) : c);
  state.bot = botNew;

  const pHand = evaluate(state.player);
  const bHand = evaluate(state.bot);

  let mult, outcome;
  if (pHand.cat > bHand.cat || (pHand.cat === bHand.cat && cmpVec(pHand.tiebreak, bHand.tiebreak) > 0)) {
    mult = PAY[pHand.cat]; outcome = 'win';
  } else if (pHand.cat === bHand.cat && cmpVec(pHand.tiebreak, bHand.tiebreak) === 0) {
    mult = 1; outcome = 'push';
  } else {
    mult = 0; outcome = 'lose';
  }

  state.stage = 'done';
  state.result = { player: pHand, bot: bHand };
  return {
    finished: true,
    outcome,
    returnMult: mult,
    message: outcome === 'win' && mult >= 25 ? 'premium' : pHand.name,
    state,
    view: view(state, true),
  };
}

/** Стратегия бота: держит комбинации, при слабой руке — 2 старшие карты */
function botStrategy(cards) {
  const counts = {};
  for (const c of cards) counts[VAL[c.r]] = (counts[VAL[c.r]] || 0) + 1;
  const keep = new Set(
    cards.map((c, i) => counts[VAL[c.r]] >= 2 ? i : -1).filter(i => i >= 0)
  );
  if (keep.size === 0) {
    // слабая рука: удерживаем пару самых старших карт
    const order = cards.map((c, i) => ({ i, v: VAL[c.r] })).sort((a, b) => b.v - a.v);
    keep.add(order[0].i);
    keep.add(order[1].i);
  }
  return cards.map((_, i) => keep.has(i) ? -1 : i).filter(i => i >= 0);
}

export function view(state, reveal = false) {
  const showBot = reveal || state.stage === 'done';
  return {
    player: state.player,
    bot: showBot ? state.bot : state.bot.map(() => ({ hidden: true })),
    hiddenBotCount: state.bot.length,
    stage: state.stage,
    playerHand: state.result?.player?.name ?? null,
    botHand: state.result?.bot?.name ?? null,
  };
}
