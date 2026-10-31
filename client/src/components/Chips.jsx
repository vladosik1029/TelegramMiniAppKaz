// Фишки на столе: ставка раскладывается на номиналы и лежит стопкой,
// как в настоящем казино. Стопка «падает» на сукно с пружинкой.

import React from 'react';
import { motion } from 'framer-motion';
import { fmtShort } from './StakeStrip.jsx';

// номинал → цвет фишки (как в казино: белые, красные, зелёные, чёрные, фиолетовые…)
const DENOMS = [
  [1e9, '#e6c065'], [1e8, '#d35400'], [1e7, '#16a085'], [1e6, '#b03a6f'],
  [1e5, '#34495e'], [5e4, '#8e44ad'], [1e4, '#c0392b'], [5e3, '#2c6fbf'],
  [1e3, '#d4a017'], [500, '#7b3fbf'], [100, '#1e1f24'], [50, '#c0392b'],
  [25, '#2f9e62'], [10, '#2c6fbf'], [5, '#8a8f96'], [1, '#d9d9d9'],
];

/** Разложить сумму на фишки (крупные снизу), не больше max штук */
export function chipsFor(amount, max = 7) {
  let left = Math.max(0, Math.floor(Number(amount) || 0));
  const out = [];
  for (const [v, color] of DENOMS) {
    while (left >= v && out.length < max) { out.push({ v, color }); left -= v; }
    if (out.length >= max) break;
  }
  return out;
}

export function ChipStack({ amount, size = 'md', max = 7 }) {
  const chips = chipsFor(amount, max);
  if (!chips.length) return null;
  return (
    <span className={`chip-stack ${size}`} style={{ '--n': chips.length }} aria-hidden>
      {chips.map((c, i) => (
        <motion.i key={`${amount}-${i}`} className="stack-chip" style={{ '--c': c.color, '--i': i }}
          initial={{ y: -28, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 22, delay: i * 0.035 }} />
      ))}
    </span>
  );
}

/** Место ставки на сукне: линия-разделитель, а по центру — стопка и сумма */
export function BetSpot({ amount, label }) {
  if (!(amount > 0)) return <div className="felt-sep" />;
  return (
    <div className="bet-spot">
      <div className="felt-sep" />
      <div className="bet-spot-inner">
        <ChipStack amount={amount} />
        <span className="bet-spot-amount">{label && <small>{label}</small>}{fmtShort(amount)} 🪙</span>
      </div>
    </div>
  );
}
