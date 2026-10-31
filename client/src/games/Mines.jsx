// Сапёр: поле 5×5, выбираешь число мин, открываешь клетки и в любой момент
// забираешь выигрыш. Позиции мин сервер раскрывает только в конце раунда.

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, haptic } from '../api.js';
import { BetBar, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import { AnimatedNumber, fmtMult } from '../components/fx.jsx';
import StakeStrip, { fmtShort } from '../components/StakeStrip.jsx';

const MINE_PRESETS = [1, 3, 5, 10, 24];

export default function Mines({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [mines, setMines] = useState(3);
  const [balance, setBalance] = useState(profile.balance);
  const [view, setView] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shake, setShake] = useState(0);

  const call = async (path, body) => {
    setBusy(true); setErr('');
    try {
      const r = await api(path, body);
      setBalance(r.balance);
      setView(r.view);
      if (r.finished) {
        if (r.view.boom != null) { setShake(s => s + 1); haptic('error'); }
        else haptic('success');
        setResult(r);
        await refresh();
      } else if (body.action) haptic('light');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const startGame = () => { setResult(null); call('/games/mines/start', { bet, opts: { mines } }); };
  const open = (i) => call('/games/mines/action', { action: 'open:' + i });
  const cashout = () => call('/games/mines/action', { action: 'cashout' });

  const inRound = view && !result;
  const opened = new Set(view?.opened ?? []);
  const bombs = new Set(view?.bombs ?? []);

  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={!!inRound} sub={inRound && view.mult > 1 ? `→ ${fmtShort(bet * view.mult)}` : null} />
      <motion.div
        className="table-felt mines-felt"
        key={shake}
        animate={shake ? { x: [0, -10, 9, -6, 4, 0] } : {}}
        transition={{ duration: .45 }}
      >
        <div className="mines-head">
          <div><small>Мин</small><b>💣 {view?.mines ?? mines}</b></div>
          <div><small>Множитель</small><b className="gold">×<AnimatedNumber value={view?.mult ?? 1} decimals={2} duration={.4} /></b></div>
          <div><small>Следующая</small><b>{inRound && view.nextMult ? `×${fmtMult(view.nextMult)}` : '—'}</b></div>
        </div>

        <div className={`mines-grid ${inRound ? 'live' : ''}`}>
          {Array.from({ length: 25 }, (_, i) => {
            const isOpen = opened.has(i);
            const isBomb = bombs.has(i);
            const revealed = isOpen || (result && isBomb);
            const boom = view?.boom === i;
            return (
              <motion.button
                key={i}
                className={`mine-cell ${revealed ? 'open' : ''} ${isBomb && revealed ? 'bomb' : ''} ${boom ? 'boom' : ''} ${result && !isOpen && !isBomb ? 'ghost' : ''}`}
                disabled={!inRound || busy || isOpen}
                onClick={() => open(i)}
                whileTap={inRound ? { scale: .88 } : undefined}
                initial={{ opacity: 0, scale: .6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: view ? 0 : i * .012, type: 'spring', stiffness: 420, damping: 22 }}
              >
                <AnimatePresence>
                  {revealed && (
                    <motion.span
                      className="mine-icon"
                      initial={{ rotateY: 90, scale: .4 }}
                      animate={{ rotateY: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 16, delay: isOpen ? 0 : .03 * (i % 7) }}
                    >{isBomb ? (boom ? '💥' : '💣') : '💎'}</motion.span>
                  )}
                  {result && !revealed && <span className="mine-icon faint">💎</span>}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </div>

        {result && (
          <ResultBanner result={result}
            extra={result.message === 'boom' ? 'Бах! Попал на мину' : `Забрал на ×${fmtMult(result.view.mult)}`} />
        )}
        {err && <div className="notice">⚠ {err}</div>}
      </motion.div>

      {!inRound && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={startGame} label="Начать 💎">
          <div className="seg">
            {MINE_PRESETS.map(m => (
              <button key={m} className={mines === m ? 'active' : ''} disabled={busy}
                onClick={() => { haptic('light'); setMines(m); }}>💣 {m}</button>
            ))}
          </div>
          <div className="hint">Больше мин — выше множитель за каждую клетку.</div>
        </BetBar>
      )}

      {inRound && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn gold big"
            disabled={busy || !view.opened.length} onClick={cashout}>
            {view.opened.length
              ? <>Забрать {Math.round(bet * view.mult).toLocaleString('ru-RU')} 🪙</>
              : 'Открой хотя бы одну клетку'}
          </motion.button>
        </motion.div>
      )}
    </main>
  );
}
