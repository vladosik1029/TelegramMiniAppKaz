import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, tg, haptic, startParam } from './api.js';
import Blackjack from './games/Blackjack.jsx';
import Ochko from './games/Ochko.jsx';
import Poker from './games/Poker.jsx';
import Roulette from './games/Roulette.jsx';
import Slots from './games/Slots.jsx';
import Mines from './games/Mines.jsx';
import HiLo from './games/HiLo.jsx';
import Dice from './games/Dice.jsx';
import Crash from './games/Crash.jsx';
import Plinko from './games/Plinko.jsx';
import Baccarat from './games/Baccarat.jsx';
import Limbo from './games/Limbo.jsx';
import Tower from './games/Tower.jsx';
import Keno from './games/Keno.jsx';
import { AnimatedNumber } from './components/fx.jsx';
import { setMaxBet } from './components/ui.jsx';
import { soundOn, setSoundOn, onSoundChange } from './sound.js';
import Wallet from './components/Wallet.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import Rules, { RulesCard } from './components/Rules.jsx';
import Tables from './components/Tables.jsx';
import Fairness, { ensureBrowserSeed } from './components/Fairness.jsx';

const GAMES = [
  { id: 'blackjack', title: 'Blackjack', subtitle: '21 очко против дилера', icon: '🂡', group: 'cards', accent: 'emerald' },
  { id: 'ochko', title: 'Очко', subtitle: 'Русская «21» с пан-пан', icon: '♠️', group: 'cards', accent: 'ruby' },
  { id: 'poker', title: 'Покер', subtitle: 'Пятикарточный дро-покер', icon: '🂱', group: 'cards', accent: 'sapphire' },
  { id: 'baccarat', title: 'Баккара', subtitle: 'Игрок, Банкир или Ничья', icon: '🎴', group: 'cards', accent: 'violet' },
  { id: 'hilo', title: 'Выше / Ниже', subtitle: 'Угадай следующую карту', icon: '🃏', group: 'cards', accent: 'amber' },
  { id: 'crash', title: 'Ракета', subtitle: 'Забери до взрыва', icon: '🚀', group: 'online', accent: 'amber', live: true },
  { id: 'plinko', title: 'Плинко', subtitle: 'Шарик через колышки, до ×170', icon: '🟡', group: 'quick', accent: 'violet' },
  { id: 'roulette', title: 'Рулетка', subtitle: 'Европейская, 37 лунок', icon: '🎡', group: 'quick', accent: 'ruby' },
  { id: 'slots', title: 'Слоты', subtitle: '3 барабана, до ×200', icon: '🎰', group: 'quick', accent: 'violet' },
  { id: 'mines', title: 'Сапёр', subtitle: 'Открывай алмазы, беги от мин', icon: '💎', group: 'quick', accent: 'sapphire' },
  { id: 'dice', title: 'Кости', subtitle: 'Сам выбираешь шанс', icon: '🎲', group: 'quick', accent: 'emerald' },
  { id: 'limbo', title: 'Лимбо', subtitle: 'Загадай икс — до ×10 000', icon: '🎯', group: 'quick', accent: 'amber' },
  { id: 'tower', title: 'Башня', subtitle: '8 этажей, обходи мины', icon: '🗼', group: 'quick', accent: 'sapphire' },
  { id: 'keno', title: 'Кено', subtitle: '10 шаров из 40, до ×1000', icon: '🔢', group: 'quick', accent: 'ruby' },
];

const TABS = [
  { id: 'games', icon: '🎰', label: 'Игры' },
  { id: 'tables', icon: '👥', label: 'Столы' },
  { id: 'wallet', icon: '👤', label: 'Профиль' },
  { id: 'rules', icon: '📖', label: 'Правила' },
  { id: 'admin', icon: '👑', label: 'Админ', admin: true },
];

const GROUPS = [
  { id: 'online', title: '🔥 Онлайн с другими игроками' },
  { id: 'cards', title: '🃏 Карточные', note: 'против крупье' },
  { id: 'quick', title: '⚡ Быстрые', note: 'раунд за пару секунд' },
];

const SCREENS = { blackjack: Blackjack, ochko: Ochko, poker: Poker, roulette: Roulette, slots: Slots, mines: Mines, hilo: HiLo, dice: Dice, crash: Crash, plinko: Plinko, baccarat: Baccarat, limbo: Limbo, tower: Tower, keno: Keno };

