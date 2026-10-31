// Плинко: шарик падает через 12 рядов колышков в одну из 13 лунок.
// Путь (влево/вправо на каждом ряду) решает сервер (server/src/games/plinko.js),
// клиент только проигрывает его анимацией. Можно бросать несколько шариков подряд.

import React, { useRef, useState } from 'react';
import StakeStrip, { fmtShort } from '../components/StakeStrip.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import { api, haptic } from '../api.js';
import { BetStepper } from '../components/ui.jsx';

const ROWS = 12;
const sym = (half) => [...half, ...half.slice(0, -1).reverse()];
// как на сервере
const TABLES = {
  low: sym([10, 3, 1.6, 1.4, 1.1, 1, 0.5]),
  medium: sym([33, 11, 4, 2, 1.1, 0.6, 0.3]),
  high: sym([170, 24, 8.1, 2, 0.7, 0.2, 0.2]),
};
const RISKS = [['low', 'Низкий'], ['medium', 'Средний'], ['high', 'Высокий']];
const MAX_BALLS = 8;

// геометрия доски в процентах: шаг между колышками и высота ряда
const STEP = 100 / (ROWS + 2);
const ROW_H = 100 / (ROWS + 0.5);
const pegX = (row, j) => 50 + (j - (row + 2) / 2) * STEP;
const pegY = (row) => (row + 0.6) * ROW_H;
const slotX = (k) => 50 + (k - ROWS / 2) * STEP;

const fmt = (n) => Number(n).toLocaleString('ru-RU');
const tone = (m) => (m >= 10 ? 'hot' : m >= 2 ? 'warm' : m >= 1 ? 'even' : 'cold');

export default function Plinko({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [risk, setRisk] = useState('medium');
  const [balance, setBalance] = useState(profile.balance);
  const [balls, setBalls] = useState([]);
  const [recent, setRecent] = useState([]);
  const [hit, setHit] = useState(null); // { slot, key } — подсветка лунки
  const [last, setLast] = useState(null);
  const [err, setErr] = useState('');
  const pending = useRef(0);
  const [, force] = useState(0);
  const id = useRef(0);

  const inFlight = balls.length + pending.current;

  const drop = async () => {
    if (inFlight >= MAX_BALLS) return;
    setErr('');
    haptic('light');
    pending.current += 1; force(x => x + 1);
    try {
      const r = await api('/games/plinko/start', { bet, opts: { risk } });
      setBalance(b => b - bet);
      setBalls(bs => [...bs, { id: ++id.current, bet, path: r.view.path, slot: r.view.slot, mult: r.view.mult, net: r.net }]);
    } catch (e) { setErr(e.message); haptic('error'); }
    pending.current -= 1; force(x => x + 1);
  };

  const land = (ball) => {
    setBalls(bs => bs.filter(b => b.id !== ball.id));
    setBalance(b => b + ball.bet + ball.net);
    setHit({ slot: ball.slot, key: ball.id });
    setLast(ball);
    setRecent(rs => [ball, ...rs].slice(0, 12));
    haptic(ball.mult >= 2 ? 'success' : ball.mult >= 1 ? 'light' : 'soft');
    refresh();
  };

  const table = TABLES[risk];
  const flying = balls.reduce((s, b) => s + b.bet, 0);

  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={balls.length > 0}
        sub={balls.length ? `в полёте ${balls.length} · ${fmtShort(flying)}` : null} />
      <div className="table-felt plinko-felt">
        <div className="plinko-recent">
          <AnimatePresence initial={false}>
            {recent.map(b => (
              <motion.span key={b.id} layout initial={{ opacity: 0, scale: .5 }} animate={{ opacity: 1, scale: 1 }}
                className={`plinko-pill ${tone(b.mult)}`}>×{b.mult}</motion.span>
            ))}
          </AnimatePresence>
          {!recent.length && <span className="plinko-hint">Бросай шарик — чем дальше от центра, тем больше множитель</span>}
        </div>

        <div className="plinko-board">
          {Array.from({ length: ROWS }, (_, row) => Array.from({ length: row + 3 }, (_, j) => (
            <span key={`${row}-${j}`} className="plinko-peg" style={{ left: `${pegX(row, j)}%`, top: `${pegY(row)}%` }} />
          )))}
          {balls.map(b => <Ball key={b.id} ball={b} onLand={land} />)}
        </div>

        <div className="plinko-slots">
          {table.map((m, k) => (
            <motion.div key={`${risk}-${k}-${hit?.slot === k ? hit.key : ''}`} className={`plinko-slot ${tone(m)}`}
              initial={hit?.slot === k ? { y: 7, scale: 1.2 } : false} animate={{ y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 14 }}>
              {m}
            </motion.div>
          ))}
        </div>

        <div className="plinko-last">
          {last ? (
            <span className={last.net > 0 ? 'pos' : last.net < 0 ? 'neg' : ''}>
              ×{last.mult} · {last.net > 0 ? '+' : ''}{fmt(last.net)} 🪙
            </span>
          ) : <span>&nbsp;</span>}
        </div>
      </div>

      <div className="betbar">
        <BetStepper balance={balance} bet={bet} setBet={setBet} />
        <div className="seg">
          {RISKS.map(([k, l]) => (
            <button key={k} className={risk === k ? 'active' : ''} disabled={inFlight > 0}
              onClick={() => { haptic('light'); setRisk(k); }}>{l}</button>
          ))}
        </div>
        <motion.button whileTap={{ scale: .96 }} className="btn primary big"
          disabled={bet < 1 || bet > balance || inFlight >= MAX_BALLS} onClick={drop}>
          Бросить шарик · {fmt(bet)} 🪙
        </motion.button>
        <div className="hint">
          {inFlight > 0 ? `В полёте: ${inFlight}` : `Риск «${RISKS.find(r => r[0] === risk)[1].toLowerCase()}»: от ×${Math.min(...table)} до ×${Math.max(...table)}`}
        </div>
        {err && <div className="notice">⚠ {err}</div>}
      </div>
    </main>
  );
}

/** Шарик: проходит по колышкам своего пути и падает в лунку */
function Ball({ ball, onLand }) {
  const xs = [50], ys = [-3];
  let rights = 0;
  for (let row = 0; row < ROWS; row++) {
    // касание колышка сверху, потом отскок в сторону
    const x = 50 + (rights - row / 2) * STEP;
    xs.push(x); ys.push(pegY(row) - ROW_H * 0.45);
    rights += ball.path[row];
  }
  xs.push(slotX(ball.slot)); ys.push(103);
  const times = xs.map((_, i) => i / (xs.length - 1));
  return (
    <motion.span className="plinko-ball"
      initial={{ left: '50%', top: '-3%' }}
      animate={{ left: xs.map(x => `${x}%`), top: ys.map(y => `${y}%`) }}
      transition={{ duration: 2.1, times, ease: 'easeIn' }}
      onAnimationComplete={() => onLand(ball)} />
  );
}
