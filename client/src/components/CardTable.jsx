// Экран карточного стола: Blackjack и Очко (все против крупье) и дро-покер
// (игроки друг против друга). Всё состояние раунда приходит с сервера в
// room.round (см. server/src/cardtables.js), клиент только рисует и шлёт ходы:
// { op: 'bet' | 'clear' | 'ready' } в фазе ставок и { op: 'act', action } на своём ходу.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic, wsSend } from '../api.js';
import { CardView, actionsStagger, actionsItem } from './ui.jsx';
import { AnimatedNumber } from './fx.jsx';
import StakeStrip, { fmtShort } from './StakeStrip.jsx';

const fmt = (n) => Number(n).toLocaleString('ru-RU');
const CHIPS = [5, 10, 25, 50, 100, 500];

const ACTION_LABEL = {
  hit: 'Ещё карту', stand: 'Хватит', stop: 'Хватит', double: 'Удвоить',
  check: 'Чек', fold: 'Пас', take: 'Беру', pass: 'Пас',
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
  const durak = room.game === 'durak';
  const pvp = poker || durak; // «Готов» = сесть в партию, ставка фиксированная
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
  const myTurn = durak ? r.phase === 'playing' && r.turnId === profile.id : r.you.actions.length > 0;
  const turnSeat = r.seats.find(s => s.id === r.turnId);

  // «Готов»: ждём игроков онлайн, у которых есть чем играть (как на сервере)
  const need = pvp ? r.ante : 1;
  const waitFor = room.players.filter(p => p.online && (p.bank >= need || p.bet > 0));
  const readyCount = waitFor.filter(p => p.ready).length;

  const statusLine = () => {
    if (r.phase === 'betting') {
      if (r.deadlineMs) return `${durak ? 'Партия' : 'Раздача'} через ${sec} с`;
      return pvp ? `Жми «Готов», чтобы сесть ${durak ? 'в партию' : 'в раздачу'}` : 'Делайте ставки';
    }
    if (r.phase === 'results') return `${durak ? 'Следующая партия' : 'Следующая раздача'} через ${sec} с`;
    if (myTurn) return `Твой ход · ${sec} с`;
    return turnSeat ? `Ходит ${turnSeat.name} · ${sec} с` : PHASE_TITLE[r.phase];
  };

  return (
    <motion.div className="game-screen room-screen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      {head}
      <StakeStrip amount={myStake} live={myStake > 0 && r.phase !== 'betting'}
        label={poker ? 'Вложено' : durak ? 'Ставка партии' : 'Ставка'}
        sub={poker && r.pot ? `банк ${fmtShort(r.pot)}` : null} />

      <div className="table-felt ct-felt">
        <div className="ct-status">
          <span className="ct-phase">{PHASE_TITLE[r.phase]}{r.hand ? ` · ${durak ? 'партия' : 'раздача'} ${r.hand}` : ''}</span>
          <span className={`ct-clock ${myTurn ? 'mine' : ''}`}>{statusLine()}</span>
        </div>
        <TimerBar ms={r.deadlineMs} total={r.phase === 'betting' || r.phase === 'results' ? r.deadlineMs : r.turnTotalMs} />

        {durak ? (
          <DurakBoard r={r} profile={profile} />
        ) : poker ? (
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
        {!durak && <div className="ct-seats">
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
        </div>}

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
            <small>{poker ? 'Вложено в раздачу' : durak ? 'Ставка партии' : 'Ставка'}</small>
            <b>{fmt(myStake)} 🪙</b>
          </div>
        </div>

        {r.phase === 'betting' && !pvp && (
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

        {r.phase === 'betting' && durak && (
          <div className="hint">
            Подкидной дурак на 2–4 игроков, колода 36 карт. Ставка за партию {fmt(r.ante)} 🪙:
            дурак её теряет, банк делится между остальными.
          </div>
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
                disabled={!connected || (!me?.ready && (pvp ? room.you.roomBalance < r.ante : !myStake))}
                onClick={() => send({ op: 'ready', ready: !me?.ready })}>
                {me?.ready ? '✓ Готов · отменить' : pvp
                  ? (room.you.roomBalance < r.ante ? 'Не хватает фишек' : 'Готов, сдавайте ✋')
                  : myStake ? 'Готов ✋' : 'Сделай ставку'}
              </motion.button>
            </div>
            <div className="hint ready-hint">
              Готовы {readyCount} из {waitFor.length}.{' '}
              {pvp ? `${durak ? 'Партия' : 'Раздача'} начнётся, когда готовы все (минимум двое) или через 15 с после второго «Готов».`
                : 'Раздача начнётся, когда готовы все или через 15 с после первого «Готов».'}
            </div>
          </>
        )}

        {durak && (r.phase === 'playing' || r.phase === 'results') && mySeat && r.durak.hand.length > 0 && (
          <DurakHand r={r} myTurn={myTurn} onPlay={(card) => send({ op: 'act', action: 'play', card })} />
        )}

        {r.phase !== 'betting' && r.phase !== 'results' && (
          myTurn ? (
            <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show" key={timerKey}>
              {r.phase === 'draw' ? (
                <motion.button variants={actionsItem} whileTap={{ scale: .96 }} className="btn gold big-flex"
                  onClick={() => send({ op: 'act', action: 'draw', discard: [...discard] })}>
                  {discard.size ? `Обменять ${discard.size} ↺` : 'Оставить все карты'}
                </motion.button>
              ) : durak && !r.you.actions.length ? (
                <div className="room-wait">{r.durak.table.length ? 'Подкинь карту' : 'Твой заход — выбери карту'}</div>
              ) : r.you.actions.map(a => (
                <motion.button key={a} variants={actionsItem} whileTap={{ scale: .96 }}
                  className={`btn ${a === 'fold' ? 'danger' : a === 'raise' || a === 'double' ? 'gold' : ''}`}
                  onClick={() => send({ op: 'act', action: a })}>
                  {a === 'call' ? `Колл ${fmt(r.you.toCall)}`
                    : a === 'raise' ? (r.curBet ? `Рейз до ${fmt(r.you.raiseTo)}` : `Бет ${fmt(r.you.raiseTo)}`)
                      : a === 'pass' ? (r.durak.attackerId === profile.id && !r.durak.took ? 'Бито' : 'Пас')
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
        {r.phase === 'results' && <div className="room-wait">{durak ? 'Следующая партия' : 'Следующая раздача'} через {sec} с</div>}

        {err && <div className="notice">⚠ {err}</div>}
      </div>

      {/* все за столом */}
      <div className="players-list">
        {room.players.map(p => (
          <div key={p.id} className={`player-row ${p.id === profile.id ? 'me' : ''}`}>
            <span className={`dot ${p.online ? 'on' : ''}`} />
            <span className="player-name">{p.isHost && '👑 '}{p.name}{p.id === profile.id && ' (ты)'}</span>
            {r.phase === 'betting' && p.ready && <span className="player-ready">✓ готов</span>}
            {p.bet > 0 && <span className="player-bet">{pvp ? 'в банке' : 'ставка'} {fmt(p.bet)}</span>}
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

// ─── Дурак ───────────────────────────────────────────────────────────────────

const SUIT_COLOR = (s) => (s === '♥' || s === '♦' ? 'red' : 'black');

/** Стол дурака: соперники, козырь с колодой, пары «атака / защита» */
function DurakBoard({ r, profile }) {
  const d = r.durak;
  const results = r.phase === 'results';
  const others = r.seats.filter(s => s.id !== profile.id);
  const role = (s) => (s.id === d.defenderId ? '🛡' : s.id === d.attackerId ? '⚔' : '');
  return (
    <div className="dk">
      <div className="dk-opps">
        {r.seats.length === 0 && <div className="ct-empty">Нужно минимум двое — жмите «Готов»</div>}
        {others.map(s => (
          <div key={s.id} className={`dk-opp ${s.id === r.turnId ? 'active' : ''} ${s.out ? 'out' : ''}`}>
            <div className="dk-opp-name">{role(s)} {s.name}{s.left ? ' · ушёл' : ''}</div>
            {results && s.cards.length ? (
              <div className="cards ct-cards small dk-reveal">{s.cards.map((c, i) => <CardView key={i} card={c} />)}</div>
            ) : (
              <div className="dk-backs">
                {Array.from({ length: Math.min(s.count, 8) }, (_, i) => <span key={i} className="dk-back" />)}
                <b>{s.out ? `вышел ${s.place}-м` : s.count}</b>
              </div>
            )}
            {s.result && <div className={`ct-result ${s.result.outcome}`}>{s.result.label} · {s.result.net > 0 ? '+' : ''}{fmt(s.result.net)}</div>}
          </div>
        ))}
      </div>

      <div className="dk-middle">
        <div className="dk-deck">
          <div className="dk-deck-cards">
            {d.deck > 1 && <div className="dk-pile"><div className="card back"><div className="card-back-pattern" /></div></div>}
            {d.trumpCard && d.deck > 0 && <div className="dk-trump"><CardView card={d.trumpCard} /></div>}
          </div>
          <small>{d.deck ? `в колоде ${d.deck}` : 'колода пуста'}</small>
          {d.trump && <span className={`dk-trump-suit ${SUIT_COLOR(d.trump)}`}>козырь {d.trump}</span>}
        </div>
        <div className="dk-table">
          {d.table.length === 0 && !results && r.seats.length > 0 && (
            <div className="ct-empty">{r.turnId === profile.id ? 'Твой заход' : 'Ждём заход'}</div>
          )}
          <AnimatePresence>
            {d.table.map((p, i) => (
              <motion.div key={`${r.hand}-${p.a.r}${p.a.s}`} className="dk-pair"
                initial={{ opacity: 0, y: 30, scale: .8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: .6 }}>
                <CardView card={p.a} />
                {p.d && <div className="dk-cover"><CardView card={p.d} /></div>}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="dk-meta">
          {d.took && !results && <span className="ct-tag bust">берёт</span>}
          {d.discard > 0 && <small>бито {d.discard}</small>}
        </div>
      </div>
    </div>
  );
}

/** Своя рука: доступные карты подсвечены, тап — сыграть */
function DurakHand({ r, myTurn, onPlay }) {
  const d = r.durak;
  const role = r.phase === 'results' ? 'Твои карты' : d.defenderId === r.seats[d.meIdx]?.id ? 'Ты отбиваешься 🛡' : d.attackerId === r.seats[d.meIdx]?.id ? 'Ты заходишь ⚔' : 'Можешь подкидывать';
  return (
    <div className="dk-hand-wrap">
      <div className="dk-hand-title">{role} · {d.hand.length} карт</div>
      <div className={`dk-hand ${d.hand.length > 6 ? 'many' : ''}`} style={{ '--n': d.hand.length }}>
        {d.hand.map((c, i) => {
          const ok = myTurn && d.playable.includes(i);
          return (
            <motion.button key={`${c.r}${c.s}`} layout whileTap={ok ? { scale: .92, y: -6 } : undefined}
              className={`dk-card ${ok ? 'ok' : ''} ${c.s === d.trump ? 'trump' : ''}`} disabled={!ok}
              onClick={() => ok && onPlay(c)}>
              <CardView card={c} />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
