import React, { useState } from 'react';
import { api, haptic } from '../api.js';
import { CardView, BetBar, ResultBanner } from '../components/ui.jsx';

function PokerHand({ title, cards, label, selectable, selected, onToggle }) {
  return (
    <div className="hand">
      <div className="hand-head">
        <span className="hand-title">{title}</span>
        {label && <span className="hand-label">{label}</span>}
      </div>
      <div className="cards">
        {cards.map((c, i) => (
          selectable ? (
            <button
              key={i}
              className={`card-slot ${selected.has(i) ? 'selected' : ''}`}
              onClick={() => onToggle(i)}
            >
              <CardView card={c} dim={selected.has(i)} />
              <span className="card-slot-mark">{selected.has(i) ? '↺' : ''}</span>
            </button>
          ) : (
            <CardView key={i} card={c} />
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
      <PokerHand
        title="🤖 Бот" cards={view?.bot ?? []}
        label={view?.botHand || null}
      />
      <PokerHand
        title="🙋 Ты" cards={view?.player ?? []}
        label={view?.playerHand || null}
        selectable={view && !result && view.stage === 'draw'}
        selected={selected}
        onToggle={toggle}
      />

      {view && !result && view.stage === 'draw' && (
        <div className="hint">Нажми на карты, которые хочешь обменять ({selected.size} выбрано)</div>
      )}

      {result && <ResultBanner result={result} />}

      {err && <div className="notice">⚠ {err}</div>}

      {(!view || result) && !view && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={deal} />
      )}

      {view && view.stage === 'draw' && (
        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={draw}>
            Обменять ({selected.size || 0})
          </button>
          {result || !view ? null : (
            <button className="btn" disabled={busy} onClick={() => setSelected(new Set())}>
              Снять выбор
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="actions">
          <button className="btn primary big" onClick={() => { setResult(null); setView(null); }}>
            🔄 Новая партия
          </button>
        </div>
      )}
    </main>
  );
}
