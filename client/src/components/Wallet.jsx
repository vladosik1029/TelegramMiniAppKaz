import React, { useState, useEffect } from 'react';
import { api } from '../api.js';
import { ResultBanner } from './ui.jsx';

const GAME_NAMES = {
  blackjack: 'Blackjack', ochko: 'Очко', poker: 'Покер', roulette: 'Рулетка', roulette_room: 'Рулетка · стол', blackjack_room: 'Blackjack · стол', ochko_room: 'Очко · стол', poker_room: 'Покер · стол', durak_room: 'Дурак · стол', crash: 'Ракета', plinko: 'Плинко', baccarat: 'Баккара',
  slots: 'Слоты', mines: 'Сапёр', hilo: 'Выше / Ниже', dice: 'Кости',
};

export default function Wallet({ profile, refresh }) {
  const [history, setHistory] = useState(profile.history || []);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/init')
      .then(p => setHistory(p.history || []))
      .catch(e => setErr(e.message));
  }, []);

  const totalNet = history.reduce((s, h) => s + h.net, 0);

  return (
    <main className="page">
      <div className="wallet-card">
        <div className="wallet-title">Мой баланс</div>
        <div className="wallet-balance">{profile.balance.toLocaleString('ru-RU')} 🪙</div>
        <div className="wallet-id">ID: {profile.id}</div>
      </div>

      {err && <div className="notice">⚠ {err}</div>}

      <h3 className="section-title">История</h3>
      {history.length === 0 && <div className="hint">Ещё не сыграно ни одной игры</div>}
      {history.map((h, i) => (
        <div key={i} className="history-row">
          <div>
            <div className="history-game">{GAME_NAMES[h.game] || h.game}</div>
            <div className="history-time">{h.created_at}</div>
          </div>
          <div>
            <div className="history-bet">ставка {h.bet.toLocaleString('ru-RU')}</div>
            <div className={`history-net ${h.net > 0 ? 'pos' : h.net < 0 ? 'neg' : ''}`}>
              {h.net > 0 ? '+' : ''}{h.net === 0 ? '0' : h.net.toLocaleString('ru-RU')}
            </div>
          </div>
        </div>
      ))}
    </main>
  );
}
