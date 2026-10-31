// Лимбо: задаёшь целевой множитель, сервер выбрасывает число. Выпало не меньше
// цели — получаешь ставку × цель. Чем выше цель, тем меньше шанс (≈ 99% / цель).

import React, { useEffect, useRef, useState } from 'react';
import { motion, animate } from 'framer-motion';
import { api, haptic } from '../api.js';
import { BetBar, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import StakeStrip, { fmtShort } from '../components/StakeStrip.jsx';

const PRESETS = [1.5, 2, 5, 10, 100];
const fmtX = (m) => `×${Number(m).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Limbo({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [targetText, setTargetText] = useState('2.00');
  const [balance, setBalance] = useState(profile.balance);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shown, setShown] = useState(1);
  const [recent, setRecent] = useState([]);
  const anim = useRef(null);

  const target = Math.round(Number(String(targetText).replace(',', '.')) * 100) / 100;
  const targetOk = target >= 1.01 && target <= 10000;
  const chance = targetOk ? Math.min(99, 99 / target) : 0;

  useEffect(() => () => anim.current?.stop(), []);

  const play = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api('/games/limbo/start', { bet, opts: { target } });
      setBalance(r.balance);
      // число «взлетает» от ×1 до выпавшего — быстро, по логарифму
      await new Promise(done => {
        anim.current = animate(0, Math.log(r.view.point), {
          duration: Math.min(1.1, 0.35 + Math.log10(r.view.point) * 0.25), ease: [.15, .7, .3, 1],
          onUpdate: v => setShown(Math.exp(v)), onComplete: done,
        });
      });
      setShown(r.view.point);
      setResult(r);
      setRecent(rs => [r.view, ...rs].slice(0, 12));
      haptic(r.outcome === 'win' ? 'success' : 'error');
      await refresh();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const state = result ? (result.outcome === 'win' ? 'win' : 'lose') : '';

  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={busy} sub={targetOk ? `→ ${fmtShort(bet * target)}` : null} />
      <div className="table-felt limbo-felt">
        <div className="crash-recent">
          {recent.map((v, i) => (
            <span key={recent.length - i} className={`crash-pill ${v.point >= v.target ? 'hi' : 'lo'}`}>{fmtX(v.point)}</span>
          ))}
        </div>
        <motion.div className={`limbo-readout ${state}`} key={result ? 'r' + recent.length : 'idle'}
          initial={result ? { scale: 1.12 } : false} animate={{ scale: 1 }}>
          {fmtX(shown)}
        </motion.div>
        <div className="dice-sub">Цель {targetOk ? fmtX(target) : '—'} · шанс {chance.toFixed(chance < 1 ? 3 : 2)}%</div>
        {result && <ResultBanner result={result} extra={`Выпало ${fmtX(result.view.point)} при цели ${fmtX(result.view.target)}`} />}
        {err && <div className="notice">⚠ {err}</div>}
      </div>

      {!result && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={play}
          label={`Играть до ${targetOk ? fmtX(target) : '…'}`} busyLabel="Летим…" canDeal={targetOk}>
          <div className="limbo-target">
            <span>Цель ×</span>
            <input className="bet-input" inputMode="decimal" value={targetText} disabled={busy}
              onChange={e => setTargetText(e.target.value.replace(/[^\d.,]/g, '').slice(0, 8))}
              onBlur={() => targetOk && setTargetText(target.toFixed(2))} />
          </div>
          <div className="seg">
            {PRESETS.map(p => (
              <button key={p} className={target === p ? 'active' : ''} disabled={busy}
                onClick={() => { haptic('light'); setTargetText(p.toFixed(2)); }}>×{p}</button>
            ))}
          </div>
          {!targetOk && <div className="hint">Цель от ×1.01 до ×10 000</div>}
        </BetBar>
      )}

      {result && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary big" onClick={() => setResult(null)}>
            🔄 Ещё раз
          </motion.button>
        </motion.div>
      )}
    </main>
  );
}
