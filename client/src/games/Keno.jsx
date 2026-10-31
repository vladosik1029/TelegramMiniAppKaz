// Кено: отметь от 1 до 10 чисел из 40, сервер вытягивает 10 шаров.
// Выплата — по таблице: сколько отмеченных чисел совпало.

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, haptic } from '../api.js';
import { play as sound } from '../sound.js';
import { BetBar, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import StakeStrip, { fmtShort } from '../components/StakeStrip.jsx';

// та же таблица, что на сервере (server/src/games/keno.js)
const PAYS = {
  1: { 1: 3.96 }, 2: { 1: 1.8, 2: 5.1 }, 3: { 2: 2.8, 3: 50 }, 4: { 2: 1.7, 3: 10, 4: 100 },
  5: { 2: 1.4, 3: 4, 4: 14, 5: 390 }, 6: { 3: 3, 4: 9, 5: 180, 6: 710 },
  7: { 3: 2, 4: 7, 5: 30, 6: 400, 7: 800 }, 8: { 3: 2, 4: 4, 5: 11, 6: 67, 7: 400, 8: 900 },
  9: { 3: 2, 4: 2.5, 5: 5, 6: 15, 7: 100, 8: 500, 9: 1000 },
  10: { 3: 1.6, 4: 2, 5: 4, 6: 7, 7: 26, 8: 100, 9: 500, 10: 1000 },
};
const STEP_MS = 160;

export default function Keno({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [picks, setPicks] = useState([]);
  const [balance, setBalance] = useState(profile.balance);
  const [deal, setDeal] = useState(null);   // ответ сервера
  const [shown, setShown] = useState(0);    // сколько шаров уже вылетело
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggle = (n) => {
    if (busy) return;
    if (result) { setResult(null); setDeal(null); }
    haptic('light', 'chip');
    setPicks(ps => ps.includes(n) ? ps.filter(x => x !== n) : ps.length >= 10 ? ps : [...ps, n]);
  };
  const auto = () => {
    haptic('light');
    if (result) { setResult(null); setDeal(null); }
    const n = Math.max(picks.length, 5);
    const all = Array.from({ length: 40 }, (_, i) => i + 1).sort(() => Math.random() - .5);
    setPicks(all.slice(0, n));
  };

  const playRound = async () => {
    setBusy(true); setErr(''); setResult(null); setDeal(null); setShown(0);
    try {
      const r = await api('/games/keno/start', { bet, opts: { picks } });
      setBalance(r.balance);
      setDeal(r);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  // шары вылетают по одному
  useEffect(() => {
    if (!deal || result) return;
    if (shown < deal.view.drawn.length) {
      const t = setTimeout(() => {
        const ball = deal.view.drawn[shown];
        sound(picks.includes(ball) ? 'turn' : 'soft');
        setShown(s => s + 1);
      }, shown ? STEP_MS : 120);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setResult(deal);
      haptic(deal.outcome === 'win' ? 'success' : deal.outcome === 'lose' ? 'error' : 'light');
      setBusy(false);
      refresh();
    }, 300);
    return () => clearTimeout(t);
  }, [deal, shown, result]);

  const drawn = new Set(deal ? deal.view.drawn.slice(0, shown) : []);
  const hitsNow = picks.filter(n => drawn.has(n)).length;
  const row = PAYS[picks.length] ?? {};
  const maxMult = Math.max(0, ...Object.values(row));

  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={busy} sub={picks.length ? `${picks.length} чисел · до ${fmtShort(bet * maxMult)}` : null} />
      <div className="table-felt keno-felt">
        <div className="keno-grid">
          {Array.from({ length: 40 }, (_, i) => i + 1).map(n => {
            const p = picks.includes(n), d = drawn.has(n);
            return (
              <motion.button key={n} className={`keno-cell ${p ? 'pick' : ''} ${d ? 'drawn' : ''} ${p && d ? 'hit' : ''}`}
                disabled={busy} onClick={() => toggle(n)} whileTap={{ scale: .9 }}
                animate={d ? { scale: [1, 1.18, 1] } : { scale: 1 }} transition={{ duration: .25 }}>
                {n}
              </motion.button>
            );
          })}
        </div>
        <div className="keno-pays">
          {picks.length === 0 ? <span className="hint">Отметь от 1 до 10 чисел</span> :
            Object.entries(row).map(([h, m]) => (
              <span key={h} className={`keno-pay ${deal && +h === hitsNow ? 'now' : ''}`}><small>{h} совп.</small>×{m}</span>
            ))}
        </div>
        {result && <ResultBanner result={result} extra={`Совпало ${result.view.hits.length} из ${result.view.picks.length}${result.view.mult ? ` · ×${result.view.mult}` : ''}`} />}
        {err && <div className="notice">⚠ {err}</div>}
      </div>

      <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={playRound}
        label={picks.length ? `Тянуть шары · ${picks.length} чисел` : 'Отметь числа'} busyLabel="Шары летят…" canDeal={picks.length > 0}>
        <div className="actions keno-tools">
          <button className="btn small" disabled={busy} onClick={auto}>🎲 Случайные</button>
          <button className="btn small" disabled={busy || !picks.length} onClick={() => { haptic('light'); setPicks([]); setResult(null); setDeal(null); }}>Очистить</button>
        </div>
      </BetBar>
    </main>
  );
}
