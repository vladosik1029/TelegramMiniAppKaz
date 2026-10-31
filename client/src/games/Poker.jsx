import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { api, haptic } from '../api.js';
import { CardView, BetBar, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import StakeStrip from '../components/StakeStrip.jsx';

function PokerHand({ title, cards, label, selectable, selected, onToggle }) {
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
      </div>
      <div className="cards">
        {cards.map((c, i) => (
          selectable ? (
            <motion.button
              key={i}
              whileTap={{ scale: .93 }}
              className={`card-slot ${selected.has(i) ? 'selected' : ''}`}
              onClick={() => onToggle(i)}
            >
              <CardView card={c} dim={selected.has(i)} delay={Math.min(i * 0.06, 0.3)} />
              <span className="card-slot-mark">{selected.has(i) ? '↺' : ''}</span>
            </motion.button>
          ) : (
            <CardView key={i} card={c} delay={Math.min(i * 0.06, 0.3)} />
          )
        ))}
      </div>
    </div>
  );
}

export default function Poker({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [view, setView] = useState(null);
  const [balance, setBalance] = useState(profile.balance);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const deal = async () => {
    setBusy(true); setErr(''); setResult(null); setSelected(new Set());
    try {
      const r = await api('/games/poker/start', { bet });
      setBalance(r.balance);
      setView(r.view);
      if (r.finished) { setResult(r); await refresh(); }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const toggle = (i) => {
    haptic('light');
    const next = new Set(selected);
    next.has(i) ? next.delete(i) : next.add(i);
    setSelected(next);
  };

  const draw = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api('/games/poker/action', { action: { discard: [...selected] } });
      setBalance(r.balance);
      setView(r.view);
      if (r.finished) {
        setResult(r);
        haptic(r.outcome === 'win' ? 'success' : r.outcome === 'lose' ? 'error' : 'light');
        await refresh();
      }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={!!(view && !result)} />
      <div className="table-felt">
        <PokerHand
          title="🤖 Бот" cards={view?.bot ?? []}
          label={view?.botHand || null}
        />
        <div className="felt-sep" />
        <PokerHand
          title="🙋 Ты" cards={view?.player ?? []}
          label={view?.playerHand || null}
          selectable={view && !result && view.stage === 'draw'}
          selected={selected}
          onToggle={toggle}
        />
        {view && !result && view.stage === 'draw' && (
          <div className="hint rw-pick-hint">Нажми на карты, которые хочешь обменять ({selected.size} выбрано)</div>
        )}
      </div>

      {result && <ResultBanner result={result} />}

      {err && <div className="notice">⚠ {err}</div>}

      {(!view || result) && !view && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={deal} />
      )}

      {view && view.stage === 'draw' && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary" disabled={busy} onClick={draw}>
            Обменять ({selected.size || 0})
          </motion.button>
          {result || !view ? null : (
            <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn" disabled={busy} onClick={() => setSelected(new Set())}>
              Снять выбор
            </motion.button>
          )}
        </motion.div>
      )}

      {result && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary big" onClick={() => { setResult(null); setView(null); }}>
            🔄 Новая партия
          </motion.button>
        </motion.div>
      )}
    </main>
  );
}
