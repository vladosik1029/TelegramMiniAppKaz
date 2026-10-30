// ─── Дурак подкидной (2–4 игрока) ────────────────────────────────────────────
// Колода 36 карт (6–A), по 6 карт, козырь — нижняя карта колоды (открыта).
// Первым ходит тот, у кого младший козырь. Ход идёт по очереди одним «актором»:
//   • на столе есть непобитая карта → отбивающийся кроет её или берёт («Беру»);
//   • иначе ходит атакующий: кладёт карту (первую — любую, дальше — только
//     достоинства, что уже есть на столе) или говорит «Бито»/«Пас». После него
//     по кругу могут подкинуть остальные (кроме отбивающегося).
//   Подкидывать можно, пока карт атаки меньше, чем было у отбивающегося на
//   начало отбоя (и не больше 6). Если отбивающийся сказал «Беру», остальные
//   ещё могут подкинуть вдогонку, потом он забирает всё.
// После отбоя все добирают до 6 (первым — заходивший, отбивающийся последним).
// Кто остался без карт при пустой колоде — вышел. Последний с картами — дурак.
//
// Деньги: каждый вносит ставку стола (10% бай-ина). Дурак свою теряет, банк
// делится между остальными. Если последние карты ушли одновременно — ничья,
// ставки возвращаются. Ушёл из-за стола посреди партии — проиграл (дурак).
//
// Модуль не знает про таймеры и деньги: всё это передаёт cardtables.js через ctx.

const RANKS = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];
const VAL = Object.fromEntries(RANKS.map((r, i) => [r, i]));
export const MAX_DURAK = 4;

const fail = (code) => { throw new Error(code); };
const same = (a, b) => a && b && a.r === b.r && a.s === b.s;

/** Ставка за партию: 10% бай-ина, минимум 1 */
export const durakStakeOf = (room) => Math.max(1, Math.floor(room.buyIn / 10));

function deck36(shuffle) {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ s, r });
  return shuffle(d);
}

/** Бьёт ли d карту a при козыре trump */
export const beats = (d, a, trump) =>
  (d.s === a.s && VAL[d.r] > VAL[a.r]) || (d.s === trump && a.s !== trump);

const sortHand = (cards, trump) =>
  cards.sort((x, y) => (x.s === trump) - (y.s === trump) || VAL[x.r] - VAL[y.r] || x.s.localeCompare(y.s));

export function durakDeal(room, players, ctx) {
  const r = room.round;
  const stake = durakStakeOf(room);
  r.deck = deck36(ctx.shuffle);
  // нижняя карта колоды — козырь, её берут последней
  r.trumpCard = r.deck[0];
  r.trump = r.trumpCard.s;
  ctx.payAll(room, players, stake);
  r.stake = stake;
  r.seats = players.map(m => ({ id: m.id, name: m.name, hand: [], stake, out: false, place: null, left: false }));
  for (let k = 0; k < 6; k++) for (const s of r.seats) s.hand.push(r.deck.pop());
  for (const s of r.seats) sortHand(s.hand, r.trump);
  r.discard = 0;
  r.finished = 0;

  // первым ходит младший козырь
  let first = 0, low = 99;
  r.seats.forEach((s, i) => {
    for (const c of s.hand) if (c.s === r.trump && VAL[c.r] < low) { low = VAL[c.r]; first = i; }
  });
  r.phase = 'playing';
  startBout(room, first, ctx);
}

const inGame = (s) => !s.out;
function nextIn(r, from, skip = -1) {
  const n = r.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (i !== skip && inGame(r.seats[i])) return i;
  }
  return -1;
}

function startBout(room, attacker, ctx) {
  const r = room.round;
  r.attacker = attacker;
  r.defender = nextIn(r, attacker);
  r.table = [];          // [{ a, d }]
  r.took = false;
  r.limit = Math.min(6, r.seats[r.defender].hand.length);
  // очередь подкидывающих: заходивший, потом остальные по кругу (без отбивающегося)
  r.throwers = [attacker];
  for (let i = nextIn(r, attacker, r.defender); i !== -1 && i !== attacker; i = nextIn(r, i, r.defender)) {
    if (!r.throwers.includes(i)) r.throwers.push(i);
  }
  r.passed = new Set();
  r.thrower = 0;         // чей черёд в очереди подкидывающих
  setActor(room, attacker, ctx);
}

function setActor(room, i, ctx) {
  const r = room.round;
  r.turn = i;
  ctx.scheduleTurn(room, r.seats[i]);
}

const uncovered = (r) => r.table.find(p => !p.d);
const tableRanks = (r) => new Set(r.table.flatMap(p => [p.a.r, p.d?.r].filter(Boolean)));
const canThrowMore = (r) => r.table.length < r.limit && r.seats[r.defender].hand.length > r.table.filter(p => !p.d).length;

/** Какие карты из руки seat можно положить сейчас */
export function playableFor(r, i) {
  const s = r.seats[i];
  if (r.turn !== i || !s) return [];
  if (i === r.defender) {
    const open = uncovered(r);
    if (!open || r.took) return [];
    return s.hand.map((c, k) => (beats(c, open.a, r.trump) ? k : -1)).filter(k => k >= 0);
  }
  if (!canThrowMore(r)) return [];
  if (!r.table.length) return s.hand.map((_, k) => k);
  const ranks = tableRanks(r);
  return s.hand.map((c, k) => (ranks.has(c.r) ? k : -1)).filter(k => k >= 0);
}

