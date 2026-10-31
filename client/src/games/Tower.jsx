// Башня: 8 этажей, на каждом выбираешь одну клетку. Безопасная — поднимаешься
// выше и множитель растёт, мина — ставка сгорает. Забрать можно в любой момент.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { api, haptic } from '../api.js';
import { BetBar, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import { AnimatedNumber, fmtMult } from '../components/fx.jsx';
import StakeStrip, { fmtShort } from '../components/StakeStrip.jsx';

const LEVELS = {
  easy: { label: 'Лёгкая', cells: 4, bombs: 1 },
  medium: { label: 'Средняя', cells: 3, bombs: 1 },
  hard: { label: 'Сложная', cells: 2, bombs: 1 },
  expert: { label: 'Эксперт', cells: 3, bombs: 2 },
};
const FLOORS = 8;
const multAfter = (lv, k) => (k ? Math.floor(0.99 * (LEVELS[lv].cells / (LEVELS[lv].cells - LEVELS[lv].bombs)) ** k * 100) / 100 : 1);

export default function Tower({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [level, setLevel] = useState('medium');
  const [balance, setBalance] = useState(profile.balance);
  const [view, setView] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const call = async (path, body) => {
    setBusy(true); setErr('');
    try {
      const r = await api(path, body);
      setBalance(r.balance);
      setView(r.view);
      if (r.finished) {
        haptic(r.view.boom != null ? 'error' : 'success');
        setResult(r);
        await refresh();
      } else if (body.action) haptic('light', 'chip');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const start = () => { setResult(null); call('/games/tower/start', { bet, opts: { level } }); };
  const pick = (c) => call('/games/tower/action', { action: 'pick:' + c });
  const cashout = () => call('/games/tower/action', { action: 'cashout' });

  const inRound = view && !result;
  const lv = view?.level ?? level;
  const { cells } = LEVELS[lv];
  const floor = view?.floor ?? 0;

  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={!!inRound} sub={inRound && floor > 0 ? `→ ${fmtShort(bet * view.mult)}` : null} />
      <div className="table-felt tower-felt">
        <div className="mines-head">
          <div><small>Этаж</small><b>{floor} / {FLOORS}</b></div>
          <div><small>Множитель</small><b className="gold">×<AnimatedNumber value={view?.mult ?? 1} decimals={2} duration={.4} /></b></div>
          <div><small>Следующий</small><b>{inRound && view.nextMult ? `×${fmtMult(view.nextMult)}` : '—'}</b></div>
        </div>
        <div className="tower">
          {Array.from({ length: FLOORS }, (_, i) => FLOORS - 1 - i).map(f => {
            const passed = view && f < floor;
            const current = inRound && f === floor;
            const picked = view?.picks?.[f];
            const bombs = new Set(view?.bombs?.[f] ?? []);
            const shown = view?.bombs?.[f] != null;
            return (
              <div key={f} className={`tower-floor ${current ? 'current' : ''} ${passed ? 'passed' : ''}`}>
                <span className="tower-mult">×{fmtMult(multAfter(lv, f + 1))}</span>
                <div className="tower-cells" style={{ gridTemplateColumns: `repeat(${cells}, 1fr)` }}>
                  {Array.from({ length: cells }, (_, c) => {
                    const isPick = picked === c;
                    const isBomb = shown && bombs.has(c);
                    const boom = view?.boom === f && isPick;
                    return (
                      <motion.button key={c} disabled={!current || busy} onClick={() => pick(c)}
                        whileTap={current ? { scale: .9 } : undefined}
                        className={`tower-cell ${isPick && !isBomb ? 'safe' : ''} ${isBomb ? 'bomb' : ''} ${boom ? 'boom' : ''} ${shown && !isBomb && !isPick ? 'ghost' : ''}`}>
                        {boom ? '💥' : isBomb ? '💣' : isPick ? '💎' : shown ? <span className="mine-icon faint">💎</span> : ''}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {result && <ResultBanner result={result}
          extra={result.message === 'boom' ? `Мина на ${floor + 1}-м этаже` : result.message === 'top' ? 'Ты на вершине башни! 🏆' : `Забрал на ×${fmtMult(result.view.mult)}`} />}
        {err && <div className="notice">⚠ {err}</div>}
      </div>

      {!inRound && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={start} label="Начать подъём 🗼">
          <div className="seg">
            {Object.entries(LEVELS).map(([id, l]) => (
              <button key={id} className={level === id ? 'active' : ''} disabled={busy}
                onClick={() => { haptic('light'); setLevel(id); setView(null); setResult(null); }}>{l.label}</button>
            ))}
          </div>
          <div className="hint">
            {LEVELS[level].cells} клетки на этаже, {LEVELS[level].bombs === 1 ? '1 мина' : `${LEVELS[level].bombs} мины`} · вершина ×{fmtMult(multAfter(level, FLOORS))}
          </div>
        </BetBar>
      )}

      {inRound && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn gold big"
            disabled={busy || floor < 1} onClick={cashout}>
            {floor ? <>Забрать {Math.round(bet * view.mult).toLocaleString('ru-RU')} 🪙</> : 'Пройди хотя бы один этаж'}
          </motion.button>
        </motion.div>
      )}
    </main>
  );
}
