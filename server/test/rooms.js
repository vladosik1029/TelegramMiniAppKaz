// E2E-тест столов: хост (dev-игрок через REST) + гость «dev:2222» по WebSocket.
// Запуск: сервер с DEV_MODE=1 на :3000, затем `node test/rooms.js` (из папки server)

import WebSocket from 'ws';

const HOST = process.env.HOST || 'localhost:3000';
const B = `http://${HOST}/api`;
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
  else { fail = 1; console.log('✗', name, extra ? JSON.stringify(extra).slice(0, 400) : ''); }
};

/** ws-клиент с очередью входящих сообщений и ожиданием по условию */
function client(token) {
  const ws = new WebSocket(`ws://${HOST}/ws?t=${encodeURIComponent(token)}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const w = waiters.find(x => x.pred(msg));
    if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); } else inbox.push(msg);
  });
  let rid = 0;
  return {
    ws,
    open: () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); ws.once('unexpected-response', (_, r) => rej(new Error('HTTP ' + r.statusCode))); }),
    wait: (pred, ms = 4000) => new Promise((resolve, reject) => {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return resolve(hit); }
      const w = { pred, resolve: (m) => { clearTimeout(t); resolve(m); } };
      waiters.push(w);
      const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout; inbox=' + JSON.stringify(inbox.map(x => x.type + ':' + (x.event || x.error || x.rid))))); }, ms);
    }),
    send: (msg) => { const r = ++rid; ws.send(JSON.stringify({ ...msg, rid: r })); return r; },
    drain: () => { inbox.length = 0; },
  };
}

// ── неавторизованный ws отклоняется
try {
  const bad = client('garbage'); await bad.open();
  check(false, 'ws без валидного initData должен быть отклонён');
} catch (e) { check(/401/.test(e.message), 'ws без валидного initData → 401', e.message); }

// ── хост создаёт приватный стол
const bal0 = (await api('/init')).data.balance;
let r = await api('/rooms', { name: 'Тестовый стол', game: 'roulette', isPublic: false, buyIn: 200 });
check(r.status === 200 && r.data.room.you.isHost && r.data.room.you.roomBalance === 200, 'создание стола', r);
check(r.data.balance === bal0 - 200, 'бай-ин списан с основного баланса', r.data);
const roomId = r.data.room.id;
check(r.data.room.invite.link.endsWith(`startapp=room_${roomId}`), 'ссылка-приглашение', r.data.room.invite);
check((await api('/rooms', { game: 'poker', buyIn: 100 })).status === 400, 'покер для столов — «скоро»');
check((await api('/rooms', { game: 'roulette', buyIn: 1 })).status === 400, 'бай-ин ниже минимума отклонён');

// приватный стол не светится в публичном списке у чужих, но виден владельцу
r = await api('/rooms');
check(r.data.rooms.some(x => x.id === roomId && x.mine), 'свой приватный стол в списке');

// ── хост и гость подключаются по ws
const host = client('');
const guest = client('dev:2222');
await host.open(); await guest.open();
host.send({ op: 'sub', roomId });
let m = await host.wait(x => x.type === 'room');
check(m.room.players.length === 1, 'хост подписан на стол');

guest.send({ op: 'sub', roomId });
m = await guest.wait(x => x.type === 'error');
check(/не сидишь/.test(m.error), 'гость без входа не может подписаться', m);

const G = 'dev:2222';
r = await api(`/rooms/${roomId}/preview`, undefined, G);
check(r.status === 200 && r.data.preview.buyIn === 200 && !r.data.preview.inRoom && r.data.preview.players.length === 1, 'гость видит превью стола', r);

const gBal0 = (await api('/init', undefined, G)).data.balance;
r = await api(`/rooms/${roomId}/join`, {}, G);
check(r.status === 200 && r.data.room.you.roomBalance === 200 && r.data.balance === gBal0 - 200, 'гость вошёл, бай-ин списан', r);
m = await host.wait(x => x.type === 'room' && x.event === 'join');
check(m.room.players.length === 2, 'хост получил рассылку о входе гостя');

guest.send({ op: 'sub', roomId });
m = await guest.wait(x => x.type === 'room' && x.event === 'sub');
check(m.room.you.inRoom && !m.room.you.isHost, 'гость подписан');

// ── ставки
guest.send({ op: 'spin' });
m = await guest.wait(x => x.type === 'error');
check(/создатель/.test(m.error), 'гость не может крутить', m);

host.send({ op: 'spin' });
m = await host.wait(x => x.type === 'error');
check(/никто не поставил/.test(m.error), 'спин без ставок отклонён', m);

guest.send({ op: 'bet', type: 'red', amount: 500 });
m = await guest.wait(x => x.type === 'error');
check(/не хватает/.test(m.error), 'ставка больше банка отклонена', m);

host.drain(); guest.drain();
guest.send({ op: 'bet', type: 'red', amount: 30 });
guest.send({ op: 'bet', type: 'red', amount: 20 });   // сольётся с первой
guest.send({ op: 'bet', type: 'num', value: 17, amount: 10 });
host.send({ op: 'bet', type: 'black', amount: 40 });
for (let i = 0; i < 3; i++) await guest.wait(x => x.type === 'ok');
await host.wait(x => x.type === 'ok');
r = await api(`/rooms/${roomId}`);
const gp = r.data.room.players.find(p => p.id === 2222);
check(gp.bet === 60 && gp.bank === 140, 'ставки гостя списаны из банка стола', gp);
check(r.data.room.bets.filter(b => b.userId === 2222).length === 2, 'одинаковые позиции сложились');

// снять и поставить заново
guest.send({ op: 'clear' }); await guest.wait(x => x.type === 'ok');
guest.send({ op: 'bet', type: 'red', amount: 50 }); await guest.wait(x => x.type === 'ok');

// ── спин: один исход на всех
host.drain(); guest.drain();
host.send({ op: 'spin' });
const hs = await host.wait(x => x.type === 'room' && x.event === 'spin');
const gs = await guest.wait(x => x.type === 'room' && x.event === 'spin');
const spin = hs.room.lastSpin;
check(spin && gs.room.lastSpin.number === spin.number && gs.room.lastSpin.seq === spin.seq, 'оба получили один и тот же исход: ' + spin.number);
check(hs.room.status === 'spinning' && hs.room.bets.length === 0, 'стол в статусе spinning, ставки обнулены');
const red = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const gExpect = spin.number !== 0 && red.has(spin.number) ? 100 : 0;
const hExpect = spin.number !== 0 && !red.has(spin.number) ? 80 : 0;
const gRes = spin.results['2222'], hRes = spin.results[String(hs.room.hostId)];
check(gRes.payout === gExpect && gRes.net === gExpect - 50, 'выплата гостя верна', gRes);
check(hRes.payout === hExpect, 'выплата хоста верна', hRes);
check(gs.room.you.roomBalance === 150 + gExpect, 'банк гостя после спина', gs.room.you);

guest.send({ op: 'bet', type: 'odd', amount: 5 });
m = await guest.wait(x => x.type === 'error');
check(/крутится/.test(m.error), 'во время вращения ставки закрыты', m);

m = await host.wait(x => x.type === 'room' && x.event === 'open', 7000);
check(m.room.status === 'open', 'после анимации стол снова открыт');

// ── гость ставит и выходит: несыгранная ставка возвращается, банк — на баланс
guest.send({ op: 'bet', type: 'odd', amount: 5 }); await guest.wait(x => x.type === 'ok');
const gBank = gs.room.you.roomBalance;
guest.send({ op: 'leave' });
m = await guest.wait(x => x.type === 'left');
check(m.cashout === gBank && m.balance === gBal0 - 200 + gBank, 'кэшаут гостя = банк + несыгранная ставка', m);
m = await host.wait(x => x.type === 'room' && x.event === 'leave');
check(m.room.players.length === 1, 'хост видит уход гостя');

// ── история
const h = (await api('/init', undefined, G)).data.history[0];
check(h.game === 'roulette_room' && h.bet === 50, 'спин записан в историю гостя', h);

// ── хост выходит последним — стол закрывается
const hostBal = (await api('/init')).data.balance;
const hostBank = m.room.you.roomBalance;
r = await api(`/rooms/${roomId}/leave`, {});
check(r.status === 200 && r.data.balance === hostBal + hostBank, 'кэшаут хоста', r);
check((await api(`/rooms/${roomId}/preview`)).status === 404, 'пустой стол закрыт');

host.ws.close(); guest.ws.close();
console.log(fail ? '\n❌ Есть ошибки' : '\n✅ Столы: все проверки пройдены');
process.exit(fail);
