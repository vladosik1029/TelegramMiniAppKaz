// E2E-тест карточных столов (Blackjack, Очко, Покер): хост (dev-игрок) + гость «dev:3333».
// Запуск: сервер с DEV_MODE=1 и короткими таймингами, затем `node test/cards.js` (из папки server):
//   TABLE_TURN_MS=1500 TABLE_OFFLINE_TURN_MS=700 TABLE_BET_WAIT_MS=1500 \
//   TABLE_RESULT_MS=800 TABLE_POKER_RESULT_MS=800 node src/index.js

import WebSocket from 'ws';

const HOST = process.env.HOST || 'localhost:3000';
const B = `http://${HOST}/api`;
const G = 'dev:3333';
const api = async (path, body, as = '') => {
  const res = await fetch(B + path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + as },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
};

let fail = 0;
const check = (cond, name, extra) => {
  if (cond) console.log('✓', name);
  else { fail = 1; console.log('✗', name, extra ? JSON.stringify(extra).slice(0, 500) : ''); }
};

/** ws-клиент: хранит последнее состояние стола, умеет ждать условие по нему */
function client(token) {
  const ws = new WebSocket(`ws://${HOST}/ws?t=${encodeURIComponent(token)}`);
  const c = { ws, room: null, errors: [], subs: [] };
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'room') c.room = msg.room;
    if (msg.type === 'error') c.errors.push(msg.error);
    for (const s of [...c.subs]) if (s(msg)) c.subs.splice(c.subs.indexOf(s), 1);
  });
  c.open = () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  c.send = (msg) => ws.send(JSON.stringify(msg));
  /** ждём, пока pred(состояние стола) станет true */
  c.until = (pred, ms = 6000) => new Promise((resolve, reject) => {
    if (c.room && pred(c.room)) return resolve(c.room);
    const where = new Error().stack.split('\n').slice(2, 5).join(' ');
    const t = setTimeout(() => reject(new Error(`timeout ${where}; phase=${c.room?.round?.phase}; errors=${c.errors.join(' | ')}`)), ms);
    c.subs.push((msg) => {
      if (msg.type === 'room' && pred(msg.room)) { clearTimeout(t); resolve(msg.room); return true; }
      return false;
    });
  });
  c.error = (ms = 3000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no error')), ms);
    c.subs.push((msg) => { if (msg.type === 'error') { clearTimeout(t); resolve(msg.error); return true; } return false; });
  });
  return c;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const bankOf = (room, id) => room.players.find(p => p.id === id)?.bank;

async function table(game, buyIn) {
  const r = await api('/rooms', { name: `Тест ${game}`, game, isPublic: false, buyIn });
  check(r.status === 200, `${game}: стол создан`, r);
  const id = r.data.room.id;
  check((await api(`/rooms/${id}/join`, {}, G)).status === 200, `${game}: гость сел`);
  const host = client(''); const guest = client(G);
  await host.open(); await guest.open();
  host.send({ op: 'sub', roomId: id }); guest.send({ op: 'sub', roomId: id });
  await host.until(r => r.players.length === 2 && r.players.every(p => p.online));
  await guest.until(r => !!r.round);
  return { id, host, guest, hostId: r.data.room.hostId };
}

/** Играет раздачу Blackjack/Очко: каждый на своём ходу делает action(seat) */
async function playOut(players, action) {
  for (let i = 0; i < 30; i++) {
    const room = players[0].room;
    if (room.round.phase === 'results') return room;
    const p = players.find(c => c.room.round.you.actions.length);
    if (p) { p.send({ op: 'act', ...action(p.room) }); await sleep(120); }
    else await sleep(100);
  }
  return players[0].until(r => r.round.phase === 'results');
}