export default function App() {
  const [profile, setProfile] = useState(null);
  // приглашение за стол: t.me/<bot>?startapp=room_<id>
  const [inviteRoomId, setInviteRoomId] = useState(() => (/^room_[\w-]+$/.test(startParam) ? startParam.slice(5) : null));
  const [tab, setTab] = useState(inviteRoomId ? 'tables' : 'games'); // games | tables | wallet | rules | admin
  const [screenGame, setScreenGame] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [showFair, setShowFair] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    try { tg?.ready?.(); tg?.expand?.(); } catch {}
    api('/init').then(p => { setMaxBet(p.maxBet); setProfile(p); }).catch(e => setErr(e.message));
    ensureBrowserSeed(); // Provably Fair: client seed придумывает браузер, а не сервер
  }, []);

  const fairBtn = (
    <button className="icon-btn" aria-label="Проверка честности" onClick={() => { haptic('light'); setShowFair(true); }}>
      🛡<span className="rules-btn-label">Честность</span>
    </button>
  );
  const fairSheet = (
    <Sheet open={showFair} onClose={() => setShowFair(false)}>
      <Fairness />
    </Sheet>
  );

  const refresh = async () => setProfile(await api('/init'));

  if (err) return <div className="app-error">⚠ {err}</div>;
  if (!profile) return <div className="app-loading">Загрузка…</div>;

  if (screenGame) {
    const back = async () => { setShowRules(false); setScreenGame(null); await refresh(); };
    const gameProps = { profile, refresh, onExit: back };
    const meta = GAMES.find(g => g.id === screenGame);
    return (
      <motion.div
        key={screenGame}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <div className="topbar game-topbar">
          <button className="icon-btn" onClick={back} aria-label="Назад">←</button>
          <div className="game-topbar-title">
            <span>{meta?.icon}</span> {meta?.title}
          </div>
          <button className="icon-btn rules-btn" aria-label="Правила" onClick={() => { haptic('light'); setShowRules(true); }}>
            📖<span className="rules-btn-label">Правила</span>
          </button>
          {fairBtn}
          <Coin balance={profile.balance} />
        </div>
        {SCREENS[screenGame] && React.createElement(SCREENS[screenGame], gameProps)}
        <Sheet open={showRules} onClose={() => setShowRules(false)}>
          <RulesCard id={screenGame} />
        </Sheet>
        {fairSheet}
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
        <div className="topbar-right">
          <SoundToggle />
          {fairBtn}
          <Coin balance={balance} />
        </div>
      </header>
      {fairSheet}

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
              {GROUPS.map(gr => (
                <section key={gr.id}>
                  <h3 className="section-title">{gr.title}{gr.note && <small>{gr.note}</small>}</h3>
                  <motion.div className="game-grid" variants={gridStagger} initial="hidden" animate="show">
                    {GAMES.filter(g => g.group === gr.id).map(g => (
                      <GameTile key={g.id} g={g} onClick={() => { haptic('light'); setScreenGame(g.id); }} />
                    ))}
                    {gr.id === 'online' && (
                      <GameTile g={{ icon: '👥', title: 'Столы с друзьями', subtitle: 'Рулетка, блэкджек, покер, дурак', accent: 'emerald' }}
                        onClick={() => { haptic('light'); setTab('tables'); }} />
                    )}
                  </motion.div>
                </section>
              ))}
              {balance <= 0 && (
                <div className="notice">Фишки кончились! Чтобы продолжить игру, попроси админа начислить баланс.</div>
              )}
            </main>
          )}

          {tab === 'tables' && (
            <Tables profile={profile} refresh={refresh}
              inviteRoomId={inviteRoomId} onInviteHandled={() => setInviteRoomId(null)} />
          )}
          {tab === 'wallet' && <Wallet profile={profile} refresh={refresh} />}
          {tab === 'rules' && <Rules />}
          {tab === 'admin' && profile.isAdmin && <AdminPanel me={profile} refresh={refresh} />}
        </motion.div>
      </AnimatePresence>

      <nav className={`bottombar ${profile.isAdmin ? 'five' : ''}`}>
        {TABS.filter(t => !t.admin || profile.isAdmin).map(t => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => { haptic('light'); setTab(t.id); }}>
            <span className="tab-icon">{t.icon}</span><span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

function GameTile({ g, onClick }) {
  return (
    <motion.button variants={gridItem} whileTap={{ scale: .96 }} className={`game-card accent-${g.accent}`} onClick={onClick}>
      <div className="game-icon">{g.icon}</div>
      <div className="game-text">
        <div className="game-title">{g.title}{g.live && <span className="live-dot">онлайн</span>}</div>
        <div className="game-sub">{g.subtitle}</div>
      </div>
      <span className="game-shine" aria-hidden />
    </motion.button>
  );
}

/** Нижняя шторка (на ПК — окно по центру), закрывается по фону и Esc */
export function Sheet({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-backdrop" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="sheet" onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
            <button className="sheet-close" onClick={onClose} aria-label="Закрыть">✕</button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const gridStagger = { hidden: {}, show: { transition: { staggerChildren: .05 } } };
const gridItem = {
  hidden: { opacity: 0, y: 14, scale: .96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 26 } },
};

function SoundToggle() {
  const [on, setOn] = useState(soundOn());
  useEffect(() => onSoundChange(setOn), []);
  return (
    <button className="icon-btn" aria-label={on ? 'Выключить звук' : 'Включить звук'} title={on ? 'Звук включён' : 'Звук выключен'}
      onClick={() => { haptic('light', null); setSoundOn(!on); }}>
      {on ? '🔊' : '🔇'}
    </button>
  );
}

export function Coin({ balance }) {
  return (
    <div className="coin">
      <span className="coin-icon">🪙</span>
      <span className="coin-value"><AnimatedNumber value={balance} /></span>
    </div>
  );
}
