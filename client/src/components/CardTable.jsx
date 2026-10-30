// Экран карточного стола: Blackjack и Очко (все против крупье) и дро-покер
// (игроки друг против друга). Всё состояние раунда приходит с сервера в
// room.round (см. server/src/cardtables.js), клиент только рисует и шлёт ходы:
// { op: 'bet' | 'clear' | 'ready' } в фазе ставок и { op: 'act', action } на своём ходу.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic, wsSend } from '../api.js';
import { CardView, actionsStagger, actionsItem } from './ui.jsx';
import { AnimatedNumber } from './fx.jsx';

const fmt = (n) => Number(n).toLocaleString('ru-RU');
const CHIPS = [5, 10, 25, 50, 100, 500];

const ACTION_LABEL = {
  hit: 'Ещё карту', stand: 'Хватит', stop: 'Хватит', double: 'Удвоить',
  check: 'Чек', fold: 'Пас',
};

const STATUS_LABEL = {
  bj: 'BlackJack!', pan: 'Пан-пан!', ochko: 'Очко!', bust: 'Перебор', stand: 'Стоп',
};

const PHASE_TITLE = {
  betting: 'Ставки', playing: 'Ходы игроков', bet1: 'Торги', draw: 'Обмен карт', bet2: 'Торги после обмена', results: 'Итоги',
};

/** Секунды до дедлайна сервера + полоска, которая тает до нуля */
function useCountdown(deadlineMs, key) {
  const end = useMemo(() => Date.now() + deadlineMs, [key, deadlineMs]);
  const [left, setLeft] = useState(deadlineMs);
  useEffect(() => {
    setLeft(Math.max(0, end - Date.now()));
    if (!deadlineMs) return;
    const t = setInterval(() => setLeft(Math.max(0, end - Date.now())), 250);
    return () => clearInterval(t);
  }, [end]);
  return left;
}

function TimerBar({ ms, total }) {
  if (!ms || !total) return null;
  const from = Math.min(1, ms / total);
  return (
    <div className="ct-timer">
      <div key={`${ms}-${total}`} className="ct-timer-fill"
        style={{ '--from': from, animationDuration: `${ms}ms` }} />
    </div>
  );
}

