// Общие UI-компоненты: карта, рука, панель ставки, результат раунда

import React from 'react';
import { haptic } from '../api.js';

const colorOf = (c) => (c.s === '♥' || c.s === '♦' ? 'red' : 'black');

export function CardView({ card, dim }) {
  if (card?.hidden) {
    return <div className="card back"><div className="card-back-pattern" /></div>;
  }
  return (
    <div className={`card ${colorOf(card)} ${dim ? 'dim' : ''}`}>
      <span className="card-rank">{card.r}</span>
      <span className="card-suit">{card.s}</span>
      <span className="card-suit-big">{card.s}</span>
    </div>
  );
}

export function Hand({ title, cards, total, label }) {
  return (
    <div className="hand">
      <div className="hand-head">
        <span className="hand-title">{title}</span>
        {label && <span className="hand-label">{label}</span>}
        {total != null && <span className="hand-total">{total}</span>}
      </div>
      <div className="cards">
        {cards.map((c, i) => <CardView key={i} card={c} />)}
      </div>
    </div>
  );
}

export function BetBar({ balance, bet, setBet, disabled, onDeal }) {
  const clamp = (v) => Math.max(1, Math.min(Number(v) || 0, Math.max(balance, 1)));
  const presets = [10, 50, 100, 500];
  return (
    <div className="betbar">
      <div className="bet-row">
        <button className="chip" disabled={disabled} onClick={() => { haptic('light'); setBet(clamp(bet - 10)); }}>−10</button>
        <div className="bet-value">{bet.toLocaleString('ru-RU')} 🪙</div>
        <button className="chip" disabled={disabled} onClick={() => { haptic('light'); setBet(clamp(bet + 10)); }}>+10</button>
      </div>
      <div className="preset-row">
        {presets.map(p => (
          <button key={p} className="chip small" disabled={disabled} onClick={() => { haptic('light'); setBet(Math.min(p, balance)); }}>{p}</button>
        ))}
        <button className="chip small" disabled={disabled} onClick={() => { haptic('light'); setBet(balance); }}>Все 🪙</button>
      </div>
      <button className="btn primary big" disabled={disabled || bet < 1 || bet > balance} onClick={onDeal}>
        {disabled ? 'Раунд идёт…' : 'Раздать карты'}
      </button>
      {bet > balance && <div className="hint">Ставка больше баланса — уменьши её</div>}
    </div>
  );
}

const OUTCOME_TEXT = {
  win: (net) => `✅ Победа! +${net.toLocaleString('ru-RU')} 🪙`,
  lose: (net) => `❌ Проигрыш ${net.toLocaleString('ru-RU')} 🪙`,
  push: () => '🤝 Ничья — ставка возвращена',
};

export function ResultBanner({ result, extra }) {
  if (!result) return null;
  const text = OUTCOME_TEXT[result.outcome]?.(result.net) ?? '';
  return (
    <div className={`result-banner ${result.outcome}`}>
      <div>{text}</div>
      {extra && <div className="result-extra">{extra}</div>}
    </div>
  );
}
