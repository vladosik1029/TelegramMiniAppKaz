// Сокровища: слот 5×3 с 10 линиями, вайлдами 🃏 и скаттерами 💰.
// 3+ 💰 — бесплатные вращения с выигрышами ×2. Сервер присылает весь раунд
// сразу (основной спин + фриспины), клиент проигрывает их по очереди.

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, haptic } from '../api.js';
import { play as sound } from '../sound.js';
import { BetBar, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import { CoinBurst } from '../components/fx.jsx';
import StakeStrip, { fmtShort } from '../components/StakeStrip.jsx';
import { TREASURE_STRIPS } from '@fair/games.js';

export const SYM = { C: '🍒', L: '🍋', O: '🍊', G: '🍇', B: '🔔', S: '⭐', D: '💎', 7: '7️⃣', W: '🃏', X: '💰' };
const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
];
const PAYTABLE = [['W', 120, 500, 2500], ['7', 100, 400, 2000], ['D', 60, 200, 750], ['S', 40, 120, 450],
  ['B', 30, 90, 300], ['O', 17, 45, 140], ['G', 17, 45, 140], ['C', 12, 35, 90], ['L', 12, 35, 90]];
const randomCol = (i) => { const s = TREASURE_STRIPS[i]; const p = Math.floor(Math.random() * s.length); return [0, 1, 2].map(r => s[(p + r) % s.length]); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

export default function Treasure({ profile, refresh }) {
  const [bet, setBet] = useState(100);
  const [balance, setBalance] = useState(profile.balance);
  const [grid, setGrid] = useState(() => [0, 1, 2, 3, 4].map(randomCol));
  const [spinning, setSpinning] = useState([false, false, false, false, false]);
  const [spinIdx, setSpinIdx] = useState(-1);     // какое вращение раунда показываем
  const [round, setRound] = useState(null);       // ответ сервера
  const [won, setWon] = useState(0);              // накоплено за раунд, в ставках
  const [hl, setHl] = useState(null);             // выигрыш текущего вращения
  const [fsBanner, setFsBanner] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showPays, setShowPays] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // пока барабан крутится — мелькают случайные символы его ленты
  useEffect(() => {
    if (!spinning.some(Boolean)) return;
    const t = setInterval(() => setGrid(g => g.map((col, i) => (spinning[i] ? randomCol(i) : col))), 70);
    return () => clearInterval(t);
  }, [spinning]);

  const showSpin = async (sp, fast) => {
    setHl(null);
    setSpinning([true, true, true, true, true]);
    await wait(fast ? 350 : 500);
    for (let i = 0; i < 5; i++) {
      if (!alive.current) return;
      await wait(fast ? 130 : 200);
      setGrid(g => g.map((col, j) => (j === i ? sp.grid[i] : col)));
      setSpinning(s => s.map((x, j) => (j === i ? false : x)));
      sound(sp.grid[i].includes('X') ? 'turn' : 'card');
    }
    await wait(150);
    if (sp.total > 0) { setHl(sp); setWon(w => Math.round((w + sp.total) * 100) / 100); sound(sp.total >= 5 ? 'win' : 'chip'); await wait(sp.wins.length > 2 ? 1100 : 800); }
  };

  const spin = async () => {
    setBusy(true); setErr(''); setResult(null); setWon(0); setRound(null); setFsBanner(null);
    try {
      const r = await api('/games/treasure/start', { bet });
      setBalance(r.balance);
      setRound(r);
      for (let i = 0; i < r.view.spins.length; i++) {
        if (!alive.current) return;
        const sp = r.view.spins[i];
        setSpinIdx(i);
        await showSpin(sp, i > 0);
        if (sp.award) {
          haptic('success');
          setFsBanner({ n: sp.award, retrigger: i > 0 });
          await wait(1600);
          setFsBanner(null);
        }
      }
      setResult(r);
      haptic(r.outcome === 'win' ? 'success' : r.outcome === 'lose' ? 'error' : 'light');
      await refresh();
    } catch (e) { setErr(e.message); setSpinning([false, false, false, false, false]); }
    setBusy(false);
  };

  const freeTotal = round?.view.freeSpins ?? 0;
  const inFree = spinIdx > 0 && round && !result;
  const lit = new Set();
  hl?.wins.forEach(w => LINES[w.line].slice(0, w.n).forEach((r, i) => lit.add(`${i}-${r}`)));
  if (hl?.scatters >= 3) grid.forEach((col, i) => col.forEach((s, r) => s === 'X' && lit.add(`${i}-${r}`)));

  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={busy} sub={busy && won > 0 ? `выиграно ${fmtShort(bet * won)}` : '10 линий'} />
      <div className={`table-felt tr-felt ${inFree ? 'free' : ''}`}>
        <div className="tr-top">
          <span className="tr-title">💰 Сокровища</span>
          <span className="tr-info">{inFree ? `Фриспин ${spinIdx} / ${freeTotal} · ×2` : '3+ 💰 — фриспины ×2'}</span>
        </div>
        <div className="tr-reels">
          {grid.map((col, i) => (
            <div key={i} className={`tr-reel ${spinning[i] ? 'spin' : ''}`}>
              {col.map((s, r) => (
                <motion.div key={r} className={`tr-cell ${lit.has(`${i}-${r}`) ? 'lit' : ''} ${s === 'W' ? 'wild' : ''} ${s === 'X' ? 'scatter' : ''}`}
                  animate={!spinning[i] ? { y: [-10, 0] } : {}} transition={{ type: 'spring', stiffness: 600, damping: 18 }}>
                  {SYM[s]}
                </motion.div>
              ))}
            </div>
          ))}
          <AnimatePresence>
            {fsBanner && (
              <motion.div className="tr-fs" initial={{ scale: .5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: .8, opacity: 0 }}>
                <CoinBurst count={18} />
                <b>{fsBanner.retrigger ? `+${fsBanner.n} фриспинов!` : `${fsBanner.n} бесплатных вращений!`}</b>
                <small>все выигрыши ×2</small>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="tr-win">
          {hl ? hl.wins.slice(0, 3).map(w => (
            <span key={w.line}>Линия {w.line + 1}: {SYM[w.sym]}×{w.n} → {fmtShort(bet * w.mult * hl.mult)}</span>
          )).concat(hl.scatterMult ? [<span key="sc">💰×{hl.scatters} → {fmtShort(bet * hl.scatterMult * hl.mult)}</span>] : [])
            : <span className="muted">{busy ? 'Крутим…' : 'Удачи!'}</span>}
          {hl && hl.wins.length > 3 && <span>и ещё {hl.wins.length - 3}</span>}
        </div>
        {(busy || result) && won > 0 && <div className="tr-total">Выигрыш раунда: <b>{fmtShort(bet * won)} 🪙</b></div>}
        {result && <ResultBanner result={result} extra={result.view.freeSpins ? `Фриспинов: ${result.view.freeSpins} · итог ×${result.view.totalMult}` : null} />}
        {err && <div className="notice">⚠ {err}</div>}
      </div>

      {!busy && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={spin} label="Крутить 🎰" busyLabel="Крутим…">
          <button className="btn-ghost tr-pays-btn" onClick={() => setShowPays(v => !v)}>{showPays ? 'Скрыть выплаты' : 'Таблица выплат'}</button>
          {showPays && (
            <div className="tr-pays">
              <div className="tr-pays-head"><span /> <span>×3</span><span>×4</span><span>×5</span></div>
              {PAYTABLE.map(([s, a, b, c]) => (
                <div key={s}><span>{SYM[s]}</span><span>{fmtShort(bet * a / 10)}</span><span>{fmtShort(bet * b / 10)}</span><span>{fmtShort(bet * c / 10)}</span></div>
              ))}
              <div className="hint">🃏 заменяет любой символ, кроме 💰. 💰 где угодно: 3 → ×2 ставки и 8 фриспинов, 4 → ×10 и 12, 5 → ×50 и 20. Во фриспинах всё ×2.</div>
            </div>
          )}
        </BetBar>
      )}
      {busy && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.div variants={actionsItem} className="room-wait">{inFree ? '🎁 Идут бесплатные вращения…' : 'Барабаны крутятся…'}</motion.div>
        </motion.div>
      )}
    </main>
  );
}
