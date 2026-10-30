// Кости: выбираешь порог и «меньше/больше», сервер бросает 0.00–99.99.
// Анимация: число «перебирается» и маркер скользит по шкале к выпавшему значению.

import React, { useState } from 'react';
import { motion, animate, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion';
import { api, haptic } from '../api.js';
import { BetBar, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import { fmtMult } from '../components/fx.jsx';

const EDGE = 0.99; // как на сервере (server/src/games/dice.js)
const chanceOf = (dir, t) => (dir === 'under' ? t : 100 - t) / 100;
const multOf = (dir, t) => Math.floor((EDGE / chanceOf(dir, t)) * 10000) / 10000;

export default function Dice({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [dir, setDir] = useState('under');
  const [target, setTarget] = useState(50);
  const [balance, setBalance] = useState(profile.balance);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pos = useMotionValue(50);
  const [shown, setShown] = useState(null);
  useMotionValueEvent(pos, 'change', (v) => setShown(v));
  const markerLeft = useTransform(pos, (v) => `${v}%`);

  const roll = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api('/games/dice/start', { bet, opts: { dir, target } });
      setBalance(r.balance);
      // короткая «тряска» по шкале, затем мягкая посадка на выпавшее число
      await animate(pos, [pos.get(), 12 + Math.random() * 20, 70 + Math.random() * 25, r.view.roll], {
        duration: 1.1, ease: [.3, .1, .2, 1], times: [0, .25, .55, 1],
      });
      setResult(r);
      haptic(r.outcome === 'win' ? 'success' : 'error');
      await refresh();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const chance = chanceOf(dir, target);
  const mult = multOf(dir, target);
  const winFrom = dir === 'under' ? 0 : target;
  const winTo = dir === 'under' ? target : 100;
  const landed = result ? (result.outcome === 'win' ? 'win' : 'lose') : '';

  return (
    <main className="page game-screen">
      <div className="table-felt dice-felt">
        <div className={`dice-readout ${landed}`}>
          {shown == null ? '—' : shown.toFixed(2)}
        </div>
        <div className="dice-sub">
          {dir === 'under' ? `Выигрыш, если меньше ${target}` : `Выигрыш, если больше ${target}`}
        </div>

        <div className="dice-track">
          <div className="dice-zone" style={{ left: `${winFrom}%`, width: `${winTo - winFrom}%` }} />
          <motion.div className={`dice-marker ${landed}`} style={{ left: markerLeft }}>
            <span>🎲</span>
          </motion.div>
          <div className="dice-ticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
        </div>

        {result && <ResultBanner result={result} extra={`Выпало ${result.view.roll.toFixed(2)} · ×${fmtMult(result.view.mult)}`} />}
        {err && <div className="notice">⚠ {err}</div>}
      </div>

      {!result && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={roll}
          label="Бросить кости 🎲" busyLabel="Кости летят…">
          <div className="seg">
            {[['under', '⬇ Меньше'], ['over', '⬆ Больше']].map(([d, l]) => (
              <button key={d} className={dir === d ? 'active' : ''} disabled={busy}
                onClick={() => { haptic('light'); setDir(d); }}>{l}</button>
            ))}
          </div>
          <input className="dice-range" type="range" min={2} max={98} value={target} disabled={busy}
            onChange={e => setTarget(Number(e.target.value))} />
          <div className="dice-stats">
            <div><small>Порог</small><b>{target}</b></div>
            <div><small>Шанс</small><b>{(chance * 100).toFixed(0)}%</b></div>
            <div><small>Выплата</small><b>×{fmtMult(mult)}</b></div>
            <div><small>Выигрыш</small><b>{Math.round(bet * mult).toLocaleString('ru-RU')}</b></div>
          </div>
        </BetBar>
      )}

      {result && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary big" onClick={() => setResult(null)}>
            🔄 Ещё бросок
          </motion.button>
        </motion.div>
      )}
    </main>
  );
}

