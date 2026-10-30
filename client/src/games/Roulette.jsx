// Рулетка (европейская, 37 лунок). Сервер сразу крутит спин, клиент --
// анимирует вращение колеса до выпавшей лунки и показывает баннер.

import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { api, haptic } from '../api.js';
import { ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';

const STEP = 360 / 37;
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// порядок лунокEuropean wheel — для раскраски конического градиента
const ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

const WHEEL_BG = `conic-gradient(${ORDER.map((n, i) => {
  const c = colorOf(n) === 'red' ? '#b8352b' : colorOf(n) === 'green' ? '#1f9450' : '#232830';
  return `${c} ${(i * STEP).toFixed(3)}deg ${((i + 1) * STEP).toFixed(3)}deg`;
}).join(', ')})`;

const BETS = [
  { type: 'red', label: 'Красное', mult: '×2', cls: 'red' },
  { type: 'black', label: 'Чёрное', mult: '×2', cls: 'black' },
  { type: 'even', label: 'Чётное', mult: '×2' },
  { type: 'odd', label: 'Нечётное', mult: '×2' },
  { type: 'low', label: '1–18', mult: '×2' },
  { type: 'high', label: '19–36', mult: '×2' },
  { type: 'd1', label: '1–12', mult: '×3' },
  { type: 'd2', label: '13–24', mult: '×3' },
  { type: 'd3', label: '25–36', mult: '×3' },
  { type: 'c1', label: 'Колонка 1', mult: '×3' },
  { type: 'c2', label: 'Колонка 2', mult: '×3' },
  { type: 'c3', label: 'Колонка 3', mult: '×3' },
  { type: 'num', label: 'Число', mult: '×36' },
];

const COLOR_NAME = { red: '🔴 Красное', black: '⚫ Чёрное', green: '🟢 ЗЕРО' };

export default function Roulette({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [bType, setBType] = useState('red');
  const [num, setNum] = useState(null);
  const [balance, setBalance] = useState(profile.balance);
  const [result, setResult] = useState(null); // ответ сервера (outcome/net/view)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rot, setRot] = useState(0);
  const rotRef = useRef(0);

  const spinWheelTo = (idx) => {
    const target = -idx * STEP;                       // куда должна встать лунка (под маркер)
    const base = ((target - rotRef.current) % 360 + 360) % 360;
    rotRef.current = rotRef.current + 360 * 5 + base; // 5 оборотов + поправка, всегда вперёд
    setRot(rotRef.current);
    return new Promise(r => setTimeout(r, 4400));
  };

  const spin = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api('/games/roulette/start', {
        bet,
        opts: { type: bType, value: bType === 'num' ? num : null },
      });
      setBalance(r.balance);
      await spinWheelTo(r.view.pocketIdx);
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
          <div className="wheel-box">
            <div className="wheel-pointer" />
            <motion.div
              className="wheel"
              animate={{ rotate: rot }}
              transition={{ duration: 4.2, ease: [.15, .75, .1, 1] }}
            >
              <div className="wheel-face" style={{ background: WHEEL_BG }} />
            </motion.div>
            <motion.div
              className="wheel-ball-ring"
              animate={{ rotate: -rot - 720 }}
              transition={{ duration: 4.2, ease: [.15, .75, .1, 1] }}
            >
              <div className="wheel-ball" />
            </motion.div>
            <div className="wheel-hub">
              {result ? (
                <>
                  <span className={`hub-num ${result.view.color}`}>{result.view.number}</span>
                  <small>{COLOR_NAME[result.view.color]}</small>
                </>
              ) : (
                <small>{busy ? 'ШАР БЕГАЕТ…' : 'ДЕЛАЙ СТАВКУ'}</small>
              )}
            </div>
          </div>
        </div>

        {result && (
          <ResultBanner
            result={result}
            extra={`${result.view.number} — ${COLOR_NAME[result.view.color]} · ${rLabelText(result.view)}`}
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
            <div className="num-chips">
              {Array.from({ length: 37 }, (_, n) => (
                <motion.button
                  whileTap={{ scale: .88 }}
                  key={n}
                  className={`num-chip ${colorOf(n)} ${num === n ? 'sel' : ''}`}
                  disabled={busy}
                  onClick={() => { haptic('light'); setNum(n); }}
                >{n}</motion.button>
              ))}
            </div>
          )}

          <motion.button
            whileTap={{ scale: .96 }}
            className="btn primary big"
            disabled={!canSpin}
            onClick={spin}
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

function rLabelText(v) {
  const bet = BETS.find(b => b.type === v.betType);
  return bet ? `${bet.mult}` : '';
}
