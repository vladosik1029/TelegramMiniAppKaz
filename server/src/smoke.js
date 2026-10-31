// Смоук-тест игровой логики: запускает много раундов, проверяет инварианты
// node src/smoke.js
// npm install не нужен (нет импортов express)

import * as bj from './games/blackjack.js';
import * as ochko from './games/ochko.js';
import * as poker from './games/poker.js';
import * as dice from './games/dice.js';
import * as plinko from './games/plinko.js';
import * as baccarat from './games/baccarat.js';
import * as slots from './games/slots.js';
import * as mines from './games/mines.js';
import * as hilo from './games/hilo.js';
import * as limbo from './games/limbo.js';
import * as tower from './games/tower.js';
import * as keno from './games/keno.js';
import * as treasure from './games/treasure.js';

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } };

let wins = 0, losses = 0, pushes = 0;
for (let i = 0; i < 4000; i++) {
  const bet = 10;
  const s = bj.start();
  assert(s.finished === false, 'bj start finished=false');
  // стратегия: добираем до 17; авто-stand если у игрока сразу BJ
  let res;
  const total = () => bj.view({ ...s.state }).playerTotal;
  let st = s.state;
  if (st.stage === 'done') res = bj.act(st, 'stand');
  else {
    while (total() < 17) {
      const a = bj.act(st, 'hit');
      if (a.finished) { res = a; break; }
      st = a.state;
    }
    if (!res) res = bj.act(st, 'stand');
  }
  assert(['win', 'lose', 'push'].includes(res.outcome), 'bj outcome ok: ' + res.outcome);
  assert(Number.isFinite(res.returnMult) && res.returnMult >= 0 && res.returnMult <= 5, 'bj mult ok: ' + res.returnMult);
  assert(res.view.dealer.length >= 2 && !res.view.dealer.some(c => c.hidden), 'bj final reveal');
  wins += res.returnMult > 1; losses += res.returnMult === 0; pushes += res.returnMult === 1;
}
console.log(`Blackjack: win=${wins} push=${pushes} lose=${losses} из 4000`);

// дабл
{
  let doubled = 0;
  for (let i = 0; i < 2000; i++) {
    const s = bj.start();
    if (s.state.stage === 'done') continue;
    const first = { ...s.state.player.map(c => c.r) };
    try { s.state.deck = Array.from({ length: 52 }, () => ({ s: '♠', r: '2' })); } catch {}
    const res = bj.act(s.state, 'double');
    if (res.state.betUnits === 2 && res.finished) doubled++;
    assert(res.returnMult % 2 === 0 || !res.finished, 'double mult even');
  }
  console.log(`Blackjack doubles tested: ${doubled} завершённых`);
}

wins = 0; losses = 0; pushes = 0; let pans = 0, ochkoS = 0;
for (let i = 0; i < 4000; i++) {
  const s = ochko.start();
  let res;
  if (s.finished) {
    res = s;
    if (res.message === 'pan_pan') pans++;
    if (res.message === 'ochko') ochkoS++;
  } else {
    // стратегия: беру до 16
    let st = s.state;
    while (ochko.view(st).playerTotal < 16) {
      const a = ochko.act(st, 'hit');
      if (a.finished) { res = a; break; }
      st = a.state;
    }
    if (!res) res = ochko.act(st, 'stop');
  }
  assert(['win', 'lose', 'push'].includes(res.outcome), 'ochko outcome: ' + res.outcome);
  assert(Number.isFinite(res.returnMult) && res.returnMult >= 0 && res.returnMult <= 3, 'ochko mult: ' + res.returnMult);
  if (res.returnMult === 3) assert(res.message === 'pan_pan', 'mult3 = пан-пан');
  wins += res.returnMult > 1; losses += res.returnMult === 0; pushes += res.returnMult === 1;
}
console.log(`Очко: win=${wins} push=${pushes} lose=${losses} | пан-пан=${pans} очко=${ochkoS} из 4000`);

let cat = {};
let pWin = 0, bWin = 0, tied = 0, payout = 0, stake = 0;
const VALP = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const saneStrategy = (cards) => {
  // игрок держит пары+, иначе две старшие карты (та же стратегия, что у бота)
  const counts = {};
  for (const c of cards) counts[VALP[c.r]] = (counts[VALP[c.r]] || 0) + 1;
  const idx = (i) => counts[VALP[cards[i].r]] >= 2 ? i : -1;
  const disc = cards.map((_, i) => idx(i) >= 0 ? -1 : i).filter(i => i >= 0);
  if (!cards.some((c, i) => idx(i) >= 0)) {
    const order = cards.map((c, i) => ({ i, v: VALP[c.r] })).sort((a, b) => b.v - a.v);
    disc.length = 0;
    cards.forEach((_, i) => { if (i !== order[0].i && i !== order[1].i) disc.push(i); });
  }
  return disc;
};
for (let i = 0; i < 3000; i++) {
  const s = poker.start();
  assert(s.finished === false, 'poker start');
  const discard = saneStrategy(s.state.player);
  const res = poker.act(s.state, { discard });
  assert(res.finished, 'poker finished');
  assert(poker.view(res.state).bot.every(c => !c.hidden), 'bot reveal');
  cat[res.state.result.player.cat] = (cat[res.state.result.player.cat] || 0) + 1;
  payout += res.returnMult; stake += 1;
  if (res.outcome === 'win') pWin++;
  else if (res.outcome === 'lose') bWin++;
  else tied++;
}
console.log(`\nПокер (разумная стратегия): игрок ${pWin} / бот ${bWin} / ничья ${tied}; средний возврат = ${(payout / stake).toFixed(3)}`);
console.log('Категории рук игрока:', cat);

