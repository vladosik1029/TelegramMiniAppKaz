// E2E-тест Ракеты (краш): dev-игрок + «dev:4444» по WebSocket.
// Запуск: сервер с DEV_MODE=1 и CRASH_BET_MS=1500 CRASH_PAUSE_MS=800, затем `node test/crash.js`.

import WebSocket from 'ws';

const HOST = process.env.HOST || 'localhost:3000';
const G = 'dev:4444';
const balance = async (as = '') =>
  (await (await fetch(`http://${HOST}/api/init`, { headers: { Authorization: 'tma ' + as } })).json()).balance;

let fail = 0;
const check = (cond, name, extra) => {
  if (cond) console.log('✓', name);
  else { fail = 1; console.log('✗', name, extra ? JSON.stringify(extra).slice(0, 400) : ''); }
};

function client(token) {
  const ws = new WebSocket(`ws://${HOST}/ws?t=${encodeURIComponent(token)}`);
  const c = { ws, s: null, subs: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'crash') c.s = m.crash;
    for (const f of [...c.subs]) if (f(m)) c.subs.splice(c.subs.indexOf(f), 1);
  });
  c.open = () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.until = (pred, ms = 8000) => new Promise((resolve, reject) => {
    if (c.s && pred(c.s)) return resolve(c.s);
    const t = setTimeout(() => reject(new Error('timeout, phase=' + c.s?.phase)), ms);
    c.subs.push((m) => { if (m.type === 'crash' && pred(m.crash)) { clearTimeout(t); resolve(m.crash); return true; } return false; });
  });
  c.error = (ms = 3000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no error')), ms);
    c.subs.push((m) => { if (m.type === 'error') { clearTimeout(t); resolve(m.error); return true; } return false; });
  });
  return c;
}

const a = client(''); const b = client(G);
await a.open(); await b.open();
a.send({ op: 'crash_sub' }); b.send({ op: 'crash_sub' });

// ждём начало нового раунда ставок
let s = await a.until(x => x.phase === 'betting' && x.leftMs > 700, 120000);
const round = s.round;
const aBal = await balance(), bBal = await balance(G);

a.send({ op: 'crash_bet', amount: 100 });
b.send({ op: 'crash_bet', amount: 40, auto: 1.01 });
s = await a.until(x => x.bets.length === 2);
check(s.you?.amount === 100 && s.bets.some(x => x.id === 4444), 'обе ставки приняты');
check(await balance() === aBal - 100, 'ставка списана с баланса');

a.send({ op: 'crash_bet', amount: 10 });
check(/уже поставил/.test(await a.error()), 'вторая ставка в раунде отклонена');

// отмена и повторная ставка
a.send({ op: 'crash_cancel' });
s = await a.until(x => !x.you);
check(await balance() === aBal, 'отмена вернула ставку');
a.send({ op: 'crash_bet', amount: 100 });
await a.until(x => x.you?.amount === 100);

s = await a.until(x => x.phase !== 'betting' && x.round === round, 5000);
check(s.point === null || s.phase === 'crashed', 'точка взрыва не видна до взрыва', s);

// новые ставки во время полёта закрыты
if (s.phase === 'flying') {
  const c3 = client('dev:4545'); await c3.open();
  c3.send({ op: 'crash_bet', amount: 5 });
  check(/закрыты/.test(await c3.error()), 'во время полёта ставки закрыты');
  c3.ws.close();
  a.send({ op: 'crash_cashout' });
}

s = await a.until(x => x.phase === 'crashed' && x.round === round, 120000);
const you = s.you;
const bBet = s.bets.find(x => x.id === 4444);
console.log('  точка взрыва', s.point, '· забрал', you.cashedAt, '· авто гостя', bBet.cashedAt);
if (you.cashedAt != null) {
  check(you.cashedAt <= s.point && you.payout === Math.floor(100 * you.cashedAt), 'выплата = ставка × множитель', you);
  check(await balance() === aBal - 100 + you.payout, 'выплата зачислена на баланс');
} else {
  check(s.point < 1.1, 'не успел забрать — значит взорвалось почти сразу', s.point);
  check(await balance() === aBal - 100, 'проигрыш: ставка не вернулась');
}
if (s.point >= 1.01) check(bBet.cashedAt === 1.01 && await balance(G) === bBal - 40 + 40, 'автозабор на ×1.01', bBet);
else check(bBet.cashedAt == null && await balance(G) === bBal - 40, 'взрыв на ×1.00 — автозабор не успел', bBet);

s = await a.until(x => x.phase === 'betting' && x.round === round + 1, 5000);
check(!s.you && s.bets.length === 0 && s.recent[0] > 0, 'новый раунд, взрыв в истории');

a.ws.close(); b.ws.close();
console.log(fail ? '\n⛔ ЕСТЬ ПРОВАЛЫ' : '\n✅ Ракета: все проверки пройдены');
process.exit(fail);
