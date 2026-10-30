// Колесо европейской рулетки — общее для соло-игры и столов.
// Поворот ведёт motion value, поэтому во время вращения хаб в реальном
// времени показывает лунку, которая сейчас под маркером.

import React, { useEffect, useRef, useState } from 'react';
import { motion, animate, useMotionValue, useMotionValueEvent } from 'framer-motion';

export const ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
export const STEP = 360 / ORDER.length;
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
export const COLOR_NAME = { red: '🔴 Красное', black: '⚫ Чёрное', green: '🟢 ЗЕРО' };

// Типы ставок (как в server/src/games/roulette.js)
export const ROULETTE_BETS = [
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

const WHEEL_BG = `conic-gradient(${ORDER.map((n, i) => {
  const c = colorOf(n) === 'red' ? '#b8352b' : colorOf(n) === 'green' ? '#1f9450' : '#232830';
  return `${c} ${(i * STEP).toFixed(3)}deg ${((i + 1) * STEP).toFixed(3)}deg`;
}).join(', ')})`;

/** Угол, при котором центр лунки idx встаёт под маркер, + turns полных оборотов вперёд */
export function nextWheelAngle(current, idx, turns = 5) {
  const target = -(idx + 0.5) * STEP;
  const delta = ((target - current) % 360 + 360) % 360;
  return current + 360 * turns + delta;
}

/** Номер лунки под маркером при данном повороте колеса */
export const pocketAt = (rot) => ORDER[Math.floor(((((-rot) % 360) + 360) % 360) / STEP) % ORDER.length];

/**
 * spin: { key, idx, duration? } — новая key запускает вращение к лунке idx.
 * result: { number, color } — что показать в хабе после остановки.
 */
export default function Wheel({ spin, result, idleText = 'ДЕЛАЙ СТАВКУ', onDone }) {
  const rot = useMotionValue(-0.5 * STEP);
  const ballRot = useMotionValue(0);
  const [spinning, setSpinning] = useState(false);
  const [live, setLive] = useState(null);
  const lastKey = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useMotionValueEvent(rot, 'change', (v) => { if (spinning) setLive(pocketAt(v)); });

  useEffect(() => {
    if (!spin || spin.key == null || spin.key === lastKey.current) return;
    lastKey.current = spin.key;
    const duration = spin.duration ?? 4.2;
    if (duration <= 0.05) { // мгновенно (например, подключились, когда шар уже лёг)
      rot.set(nextWheelAngle(rot.get(), spin.idx, 0));
      doneRef.current?.();
      return;
    }
    setSpinning(true);
    const ease = [.15, .75, .1, 1];
    const a = animate(rot, nextWheelAngle(rot.get(), spin.idx, Math.max(2, Math.round(duration + 1))), { duration, ease });
    // шар бежит навстречу и ложится ровно под маркер (кратно 360°)
    const b = animate(ballRot, Math.floor(ballRot.get() / 360) * 360 - 360 * Math.max(3, Math.round(duration * 1.6)), { duration, ease });
    a.then(() => { setSpinning(false); setLive(null); doneRef.current?.(); });
    return () => { a.stop(); b.stop(); };
  }, [spin?.key]);

  const shown = spinning ? live : null;

  return (
    <div className="wheel-box">
      <div className="wheel-pointer" />
      <motion.div className="wheel" style={{ rotate: rot }}>
        <div className="wheel-face" style={{ background: WHEEL_BG }} />
        <div className="wheel-nums" aria-hidden>
          {ORDER.map((n, i) => (
            <span key={n} className="wheel-num" style={{ transform: `rotate(${(i + 0.5) * STEP}deg)` }}>
              <b>{n}</b>
            </span>
          ))}
        </div>
      </motion.div>
      <motion.div className="wheel-ball-ring" style={{ rotate: ballRot }}>
        <div className={`wheel-ball ${spinning ? 'rolling' : ''}`} />
      </motion.div>
      <div className={`wheel-hub ${spinning ? 'live' : ''}`}>
        {spinning ? (
          <>
            <span className={`hub-num ${shown != null ? colorOf(shown) : ''}`}>{shown ?? '…'}</span>
            <small>ПОД МАРКЕРОМ</small>
          </>
        ) : result ? (
          <>
            <motion.span key={result.number} className={`hub-num ${result.color}`}
              initial={{ scale: .4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 14 }}>{result.number}</motion.span>
            <small>{COLOR_NAME[result.color]}</small>
          </>
        ) : (
          <small>{idleText}</small>
        )}
      </div>
    </div>
  );
}

/** Горизонтальная лента чисел 0–36: на ПК прокручивается колесом мыши */
export function NumberStrip({ value, onPick, disabled, badges }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // горизонтальный трекпад — нативно
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="num-chips" ref={ref}>
      {Array.from({ length: 37 }, (_, n) => (
        <motion.button
          whileTap={{ scale: .88 }}
          key={n}
          className={`num-chip ${colorOf(n)} ${value === n ? 'sel' : ''}`}
          disabled={disabled}
          onClick={() => onPick(n)}
        >
          {n}
          {badges?.[n] ? <i className="num-badge">{badges[n]}</i> : null}
        </motion.button>
      ))}
    </div>
  );
}