// ══ Blackjack ══════════════════════════════════════════════════════════════
{
  const { id, host, guest, hostId } = await table('blackjack', 500);

  guest.send({ op: 'ready' });
  check(/Сначала сделай ставку/.test(await guest.error()), 'bj: «Готов» без ставки отклонён');

  host.send({ op: 'bet', amount: 50 });
  guest.send({ op: 'bet', amount: 30 });
  await host.until(r => r.players.every(p => p.bet > 0));
  host.send({ op: 'ready' });
  let room = await host.until(r => r.round.phase === 'betting' && r.players.find(p => p.id === hostId).bank === 450);
  await sleep(200);
  check(host.room.round.phase === 'betting', 'bj: хост готов, гость нет — раздача ждёт');

  guest.send({ op: 'ready' });
  room = await host.until(r => r.round.phase !== 'betting');
  check(room.round.seats.length === 2 && room.round.dealer.cards.length === 2, 'bj: раздача началась на двоих');
  check(room.round.phase === 'results' || room.round.dealer.cards[1].hidden, 'bj: вторая карта крупье закрыта');
  if (room.round.phase === 'playing') {
    const turnClient = room.round.turnId === hostId ? guest : host;
    turnClient.send({ op: 'act', action: 'stand' });
    check(/не твой ход/.test(await turnClient.error()), 'bj: чужой ход отклонён');
  }

  room = await playOut([host, guest], () => ({ action: 'stand' }));
  check(room.round.phase === 'results' && !room.round.dealer.cards.some(c => c.hidden), 'bj: итог раздачи, карты крупье открыты');
  const hs = room.round.seats.find(s => s.id === hostId);
  check(bankOf(room, hostId) === 450 + hs.result.payout, 'bj: выплата хоста зачислена в банк', { bank: bankOf(room, hostId), hs });
  check([0, 50, 100, 125].includes(hs.result.payout), 'bj: выплата хоста кратна ставке', hs.result);

  room = await host.until(r => r.round.phase === 'betting', 4000);
  check(room.players.every(p => p.bet === 0), 'bj: новый раунд — ставки обнулены');

  // таймаут хода: никто не ходит — сервер сам говорит «Хватит»
  host.send({ op: 'bet', amount: 10 }); guest.send({ op: 'bet', amount: 10 });
  await host.until(r => r.players.every(p => p.bet === 10));
  host.send({ op: 'ready' }); guest.send({ op: 'ready' });
  room = await host.until(r => r.round.phase === 'results', 9000);
  check(room.round.seats.every(s => s.status !== 'play'), 'bj: по таймауту руки остановлены, раунд завершён');
  await host.until(r => r.round.phase === 'betting', 4000);

  // гость уходит посреди раздачи — рука доигрывается, выигрыш идёт на баланс
  const gBalBefore = (await api('/init', undefined, G)).data.balance;
  host.send({ op: 'bet', amount: 20 }); guest.send({ op: 'bet', amount: 20 });
  await host.until(r => r.players.every(p => p.bet === 20));
  host.send({ op: 'ready' }); guest.send({ op: 'ready' });
  room = await host.until(r => r.round.phase !== 'betting');
  const gBank = bankOf(room, 3333);
  const settledBeforeLeave = room.round.phase === 'results'; // крупье сразу с блэкджеком
  guest.send({ op: 'leave' });
  room = await host.until(r => r.players.length === 1);
  room = await playOut([host], () => ({ action: 'stand' }));
  const gs = room.round.seats.find(s => s.id === 3333);
  check(settledBeforeLeave || (gs.left && gs.status !== 'play'), 'bj: рука ушедшего гостя остановлена');
  await sleep(200);
  const gBalAfter = (await api('/init', undefined, G)).data.balance;
  check(gBalAfter === gBalBefore + gBank + (settledBeforeLeave ? 0 : gs.result.payout), 'bj: банк + выигрыш ушедшего гостя на балансе', { gBalBefore, gBank, gBalAfter, res: gs.result });
  const hist = (await api('/init', undefined, G)).data.history[0];
  check(hist.game === 'blackjack_room' && hist.bet === 20, 'bj: раздача в истории гостя', hist);

  await api(`/rooms/${id}/leave`, {});
  host.ws.close(); guest.ws.close();
}

// ══ Очко ═══════════════════════════════════════════════════════════════════
{
  const { id, host, guest, hostId } = await table('ochko', 300);
  host.send({ op: 'bet', amount: 40 }); guest.send({ op: 'bet', amount: 40 });
  await host.until(r => r.players.every(p => p.bet === 40));
  host.send({ op: 'ready' }); guest.send({ op: 'ready' });
  await host.until(r => r.round.phase !== 'betting');
  const room = await playOut([host, guest], (r) => ({ action: r.round.seats.find(s => s.id === r.round.turnId).total < 15 ? 'hit' : 'stop' }));
  const hs = room.round.seats.find(s => s.id === hostId);
  check(room.round.phase === 'results' && hs.result, 'очко: раздача сыграна', hs);
  check(bankOf(room, hostId) === 260 + hs.result.payout, 'очко: выплата хоста в банке', { bank: bankOf(room, hostId), hs });
  await api(`/rooms/${id}/leave`, {}); await api(`/rooms/${id}/leave`, {}, G);
  host.ws.close(); guest.ws.close();
}

