// E2E-тест Provably Fair через API: игрок «dev:5555» играет во все одиночные
// игры, стол рулетки и Ракету, затем меняет сид и проверяет каждый раунд
// из истории тем же кодом, что и браузер (WebCrypto, src/fair/verify.js).
// Запуск: сервер с DEV_MODE=1 и CRASH_BET_MS=1500 CRASH_PAUSE_MS=800, затем `node test/fair-api.js`.

import WebSocket from 'ws';
import { verifyRound, hashTimes } from '../src/fair/verify.js';
import { sha256Hex } from '../src/fair/core.js';

const HOST = process.env.HOST || 'localhost:3000';
const ME = 'dev:5555';

const api = async (path, body, as = ME) => {
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
  else { fail = 1; console.log('✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
};

await api('/init', {});
// баланс тестового игрока — с запасом (dev-игрок 900001 — админ)
const me = (await api('/init', {})).data;
await api('/admin/balance', { userId: me.id, mode: 'add', amount: 100000, comment: 'fair test' }, '');

// ── сиды: client seed задаёт игрок, хэши видны заранее
let r = await api('/fair');
check(r.status === 200 && /^[0-9a-f]{64}$/.test(r.data.serverSeedHash) && /^[0-9a-f]{64}$/.test(r.data.nextServerSeedHash), 'хэши активного и следующего server seed', r.data);
const firstHash = r.data.serverSeedHash;
const nextHash = r.data.nextServerSeedHash;
check((await api('/fair/client-seed', { clientSeed: 'bad seed!' })).status === 400, 'кривой client seed отклоняется');
r = await api('/fair/client-seed', { clientSeed: 'my_lucky-seed' });
check(r.data.clientSeed === 'my_lucky-seed' && r.data.clientSeedByPlayer && r.data.serverSeedHash === firstHash, 'client seed сменился, server seed тот же');
const nonce0 = r.data.nonce;

// ── одиночные игры
const play = async (game, opts, step) => {
  let s = await api(`/games/${game}/start`, { bet: 10, opts });
  if (s.status !== 200) return s;
  const fair = s.data.fair;
  let guard = 30;
  while (!s.data.finished && guard--) s = await api(`/games/${game}/action`, { action: step(s.data) });
  return { ...s, fair };
};
const games = [
  ['roulette', { type: 'num', value: 7 }],
  ['dice', { dir: 'over', target: 30 }],
  ['slots', null],
  ['plinko', { risk: 'medium' }],
  ['baccarat', { side: 'banker' }],
  ['mines', { mines: 3 }, (d) => (d.view.opened.length >= 2 ? 'cashout' : 'open:' + [4, 9, 17][d.view.opened.length])],
  ['hilo', null, (d) => (d.view.steps >= 2 ? 'cashout' : d.view.hi.chance >= d.view.lo.chance ? 'hi' : 'lo')],
  ['blackjack', null, (d) => (d.view.stage === 'done' ? 'stand' : d.view.playerTotal < 15 ? 'hit' : 'stand')],
  ['ochko', null, (d) => (d.view.playerTotal < 15 ? 'hit' : 'stop')],
  ['poker', null, () => ({ discard: [1, 3] })],
];
const played = [];
for (const [game, opts, step] of games) {
  const p = await play(game, opts, step);
  check(p.status === 200 && p.data.finished && p.fair?.serverSeedHash === firstHash, `${game}: сыграно на объявленном сиде`, p.data);
  played.push({ game, nonce: p.fair?.nonce, view: p.data.view });
}
check(played.every((p, i) => p.nonce === nonce0 + i), 'nonce растёт на 1 с каждой игрой', played.map(p => p.nonce));

// до смены сида исход проверить нельзя — сид скрыт
r = await api('/fair/history?limit=20');
check(r.data.rounds.length >= games.length && r.data.rounds.every(x => x.serverSeed === null), 'до смены server seed скрыт');

// незаконченная игра блокирует смену сида (иначе по сиду можно узнать мины)
await api('/games/mines/start', { bet: 10, opts: { mines: 5 } });
check((await api('/fair/rotate', {})).status === 400, 'смена сида при начатой игре запрещена');
await api('/games/mines/action', { action: 'open:0' });
const st = await api('/games/mines/action', { action: 'cashout' });
if (st.status !== 200) await api('/games/mines/start', { bet: 10, opts: { mines: 24 } }).then(() => api('/games/mines/action', { action: 'open:0' }));

// ── стол рулетки: сид спина виден до ставок, после — раскрыт
r = await api('/rooms', { game: 'roulette', buyIn: 500, name: 'fair' });
const room = r.data.room;
check(/^[0-9a-f]{64}$/.test(room.fair?.current ?? ''), 'стол: хэш сида спина виден до ставок', room.fair);
const committed = room.fair.current;
await api(`/rooms/${room.id}/bet`, { type: 'red', amount: 50 });
r = await api(`/rooms/${room.id}/ready`, { entropy: 'deadbeefcafe0123' });
const last = r.data.room.fair.last;
check(last && last.hash === committed && await sha256Hex(last.seed) === committed, 'стол: раскрыт тот самый сид, хэш которого был виден');
check(last?.clientSeed === `${me.id}=my_lucky-seed/deadbeefcafe0123`, 'стол: client seed = сид игрока + свежее число из «Готов»', last);
const spinNumber = r.data.room.lastSpin.number;
await api(`/rooms/${room.id}/leave`, {});

// ── Ракета: ставка с entropy, ждём взрыв
const ws = new WebSocket(`ws://${HOST}/ws?t=${encodeURIComponent(ME)}`);
let crash = null;
const waiters = [];
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type !== 'crash') return;
  crash = m.crash;
  for (const w of [...waiters]) if (w.pred(crash)) { waiters.splice(waiters.indexOf(w), 1); w.res(crash); }
});
const until = (pred, ms = 20000) => new Promise((res, rej) => {
  if (crash && pred(crash)) return res(crash);
  waiters.push({ pred, res });
  setTimeout(() => rej(new Error('timeout ' + crash?.phase)), ms);
});
await new Promise((res) => ws.once('open', res));
ws.send(JSON.stringify({ op: 'crash_sub' }));
await until(c => c.phase === 'betting' && c.leftMs > 400);
const crashHash = crash.fair.hash;
const crashIdx = crash.fair.idx;
ws.send(JSON.stringify({ op: 'crash_bet', amount: 10, entropy: '0badc0ffee11' }));
const done = await until(c => c.phase === 'crashed' && c.fair.last?.idx === crashIdx);
check(done.fair.last.hash === crashHash && await sha256Hex(done.fair.last.seed) === crashHash, 'Ракета: раскрыт сид, хэш которого был виден до ставок');
check(done.fair.last.point === done.point, 'Ракета: точка взрыва совпадает с раскрытой');
check(await hashTimes(done.fair.last.seed, crashIdx) === done.fair.commitment, 'Ракета: сид лежит в опубликованной цепочке хэшей');
ws.close();

