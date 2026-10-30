// Вкладка «Столы» — мультиплеер.
// Лобби (публичные столы + мои) → создание стола → приглашение по ссылке
// (гость сначала видит параметры и жмёт «Войти»/«Отказаться») → экран стола.
// Создание/вход/выход — REST, ставки и спин — WebSocket (см. server/src/ws.js).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, tg, haptic, wsConnect, wsSend, onWsMsg, wsIsOpen } from '../api.js';
import Wheel, { ROULETTE_BETS, COLOR_NAME, NumberStrip, colorOf } from './Wheel.jsx';
import { AnimatedNumber } from './fx.jsx';
import CardTable from './CardTable.jsx';

const GAME_ICON = { roulette: '🎡', blackjack: '🂡', ochko: '♠️', poker: '🂱', durak: '🃏' };
const GAME_TITLE = { roulette: 'рулетка', blackjack: 'блэкджек', ochko: 'очко', poker: 'покер', durak: 'дурак' };
const fmt = (n) => Number(n).toLocaleString('ru-RU');

export default function Tables({ profile, refresh, inviteRoomId, onInviteHandled }) {
  const [roomId, setRoomId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState(null);   // диалог входа (по ссылке или из лобби)
  const [toast, setToast] = useState('');

  // приглашение из ссылки t.me/<bot>?startapp=room_<id>
  useEffect(() => {
    if (!inviteRoomId) return;
    onInviteHandled?.();
    openPreview(inviteRoomId);
  }, [inviteRoomId]);

  const openPreview = async (id) => {
    try {
      const { preview: p } = await api(`/rooms/${id}/preview`);
      if (p.inRoom) setRoomId(p.id); else setPreview(p);
    } catch (e) { setToast(e.message); }
  };

  const join = async () => {
    try {
      await api(`/rooms/${preview.id}/join`, {});
      haptic('success');
      setRoomId(preview.id);
      setPreview(null);
      await refresh();
    } catch (e) { setToast(e.message); haptic('error'); }
  };

  const exitRoom = async (msg) => {
    setRoomId(null);
    if (msg) setToast(msg);
    await refresh();
  };

  return (
    <main className="page tables">
      {roomId ? (
        <RoomScreen key={roomId} roomId={roomId} profile={profile} onExit={exitRoom} />
      ) : creating ? (
        <CreateRoom
          balance={profile.balance}
          onCancel={() => setCreating(false)}
          onCreated={async (id) => { setCreating(false); setRoomId(id); await refresh(); }}
        />
      ) : (
        <Lobby onCreate={() => setCreating(true)} onOpen={openPreview} />
      )}

      <AnimatePresence>
        {preview && (
          <InviteDialog preview={preview} balance={profile.balance} onJoin={join} onDecline={() => setPreview(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && <Toast text={toast} onDone={() => setToast('')} />}
      </AnimatePresence>
    </main>
  );
}

// ─── лобби ───────────────────────────────────────────────────────────────────

function Lobby({ onCreate, onOpen }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () => api('/rooms').then(d => alive && (setData(d), setErr(''))).catch(e => alive && setErr(e.message));
    load();
    const t = setInterval(load, 5000); // лёгкий поллинг списка; сам стол живёт на ws
    return () => { alive = false; clearInterval(t); };
  }, []);

  const rooms = data?.rooms ?? [];

  return (
    <>
      <div className="tables-hero">
        <div>
          <div className="tables-title">👥 Столы</div>
          <div className="tables-sub">Играй с друзьями: общий спин, свой банк стола</div>
        </div>
        <motion.button whileTap={{ scale: .94 }} className="btn gold small" onClick={() => { haptic('light'); onCreate(); }}>
          ➕ Создать
        </motion.button>
      </div>

      {err && <div className="notice">⚠ {err}</div>}
      {!data && !err && <div className="hint">Загружаем столы…</div>}
      {data && !rooms.length && (
        <div className="tables-empty">
          <div className="tables-empty-icon">🎡</div>
          Открытых столов пока нет — создай свой и позови друзей по ссылке.
        </div>
      )}

      <motion.div className="tables-list" initial="hidden" animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: .05 } } }}>
        {rooms.map(r => (
          <motion.button
            key={r.id}
            className={`room-row ${r.mine ? 'mine' : ''}`}
            variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
            whileTap={{ scale: .98 }}
            onClick={() => { haptic('light'); onOpen(r.id); }}
          >
            <div className="room-icon">{GAME_ICON[r.game]}</div>
            <div className="room-main">
              <div className="room-name">{!r.isPublic && '🔒 '}{r.name}</div>
              <div className="room-meta">
                бай-ин {fmt(r.buyIn)} 🪙 · хост {r.hostName}
              </div>
            </div>
            <div className="room-side">
              <div className="room-seats">{r.players}/{r.max}</div>
              {r.mine ? <span className="room-badge">ты здесь</span>
                : <span className={`dot ${r.online ? 'on' : ''}`} title="онлайн" />}
            </div>
          </motion.button>
        ))}
      </motion.div>
    </>
  );
}

