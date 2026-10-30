// Визуальные эффекты: «бегущее» число баланса, взрыв монет при выигрыше,
// счётчик-«барабан» для чисел (кости, множители).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, animate, useMotionValue, useMotionValueEvent } from 'framer-motion';

/** Число плавно докручивается до нового значения (баланс, множитель) */
export function AnimatedNumber({ value, decimals = 0, duration = 0.6, format }) {
  const mv = useMotionValue(value);
  const [shown, setShown] = useState(value);
  const first = useRef(true);

  useMotionValueEvent(mv, 'change', (v) => setShown(v));
  useEffect(() => {
    if (first.current) { first.current = false; mv.set(value); return; }
    const c = animate(mv, value, { duration, ease: [.2, .8, .2, 1] });
    return () => c.stop();
  }, [value]);

  const n = decimals ? Number(shown.toFixed(decimals)) : Math.round(shown);
  return <>{format ? format(n) : n.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}

/** Взрыв монет из центра — разовый эффект поверх баннера выигрыша */
export function CoinBurst({ count = 14 }) {
  const parts = useMemo(() => Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + Math.random() * .4;
    const r = 70 + Math.random() * 60;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * .7 - 30, rot: Math.random() * 540 - 270, d: Math.random() * .12 };
  }), [count]);

  return (
    <div className="coin-burst" aria-hidden>
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="coin-burst-item"
          initial={{ x: 0, y: 0, scale: .3, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 80], scale: [0.3, 1, .8], opacity: [1, 1, 0], rotate: p.rot }}
          transition={{ duration: 1.1, delay: p.d, ease: 'easeOut', times: [0, .45, 1] }}
        >🪙</motion.span>
      ))}
    </div>
  );
}

/** Множитель в русском формате: 1,98 */
export const fmtMult = (m) => Number(m).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