// ── новые игры: инварианты и средний возврат ────────────────────────────────
const rtp = (name, n, round) => {
  let paid = 0;
  for (let i = 0; i < n; i++) {
    const m = round();
    assert(Number.isFinite(m) && m >= 0, `${name} mult ok: ${m}`);
    paid += m;
  }
  console.log(`${name}: средний возврат = ${(paid / n).toFixed(3)}`);
};

rtp('Кости (меньше 50)', 40000, () => dice.start(10, { dir: 'under', target: 50 }).returnMult);
rtp('Кости (больше 90)', 40000, () => dice.start(10, { dir: 'over', target: 90 }).returnMult);
let badDice = 0;
for (const o of [null, {}, { dir: 'under', target: 1 }, { dir: 'over', target: 99 }, { dir: 'x', target: 50 }]) {
  try { dice.start(10, o); } catch { badDice++; }
}
assert(badDice === 5, 'dice отклоняет плохие opts');

rtp('Слоты', 40000, () => slots.start().returnMult);

// плинко: точный средний возврат таблиц по биномиальному распределению + симуляция
const binom = (n, k) => { let c = 1; for (let i = 1; i <= k; i++) c = c * (n - i + 1) / i; return c; };
for (const [risk, t] of Object.entries(plinko.TABLES)) {
  assert(t.length === plinko.ROWS + 1, `plinko ${risk}: ${plinko.ROWS + 1} лунок`);
  const ev = t.reduce((s, m, k) => s + m * binom(plinko.ROWS, k) / 2 ** plinko.ROWS, 0);
  assert(ev > 0.98 && ev < 0.995, `plinko ${risk}: возврат ${ev}`);
  console.log(`Плинко (${risk}): точный возврат = ${ev.toFixed(4)}`);
  rtp(`Плинко (${risk}), симуляция`, 40000, () => {
    const r = plinko.start(10, { risk });
    assert(r.view.path.length === plinko.ROWS && r.view.slot === r.view.path.reduce((a, b) => a + b, 0), 'plinko path');
    return r.returnMult;
  });
}
let badPlinko = 0;
for (const o of [null, {}, { risk: 'x' }, { risk: 'toString' }]) { try { plinko.start(10, o); } catch { badPlinko++; } }
assert(badPlinko === 4, 'plinko отклоняет плохие opts');

// баккара: правила третьей карты, частоты исходов и возврат
{
  const t = baccarat.totalOf;
  assert(t([{ r: 'K' }, { r: '9' }]) === 9 && t([{ r: '7' }, { r: '8' }]) === 5 && t([{ r: 'A' }, { r: '10' }]) === 1, 'baccarat: подсчёт очков');
  assert(baccarat.bankerDraws(3, 8) === false && baccarat.bankerDraws(3, 9) === true && baccarat.bankerDraws(6, null) === false
    && baccarat.bankerDraws(5, null) === true && baccarat.bankerDraws(6, 6) === true && baccarat.bankerDraws(4, 1) === false, 'baccarat: третья карта банкира');
  const wins = { player: 0, banker: 0, tie: 0 };
  for (const side of ['player', 'banker', 'tie']) {
    rtp(`Баккара (${side})`, 60000, () => {
      const r = baccarat.start(10, { side });
      const v = r.view;
      assert(v.player.length >= 2 && v.player.length <= 3 && v.banker.length >= 2 && v.banker.length <= 3, 'baccarat: 2–3 карты');
      assert(v.order.length === v.player.length + v.banker.length, 'baccarat: порядок раздачи');
      if (t(v.player.slice(0, 2)) >= 8 || t(v.banker.slice(0, 2)) >= 8) assert(v.order.length === 4, 'baccarat: натурал — без третьих карт');
      wins[v.winner]++;
      return r.returnMult;
    });
  }
  const n = wins.player + wins.banker + wins.tie;
  console.log(`Баккара: игрок ${(wins.player / n * 100).toFixed(1)}% / банкир ${(wins.banker / n * 100).toFixed(1)}% / ничья ${(wins.tie / n * 100).toFixed(1)}%`);
  let badBac = 0;
  for (const o of [null, {}, { side: 'x' }]) { try { baccarat.start(10, o); } catch { badBac++; } }
  assert(badBac === 3, 'baccarat отклоняет плохие opts');
}

