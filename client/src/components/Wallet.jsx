// Вкладка «Профиль»: баланс, уровень, значки, статистика по играм, история
// и таблица лидеров (за неделю / за всё время, по выигрышу или по крупнейшему кушу).

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { api, haptic } from '../api.js';
import { fmtShort } from './StakeStrip.jsx';

export const GAME_NAMES = {
  blackjack: 'Blackjack', ochko: 'Очко', poker: 'Покер', roulette: 'Рулетка', roulette_room: 'Рулетка · стол', blackjack_room: 'Blackjack · стол', ochko_room: 'Очко · стол', poker_room: 'Покер · стол', durak_room: 'Дурак · стол', crash: 'Ракета', plinko: 'Плинко', baccarat: 'Баккара',
  slots: 'Слоты', mines: 'Сапёр', hilo: 'Выше / Ниже', dice: 'Кости',
};

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
const signed = (n) => (n > 0 ? '+' : '') + fmtShort(n);

export default function Wallet({ profile }) {
  const [tab, setTab] = useState('me');
  return (
    <main className="page wallet">
      <div className="seg profile-tabs">
        {[['me', '👤 Профиль'], ['top', '🏆 Топ игроков']].map(([id, l]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => { haptic('light'); setTab(id); }}>{l}</button>
        ))}
      </div>
      {tab === 'me' ? <Me profile={profile} /> : <Leaderboard />}
    </main>
  );
}