/** Что может сделать актор (для кнопок клиента) */
export function durakActions(r) {
  const i = r.turn;
  if (i < 0) return [];
  if (i === r.defender) return r.took ? [] : ['take'];
  return r.table.length ? ['pass'] : [];
}

export function durakAct(room, seat, msg, ctx) {
  const r = room.round;
  const i = r.seats.indexOf(seat);
  const action = String(msg.action || '');

  if (action === 'play') {
    const k = seat.hand.findIndex(c => same(c, msg.card));
    if (k < 0 || !playableFor(r, i).includes(k)) fail('BAD_MOVE');
    const [card] = seat.hand.splice(k, 1);
    if (i === r.defender) uncovered(r).d = card;
    else { r.table.push({ a: card, d: null }); r.passed.clear(); }
    return afterMove(room, ctx);
  }
  if (action === 'take') {
    if (i !== r.defender || r.took || !uncovered(r)) fail('BAD_ACTION');
    r.took = true;
    r.passed.clear();
    return afterMove(room, ctx);
  }
  if (action === 'pass') {
    if (i === r.defender || !r.table.length) fail('BAD_ACTION');
    r.passed.add(i);
    return afterMove(room, ctx);
  }
  fail('BAD_ACTION');
}

/** Кто ходит дальше или чем закончился отбой */
function afterMove(room, ctx) {
  const r = room.round;
  const def = r.seats[r.defender];
  // отбивающийся без карт и всё покрыто — отбился
  if (!r.took && !uncovered(r) && def.hand.length === 0) return endBout(room, ctx);
  if (!r.took && uncovered(r)) return setActor(room, r.defender, ctx);

  // черёд подкидывающих: первый из очереди, кто ещё не сказал «пас» и может подкинуть
  const live = r.throwers.filter(i => inGame(r.seats[i]) && !r.passed.has(i) && r.seats[i].hand.length);
  if (!live.length || !canThrowMore(r)) return endBout(room, ctx);
  // тот, кто только что подкинул, продолжает; иначе следующий по очереди
  const cur = r.throwers.includes(r.turn) && live.includes(r.turn) ? r.turn : live[0];
  return setActor(room, cur, ctx);
}

function endBout(room, ctx) {
  const r = room.round;
  const def = r.seats[r.defender];
  const cards = r.table.flatMap(p => [p.a, p.d].filter(Boolean));
  if (r.took) def.hand.push(...cards);
  else r.discard += cards.length;
  r.table = [];

  // добор: заходивший, остальные подкидывавшие, отбивающийся последним
  for (const i of [...r.throwers, r.defender]) {
    const s = r.seats[i];
    while (s.hand.length < 6 && r.deck.length) s.hand.push(r.deck.pop());
    sortHand(s.hand, r.trump);
  }
  // колода пуста — кто без карт, вышел
  if (!r.deck.length) {
    for (const s of r.seats) if (!s.out && !s.hand.length) { s.out = true; s.place = ++r.finished; }
  }
  const left = r.seats.filter(inGame);
  if (left.length <= 1) return ctx.finish(room, left[0] ?? null);

  // следующим заходит отбившийся; если взял — следующий за ним
  const from = r.took ? r.defender : (inGame(def) ? (r.defender - 1 + r.seats.length) % r.seats.length : r.defender);
  startBout(room, nextIn(r, from), ctx);
}

/** Таймаут: отбивающийся берёт, атакующий пасует или заходит младшей картой */
export function durakAuto(room, ctx) {
  const r = room.round;
  const seat = r.seats[r.turn];
  if (r.turn === r.defender) return durakAct(room, seat, { action: 'take' }, ctx);
  if (r.table.length) return durakAct(room, seat, { action: 'pass' }, ctx);
  return durakAct(room, seat, { action: 'play', card: seat.hand[0] }, ctx);
}

/** Игрок ушёл посреди партии — он и есть дурак, партия заканчивается */
export function durakLeave(room, seat, ctx) {
  seat.left = true;
  return ctx.finish(room, seat);
}

/** Выплаты: дурак теряет ставку, банк делится между остальными; без дурака — ничья */
export function durakPayouts(r, loser) {
  const pot = r.stake * r.seats.length;
  if (!loser) return r.seats.map(s => ({ s, payout: s.stake, label: 'Ничья — ставка возвращена' }));
  const winners = r.seats.filter(s => s !== loser)
    .sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  const share = Math.floor(pot / winners.length);
  const extra = pot - share * winners.length;
  return r.seats.map(s => {
    if (s === loser) return { s, payout: 0, label: s.left ? 'Ушёл из-за стола — проигрыш' : 'Дурак 🤡' };
    const payout = share + (s === winners[0] ? extra : 0);
    return { s, payout, label: s.place === 1 ? 'Вышел первым!' : 'Не дурак' };
  });
}

export function durakView(r, userId) {
  const meIdx = r.seats.findIndex(s => s.id === userId);
  const results = r.phase === 'results';
  return {
    trump: r.trump ?? null,
    trumpCard: r.trumpCard ?? null,
    deck: r.deck?.length ?? 0,
    discard: r.discard ?? 0,
    stake: r.stake ?? 0,
    table: r.table ?? [],
    took: !!r.took,
    attackerId: r.seats[r.attacker]?.id ?? null,
    defenderId: r.seats[r.defender]?.id ?? null,
    limit: r.limit ?? 0,
    hand: meIdx >= 0 ? r.seats[meIdx].hand : [],
    playable: meIdx >= 0 && !results ? playableFor(r, meIdx) : [],
    meIdx,
  };
}
