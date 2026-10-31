// Краш (Ракета): один общий раунд на всех по WebSocket (server/src/crash.js).
// Сервер шлёт фазу и сколько прошло с взлёта, множитель клиент досчитывает сам
// по той же формуле m(t) = e^(rate·t) — чтобы цифры шли плавно каждый кадр.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic, wsConnect, wsSend, onWsMsg, wsIsOpen } from '../api.js';
import { FairLine } from '../components/Fairness.jsx';
import { BetStepper } from '../components/ui.jsx';
import StakeStrip, { fmtShort } from '../components/StakeStrip.jsx';

const fmt = (n) => Number(n).toLocaleString('ru-RU');
const fmtX = (m) => `×${Number(m).toFixed(2)}`;
const multAt = (rate, ms) => Math.floor(Math.exp(rate * ms / 1000) * 100) / 100;
const tone = (p) => (p >= 10 ? 'gold' : p >= 2 ? 'good' : 'bad');

export default function Crash({ profile, refresh }) {
  const [c, setC] = useState(null);
  const [connected, setConnected] = useState(wsIsOpen());
  const [bet, setBet] = useState(50);
  const [autoOn, setAutoOn] = useState(false);
  const [auto, setAuto] = useState('2.00');
  const [err, setErr] = useState('');
  const [now, setNow] = useState(performance.now());
  const anchor = useRef(null); // { start: performance.now() момента взлёта } или { end } для отсчёта

  useEffect(() => {
    wsConnect();
    const off = onWsMsg((m) => {
      if (m.type === '_open') { setConnected(true); wsSend({ op: 'crash_sub' }); }
      else if (m.type === '_close') setConnected(false);
      else if (m.type === 'crash') {
        const s = m.crash;
        const t = performance.now();
        anchor.current = s.phase === 'flying' ? { start: t - s.elapsedMs } : { end: t + s.leftMs };
        setC(prev => {
          if (prev && s.phase === 'crashed' && prev.phase === 'flying' && s.you && s.you.cashedAt == null) haptic('error');
          if (prev?.you && s.you?.cashedAt != null && prev.you.cashedAt == null) haptic('success');
          if (s.phase === 'flying' && prev?.phase !== 'flying') haptic('medium');
          return s;
        });
      } else if (m.type === 'error') { setErr(m.error); haptic('error'); }
    });
    if (wsIsOpen()) wsSend({ op: 'crash_sub' });
    return () => { off(); wsSend({ op: 'crash_unsub' }); };
  }, []);

  // баланс в шапке приложения — после каждой смены своего баланса
  useEffect(() => { if (c?.balance != null && c.balance !== profile.balance) refresh(); }, [c?.balance]);

  // кадры анимации — только пока есть что двигать
  useEffect(() => {
    let id;
    const loop = () => { setNow(performance.now()); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  const flying = c?.phase === 'flying';
  // после взрыва кривая замирает в точке взрыва
  const elapsed = flying && anchor.current?.start != null ? Math.max(0, now - anchor.current.start)
    : c?.phase === 'crashed' ? Math.log(c.point) / c.rate * 1000 : 0;
  const mult = c ? (c.phase === 'crashed' ? c.point : flying ? multAt(c.rate, elapsed) : 1) : 1;
  const leftS = anchor.current?.end != null ? Math.max(0, (anchor.current.end - now) / 1000) : 0;

  const you = c?.you;
  const balance = c?.balance ?? profile.balance;
  const autoVal = Number(String(auto).replace(',', '.'));
  const autoOk = !autoOn || (autoVal >= 1.01 && autoVal <= 1000);

  const placeBet = () => {
    setErr('');
    haptic('light');
    wsSend({ op: 'crash_bet', amount: bet, auto: autoOn ? autoVal : null });
  };

  return (
    <main className="page game-screen">
      <StakeStrip amount={you ? you.amount : bet} live={!!you && you.cashedAt == null && c?.phase !== 'crashed'}
        sub={!you ? null
          : you.cashedAt != null ? `забрал ${fmtShort(you.payout)}`
          : c?.phase === 'crashed' ? 'сгорела 💥'
          : c?.phase === 'flying' ? `→ ${fmtShort(you.amount * mult)}`
          : you.auto ? `авто ×${Number(you.auto).toFixed(2)}` : null} />
      <div className="table-felt crash-felt">
        <div className="crash-recent">
          {(c?.recent ?? []).map((p, i) => <span key={`${c.round}-${i}`} className={`crash-pill ${tone(p)}`}>{fmtX(p)}</span>)}
        </div>

        <CrashGraph phase={c?.phase} elapsed={elapsed} mult={mult} rate={c?.rate ?? 0.08} />

        <div className="crash-center">
          {!c ? <div className="crash-big">…</div>
            : c.phase === 'betting' ? (
              <>
                <div className="crash-sub">Взлёт через</div>
                <div className="crash-big">{leftS.toFixed(1)} с</div>
              </>
            ) : c.phase === 'flying' ? (
              <div className={`crash-big live ${you && you.cashedAt == null ? 'mine' : ''}`}>{fmtX(mult)}</div>
            ) : (
              <>
                <motion.div className="crash-big boom" initial={{ scale: 1.4 }} animate={{ scale: 1 }}>💥 {fmtX(c.point)}</motion.div>
                <div className="crash-sub">Новый раунд через {leftS.toFixed(0)} с</div>
              </>
            )}
        </div>
      </div>

      <div className="betbar crash-panel">
        {!c || !connected ? (
          <div className="room-wait">Подключаемся…</div>
        ) : !you && c.phase === 'betting' ? (
          <>
            <BetStepper balance={balance} bet={bet} setBet={setBet} />
            <div className="crash-auto">
              <label className="crash-auto-toggle">
                <input type="checkbox" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} />
                <span>Забрать автоматически на</span>
              </label>
              <label className={`bet-input-wrap crash-auto-input ${autoOn ? '' : 'off'}`}>
                <span>×</span>
                <input className="bet-input" inputMode="decimal" value={auto} disabled={!autoOn}
                  onChange={(e) => setAuto(e.target.value.replace(/[^\d.,]/g, '').slice(0, 7))} />
              </label>
            </div>
            <motion.button whileTap={{ scale: .96 }} className="btn gold big" disabled={bet < 1 || bet > balance || !autoOk}
              onClick={placeBet}>Поставить {fmt(bet)} 🪙</motion.button>
            {!autoOk && <div className="hint">Автозабор — от ×1.01 до ×1000</div>}
          </>
        ) : you && c.phase === 'betting' ? (
          <div className="actions">
            <div className="room-wait">Ставка {fmt(you.amount)} 🪙{you.auto ? ` · авто ${fmtX(you.auto)}` : ''}</div>
            <button className="btn small" onClick={() => { haptic('light'); wsSend({ op: 'crash_cancel' }); }}>Отменить</button>
          </div>
        ) : you && you.cashedAt == null && c.phase === 'flying' ? (
          <motion.button whileTap={{ scale: .96 }} className="btn gold big crash-cashout"
            onClick={() => { haptic('medium'); wsSend({ op: 'crash_cashout' }); }}>
            Забрать {fmt(Math.floor(you.amount * mult))} 🪙 <small>{fmtX(mult)}</small>
          </motion.button>
        ) : you && you.cashedAt != null ? (
          <div className="result-banner win">✅ Забрал на {fmtX(you.cashedAt)}: +{fmt(you.payout - you.amount)} 🪙</div>
        ) : you && c.phase === 'crashed' ? (
          <div className="result-banner lose">❌ Ракета взорвалась: −{fmt(you.amount)} 🪙</div>
        ) : (
          <div className="room-wait">{c.phase === 'flying' ? 'Раунд идёт — ставка на следующий' : 'Скоро новый раунд'}</div>
        )}
        {err && <div className="notice">⚠ {err}</div>}
      </div>

      <div className="players-list">
        <div className="crash-players-head">Игроки раунда · {c?.bets.length ?? 0}</div>
        <AnimatePresence initial={false}>
          {(c?.bets ?? []).map(b => {
            const lost = c.phase === 'crashed' && b.cashedAt == null;
            return (
              <motion.div key={b.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={`player-row ${b.id === profile.id ? 'me' : ''}`}>
                <span className="player-name">{b.name}{b.id === profile.id && ' (ты)'}</span>
                <span className="player-bet">{fmt(b.amount)} 🪙</span>
                {b.cashedAt != null && <span className="player-net pos">{fmtX(b.cashedAt)} +{fmt(b.payout - b.amount)}</span>}
                {lost && <span className="player-net neg">−{fmt(b.amount)}</span>}
              </motion.div>
            );
          })}
        </AnimatePresence>
        {c && !c.bets.length && <div className="hint">В этом раунде пока никто не поставил</div>}
        {c?.fair && (
          <FairLine hash={c.fair.hash}
            last={c.fair.last && { ...c.fair.last, game: 'crash', nonce: c.fair.last.idx,
              params: { idx: c.fair.last.idx, commitment: c.fair.last.commitment }, record: { point: c.fair.last.point } }} />
        )}
      </div>
    </main>
  );
}

/** График полёта: кривая множителя и ракета на её конце */
function CrashGraph({ phase, elapsed, mult, rate }) {
  const W = 300, H = 160;
  const tMax = Math.max(8000, elapsed * 1.15);
  const mMax = Math.max(2, mult * 1.2);
  const x = (t) => (t / tMax) * W;
  const y = (m) => H - ((m - 1) / (mMax - 1)) * (H - 8);

  const path = useMemo(() => {
    if (phase !== 'flying' && phase !== 'crashed') return '';
    const pts = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = (elapsed * i) / steps;
      pts.push(`${x(t).toFixed(1)},${y(Math.exp(rate * t / 1000)).toFixed(1)}`);
    }
    return pts.join(' ');
  }, [phase, elapsed, rate, tMax, mMax]);

  // ракета смотрит по касательной к кривой
  const tipX = x(elapsed), tipY = y(mult);
  const dt = Math.max(elapsed * 0.04, 60);
  const angle = Math.atan2(y(Math.exp(rate * Math.max(0, elapsed - dt) / 1000)) - tipY, tipX - x(Math.max(0, elapsed - dt))) * 180 / Math.PI;

  return (
    <div className="crash-graph">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map(f => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="crash-grid" />)}
        {path && (
          <>
            <polygon points={`0,${H} ${path} ${tipX.toFixed(1)},${H}`} className={`crash-area ${phase}`} />
            <polyline points={path} className={`crash-line ${phase}`} />
          </>
        )}
      </svg>
      {(phase === 'flying' || phase === 'crashed') && (
        <div className={`crash-rocket ${phase}`}
          style={{ left: `${(tipX / W) * 100}%`, top: `${(tipY / H) * 100}%`, transform: `translate(-50%, -50%) rotate(${45 - angle}deg)` }}>
          {phase === 'crashed' ? '💥' : '🚀'}
        </div>
      )}
    </div>
  );
}
