import React, { useEffect, useState } from 'react';
import { api, tg } from './api.js';
import Blackjack from './games/Blackjack.jsx';
import Ochko from './games/Ochko.jsx';
import Poker from './games/Poker.jsx';
import Wallet from './components/Wallet.jsx';
import AdminPanel from './components/AdminPanel.jsx';

const GAMES = [
  { id: 'blackjack', title: 'Blackjack', subtitle: '21 очко против дилера', icon: '🂡' },
  { id: 'ochko', title: 'Очко', subtitle: 'Русская «21» с пан-пан', icon: '♠️' },
  { id: 'poker', title: 'Покер', subtitle: 'Пятикарточный дро-покер', icon: '🂱' },
];

export default function App() {
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('games'); // games | wallet | admin
  const [screenGame, setScreenGame] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    try { tg?.ready?.(); tg?.expand?.(); } catch {}
    api('/init').then(setProfile).catch(e => setErr(e.message));
  }, []);

  const refresh = async () => setProfile(await api('/init'));

  if (err) return <div className="app-error">⚠ {err}</div>;
  if (!profile) return <div className="app-loading">Загрузка…</div>;

  if (screenGame) {
    const back = async () => { setScreenGame(null); await refresh(); };
    const gameProps = { profile, refresh, onExit: back };
    return (
      <>
        <div className="topbar">
          <button className="btn-ghost" onClick={back}>← Назад</button>
          <Coin balance={profile.balance} />
        </div>
        {screenGame === 'blackjack' && <Blackjack {...gameProps} />}
        {screenGame === 'ochko' && <Ochko {...gameProps} />}
        {screenGame === 'poker' && <Poker {...gameProps} />}
      </>
    );
  }

  const balance = profile.balance;

  return (
    <>
      <header className="topbar">
        <div>
          <div className="hello">{profile.dev && <span className="dev-badge">DEV</span>}{profile.firstName}</div>
          {profile.isAdmin && <div className="admin-badge">👑 Админ</div>}
        </div>
        <Coin balance={balance} />
      </header>

      {tab === 'games' && (
        <main className="home">
          <div className="game-grid">
            {GAMES.map(g => (
              <button key={g.id} className="game-card" onClick={() => setScreenGame(g.id)}>
                <div className="game-icon">{g.icon}</div>
                <div className="game-title">{g.title}</div>
                <div className="game-sub">{g.subtitle}</div>
              </button>
            ))}
          </div>
          {balance <= 0 && (
            <div className="notice">Фишки кончились! Чтобы продолжить игру, попроси админа начислить баланс.</div>
          )}
        </main>
      )}

      {tab === 'wallet' && <Wallet profile={profile} refresh={refresh} />}
      {tab === 'admin' && profile.isAdmin && <AdminPanel me={profile} refresh={refresh} />}

      <nav className="bottombar">
        <button className={tab === 'games' ? 'active' : ''} onClick={() => setTab('games')}>🎰 Игры</button>
        <button className={tab === 'wallet' ? 'active' : ''} onClick={() => setTab('wallet')}>💰 Кошелёк</button>
        {profile.isAdmin && (
          <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>👑 Админ</button>
        )}
      </nav>
    </>
  );
}

export function Coin({ balance }) {
  return (
    <div className="coin">
      <span className="coin-icon">🪙</span>
      <span className="coin-value">{balance.toLocaleString('ru-RU')}</span>
    </div>
  );
}
