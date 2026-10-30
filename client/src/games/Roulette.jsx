// Рулетка (европейская, 37 лунок). Сервер сразу крутит спин, клиент
// анимирует колесо до выпавшей лунки (хаб показывает лунку под маркером вживую).

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { api, haptic } from '../api.js';
import { ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import Wheel, { ROULETTE_BETS as BETS, COLOR_NAME, NumberStrip } from '../components/Wheel.jsx';

const SPIN_S = 4.2;

export default function Roulette({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [bType, setBType] = useState('red');
  const [num, setNum] = useState(null);
  const [balance, setBalance] = useState(profile.balance);
  const [result, setResult] = useState(null); // ответ сервера (outcome/net/view)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [spin, setSpin] = useState(null);

  const doSpin = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api('/games/roulette/start', {
        bet,
        opts: { type: bType, value: bType === 'num' ? num : null },
      });
      setBalance(r.balance);
      await new Promise(done => setSpin({ key: Date.now(), idx: r.view.pocketIdx, duration: SPIN_S, done }));
      setResult(r);
      haptic(r.outcome === 'win' ? 'success' : 'error');
      await refresh();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const presets = [10, 50, 100, 500];
  const clamp = (v) => Math.max(1, Math.min(Number(v) || 0, Math.max(balance, 1)));
  const canSpin = !busy && bet >= 1 && bet <= balance && (bType !== 'num' || num != null);

  return (
    <main className="page game-screen">

      {/* ─── стол ───────────────────────────────────────── */}
      <div className="table-felt rw-felt">
        <div className="rw-wrap">
          <Wheel
            spin={spin}
            onDone={() => spin?.done?.()}
            result={result && { number: result.view.number, color: result.view.color }}
            idleText={busy ? 'ШАР БЕГАЕТ…' : 'ДЕЛАЙ СТАВКУ'}
          />
        </div>

        {result && (
          <ResultBanner
            result={result}
            extra={`${result.view.number} — ${COLOR_NAME[result.view.color]} · ${BETS.find(b => b.type === result.view.betType)?.mult ?? ''}`}
          />
        )}
        {err && <div className="notice">⚠ {err}</div>}
      </div>

      {/* ─── панель ставки ──────────────────────────────── */}
      {!result && (
        <div className="betbar">
          <div className="bet-row">
            <button className="chip" disabled={busy} onClick={() => { haptic('light'); setBet(clamp(bet - 10)); }}>−10</button>
            <motion.div key={bet} className="bet-value" initial={{ scale: 1.25 }} animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 550, damping: 24 }}>
              {bet.toLocaleString('ru-RU')} 🪙
            </motion.div>
            <button className="chip" disabled={busy} onClick={() => { haptic('light'); setBet(clamp(bet + 10)); }}>+10</button>
          </div>
          <div className="preset-row">
            {presets.map(p => (
              <motion.button whileTap={{ scale: .9 }} key={p} className="chip small" disabled={busy}
                onClick={() => { haptic('light'); setBet(Math.min(p, balance)); }}>{p}</motion.button>
            ))}
          </div>

          <div className="bets-grid">
            {BETS.map(b => (
              <motion.button
                whileTap={{ scale: .94 }}
                key={b.type}
                className={`bet-opt ${bType === b.type ? 'active' : ''} ${b.cls || ''}`}
                disabled={busy}
                onClick={() => { haptic('light'); setBType(b.type); }}
              >
                <span>{b.label}</span>
                <small>{b.mult}</small>
              </motion.button>
            ))}
          </div>

          {bType === 'num' && (
            <NumberStrip value={num} disabled={busy} onPick={(n) => { haptic('light'); setNum(n); }} />
          )}

          <motion.button
            whileTap={{ scale: .96 }}
            className="btn primary big"
            disabled={!canSpin}
            onClick={doSpin}
          >
            {busy ? 'Колесо крутится…' : bType === 'num' && num == null ? 'Выбери число' : 'Крутить колесо 🎡'}
          </motion.button>
          {bet > balance && <div className="hint">Ставка больше баланса — уменьши её</div>}
        </div>
      )}

      {/* ─── новый раунд ───────────────────────────────── */}
      {result && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary big"
            onClick={() => setResult(null)}>
            🔄 Ещё спин
          </motion.button>
        </motion.div>
      )}
    </main>
  );
}