// ── смена сида: старый раскрывается, следующий становится активным
r = await api('/fair/rotate', { clientSeed: 'second_seed' });
check(r.status === 200 && r.data.revealed.hash === firstHash && r.data.state.serverSeedHash === nextHash && r.data.state.nonce === 0, 'смена сида: раскрыт старый, активным стал заранее объявленный', r.data);

// ── проверяем всю историю кодом браузера
r = await api('/fair/history?limit=40');
const rounds = r.data.rounds;
let verified = 0;
for (const round of rounds) {
  if (!round.done) continue;
  check(round.serverSeed, `${round.game} #${round.nonce}: сид раскрыт`);
  const v = await verifyRound(round);
  if (v.ok && v.recordOk) verified++;
  else check(false, `${round.game} #${round.nonce}: проверка`, { v, round });
}
const doneCount = rounds.filter(x => x.done).length;
check(verified === doneCount && doneCount >= games.length + 2, `история: ${verified}/${doneCount} раундов проверены браузерным верификатором`);
const roomRound = rounds.find(x => x.game === 'roulette_room');
check(roomRound && (await verifyRound(roomRound)).text === `Число ${spinNumber}`, 'стол: пересчитанное число = выпавшее');
const crashRound = rounds.find(x => x.game === 'crash');
check(crashRound && (await verifyRound(crashRound)).chainOk, 'Ракета в истории: цепочка проверена');
for (const p of played) {
  const round = rounds.find(x => x.game === p.game && x.nonce === p.nonce);
  const v = round && await verifyRound(round);
  let same = !!v?.ok;
  if (p.game === 'roulette') same &&= v.text === `Число ${p.view.number}`;
  if (p.game === 'dice') same &&= v.text === `Выпало ${p.view.roll.toFixed(2)}`;
  if (p.game === 'mines') same &&= v.record.bombs.join() === p.view.bombs.join();
  check(same, `${p.game}: исход в игре = пересчитанный по раскрытому сиду`);
}

// публичная лента Ракеты
r = await api('/fair/crash?limit=5');
check(r.data.rounds.length > 0 && (await verifyRound(r.data.rounds[0])).ok, 'Ракета: публичная история раундов проверяется');

console.log(fail ? '\nЕСТЬ ОШИБКИ' : '\nВсё проверено');
process.exit(fail);