export default function CardTable({ room, profile, connected, head, err, setErr, leaveLabel, onLeave }) {
  const r = room.round;
  const poker = room.game === 'poker';
  const me = room.players.find(p => p.id === profile.id);
  const mySeat = r.seats.find(s => s.id === profile.id);
  const myStake = me?.bet ?? 0;
  const [chip, setChip] = useState(10);
  const [discard, setDiscard] = useState(() => new Set());

  // ключ отсчёта: новая фаза, новый ход или новый дедлайн
  const timerKey = `${r.hand}-${r.phase}-${r.turnId}-${r.deadlineMs}`;
  const left = useCountdown(r.deadlineMs, timerKey);
  const sec = Math.ceil(left / 1000);

  // вибро: мой ход, итог раздачи
  const prevTurn = useRef(null);
  useEffect(() => {
    if (r.turnId === profile.id && prevTurn.current !== profile.id) haptic('medium');
    prevTurn.current = r.turnId;
  }, [r.turnId]);
  const prevPhase = useRef(r.phase);
  useEffect(() => {
    if (r.phase === 'results' && prevPhase.current !== 'results' && mySeat?.result) {
      haptic(mySeat.result.outcome === 'win' ? 'success' : mySeat.result.outcome === 'lose' ? 'error' : 'light');
    }
    if (r.phase !== 'draw') setDiscard(new Set());
    prevPhase.current = r.phase;
  }, [r.phase]);

  const send = (msg) => { haptic('light'); setErr(''); wsSend(msg); };
  const myTurn = r.you.actions.length > 0;
  const turnSeat = r.seats.find(s => s.id === r.turnId);

  // «Готов»: ждём игроков онлайн, у которых есть чем играть (как на сервере)
  const need = poker ? r.ante : 1;
  const waitFor = room.players.filter(p => p.online && (p.bank >= need || p.bet > 0));
  const readyCount = waitFor.filter(p => p.ready).length;

  const statusLine = () => {
    if (r.phase === 'betting') {
      if (r.deadlineMs) return `Раздача через ${sec} с`;
      return poker ? 'Жми «Готов», чтобы сесть в раздачу' : 'Делайте ставки';
    }
    if (r.phase === 'results') return `Следующая раздача через ${sec} с`;
    if (myTurn) return `Твой ход · ${sec} с`;
    return turnSeat ? `Ходит ${turnSeat.name} · ${sec} с` : PHASE_TITLE[r.phase];
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      {head}

      <div className="table-felt ct-felt">
        <div className="ct-status">
          <span className="ct-phase">{PHASE_TITLE[r.phase]}{r.hand ? ` · раздача ${r.hand}` : ''}</span>
          <span className={`ct-clock ${myTurn ? 'mine' : ''}`}>{statusLine()}</span>
        </div>
        <TimerBar ms={r.deadlineMs} total={r.phase === 'betting' || r.phase === 'results' ? r.deadlineMs : r.turnTotalMs} />

        {poker ? (
          <div className="ct-pot">
            <small>Банк раздачи</small>
            <b><AnimatedNumber value={r.pot} /> 🪙</b>
            <small>анте {fmt(r.ante)}{r.betSize ? ` · ставка ${fmt(r.betSize)}` : ''}{r.curBet ? ` · на кругу ${fmt(r.curBet)}` : ''}</small>
          </div>
        ) : (
          <div className="ct-dealer">
            <div className="ct-seat-head">
              <span className="ct-name">🤵 Крупье</span>
              {r.dealer.total != null && <span className="ct-total">{r.dealer.total}</span>}
            </div>
            <div className="cards ct-cards">
              {r.dealer.cards.length
                ? r.dealer.cards.map((c, i) => <CardView key={`${r.hand}-${i}`} card={c} delay={i * 0.08} />)
                : <div className="ct-empty">Ждёт ставок</div>}
            </div>
          </div>
        )}

        {/* места игроков в раздаче */}
        <div className="ct-seats">
          {r.seats.length === 0 && (
            <div className="ct-empty">{poker ? 'Нужно минимум двое — жмите «Готов»' : 'Раздача начнётся, когда все нажмут «Готов»'}</div>
          )}
          {r.seats.map(s => (
            <Seat key={s.id} seat={s} round={r} poker={poker} me={s.id === profile.id}
              active={s.id === r.turnId} discard={s.id === profile.id && r.phase === 'draw' && myTurn ? discard : null}
              onToggle={(i) => {
                haptic('light');
                setDiscard(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });
              }} />
          ))}
        </div>

        <AnimatePresence>
          {r.phase === 'results' && mySeat?.result && (
            <motion.div key={r.hand} className={`result-banner ${mySeat.result.outcome}`}
              initial={{ scale: .8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 16 }}>
              {mySeat.result.net > 0 ? `✅ +${fmt(mySeat.result.net)} 🪙` : mySeat.result.net < 0 ? `❌ ${fmt(mySeat.result.net)} 🪙` : '🤝 В ноль'}
              <div className="result-extra">{mySeat.result.label}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* панель игрока */}
      <div className="betbar ct-panel">
        <div className="bet-row">
          <div className="room-bank">
            <small>Твой банк стола</small>
            <b><AnimatedNumber value={room.you.roomBalance} /> 🪙</b>
          </div>
          <div className="room-bank right">
            <small>{poker ? 'Вложено в раздачу' : 'Ставка'}</small>
            <b>{fmt(myStake)} 🪙</b>
          </div>
        </div>

        {r.phase === 'betting' && !poker && (
          <>
            <div className="chip-row">
              {CHIPS.map(c => (
                <motion.button key={c} whileTap={{ scale: .9 }}
                  className={`casino-chip c${c} ${chip === c ? 'sel' : ''}`}
                  onClick={() => { haptic('light'); setChip(c); }}>{c}</motion.button>
              ))}
            </div>
            <div className="actions">
              <button className="btn small" disabled={!connected || !myStake} onClick={() => send({ op: 'clear' })}>↩ Снять</button>
              <motion.button whileTap={{ scale: .96 }} className="btn" disabled={!connected || room.you.roomBalance < 1}
                onClick={() => send({ op: 'bet', amount: Math.min(chip, room.you.roomBalance) })}>
                ＋ Поставить {fmt(Math.min(chip, Math.max(room.you.roomBalance, 0)))}
              </motion.button>
            </div>
          </>
        )}

        {r.phase === 'betting' && poker && (
          <div className="hint">
            Анте {fmt(r.ante)} 🪙 спишется при раздаче. Ставки фиксированные: {fmt(r.ante * 2)} до обмена и {fmt(r.ante * 4)} после,
            а вложить за раздачу можно не больше самого маленького банка за столом.
          </div>
        )}

        {r.phase === 'betting' && (
          <>
            <div className="actions">
              <motion.button whileTap={{ scale: .96 }} className={`btn big-flex ${me?.ready ? 'ready-on' : 'gold'}`}
                disabled={!connected || (!me?.ready && (poker ? room.you.roomBalance < r.ante : !myStake))}
                onClick={() => send({ op: 'ready', ready: !me?.ready })}>
                {me?.ready ? '✓ Готов · отменить' : poker
                  ? (room.you.roomBalance < r.ante ? 'Не хватает на анте' : 'Готов, сдавайте ✋')
                  : myStake ? 'Готов ✋' : 'Сделай ставку'}
              </motion.button>
            </div>
            <div className="hint ready-hint">
              Готовы {readyCount} из {waitFor.length}.{' '}
              {poker ? 'Раздача начнётся, когда готовы все (минимум двое) или через 15 с после второго «Готов».'
                : 'Раздача начнётся, когда готовы все или через 15 с после первого «Готов».'}
            </div>
          </>
        )}

        {r.phase !== 'betting' && r.phase !== 'results' && (
          myTurn ? (
            <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show" key={timerKey}>
              {r.phase === 'draw' ? (
                <motion.button variants={actionsItem} whileTap={{ scale: .96 }} className="btn gold big-flex"
                  onClick={() => send({ op: 'act', action: 'draw', discard: [...discard] })}>
                  {discard.size ? `Обменять ${discard.size} ↺` : 'Оставить все карты'}
                </motion.button>
              ) : r.you.actions.map(a => (
                <motion.button key={a} variants={actionsItem} whileTap={{ scale: .96 }}
                  className={`btn ${a === 'fold' ? 'danger' : a === 'raise' || a === 'double' ? 'gold' : ''}`}
                  onClick={() => send({ op: 'act', action: a })}>
                  {a === 'call' ? `Колл ${fmt(r.you.toCall)}`
                    : a === 'raise' ? (r.curBet ? `Рейз до ${fmt(r.you.raiseTo)}` : `Бет ${fmt(r.you.raiseTo)}`)
                      : ACTION_LABEL[a]}
                </motion.button>
              ))}
            </motion.div>
          ) : (
            <div className="room-wait">
              {mySeat ? (turnSeat ? `Ходит ${turnSeat.name}…` : 'Ждём…') : 'Ты не в этой раздаче — сядешь в следующую'}
            </div>
          )
        )}
        {r.phase === 'draw' && myTurn && <div className="hint">Тапни карты, которые хочешь сменить.</div>}
        {r.phase === 'results' && <div className="room-wait">Следующая раздача через {sec} с</div>}

        {err && <div className="notice">⚠ {err}</div>}
      </div>

      {/* все за столом */}
      <div className="players-list">
        {room.players.map(p => (
          <div key={p.id} className={`player-row ${p.id === profile.id ? 'me' : ''}`}>
            <span className={`dot ${p.online ? 'on' : ''}`} />
            <span className="player-name">{p.isHost && '👑 '}{p.name}{p.id === profile.id && ' (ты)'}</span>
            {r.phase === 'betting' && p.ready && <span className="player-ready">✓ готов</span>}
            {p.bet > 0 && <span className="player-bet">{poker ? 'в банке' : 'ставка'} {fmt(p.bet)}</span>}
            <span className="player-bank"><AnimatedNumber value={p.bank} /> 🪙</span>
          </div>
        ))}
      </div>

      <button className="btn danger big room-leave" onClick={onLeave}>{leaveLabel}</button>
    </motion.div>
  );
}

