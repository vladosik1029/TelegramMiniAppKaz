import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, tg, haptic } from './api.js';
import Blackjack from './games/Blackjack.jsx';
import Ochko from './games/Ochko.jsx';
import Poker from './games/Poker.jsx';
import Roulette from './games/Roulette.jsx';
import Wallet from './components/Wallet.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import Rules from './components/Rules.jsx';

const GAMES = [
  { id: 'blackjack', title: 'Blackjack', subtitle: '21 очко против дилера', icon: '🂡' },
  { id: 'ochko', title: 'Очко', subtitle: 'Русская «21» с пан-пан', icon: '♠️' },
  { id: 'poker', title: 'Покер', subtitle: 'Пятикарточный дро-покер', icon: '🂱' },
  { id: 'roulette', title: 'Рулетка', subtitle: 'Европейская, 37 лунок', icon: '🎡' },
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
      <motion.div
        key={screenGame}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <div className="topbar">
          <button className="btn-ghost" onClick={back}>← Назад</button>
          <Coin balance={profile.balance} />
        </div>
        {screenGame === 'blackjack' && <Blackjack {...gameProps} />}
        {screenGame === 'ochko' && <Ochko {...gameProps} />}
        {screenGame === 'poker' && <Poker {...gameProps} />}
        {screenGame === 'roulette' && <Roulette {...gameProps} />}
      </motion.div>
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

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`tab-${tab}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
        >
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
          {tab === 'rules' && <Rules />}
          {tab === 'admin' && profile.isAdmin && <AdminPanel me={profile} refresh={refresh} />}
        </motion.div>
      </AnimatePresence>

      <nav className="bottombar">
        <button className={tab === 'games' ? 'active' : ''} onClick={() => { haptic('light'); setTab('games'); }}>🎰 Игры</button>
        <button className={tab === 'wallet' ? 'active' : ''} onClick={() => { haptic('light'); setTab('wallet'); }}>💰 Кошелёк</button>
        <button className={tab === 'rules' ? 'active' : ''} onClick={() => { haptic('light'); setTab('rules'); }}>📖 Правила</button>
        {profile.isAdmin && (
          <button className={tab === 'admin' ? 'active' : ''} onClick={() => { haptic('light'); setTab('admin'); }}>👑 Админ</button>
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