// ══ Покер ══════════════════════════════════════════════════════════════════
{
  const { id, host, guest, hostId } = await table('poker', 400); // анте 20
  host.send({ op: 'ready' });
  await sleep(200);
  check(host.room.round.phase === 'betting', 'покер: один «Готов» — ждём второго');
  guest.send({ op: 'ready' });
  let room = await host.until(r => r.round.phase === 'bet1');
  check(room.round.pot === 40 && room.round.ante === 20, 'покер: анте в банке раздачи', room.round);
  const mySeat = room.round.seats.find(s => s.id === hostId);
  const theirs = room.round.seats.find(s => s.id !== hostId);
  check(mySeat.cards.every(c => !c.hidden) && theirs.cards.every(c => c.hidden), 'покер: свои карты видны, чужие закрыты');

  // первый рейзит, второй коллирует, оба меняют карты, потом чек-чек
  const byTurn = () => (host.room.round.turnId === hostId ? host : guest);
  let p = byTurn();
  p.send({ op: 'act', action: 'raise' });
  room = await host.until(r => r.round.curBet === 40);
  p = byTurn();
  p.send({ op: 'act', action: 'call' });
  room = await host.until(r => r.round.phase === 'draw');
  check(room.round.pot === 120, 'покер: после рейза и колла в банке 120', room.round);
  byTurn().send({ op: 'act', action: 'draw', discard: [0, 1] });
  await host.until(r => r.round.seats.filter(s => s.drawn).length === 1);
  byTurn().send({ op: 'act', action: 'draw', discard: [] });
  room = await host.until(r => r.round.phase === 'bet2');
  check(room.round.betSize === 80, 'покер: после обмена ставка вдвое больше');
  const firstToAct = host.room.round.turnId;
  byTurn().send({ op: 'act', action: 'check' });
  await host.until(r => r.round.turnId !== firstToAct);
  byTurn().send({ op: 'act', action: 'check' });
  room = await host.until(r => r.round.phase === 'results');
  const total = room.players.reduce((s, x) => s + x.bank, 0);
  check(total === 800, 'покер: фишки не потерялись (сумма банков 800)', room.players);
  check(room.round.seats.every(s => s.cards.every(c => !c.hidden) && s.hand), 'покер: на вскрытии видны обе руки');

  // вторая раздача: рейз — фолд
  await host.until(r => r.round.phase === 'betting', 4000);
  host.send({ op: 'ready' }); guest.send({ op: 'ready' });
  await host.until(r => r.round.phase === 'bet1');
  const raiser = byTurn();
  const raiserId = host.room.round.turnId;
  const before = bankOf(host.room, raiserId) + 20;
  raiser.send({ op: 'act', action: 'raise' });
  await host.until(r => r.round.curBet === 40);
  byTurn().send({ op: 'act', action: 'fold' });
  room = await host.until(r => r.round.phase === 'results');
  check(bankOf(room, raiserId) === before + 20, 'покер: фолд — банк забирает рейзер (+анте соперника)', { before, after: bankOf(room, raiserId) });
  check(room.round.seats.some(s => s.cards.every(c => c.hidden)), 'покер: без вскрытия чужие карты не показываются');

  // таймаут: никто не ходит — чек/чек, обмен без замены, вскрытие
  await host.until(r => r.round.phase === 'betting', 4000);
  host.send({ op: 'ready' }); guest.send({ op: 'ready' });
  room = await host.until(r => r.round.phase === 'results', 15000);
  check(room.round.seats.every(s => !s.folded && s.discards === 0), 'покер: по таймауту — чек и без обмена');

  await api(`/rooms/${id}/leave`, {}); await api(`/rooms/${id}/leave`, {}, G);
  host.ws.close(); guest.ws.close();
}

console.log(fail ? '\n⛔ ЕСТЬ ПРОВАЛЫ' : '\n✅ Карточные столы: все проверки пройдены');
process.exit(fail);