function Seat({ seat: s, round: r, poker, me, active, discard, onToggle }) {
  const res = s.result;
  const tag = poker
    ? (s.folded ? 'Пас' : r.phase !== 'draw' && s.discards != null ? (s.discards ? `сменил ${s.discards}` : 'без обмена') : null)
    : STATUS_LABEL[s.status] && s.status !== 'stand' ? STATUS_LABEL[s.status] : null;
  return (
    <div className={`ct-seat ${me ? 'me' : ''} ${active ? 'active' : ''} ${s.folded ? 'folded' : ''}`}>
      <div className="ct-seat-head">
        <span className="ct-name">{s.name}{me && ' (ты)'}{s.left && ' · ушёл'}</span>
        {!poker && <span className="ct-total">{s.total}</span>}
        {poker && s.hand && <span className="ct-hand">{s.hand}</span>}
        {tag && <span className={`ct-tag ${s.status ?? ''}`}>{tag}</span>}
        <span className="ct-stake">
          {poker ? `${fmt(s.contrib)} 🪙` : `${fmt(s.stake * s.units)} 🪙${s.units > 1 ? ' ×2' : ''}`}
        </span>
      </div>
      <div className={`cards ct-cards ${me ? '' : 'small'}`}>
        {s.cards.map((c, i) => discard ? (
          <motion.button key={`${r.hand}-${i}`} whileTap={{ scale: .93 }}
            className={`card-slot ${discard.has(i) ? 'selected' : ''}`} onClick={() => onToggle(i)}>
            <CardView card={c} dim={discard.has(i)} />
          </motion.button>
        ) : (
          <CardView key={`${r.hand}-${i}-${c.hidden ? 'h' : c.r + c.s}`} card={c} delay={Math.min(i * 0.06, 0.3)} dim={s.folded} />
        ))}
      </div>
      {res && (
        <div className={`ct-result ${res.outcome}`}>
          {res.label} · {res.net > 0 ? '+' : ''}{fmt(res.net)} 🪙
        </div>
      )}
    </div>
  );
}
