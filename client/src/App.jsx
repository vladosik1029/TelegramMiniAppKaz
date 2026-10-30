import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, tg, haptic } from './api.js';
import Blackjack from './games/Blackjack.jsx';
import Ochko from './games/Ochko.jsx';
import Poker from './games/Poker.jsx';
import Roulette from './games/Roulette.jsx';
import Slots from './games/Slots.jsx';
import Mines from './games/Mines.jsx';
import HiLo from './games/HiLo.jsx';
import Dice from './games/Dice.jsx';
import { AnimatedNumber } from './components/fx.jsx';
import Wallet from './components/Wallet.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import Rules from './components/Rules.jsx';

const GAMES = [
  { id: 'blackjack', title: 'Blackjack', subtitle: '21 очко против дилера', icon: '🂡', group: 'cards', accent: 'emerald' },
  { id: 'ochko', title: 'Очко', subtitle: 'Русская «21» с пан-пан', icon: '♠️', group: 'cards', accent: 'ruby' },
  { id: 'poker', title: 'Покер', subtitle: 'Пятикарточный дро-покер', icon: '🂱', group: 'cards', accent: 'sapphire' },
  { id: 'hilo', title: 'Выше / Ниже', subtitle: 'Угадай следующую карту', icon: '🃏', group: 'cards', accent: 'amber', isNew: true },
  { id: 'roulette', title: 'Рулетка', subtitle: 'Европейская, 37 лунок', icon: '🎡', group: 'quick', accent: 'ruby' },
  { id: 'slots', title: 'Слоты', subtitle: '3 барабана, до ×200', icon: '🎰', group: 'quick', accent: 'violet', isNew: true },
  { id: 'mines', title: 'Сапёр', subtitle: 'Открывай алмазы, беги от мин', icon: '💎', group: 'quick', accent: 'sapphire', isNew: true },
  { id: 'dice', title: 'Кости', subtitle: 'Сам выбираешь шанс', icon: '🎲', group: 'quick', accent: 'emerald', isNew: true },
];

const GROUPS = [
  { id: 'cards', title: '🃏 Карточные' },
  { id: 'quick', title: '⚡ Быстрые' },
];

const SCREENS = { blackjack: Blackjack, ochko: Ochko, poker: Poker, roulette: Roulette, slots: Slots, mines: Mines, hilo: HiLo, dice: Dice };

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
        {SCREENS[screenGame] && React.createElement(SCREENS[screenGame], gameProps)}
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
              <div className="hero">
                <div className="hero-glow" aria-hidden />
                <div className="hero-suits" aria-hidden>♠ ♥ ♦ ♣</div>
                <div className="hero-title">Казино на фантики</div>
                <div className="hero-sub">{GAMES.length} игр · честный рандом на сервере</div>
              </div>
              {GROUPS.map(gr => (
                <section key={gr.id}>
                  <h3 className="section-title">{gr.title}</h3>
                  <motion.div className="game-grid" variants={gridStagger} initial="hidden" animate="show">
                    {GAMES.filter(g => g.group === gr.id).map(g => (
                      <motion.button
                        key={g.id}
                        variants={gridItem}
                        whileTap={{ scale: .96 }}
                        className={`game-card accent-${g.accent}`}
                        onClick={() => { haptic('light'); setScreenGame(g.id); }}
                      >
                        {g.isNew && <span className="new-badge">NEW</span>}
                        <div className="game-icon">{g.icon}</div>
                        <div className="game-title">{g.title}</div>
                        <div className="game-sub">{g.subtitle}</div>
                        <span className="game-shine" aria-hidden />
                      </motion.button>
                    ))}
                  </motion.div>
                </section>
              ))}
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

const gridStagger = { hidden: {}, show: { transition: { staggerChildren: .05 } } };
const gridItem = {
  hidden: { opacity: 0, y: 14, scale: .96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 26 } },
};

export function Coin({ balance }) {
  return (
    <div className="coin">
      <span className="coin-icon">🪙</span>
      <span className="coin-value"><AnimatedNumber value={balance} /></span>
    </div>
  );
}
