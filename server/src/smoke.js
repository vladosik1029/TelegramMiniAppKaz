// Смоук-тест игровой логики: запускает много раундов, проверяет инварианты
// node src/smoke.js
// npm install не нужен (нет импортов express)

import * as bj from './games/blackjack.js';
import * as ochko from './games/ochko.js';
import * as poker from './games/poker.js';

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
