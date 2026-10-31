// Слоты: три барабана с одной лентой символов (лента приходит с сервера).
// Каждый барабан докручивается до своей позиции с задержкой — классическая
// «лестница» остановок; выигрышная линия подсвечивается.

import React, { useRef, useState } from 'react';
import { motion, animate, useMotionValue } from 'framer-motion';
import { api, haptic } from '../api.js';
import { BetBar, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import StakeStrip from '../components/StakeStrip.jsx';

// Дубликат ленты для первого рендера (до первого спина); сервер всё равно присылает свою
const STRIP0 = ['🍒', '🍋', '🍊', '🍒', '🍇', '🍋', '🔔', '🍊', '🍒', '🍋', '⭐', '🍊', '🍇', '🍒', '🍋', '💎', '🍊', '🍒', '🍇', '🔔', '🍋', '🍊', '7️⃣', '🍇'];
const PAYTABLE = [['7️⃣', 200], ['💎', 100], ['⭐', 50], ['🔔', 25], ['🍇', 15], ['🍒', 12], ['🍊', 10], ['🍋', 8]];
const CELL = 64;       // высота клетки барабана, px (совпадает с .reel-cell в CSS)
const LOOPS = 6;       // сколько раз лента повторяется в DOM — запас для прокрутки

const COMBO = {
  three: (l) => `Три ${l[0]} в линию!`,
  two_cherry: () => 'Две вишни — ×2',
  one_cherry: () => 'Одна вишня — ставка вернулась',
  none: () => 'Мимо…',
};

export default function Slots({ profile, refresh }) {
  const [bet, setBet] = useState(20);
  const [balance, setBalance] = useState(profile.balance);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [strip, setStrip] = useState(STRIP0);
  // позиция каждого барабана (в клетках) и его сдвиг в px
  const posRef = useRef([1, 9, 17]);
  const ys = [useMotionValue(0), useMotionValue(-8 * CELL), useMotionValue(-16 * CELL)];

  const spin = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api('/games/slots/start', { bet });
      setBalance(r.balance);
      const L = r.view.strip.length;
      setStrip(r.view.strip);
      // каждый барабан: прыжок в начало ленты на тот же символ (незаметно),
      // затем (2 + i) полных оборота и точная остановка — «лестница»
      r.view.stops.forEach((stop, i) => {
        const from = posRef.current[i] % L;
        const to = from + L * (2 + i) + ((stop - from) % L + L) % L;
        posRef.current[i] = to;
        // центр окна = вторая из трёх видимых клеток, поэтому сдвиг на (pos − 1)
        animate(ys[i], [-(from - 1) * CELL, -(to - 1) * CELL], { duration: 1.4 + i * .35, ease: [.2, .1, .15, 1.02] });
      });
      await new Promise(res => setTimeout(res, 2300));
      setResult(r);
      haptic(r.outcome === 'win' ? 'success' : r.outcome === 'lose' ? 'error' : 'light');
      await refresh();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const L = strip.length;
  const tape = Array.from({ length: L * LOOPS }, (_, i) => strip[i % L]);
  const winLine = result && result.view.mult > 1;

  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={busy} />
      <div className="table-felt slots-felt">
        <div className="slot-machine">
          <div className="slot-lights" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => <span key={i} className={busy ? 'run' : winLine ? 'win' : ''} style={{ animationDelay: `${i * .09}s` }} />)}
          </div>
          <div className="reels">
            {ys.map((y, i) => (
              <div key={i} className="reel">
                <motion.div className="reel-tape" style={{ y }}>
                  {tape.map((s, j) => <div key={j} className="reel-cell">{s}</div>)}
                </motion.div>
              </div>
            ))}
            <div className={`payline ${winLine ? 'win' : ''}`} />
          </div>
        </div>

        {result && <ResultBanner result={result} extra={COMBO[result.view.combo]?.(result.view.line)} />}
        {err && <div className="notice">⚠ {err}</div>}
      </div>

      {!result && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={spin}
          label="Крутить 🎰" busyLabel="Барабаны крутятся…">
          <div className="paytable">
            {PAYTABLE.map(([s, m]) => (
              <div key={s} className="paytable-item"><span>{s}{s}{s}</span><b>×{m}</b></div>
            ))}
          </div>
        </BetBar>
      )}

      {result && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary big" onClick={() => setResult(null)}>
            🔄 Ещё спин
          </motion.button>
        </motion.div>
      )}
    </main>
  );
}