function Me({ profile }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState(profile.history || []);
  const [err, setErr] = useState('');
  const [allBadges, setAllBadges] = useState(false);

  useEffect(() => {
    api('/profile').then(setData).catch(e => setErr(e.message));
    api('/init').then(p => setHistory(p.history || [])).catch(() => {});
  }, []);

  const lv = data?.level;
  const st = data?.stats;
  const got = data?.badges.filter(b => b.got) ?? [];
  const shownBadges = allBadges ? data?.badges ?? [] : got;

  return (
    <>
      <div className="wallet-card profile-card">
        <div className="profile-head">
          <div className="profile-avatar">{(profile.firstName || '?').slice(0, 1).toUpperCase()}</div>
          <div className="profile-name">
            <b>{profile.firstName}</b>
            <small>{lv ? `Уровень ${lv.level} · ${lv.title}` : '…'}</small>
          </div>
          <div className="profile-balance">
            <small>Баланс</small>
            <b>{fmt(profile.balance)} 🪙</b>
          </div>
        </div>
        {lv && (
          <div className="level-bar" title={`${fmt(lv.xp)} / ${fmt(lv.to)}`}>
            <motion.i initial={{ width: 0 }} animate={{ width: `${Math.round(lv.progress * 100)}%` }} transition={{ duration: .8, ease: 'easeOut' }} />
            <span>до уровня {lv.level + 1}: поставь ещё {fmtShort(lv.to - lv.xp)} 🪙</span>
          </div>
        )}
        <div className="wallet-id">ID: {profile.id}</div>
      </div>

      {err && <div className="notice">⚠ {err}</div>}

      {st && (
        <div className="stat-grid">
          <Stat label="Раундов" value={fmt(st.rounds)} />
          <Stat label="Побед" value={st.rounds ? `${Math.round(st.wins / st.rounds * 100)}%` : '—'} />
          <Stat label="Поставлено" value={fmtShort(st.wagered)} />
          <Stat label="Итог" value={signed(st.net)} tone={st.net > 0 ? 'pos' : st.net < 0 ? 'neg' : ''} />
          <Stat label="Лучший выигрыш" value={st.bestWin ? `+${fmtShort(st.bestWin)}` : '—'} sub={data.best ? GAME_NAMES[data.best.game] || data.best.game : null} />
          <Stat label="Лучший икс" value={st.bestMult ? `×${st.bestMult.toLocaleString('ru-RU')}` : '—'} />
        </div>
      )}

      {data && (
        <>
          <h3 className="section-title">Значки <small>{got.length} из {data.badges.length}</small></h3>
          <div className="badge-grid">
            {shownBadges.map(b => (
              <div key={b.id} className={`badge ${b.got ? 'got' : ''}`} title={b.hint}>
                <span className="badge-icon">{b.icon}</span>
                <b>{b.title}</b>
                <small>{b.hint}</small>
              </div>
            ))}
            {!allBadges && got.length === 0 && <div className="hint">Пока ни одного — сыграй пару раундов</div>}
          </div>
          <button className="btn-ghost badge-more" onClick={() => setAllBadges(v => !v)}>
            {allBadges ? 'Только полученные' : 'Показать все значки'}
          </button>
        </>
      )}

      {data?.byGame.length > 0 && (
        <>
          <h3 className="section-title">По играм</h3>
          <div className="by-game">
            {data.byGame.map(g => (
              <div key={g.game} className="history-row">
                <div>
                  <div className="history-game">{GAME_NAMES[g.game] || g.game}</div>
                  <div className="history-time">{fmt(g.rounds)} раундов · поставлено {fmtShort(g.wagered)}</div>
                </div>
                <div className={`history-net ${g.net > 0 ? 'pos' : g.net < 0 ? 'neg' : ''}`}>{signed(g.net)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="section-title">История</h3>
      {history.length === 0 && <div className="hint">Ещё не сыграно ни одной игры</div>}
      {history.map((h, i) => (
        <div key={i} className="history-row">
          <div>
            <div className="history-game">{GAME_NAMES[h.game] || h.game}</div>
            <div className="history-time">{h.created_at}</div>
          </div>
          <div>
            <div className="history-bet">ставка {fmt(h.bet)}</div>
            <div className={`history-net ${h.net > 0 ? 'pos' : h.net < 0 ? 'neg' : ''}`}>
              {h.net > 0 ? '+' : ''}{h.net === 0 ? '0' : fmt(h.net)}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function Stat({ label, value, sub, tone = '' }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <b className={tone}>{value}</b>
      {sub && <i>{sub}</i>}
    </div>
  );
}

const MEDAL = ['🥇', '🥈', '🥉'];

function Leaderboard() {
  const [period, setPeriod] = useState('week');
  const [by, setBy] = useState('net');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setData(null); setErr('');
    api(`/leaderboard?period=${period}&by=${by}`).then(setData).catch(e => setErr(e.message));
  }, [period, by]);

  const meOutside = data?.me && !data.top.some(r => r.me);

  return (
    <>
      <div className="lb-filters">
        <div className="seg">
          {[['week', 'Эта неделя'], ['all', 'Всё время']].map(([id, l]) => (
            <button key={id} className={period === id ? 'active' : ''} onClick={() => { haptic('light'); setPeriod(id); }}>{l}</button>
          ))}
        </div>
        <div className="seg">
          {[['net', 'Выигрыш'], ['best', 'Лучший куш']].map(([id, l]) => (
            <button key={id} className={by === id ? 'active' : ''} onClick={() => { haptic('light'); setBy(id); }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="hint lb-note">
        {by === 'net' ? 'Сумма выигрышей минус проигрыши' : 'Самый крупный выигрыш за один раунд'}
        {period === 'week' ? ' · неделя с понедельника' : ''}
      </div>

      {err && <div className="notice">⚠ {err}</div>}
      {!data && !err && <div className="hint">Загрузка…</div>}
      {data && data.top.length === 0 && <div className="hint">Пока никто не в плюсе — стань первым!</div>}

      <div className="lb-list">
        {data?.top.map(r => <LbRow key={r.place} r={r} />)}
        {meOutside && (<><div className="lb-gap">…</div><LbRow r={data.me} /></>)}
      </div>
      {data && !data.me && data.top.length > 0 && <div className="hint lb-note">Тебя пока нет в таблице — нужен плюс за период.</div>}
    </>
  );
}

function LbRow({ r }) {
  return (
    <motion.div className={`lb-row ${r.me ? 'me' : ''} ${r.place <= 3 ? 'podium' : ''}`}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(r.place, 10) * 0.03 }}>
      <span className="lb-place">{MEDAL[r.place - 1] ?? r.place}</span>
      <span className="lb-name">{r.name}{r.me && <small> (ты)</small>}<small>{fmt(r.rounds)} раундов</small></span>
      <b className="lb-score">+{fmtShort(r.score)} 🪙</b>
    </motion.div>
  );
}
