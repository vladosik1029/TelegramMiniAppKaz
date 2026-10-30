// Общие UI-компоненты: карта, рука, панель ставки, результат раунда.
// Все анимации — framer-motion + CSS (см. styles.css, keyframes flipIn).

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { haptic } from '../api.js';
import { CoinBurst } from './fx.jsx';

const colorOf = (c) => (c.s === '♥' || c.s === '♦' ? 'red' : 'black');

// 3D-переворот: детектим переход «закрытая → открытая» и кратко вешаем класс анимации
export function CardView({ card, dim, delay = 0 }) {
  const prevHidden = useRef(false);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    const hidden = !!card?.hidden;
    if (prevHidden.current && card && !hidden) {
      setFlipping(true);
      const t = setTimeout(() => setFlipping(false), 700);
      prevHidden.current = false;
      return () => clearTimeout(t);
    }
    prevHidden.current = hidden;
  }, [card?.hidden]);

  return (
    <motion.div
      className={`card-anim ${dim ? 'dim' : ''} ${flipping ? 'flipping' : ''}`}
      initial={{ opacity: 0, y: -120, rotate: -14, scale: .85 }}
      animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24, delay }}
      style={{ perspective: 700 }}
    >
      {card?.hidden ? (
        <div className="card back"><div className="card-back-pattern" /></div>
      ) : (
        <div className={`card ${colorOf(card)}`}>
          <span className="card-rank">{card.r}</span>
          <span className="card-suit">{card.s}</span>
          <span className="card-suit-big">{card.s}</span>
        </div>
      )}
    </motion.div>
  );
}

export function Hand({ title, cards, total, label }) {
  return (
    <div className="hand">
      <div className="hand-head">
        <span className="hand-title">{title}</span>
        {label && (
          <motion.span
            key={label}
            className="hand-label"
            initial={{ scale: .5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
          >{label}</motion.span>
        )}
        {total != null && <span className="hand-total">{total}</span>}
      </div>
      <div className="cards">
        {cards.map((c, i) => (
          <CardView key={i} card={c} delay={Math.min(i * 0.06, 0.3)} />
        ))}
      </div>
    </div>
  );
}

export function BetBar({ balance, bet, setBet, disabled, onDeal, label = 'Раздать карты', busyLabel = 'Раунд идёт…', canDeal = true, children }) {
  const clamp = (v) => Math.max(1, Math.min(Number(v) || 0, Math.max(balance, 1)));
  const presets = [10, 50, 100, 500];
  return (
    <div className="betbar">
      <div className="bet-row">
        <button className="chip" disabled={disabled} onClick={() => { haptic('light'); setBet(clamp(bet - 10)); }}>−10</button>
        <motion.div
          key={bet}
          className="bet-value"
          initial={{ scale: 1.25 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 550, damping: 24 }}
        >{bet.toLocaleString('ru-RU')} 🪙</motion.div>
        <button className="chip" disabled={disabled} onClick={() => { haptic('light'); setBet(clamp(bet + 10)); }}>+10</button>
      </div>
      <div className="preset-row">
        {presets.map(p => (
          <motion.button whileTap={{ scale: .9 }} key={p} className="chip small" disabled={disabled} onClick={() => { haptic('light'); setBet(Math.min(p, balance)); }}>{p}</motion.button>
        ))}
        <motion.button whileTap={{ scale: .9 }} className="chip small" disabled={disabled} onClick={() => { haptic('light'); setBet(balance); }}>Все 🪙</motion.button>
      </div>
      {children}
      <motion.button
        whileTap={{ scale: .96 }}
        className="btn primary big"
        disabled={disabled || !canDeal || bet < 1 || bet > balance}
        onClick={onDeal}
      >
        {disabled ? busyLabel : label}
      </motion.button>
      {bet > balance && <div className="hint">Ставка больше баланса — уменьши её</div>}
    </div>
  );
}

const OUTCOME_TEXT = {
  win: (net) => `✅ Победа! +${net.toLocaleString('ru-RU')} 🪙`,
  lose: (net) => `❌ Проигрыш ${net.toLocaleString('ru-RU')} 🪙`,
  push: () => '🤝 Ничья — ставка возвращена',
};

// Варианты для плавного появления строк действий (кнопок)
export const actionsStagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: .06, delayChildren: .05 } },
};
export const actionsItem = {
  hidden: { opacity: 0, y: 12, scale: .96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 400, damping: 26 } },
};

export function ResultBanner({ result, extra }) {
  if (!result) return null;
  const text = OUTCOME_TEXT[result.outcome]?.(result.net) ?? '';
  return (
    <motion.div
      className={`result-banner ${result.outcome}`}
      initial={{ scale: .8, opacity: 0, y: 10 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 15 }}
    >
      {result.outcome === 'win' && <CoinBurst count={result.net >= 500 ? 22 : 12} />}
      <div>{text}</div>
      {extra && <motion.div className="result-extra" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: .15 } }}>{extra}</motion.div>}
    </motion.div>
  );
}
