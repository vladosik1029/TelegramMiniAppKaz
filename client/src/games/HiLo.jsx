// Выше / Ниже: угадываешь, будет ли следующая карта старше или младше.
// Каждое попадание умножает банк; можно забрать в любой момент или пропустить карту.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, haptic } from '../api.js';
import { BetBar, ResultBanner, CardView, actionsStagger, actionsItem } from '../components/ui.jsx';
import { AnimatedNumber, fmtMult } from '../components/fx.jsx';
import StakeStrip, { fmtShort } from '../components/StakeStrip.jsx';

const pct = (p) => `${Math.round(p * 100)}%`;

export default function HiLo({ profile, refresh }) {
  const [bet, setBet] = useState(50);
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
        setResult(r);
        haptic(r.outcome === 'win' ? 'success' : 'error');
        await refresh();
      } else if (body.action) haptic('light');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const startGame = () => { setResult(null); call('/games/hilo/start', { bet }); };
  const act = (action) => call('/games/hilo/action', { action });

  const inRound = view && !result;
  const cards = view?.cards ?? [];
  const cur = cards[cards.length - 1];
  const trail = cards.slice(0, -1);
  const skipped = new Set(view?.skipped ?? []);

  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={!!inRound} sub={inRound && view.steps > 0 ? `→ ${fmtShort(bet * view.mult)}` : null} />
      <div className="table-felt hilo-felt">
        <div className="hilo-trail">
          <AnimatePresence initial={false}>
            {trail.map((c, i) => (
              <motion.div key={`${cards.length}-${i}`} className={`hilo-mini ${skipped.has(i) ? 'skip' : ''}`}
                initial={{ opacity: 0, x: 30, scale: .7 }} animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 26 }}>
                <span className={c.s === '♥' || c.s === '♦' ? 'red' : ''}>{c.r}{c.s}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="hilo-stage">
          <div className="hilo-deck"><div className="card back"><div className="card-back-pattern" /></div></div>
          <div className="hilo-current">
            {cur
              ? <CardView key={cards.length + (result ? '-r' : '')} card={cur} />
              : <div className="card back ghost"><div className="card-back-pattern" /></div>}
          </div>
          <div className="hilo-bank">
            <small>Банк</small>
            <b>×<AnimatedNumber value={view?.mult ?? 1} decimals={2} duration={.4} /></b>
            <small>{Math.round(bet * (view?.mult ?? 1)).toLocaleString('ru-RU')} 🪙</small>
          </div>
        </div>

        {result && (
          <ResultBanner result={result}
            extra={result.message === 'miss' ? `Не угадал — выпало ${cur.r}${cur.s}` : `Забрал на ×${fmtMult(view.mult)} за ${view.steps} шаг(а)`} />
        )}
        {err && <div className="notice">⚠ {err}</div>}
      </div>

      {!inRound && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={startGame} label="Открыть карту 🃏">
          <div className="hint">Туз — старший, двойка — младшая. Равная карта засчитывается в обе стороны.</div>
        </BetBar>
      )}

      {inRound && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary hilo-btn" disabled={busy} onClick={() => act('hi')}>
            <span>⬆ Выше или =</span><small>{pct(view.hi.chance)} · ×{fmtMult(view.hi.mult)}</small>
          </motion.button>
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary hilo-btn" disabled={busy} onClick={() => act('lo')}>
            <span>⬇ Ниже или =</span><small>{pct(view.lo.chance)} · ×{fmtMult(view.lo.mult)}</small>
          </motion.button>
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn small" disabled={busy || view.skipsLeft <= 0} onClick={() => act('skip')}>
            ⏭ Пропуск ({view.skipsLeft})
          </motion.button>
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn gold" disabled={busy || view.steps < 1} onClick={() => act('cashout')}>
            {view.steps < 1 ? 'Угадай хотя бы раз' : <>Забрать {Math.round(bet * view.mult).toLocaleString('ru-RU')} 🪙</>}
          </motion.button>
        </motion.div>
      )}
    </main>
  );
}
