// E2E-тест Дурака: 2 и 3 игрока играют ботами по WebSocket до конца партии.
// Запуск: сервер с DEV_MODE=1 и короткими таймингами (как для test/cards.js), затем `node test/durak.js`.

import WebSocket from 'ws';

const HOST = process.env.HOST || 'localhost:3000';
const api = async (path, body, as = '') => {
  const res = await fetch(`http://${HOST}/api${path}`, {
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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function client(token, id) {
  const ws = new WebSocket(`ws://${HOST}/ws?t=${encodeURIComponent(token)}`);
  const c = { ws, id, room: null, errors: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'room') c.room = m.room;
    if (m.type === 'error') c.errors.push(m.error);
  });
  c.open = () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  c.send = (m) => ws.send(JSON.stringify(m));
  return c;
}

/** Ход бота: отбиться/подкинуть первой доступной картой, иначе «Беру»/«Бито» */
function botMove(c) {
  const r = c.room?.round;
  if (!r || r.phase !== 'playing' || r.turnId !== c.id) return false;
  const d = r.durak;
  if (d.playable.length && Math.random() < 0.85) {
    c.send({ op: 'act', action: 'play', card: d.hand[d.playable[0]] });
  } else if (r.you.actions.length) {
    c.send({ op: 'act', action: r.you.actions[0] });
  } else if (d.playable.length) {
    c.send({ op: 'act', action: 'play', card: d.hand[d.playable[0]] });
  } else return false;
  return true;
}

async function game(n) {
  const tokens = ['', 'dev:5551', 'dev:5552', 'dev:5553'].slice(0, n);
  const ids = [900001, 5551, 5552, 5553].slice(0, n);
  const r = await api('/rooms', { name: `Дурак ×${n}`, game: 'durak', isPublic: false, buyIn: 300 }); // ставка 30
  check(r.status === 200, `дурак ×${n}: стол создан`, r);
  const id = r.data.room.id;
  for (const t of tokens.slice(1)) await api(`/rooms/${id}/join`, {}, t);
  const cs = tokens.map((t, i) => client(t, ids[i]));
  for (const c of cs) { await c.open(); c.send({ op: 'sub', roomId: id }); }
  await sleep(400);

  cs[1].send({ op: 'bet', amount: 10 });
  await sleep(200);
  check(cs[1].errors.length > 0, `дурак ×${n}: ставки фишками не нужны`);
  cs[1].errors.length = 0;
  for (const c of cs) c.send({ op: 'ready' });
  await sleep(500);
  let room = cs[0].room;
  check(room.round.phase === 'playing' && room.round.seats.length === n, `дурак ×${n}: партия началась`, room.round.phase);
  check(room.round.durak.hand.length === 6 && room.round.durak.deck === 36 - 6 * n, `дурак ×${n}: по 6 карт, остаток в колоде`, room.round.durak);
  check(room.round.seats.every(s => s.cards.length === 0 && s.count === 6), `дурак ×${n}: чужие карты не видны`);
  check(room.players.reduce((s, p) => s + p.bank, 0) === 300 * n - 30 * n, `дурак ×${n}: ставки списаны в банк партии`);

  // бот играет; второй игрок один раз «засыпает» — за него сходит таймер
  let slept = false, moves = 0;
  for (let i = 0; i < 4000 && cs[0].room.round.phase === 'playing'; i++) {
    let moved = false;
    for (const c of cs) {
      if (c === cs[1] && !slept && c.room.round.turnId === c.id) { slept = true; continue; }
      if (botMove(c)) { moved = true; moves++; }
    }
    await sleep(moved ? 25 : 60);
  }
  room = cs[0].room;
  check(room.round.phase === 'results', `дурак ×${n}: партия доиграна (${moves} ходов)`, room.round.phase);
  const res = room.round.seats.map(s => s.result);
  const total = room.players.reduce((s, p) => s + p.bank, 0);
  check(total === 300 * n, `дурак ×${n}: фишки не потерялись`, { total, res });
  const losers = room.round.seats.filter(s => s.result.payout === 0);
  check(losers.length <= 1, `дурак ×${n}: не больше одного дурака`, res);
  if (losers.length) check(losers[0].count > 0 && losers[0].cards.length === losers[0].count, `дурак ×${n}: карты дурака открыты`);
  check(!cs.some(c => c.errors.some(e => /нельзя/.test(e))), `дурак ×${n}: бот не сделал запрещённых ходов`, cs.map(c => c.errors));

  for (const t of tokens) await api(`/rooms/${id}/leave`, {}, t);
  for (const c of cs) c.ws.close();
}

await game(2);
await game(3);

// уход посреди партии = проигрыш
{
  const r = await api('/rooms', { name: 'Дурак уход', game: 'durak', isPublic: false, buyIn: 300 });
  const id = r.data.room.id;
  await api(`/rooms/${id}/join`, {}, 'dev:5551');
  const a = client('', 900001), b = client('dev:5551', 5551);
  for (const c of [a, b]) { await c.open(); c.send({ op: 'sub', roomId: id }); }
  await sleep(300);
  a.send({ op: 'ready' }); b.send({ op: 'ready' });
  await sleep(400);
  const bal = (await api('/init', undefined, 'dev:5551')).data.balance;
  b.send({ op: 'leave' });
  await sleep(400);
  const room = a.room;
  const me = room.round.seats.find(s => s.id === 900001);
  check(room.round.phase === 'results' && me.result.payout === 60, 'дурак: ушедший проиграл, банк партии у оставшегося', me.result);
  check((await api('/init', undefined, 'dev:5551')).data.balance === bal + 270, 'дурак: ушедшему вернулся банк без ставки');
  await api(`/rooms/${id}/leave`, {});
  a.ws.close(); b.ws.close();
}

console.log(fail ? '\n⛔ ЕСТЬ ПРОВАЛЫ' : '\n✅ Дурак: все проверки пройдены');
process.exit(fail);