// ─── создание стола ──────────────────────────────────────────────────────────

function CreateRoom({ balance, onCancel, onCreated }) {
  const [games, setGames] = useState(null);
  const [game, setGame] = useState('roulette');
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [buyIn, setBuyIn] = useState(Math.min(500, Math.max(10, balance)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api('/rooms').then(d => setGames(d.games)).catch(e => setErr(e.message)); }, []);

  const create = async () => {
    setBusy(true); setErr('');
    try {
      const { room } = await api('/rooms', { name, game, isPublic, buyIn });
      haptic('success');
      onCreated(room.id);
    } catch (e) { setErr(e.message); haptic('error'); }
    setBusy(false);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="topbar">
        <button className="btn-ghost" onClick={onCancel}>← Столы</button>
      </div>
      <div className="modal-card inline">
        <div className="modal-title">Новый стол</div>

        <div className="modal-block">
          <div className="modal-label">Игра</div>
          <div className="game-pick">
            {Object.entries(games ?? { roulette: { title: 'Рулетка', ready: true } }).map(([id, g]) => (
              <button key={id} disabled={!g.ready} className={`game-pick-item ${game === id ? 'active' : ''}`}
                onClick={() => { haptic('light'); setGame(id); }}>
                <span>{GAME_ICON[id]}</span>{g.title}
                {!g.ready && <small>скоро</small>}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-block">
          <div className="modal-label">Название</div>
          <input className="input" maxLength={40} placeholder="Например, «Пятничная рулетка»"
            value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div className="modal-block">
          <div className="modal-label">Кто может войти</div>
          <div className="seg">
            <button className={isPublic ? 'active' : ''} onClick={() => setIsPublic(true)}>🌐 Все</button>
            <button className={!isPublic ? 'active' : ''} onClick={() => setIsPublic(false)}>🔒 По ссылке</button>
          </div>
        </div>

        <div className="modal-block">
          <div className="modal-label">Бай-ин (банк стола для каждого)</div>
          <div className="preset-row">
            {[100, 500, 1000, 5000].map(v => (
              <button key={v} className={`chip small ${buyIn === v ? 'active-chip' : ''}`} onClick={() => setBuyIn(v)}>{fmt(v)}</button>
            ))}
          </div>
          <input className="input" type="number" min={10} value={buyIn}
            onChange={e => setBuyIn(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
          <div className="hint">Сумма спишется с баланса в банк стола. При выходе остаток вернётся.</div>
        </div>

        {err && <div className="notice">⚠ {err}</div>}
        <div className="actions">
          <button className="btn" onClick={onCancel}>Отмена</button>
          <motion.button whileTap={{ scale: .96 }} className="btn primary" disabled={busy || buyIn < 10 || buyIn > balance} onClick={create}>
            Создать за {fmt(buyIn)} 🪙
          </motion.button>
        </div>
        {buyIn > balance && <div className="hint">Бай-ин больше твоего баланса</div>}
      </div>
    </motion.div>
  );
}

// ─── диалог приглашения ──────────────────────────────────────────────────────

function InviteDialog({ preview: p, balance, onJoin, onDecline }) {
  const [busy, setBusy] = useState(false);
  const full = p.players.length >= p.max;
  const poor = balance < p.buyIn;
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onDecline}>
      <motion.div className="modal-card" onClick={e => e.stopPropagation()}
        initial={{ y: 40, scale: .96, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}>
        <div className="modal-title">{GAME_ICON[p.game]} {p.name}</div>
        <div className="hint">Тебя зовут за стол · {p.gameTitle}</div>

        <div className="invite-params">
          <div className="invite-row"><span>Бай-ин</span><b>{fmt(p.buyIn)} 🪙</b></div>
          <div className="invite-row"><span>Хост</span><b>{p.hostName}</b></div>
          <div className="invite-row"><span>Места</span><b>{p.players.length} / {p.max}</b></div>
          <div className="invite-row"><span>Доступ</span><b>{p.isPublic ? '🌐 открытый' : '🔒 по ссылке'}</b></div>
          <div className="invite-row"><span>Твой баланс</span><b>{fmt(balance)} 🪙</b></div>
        </div>
        {p.players.length > 0 && <div className="invite-players">За столом: {p.players.join(', ')}</div>}

        {full && <div className="notice">Свободных мест нет</div>}
        {!full && poor && <div className="notice">Не хватает фишек на бай-ин</div>}

        <div className="actions">
          <button className="btn" onClick={onDecline}>Отказаться</button>
          <motion.button whileTap={{ scale: .96 }} className="btn gold" disabled={busy || full || poor}
            onClick={async () => { setBusy(true); await onJoin(); setBusy(false); }}>
            Войти за {fmt(p.buyIn)} 🪙
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Toast({ text, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [text]);
  return (
    <motion.div className="toast" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
      {text}
    </motion.div>
  );
}

// ─── стол ────────────────────────────────────────────────────────────────────

const CHIPS = [5, 10, 25, 50, 100, 500];

function RoomScreen({ roomId, profile, onExit }) {
  const [room, setRoom] = useState(null);
  const [connected, setConnected] = useState(wsIsOpen());
  const [chip, setChip] = useState(10);
  const [numPick, setNumPick] = useState(null);
  const [err, setErr] = useState('');
  const [spin, setSpin] = useState(null);         // что крутит колесо
  const [shownSpin, setShownSpin] = useState(null); // итог, показанный после остановки
  const seenSeq = useRef(null);
  const inited = useRef(false);
  const pendingSpin = useRef(null);
  const roomRef = useRef(null);
  const frozen = useRef(null); // банки «до спина» — чтобы не спойлерить итог, пока крутится колесо

  // ws: подключение, подписка на стол, входящие состояния
  useEffect(() => {
    wsConnect();
    const off = onWsMsg((m) => {
      if (m.type === '_open') { setConnected(true); wsSend({ op: 'sub', roomId }); }
      else if (m.type === '_close') setConnected(false);
      else if (m.type === 'room' && m.room.id === roomId) applyRoom(m.room);
      else if (m.type === 'left' && m.roomId === roomId) {
        onExit(m.cashout != null ? `Ты вышел из-за стола. На баланс вернулось ${fmt(m.cashout)} 🪙` : 'Ты больше не за этим столом');
      } else if (m.type === 'closed' && m.roomId === roomId) onExit('Стол закрыт');
      else if (m.type === 'error') { setErr(m.error); haptic('error'); }
    });
    if (wsIsOpen()) wsSend({ op: 'sub', roomId });
    // REST как страховка, если ws ещё не поднялся
    api(`/rooms/${roomId}`).then(d => applyRoom(d.room)).catch(e => onExit(e.message));
    return () => { off(); };
  }, [roomId]);

  function applyRoom(r) {
    const prev = roomRef.current;
    roomRef.current = r;
    setRoom(r);
    const ls = r.lastSpin;
    if (!inited.current) {
      // первое состояние: спин уже был — показываем (докручиваем, если шар ещё бежит)
      inited.current = true;
      seenSeq.current = ls?.seq ?? null;
      if (!ls) return;
      if (r.status === 'spinning' && r.spinLeftMs > 900) {
        pendingSpin.current = ls;
        setSpin({ key: ls.seq, idx: ls.idx, duration: (r.spinLeftMs - 300) / 1000 });
      } else {
        setSpin({ key: ls.seq, idx: ls.idx, duration: 0 });
        setShownSpin(ls);
      }
      return;
    }
    if (!ls) return;
    if (ls.seq !== seenSeq.current) {
      seenSeq.current = ls.seq;
      pendingSpin.current = ls;
      frozen.current = prev;
      setShownSpin(null);
      haptic('medium');
      setSpin({ key: ls.seq, idx: ls.idx, duration: Math.max(1.5, Math.min(4.6, (r.spinLeftMs - 400) / 1000)) });
    }
  }

  const onSpinDone = () => {
    const ls = pendingSpin.current;
    pendingSpin.current = null;
    frozen.current = null;
    if (!ls) return;
    setShownSpin(ls);
    const mine = ls.results?.[profile.id];
    if (mine) haptic(mine.net > 0 ? 'success' : mine.net < 0 ? 'error' : 'light');
  };

  const myBets = useMemo(() => (room?.bets ?? []).filter(b => b.userId === profile.id), [room, profile.id]);
  const myStake = myBets.reduce((s, b) => s + b.amount, 0);
  const frozenStake = (frozen.current?.bets ?? []).filter(b => b.userId === profile.id).reduce((s, b) => s + b.amount, 0);
  const stakeOn = (type, value = null) =>
    myBets.filter(b => b.type === type && (type !== 'num' || b.value === value)).reduce((s, b) => s + b.amount, 0);
  const numBadges = useMemo(() => {
    const out = {};
    for (const b of myBets) if (b.type === 'num') out[b.value] = (out[b.value] ?? 0) + b.amount;
    return out;
  }, [myBets]);

  if (!room) return <div className="hint">Подключаемся к столу…</div>;

  const spinning = room.status === 'spinning' || pendingSpin.current != null;
  // пока шар бежит — показываем банки как до спина
  const before = spinning && frozen.current;
  const bankOf = (p) => (before ? before.players.find(x => x.id === p.id)?.bank ?? p.bank : p.bank);
  const you = before ? { ...room.you, roomBalance: before.you.roomBalance } : room.you;
  // «Готов» ждём от игроков онлайн, у которых есть фишки или ставки (как на сервере)
  const waitFor = room.players.filter(p => p.online && (p.bank > 0 || p.bet > 0));
  const readyCount = waitFor.filter(p => p.ready).length;
  const canBet = connected && !spinning && you.roomBalance >= 1;
  const myResult = shownSpin?.results?.[profile.id];
  const totalOnTable = room.players.reduce((s, p) => s + p.bet, 0);

  const bet = (type, value = null) => {
    if (!canBet) return;
    const amount = Math.min(chip, you.roomBalance);
    if (amount < 1) return;
    haptic('light'); setErr('');
    wsSend({ op: 'bet', type, value, amount });
  };

  const share = () => {
    const link = room.invite.link;
    const text = `Залетай за мой стол «${room.name}» — ${GAME_TITLE[room.game] ?? 'игра'}, бай-ин ${fmt(room.buyIn)} 🪙`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    haptic('light');
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else navigator.clipboard?.writeText(link).then(() => setErr('Ссылка скопирована: ' + link)).catch(() => setErr(link));
  };

  // карточный стол: ставка до раздачи вернётся, посреди раздачи рука доигрывается без тебя
  const myCardStake = room.round?.phase === 'betting' ? (room.players.find(p => p.id === profile.id)?.bet ?? 0) : 0;
  const leave = () => {
    const back = you.roomBalance + (room.round ? myCardStake : myStake);
    const ask = `Выйти из-за стола? На баланс вернётся ${fmt(back)} 🪙`;
    const go = () => {
      if (wsIsOpen()) wsSend({ op: 'leave' });
      else api(`/rooms/${roomId}/leave`, {}).then(r => onExit(`Ты вышел из-за стола. На баланс вернулось ${fmt(r.cashout)} 🪙`)).catch(e => setErr(e.message));
    };
    if (tg?.showConfirm) tg.showConfirm(ask, ok => ok && go());
    else if (window.confirm(ask)) go();
  };

  const head = (
    <div className="room-head">
      <button className="btn-ghost" onClick={() => onExit()}>← Столы</button>
      <div className="room-head-title">
        <div>{room.isPublic ? '🌐' : '🔒'} {room.name}</div>
        <small>{GAME_ICON[room.game]} бай-ин {fmt(room.buyIn)} · <span className={`dot ${connected ? 'on' : ''}`} /> {connected ? 'онлайн' : 'переподключение…'}</small>
      </div>
      <button className="btn small" onClick={share}>🔗 Пригласить</button>
    </div>
  );

  if (room.round) {
    return (
      <CardTable room={room} profile={profile} connected={connected} head={head} err={err} setErr={setErr}
        leaveLabel={`🚪 Выйти и забрать ${fmt(you.roomBalance + myCardStake)} 🪙`} onLeave={leave} />
    );
  }

  return (
    <motion.div className="game-screen room-screen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      {head}

      <div className="table-felt rw-felt">
        <div className="rw-wrap">
          <Wheel
            spin={spin}
            onDone={onSpinDone}
            result={shownSpin && { number: shownSpin.number, color: shownSpin.color }}
            idleText={room.bets.length ? `НА СТОЛЕ ${fmt(totalOnTable)}` : 'ДЕЛАЙТЕ СТАВКИ'}
          />
        </div>

        <div className="recent-strip">
          {room.recent.map((n, i) => (
            <span key={`${room.recent.length}-${i}`} className={`recent-num ${colorOf(n)} ${i === 0 && pendingSpin.current ? 'hidden' : ''}`}>{n}</span>
          ))}
        </div>

        {/* слот фиксированной высоты: появление итога не сдвигает страницу */}
        <div className="room-result-slot">
          {!(shownSpin && myResult) && <div className="room-result-idle">Итог раунда появится здесь</div>}
          <AnimatePresence>
            {shownSpin && myResult && (
              <motion.div key={shownSpin.seq} className={`result-banner ${myResult.net > 0 ? 'win' : myResult.net < 0 ? 'lose' : 'push'}`}
                initial={{ scale: .8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 16 }}>
                {myResult.net > 0 ? `✅ +${fmt(myResult.net)} 🪙` : myResult.net < 0 ? `❌ ${fmt(myResult.net)} 🪙` : '🤝 В ноль'}
                <div className="result-extra">{shownSpin.number} — {COLOR_NAME[shownSpin.color]} · поставил {fmt(myResult.staked)}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* игроки */}
      <div className="players-list">
        {room.players.map(p => {
          const r = shownSpin?.results?.[p.id];
          return (
            <div key={p.id} className={`player-row ${p.id === profile.id ? 'me' : ''}`}>
              <span className={`dot ${p.online ? 'on' : ''}`} />
              <span className="player-name">{p.isHost && '👑 '}{p.name}{p.id === profile.id && ' (ты)'}</span>
              {before && (before.players.find(x => x.id === p.id)?.bet ?? 0) > 0 &&
                <span className="player-bet">ставка {fmt(before.players.find(x => x.id === p.id).bet)}</span>}
              {!before && p.bet > 0 && <span className="player-bet">ставка {fmt(p.bet)}</span>}
              {!spinning && p.ready && <span className="player-ready">✓ готов</span>}
              {r && !spinning && <span className={`player-net ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}`}>{r.net > 0 ? '+' : ''}{fmt(r.net)}</span>}
              <span className="player-bank"><AnimatedNumber value={bankOf(p)} /> 🪙</span>
            </div>
          );
        })}
      </div>

      {/* ставки */}
      <div className="betbar">
        <div className="bet-row">
          <div className="room-bank">
            <small>Твой банк стола</small>
            <b><AnimatedNumber value={you.roomBalance} /> 🪙</b>
          </div>
          <div className="room-bank right">
            <small>На столе</small>
            <b>{fmt(before ? frozenStake : myStake)} 🪙</b>
          </div>
        </div>

        <div className="chip-row">
          {CHIPS.map(c => (
            <motion.button key={c} whileTap={{ scale: .9 }}
              className={`casino-chip c${c} ${chip === c ? 'sel' : ''}`}
              onClick={() => { haptic('light'); setChip(c); }}>{c}</motion.button>
          ))}
        </div>
        <div className="hint">Тапни по полю — поставишь фишку {fmt(chip)}. Тапни ещё раз — добавишь.</div>

        <div className="bets-grid">
          {ROULETTE_BETS.filter(b => b.type !== 'num').map(b => {
            const s = stakeOn(b.type);
            return (
              <motion.button whileTap={{ scale: .94 }} key={b.type} disabled={!canBet}
                className={`bet-opt ${b.cls || ''} ${s ? 'active-chip' : ''}`} onClick={() => bet(b.type)}>
                <span>{b.label}</span>
                <small>{b.mult}</small>
                {s > 0 && <i className="bet-stake">{fmt(s)}</i>}
              </motion.button>
            );
          })}
        </div>
        <div className="modal-label" style={{ marginTop: 8 }}>Число ×36</div>
        <NumberStrip value={numPick} badges={numBadges} disabled={!canBet}
          onPick={(n) => { setNumPick(n); bet('num', n); }} />

        {err && <div className="notice">⚠ {err}</div>}

        <div className="actions">
          <button className="btn small" disabled={!canBet || !myBets.length}
            onClick={() => { haptic('light'); wsSend({ op: 'clear' }); }}>↩ Снять ставки</button>
          {spinning ? (
            <div className="room-wait">Колесо крутится…</div>
          ) : (
            <motion.button whileTap={{ scale: .96 }} className={`btn ${you.ready ? 'ready-on' : 'gold'}`}
              disabled={!connected || (!you.ready && !myBets.length)}
              onClick={() => { haptic('light'); setErr(''); wsSend({ op: 'ready', ready: !you.ready }); }}>
              {you.ready ? '✓ Готов · отменить' : myBets.length ? 'Готов ✋' : 'Сделай ставку'}
            </motion.button>
          )}
        </div>
        <div className="hint ready-hint">
          {spinning ? 'Ставки закрыты до остановки колеса.'
            : `Готовы ${readyCount} из ${waitFor.length}. Колесо закрутится, когда все сделают ставки и нажмут «Готов».`}
        </div>
      </div>

      <button className="btn danger big room-leave" onClick={leave}>
        🚪 Выйти и забрать {fmt(you.roomBalance + myStake)} 🪙
      </button>
    </motion.div>
  );
}
