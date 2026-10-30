// Тесты Provably Fair без сервера: node test/fair.js
//   1. лента: детерминизм, эталонный блок HMAC, отбрасывание без перекоса, равномерность;
//   2. каждая игра: исход, сыгранный сервером, пересчитывается проверкой из
//      браузера (WebCrypto, fair/verify.js) и совпадает с тем, что увидел игрок;
//   3. RTP: точный (перебором) для равномерных игр и симуляция «старый
//      Math.random против новой ленты» для карточных — возврат не изменился.

import crypto from 'node:crypto';
import { Rng, blockMessage } from '../src/fair/core.js';
import { rngFor, sha256 } from '../src/fair/node.js';
import {
  DERIVE, ROULETTE_ORDER, SLOT_STRIP, cardStr, crashPoint, sameRecord, deck52,
} from '../src/fair/games.js';
import { deriveRound, verifyRound, hashTimes } from '../src/fair/verify.js';
import * as blackjack from '../src/games/blackjack.js';
import * as ochko from '../src/games/ochko.js';
import * as poker from '../src/games/poker.js';
import * as roulette from '../src/games/roulette.js';
import * as dice from '../src/games/dice.js';
import * as plinko from '../src/games/plinko.js';
import * as baccarat from '../src/games/baccarat.js';
import * as slots from '../src/games/slots.js';
import * as mines from '../src/games/mines.js';
import * as hilo from '../src/games/hilo.js';