// сапёр: открываем 3 случайные клетки и забираем
rtp('Сапёр (3 мины, 3 клетки)', 20000, () => {
  const s = mines.start(10, { mines: 3 });
  assert(s.view.bombs === null, 'mines не светит бомбы до конца');
  let st = s.state, r;
  const order = [...Array(25).keys()].sort(() => Math.random() - .5);
  for (let k = 0; k < 3; k++) {
    r = mines.act(st, 'open:' + order[k]);
    if (r.finished) return r.returnMult;
    st = r.state;
  }
  return mines.act(st, 'cashout').returnMult;
});
{
  // полное прохождение с 24 минами: одна безопасная клетка → сразу выплата
  const s = mines.start(10, { mines: 24 });
  const safe = [...Array(25).keys()].find(i => !s.state.bombs.includes(i));
  const r = mines.act(s.state, 'open:' + safe);
  assert(r.finished && r.returnMult === 24.75, 'mines 24 cleared ×24.75: ' + r.returnMult);
}

// выше/ниже: всегда выбираем более вероятное направление, 2 шага и забираем
rtp('Выше/Ниже (2 шага)', 40000, () => {
  let st = hilo.start().state, r;
  for (let k = 0; k < 2; k++) {
    const v = hilo.view(st);
    r = hilo.act(st, v.hi.chance >= v.lo.chance ? 'hi' : 'lo');
    if (r.finished) return r.returnMult;
    st = r.state;
  }
  return hilo.act(st, 'cashout').returnMult;
});

// ─── Лимбо, Башня, Кено ─────────────────────────────────────────────────────
rtp('Лимбо (×2)', 60000, () => limbo.start(10, { target: 2 }).returnMult);
rtp('Лимбо (×10)', 100000, () => limbo.start(10, { target: 10 }).returnMult);
for (const o of [{}, { target: 1 }, { target: 10001 }, { target: 'x' }]) {
  let ok = false; try { limbo.start(10, o); } catch { ok = true; }
  assert(ok, 'limbo отклоняет ' + JSON.stringify(o));
}
for (const level of Object.keys(tower.LEVELS)) {
  rtp(`Башня (${level}, 3 этажа)`, 30000, () => {
    const s = tower.start(10, { level });
    assert(s.view.bombs.length === 0, 'tower не светит мины до хода');
    let st = s.state, r;
    for (let k = 0; k < 3; k++) {
      r = tower.act(st, 'pick:' + Math.floor(Math.random() * tower.LEVELS[level].cells));
      if (r.finished) return r.returnMult;
      st = r.state;
    }
    return tower.act(st, 'cashout').returnMult;
  });
}
{
  // до верха на лёгком — выплата ×0.99·(4/3)^8
  const s = tower.start(10, { level: 'easy' });
  let r;
  for (let k = 0; k < tower.FLOORS; k++) r = tower.act(s.state, 'pick:' + [0, 1, 2, 3].find(c => !s.state.bombs[k].includes(c)));
  assert(r.finished && r.returnMult === tower.multAfter('easy', 8), 'tower top: ' + r.returnMult);
}
for (const n of [1, 4, 10]) {
  const picks = Array.from({ length: n }, (_, i) => i * 3 + 1);
  rtp(`Кено (${n} чисел)`, 60000, () => keno.start(10, { picks }).returnMult);
}
for (const o of [{ picks: [] }, { picks: [1, 1] }, { picks: [0] }, { picks: [41] }, { picks: Array.from({ length: 11 }, (_, i) => i + 1) }]) {
  let ok = false; try { keno.start(10, o); } catch { ok = true; }
  assert(ok, 'keno отклоняет ' + JSON.stringify(o));
}
{
  // точный возврат кено по таблице выплат (гипергеометрия 10 из 40)
  const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  for (const [p, row] of Object.entries(keno.PAYS)) {
    const ev = Object.entries(row).reduce((s, [h, m]) => s + m * C(+p, +h) * C(40 - p, 10 - h) / C(40, 10), 0);
    assert(ev > 0.96 && ev <= 0.99, `кено ${p}: точный возврат ${ev}`);
  }
  console.log('Кено: точный возврат по всем строкам таблицы 96–99%');
}

{
  // Сокровища: возврат на 200 тыс. раундов (фриспины редкие, нужна большая выборка)
  let paid = 0, fs = 0;
  const N = 200000;
  for (let i = 0; i < N; i++) {
    const r = treasure.start(10);
    assert(Number.isFinite(r.returnMult) && r.returnMult >= 0, 'treasure mult');
    paid += r.returnMult;
    if (r.view.freeSpins) fs++;
  }
  console.log(`Сокровища: средний возврат = ${(paid / N).toFixed(3)}, фриспины раз в ${Math.round(N / fs)} спинов`);
  assert(paid / N > 0.93 && paid / N < 0.99, 'treasure RTP вне 93–99%');
  // вайлды на средней линии → выплата вайлда за 5
  const g = [['C', 'W', 'C'], ['C', 'W', 'C'], ['C', 'W', 'C'], ['C', 'W', 'C'], ['C', 'W', 'C']];
  const e = treasure.evaluate(g);
  assert(e.wins.find(w => w.line === 0)?.mult === 250, 'treasure: 5 вайлдов = ×250');
}