let fail = 0;
const check = (cond, name, extra) => {
  if (cond) console.log('✓', name);
  else { fail = 1; console.log('✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};
const seeds = (i) => ({ serverSeed: sha256('test-server-' + i), clientSeed: 'player_' + (i % 7), nonce: i });
const roundOf = (i) => { const s = seeds(i); return { ...s, rng: rngFor(s.serverSeed, s.clientSeed, s.nonce) }; };
const strs = (cards) => cards.map(cardStr);

// ─── 1. лента ────────────────────────────────────────────────────────────────

{
  const s = seeds(1);
  const block0 = crypto.createHmac('sha256', s.serverSeed).update(`${s.clientSeed}:${s.nonce}:0`).digest();
  const rng = rngFor(s.serverSeed, s.clientSeed, s.nonce);
  check(rng.u32() === block0.readUInt32BE(0) && rng.u32() === block0.readUInt32BE(4), 'лента = HMAC-SHA256(server, client:nonce:0), big-endian');
  check(blockMessage('a', 5, 2) === 'a:5:2', 'формат сообщения блока');
  const a = rngFor('x', 'y', 1), b = rngFor('x', 'y', 1), c = rngFor('x', 'y', 2);
  const seqA = Array.from({ length: 100 }, () => a.int(1000));
  check(JSON.stringify(seqA) === JSON.stringify(Array.from({ length: 100 }, () => b.int(1000))), 'одинаковые сиды → одинаковые числа');
  check(JSON.stringify(seqA) !== JSON.stringify(Array.from({ length: 100 }, () => c.int(1000))), 'другой nonce → другие числа');
}

{
  // отбрасывание: при n = 3·2^30 значения ≥ 3·2^30 должны выбрасываться, а не браться по модулю
  const n = 3 * 2 ** 30;
  const words = [0xFFFFFFFF, 0xC0000000, 0x12345678];
  const block = () => { const b = Buffer.alloc(32); words.forEach((w, i) => b.writeUInt32BE(w, i * 4)); return b; };
  const r = new Rng(block);
  check(r.int(n) === 0x12345678, 'числа из «хвоста» 2^32 mod n отбрасываются (нет перекоса по модулю)');
  let threw = false;
  try { new Rng(block).int(0); } catch { threw = true; }
  check(threw, 'int(0) — ошибка, а не NaN');
}

/** χ²-критерий равномерности: true, если статистика не выходит за ~5σ */
function uniform(counts) {
  const k = counts.length;
  const n = counts.reduce((a, b) => a + b, 0);
  const e = n / k;
  const chi = counts.reduce((s, c) => s + (c - e) ** 2 / e, 0);
  return { ok: Math.abs(chi - (k - 1)) < 5 * Math.sqrt(2 * (k - 1)), chi: chi.toFixed(1), df: k - 1 };
}

{
  const rng = rngFor(sha256('uniform'), 'u', 0);
  for (const n of [2, 13, 37, 52, 10000]) {
    const buckets = Math.min(n, 100);
    const counts = new Array(buckets).fill(0);
    for (let i = 0; i < 200_000; i++) counts[Math.floor(rng.int(n) * buckets / n)]++;
    const u = uniform(counts);
    check(u.ok, `int(${n}) равномерно: χ²=${u.chi} при df=${u.df}`);
  }
  // тасовка: все 24 перестановки 4 элементов равновероятны
  const perms = new Map();
  for (let i = 0; i < 120_000; i++) {
    const p = rng.shuffle([0, 1, 2, 3]).join('');
    perms.set(p, (perms.get(p) ?? 0) + 1);
  }
  const u = uniform([...perms.values()]);
  check(perms.size === 24 && u.ok, `Фишер–Йетс: 24 перестановки равновероятны (χ²=${u.chi})`);
  // туз пик равновероятно на любой позиции колоды
  const pos = new Array(52).fill(0);
  for (let i = 0; i < 52_000; i++) pos[deck52(rng).findIndex(c => c.r === 'A' && c.s === '♠')]++;
  const u2 = uniform(pos);
  check(u2.ok, `колода: туз пик равновероятно на 52 местах (χ²=${u2.chi})`);
}

// ─── 2. проверка воспроизводит исход каждой игры ────────────────────────────

/** Сыграть, как routes.js: исход из ленты раунда; вернуть запись и финальный вид */
function playSolo(mod, i, opts, actions = () => null) {
  const round = roundOf(i);
  let res = mod.start(10, opts, round.rng, round);
  let fair = res.fair ?? {};
  const views = [res.view];
  let guard = 50;
  while (!res.finished && guard--) {
    const a = actions(res, views.length);
    res = mod.act(res.state, a);
    views.push(res.view);
    fair = { params: res.fair?.params ?? fair.params, record: res.fair?.record ?? fair.record };
  }
  return { round, res, views, params: fair.params ?? {}, record: fair.record };
}

async function verifySolo(game, played) {
  const { round, params, record } = played;
  const v = await verifyRound({
    game, serverSeed: round.serverSeed, serverSeedHash: sha256(round.serverSeed),
    clientSeed: round.clientSeed, nonce: round.nonce, params, record,
  });
  return v.ok && v.recordOk === true;
}

const N = 60;
const bjActions = (res) => (res.view.stage === 'done' ? 'stand' : res.view.playerTotal < 16 ? 'hit' : 'stand');
const drawOrder = (record) => [...record.deck].reverse();

const SOLO = [
  ['roulette', roulette, () => ({ type: 'red' }), null, (p) => p.res.view.number === ROULETTE_ORDER[p.record.pocket]],
  ['dice', dice, () => ({ dir: 'under', target: 50 }), null, (p) => Math.round(p.res.view.roll * 100) === p.record.roll],
  ['slots', slots, () => null, null, (p) => p.res.view.line.join() === p.record.stops.map(i => SLOT_STRIP[i]).join()],
  ['plinko', plinko, () => ({ risk: 'high' }), null, (p) => p.res.view.path.join() === p.record.path.join()],
  ['mines', mines, (i) => ({ mines: 1 + (i % 24) }), (res, k) => (k > 3 ? 'cashout' : 'open:' + ((k * 7) % 25)),
    (p) => p.res.view.bombs.join() === p.record.bombs.join() && p.record.bombs.length === p.params.mines],
  ['hilo', hilo, () => null, (res, k) => (k > 4 ? 'cashout' : res.view.hi.chance >= res.view.lo.chance ? 'hi' : 'lo'),
    (p) => p.record.cards.length === p.params.cards && strs(p.res.view.cards).join() === p.record.cards.slice(-6).join()
      && strs(p.views[0].cards).join() === p.record.cards[0]],
  ['blackjack', blackjack, () => null, bjActions, (p) => {
    const d = drawOrder(p.record), v = p.res.view;
    const expect = [d[0], d[1], d[2], d[3], ...d.slice(4, 4 + v.player.length - 2)];
    const dealerExtra = d.slice(4 + v.player.length - 2, 4 + v.player.length - 2 + v.dealer.length - 2);
    return strs(v.player).join() === [expect[0], expect[1], ...expect.slice(4)].join()
      && strs(v.dealer).join() === [d[2], d[3], ...dealerExtra].join();
  }],
  ['ochko', ochko, () => null, (res) => (res.view.playerTotal < 16 ? 'hit' : 'stop'), (p) => {
    const d = drawOrder(p.record), v = p.res.view;
    const hits = v.player.length - 2;
    return strs(v.player).join() === [d[0], d[1], ...d.slice(4, 4 + hits)].join()
      && strs(v.dealer).join() === [d[2], d[3], ...d.slice(4 + hits, 4 + hits + v.dealer.length - 2)].join();
  }],
  ['poker', poker, () => null, () => ({ discard: [0, 2] }), (p) => {
    const d = drawOrder(p.record), first = p.views[0];
    const dealtOk = strs(first.player).join() === [0, 2, 4, 6, 8].map(k => d[k]).join();
    const v = p.res.view;
    // игрок меняет карты 0 и 2 — получает 11-ю и 12-ю карты колоды
    return dealtOk && cardStr(v.player[0]) === d[10] && cardStr(v.player[2]) === d[11]
      && strs(v.bot).every(c => d.slice(0, 20).includes(c));
  }],
  ['baccarat', baccarat, (i) => ({ side: ['player', 'banker', 'tie'][i % 3] }), null, (p) => {
    const d = drawOrder(p.record), v = p.res.view;
    let k = 4;
    const third = v.order.slice(4).map(() => d[k++]);
    const pl = [d[0], d[1], ...(v.order[4] === 'player' ? [third[0]] : [])];
    const bk = [d[2], d[3], ...(v.order.slice(4).includes('banker') ? [third[third.length - 1]] : [])];
    return strs(v.player).join() === pl.join() && strs(v.banker).join() === bk.join();
  }],
];

for (const [game, mod, opts, actions, consistent] of SOLO) {
  let verified = 0, matches = 0;
  for (let i = 0; i < N; i++) {
    const p = playSolo(mod, i, opts(i), actions ?? undefined);
    if (await verifySolo(game, p)) verified++;
    if (consistent(p)) matches++;
  }
  check(verified === N, `${game}: проверка из браузера пересчитала ${verified}/${N} исходов`);
  check(matches === N, `${game}: игрок увидел ровно пересчитанный исход ${matches}/${N}`);
}

{
  // испорченный сид/nonce/client seed — проверка ловит подмену
  const p = playSolo(dice, 3, { dir: 'under', target: 50 });
  const base = { game: 'dice', serverSeed: p.round.serverSeed, serverSeedHash: sha256(p.round.serverSeed), clientSeed: p.round.clientSeed, nonce: p.round.nonce, record: p.record };
  const wrongSeed = await verifyRound({ ...base, serverSeed: sha256('other') });
  const wrongNonce = await verifyRound({ ...base, nonce: base.nonce + 1 });
  const wrongRecord = await verifyRound({ ...base, record: { roll: (p.record.roll + 1) % 10000 } });
  check(!wrongSeed.ok && !wrongNonce.ok && !wrongRecord.ok, 'подменённый сид, nonce или исход не проходят проверку');
}

{
  // общие раунды: столы и Ракета — тот же пересчёт по склеенному client seed
  const cs = '11=abc/0123abcd,42=player_seed/';
  for (const game of ['roulette_room', 'blackjack_room', 'ochko_room', 'poker_room', 'durak_room', 'crash']) {
    let ok = 0;
    for (let i = 0; i < 20; i++) {
      const seed = sha256('room-' + game + i);
      const server = DERIVE[game](rngFor(seed, cs, i));
      if (sameRecord(server, await deriveRound({ game, serverSeed: seed, clientSeed: cs, nonce: i }))) ok++;
    }
    check(ok === 20, `${game}: исход общего раунда пересчитывается (${ok}/20)`);
  }
  // цепочка Ракеты: сид раунда j, хэшированный j раз, = публикация
  const h = ['terminal-seed'];
  for (let i = 1; i <= 50; i++) h.push(sha256(h[i - 1]));
  const j = 7, seed = h[50 - j];
  check(await hashTimes(seed, j) === h[50] && sha256(seed) === h[50 - j + 1], 'Ракета: сид раунда связан с цепочкой и с сидом прошлого раунда');
  const point = crashPoint(rngFor(seed, cs, j));
  const v = await verifyRound({ game: 'crash', serverSeed: seed, serverSeedHash: sha256(seed), clientSeed: cs, nonce: j, params: { idx: j, commitment: h[50] }, record: { point } });
  check(v.ok && v.chainOk, 'Ракета: проверка раунда целиком (хэш, цепочка, точка взрыва)');
}

// ─── 3. RTP не изменился ─────────────────────────────────────────────────────

/** Старый генератор: Math.random, как было до Provably Fair */
class OldRng extends Rng {
  constructor() { super(() => { throw new Error('not used'); }); }
  int(n) { return Math.floor(Math.random() * n); }
  u32() { return Math.floor(Math.random() * 2 ** 32); }
}

{
  // точный возврат: при строго равномерных числах он зависит только от таблиц выплат
  const rRed = ROULETTE_ORDER.filter(n => roulette.wins('red', null, n)).length * 2 / 37;
  check(Math.abs(rRed - 36 / 37) < 1e-12, `рулетка: точный возврат ${(rRed * 100).toFixed(2)}% = 36/37`);
  let slotRtp = 0;
  const L = SLOT_STRIP.length;
  for (let a = 0; a < L; a++) for (let b = 0; b < L; b++) for (let c = 0; c < L; c++) {
    slotRtp += slots.evaluate([SLOT_STRIP[a], SLOT_STRIP[b], SLOT_STRIP[c]]).mult;
  }
  slotRtp /= L ** 3;
  console.log(`  слоты: точный возврат перебором всех ${L ** 3} комбинаций = ${(slotRtp * 100).toFixed(2)}%`);
  let diceRtp = 0;
  for (let roll = 0; roll < 10000; roll++) diceRtp += roll < 5000 ? dice.multOf('under', 50) : 0;
  check(Math.abs(diceRtp / 10000 - 0.99) < 1e-9, `кости «меньше 50»: точный возврат ${(diceRtp / 100).toFixed(2)}%`);
  // Ракета: P(точка ≥ m) = 0.99/m — 1% дому для любой цели
  const rng = rngFor(sha256('crash-rtp'), 'c', 0);
  let hits = 0; const n = 200_000;
  for (let i = 0; i < n; i++) if (crashPoint(rng) >= 2) hits++;
  const se = Math.sqrt(0.495 * 0.505 / n);
  check(Math.abs(hits / n - 0.495) < 5 * se, `Ракета: P(×2) = ${(hits / n).toFixed(4)} ≈ 0.495 → возврат ${(hits / n * 200).toFixed(2)}%`);
}

/** Средний возврат и его стандартная ошибка */
function sim(n, round) {
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const m = round(i); s += m; s2 += m * m; }
  const mean = s / n;
  return { mean, se: Math.sqrt(Math.max(0, s2 / n - mean * mean) / n) };
}

function compare(name, n, round) {
  const rng = rngFor(sha256('rtp-' + name), 'rtp', 0);
  const fresh = sim(n, () => round(rng));
  const old = sim(n, () => round(new OldRng()));
  const z = Math.abs(fresh.mean - old.mean) / Math.hypot(fresh.se, old.se);
  check(z < 4.5, `${name}: возврат было ${(old.mean * 100).toFixed(2)}% → стало ${(fresh.mean * 100).toFixed(2)}% (разница ${z.toFixed(1)}σ)`);
}

const playBj = (mod, rng, act) => {
  let r = mod.start(10, null, rng);
  while (!r.finished) r = mod.act(r.state, act(r));
  return r.returnMult;
};
compare('Blackjack', 60_000, (rng) => playBj(blackjack, rng, bjActions));
compare('Очко', 60_000, (rng) => playBj(ochko, rng, (r) => (r.view.playerTotal < 16 ? 'hit' : 'stop')));
compare('Покер', 30_000, (rng) => playBj(poker, rng, () => ({ discard: [3, 4] })));
compare('Баккара (банкир)', 60_000, (rng) => baccarat.start(10, { side: 'banker' }, rng).returnMult);
compare('Слоты', 200_000, (rng) => slots.start(10, null, rng).returnMult);
compare('Плинко (high)', 200_000, (rng) => plinko.start(10, { risk: 'high' }, rng).returnMult);
compare('Сапёр (5 мин, 2 клетки)', 100_000, (rng) => {
  let r = mines.start(10, { mines: 5 }, rng);
  for (const c of [0, 1]) { r = mines.act(r.state, 'open:' + c); if (r.finished) return r.returnMult; }
  return mines.act(r.state, 'cashout').returnMult;
});
compare('Выше/Ниже (2 шага)', 100_000, (rng) => {
  // Выше/Ниже берёт карты из ленты по сидам, а не из rng: имитируем старую игру отдельно
  if (rng instanceof OldRng) {
    const draw = () => ({ r: hilo.RANKS[rng.int(13)], s: '♠' });
    let cur = draw(), mult = 1;
    for (let k = 0; k < 2; k++) {
      const dir = hilo.chance(cur, 'hi') >= hilo.chance(cur, 'lo') ? 'hi' : 'lo';
      const next = draw();
      const i = hilo.RANKS.indexOf(cur.r), j = hilo.RANKS.indexOf(next.r);
      if (dir === 'hi' ? j < i : j > i) return 0;
      mult = Math.min(5000, Math.floor(mult * hilo.stepMult(cur, dir) * 100) / 100);
      cur = next;
    }
    return mult;
  }
  const seed = { serverSeed: sha256(String(rng.int(2 ** 32))), clientSeed: 'h', nonce: 0 };
  let r = hilo.start(10, null, null, seed);
  for (let k = 0; k < 2; k++) {
    r = hilo.act(r.state, r.view.hi.chance >= r.view.lo.chance ? 'hi' : 'lo');
    if (r.finished) return r.returnMult;
  }
  return hilo.act(r.state, 'cashout').returnMult;
});

console.log(fail ? '\nЕСТЬ ОШИБКИ' : '\nВсё проверено');
process.exit(fail);
