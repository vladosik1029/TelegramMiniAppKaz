// Баккара (пунто-банко): ставка на Игрока, Банкира или Ничью.
// Сервер раздаёт сразу (server/src/games/baccarat.js), клиент выкладывает карты
// по одной в порядке раздачи и считает очки видимых карт.

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, haptic } from '../api.js';
import { BetBar, Hand, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import StakeStrip from '../components/StakeStrip.jsx';
import { BetSpot } from '../components/Chips.jsx';

const SIDES = [
  ['player', 'Игрок', '×2'],
  ['tie', 'Ничья', '×9'],
  ['banker', 'Банкир', '×1.95'],
];
const NAME = { player: 'Игрок', banker: 'Банкир', tie: 'Ничья' };
const STEP_MS = 520;

const pointOf = (c) => (c.r === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(c.r) ? 0 : Number(c.r));
const totalOf = (cards) => cards.reduce((s, c) => s + pointOf(c), 0) % 10;
const scoreLine = (v) => (v.winner === 'tie' ? `Ничья ${v.pt} : ${v.bt}`
  : v.winner === 'player' ? `Игрок выиграл ${v.pt} : ${v.bt}` : `Банкир выиграл ${v.bt} : ${v.pt}`);

export default function Baccarat({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [side, setSide] = useState('banker');
  const [balance, setBalance] = useState(profile.balance);
  const [deal, setDeal] = useState(null);   // ответ сервера
  const [shown, setShown] = useState(0);    // сколько карт уже выложено
  const [result, setResult] = useState(null);
  const [road, setRoad] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const play = async () => {
    setBusy(true); setErr(''); setResult(null); setDeal(null); setShown(0);
    try {
      const r = await api('/games/baccarat/start', { bet, opts: { side } });
      setBalance(r.balance);
      setDeal(r);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  // выкладываем карты по одной, потом показываем итог
  useEffect(() => {
    if (!deal || result) return;
    const total = deal.view.order.length;
    if (shown < total) {
      const t = setTimeout(() => { setShown(n => n + 1); haptic('light'); }, shown ? STEP_MS : 150);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setResult(deal);
      setRoad(rd => [deal.view.winner, ...rd].slice(0, 20));
      haptic(deal.outcome === 'win' ? 'success' : deal.outcome === 'lose' ? 'error' : 'light');
      setBusy(false);
      refresh();
    }, 450);
    return () => clearTimeout(t);
  }, [deal, shown, result]);

  // какие карты уже видны у каждой стороны
  const v = deal?.view;
  let pCards = [], bCards = [];
  if (v) {
    let pi = 0, bi = 0;
    v.order.slice(0, shown).forEach(s => { if (s === 'player') pCards.push(v.player[pi++]); else bCards.push(v.banker[bi++]); });
  }
  const win = result?.view.winner;

  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={busy && !!deal} sub={`на «${NAME[side]}»`} />
      <div className="table-felt bac-felt">
        <div className="bac-road">
          {road.map((w, i) => <span key={road.length - i} className={`bac-dot ${w}`}>{w === 'player' ? 'И' : w === 'banker' ? 'Б' : 'Н'}</span>)}
          {!road.length && <span className="bac-hint">Кто наберёт ближе к 9 — Игрок или Банкир?</span>}
        </div>
        <div className={`bac-side ${win === 'player' ? 'won' : ''}`}>
          <Hand title={`🙋 Игрок${side === 'player' ? ' · твоя ставка' : ''}`} cards={pCards} total={v ? totalOf(pCards) : null}
            label={win === 'player' ? 'Победа' : null} />
        </div>
        <BetSpot amount={deal ? bet : 0} label={deal ? `на «${NAME[deal.view.side ?? side]}»` : null} />
        <div className={`bac-side ${win === 'banker' ? 'won' : ''}`}>
          <Hand title={`🏦 Банкир${side === 'banker' ? ' · твоя ставка' : ''}`} cards={bCards} total={v ? totalOf(bCards) : null}
            label={win === 'banker' ? 'Победа' : null} />
        </div>
        {win === 'tie' && <motion.div className="bac-tie" initial={{ scale: .6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>🤝 Ничья {v.pt} : {v.bt}</motion.div>}
      </div>

      {result && (
        <ResultBanner result={result}
          extra={`${scoreLine(result.view)} · ставка на «${NAME[result.view.side]}»`} />
      )}
      {err && <div className="notice">⚠ {err}</div>}

      {!result && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={play}
          label={`Ставлю на «${NAME[side]}»`} busyLabel="Раздаём…">
          <div className="bac-sides">
            {SIDES.map(([k, l, m]) => (
              <button key={k} className={`bac-pick ${k} ${side === k ? 'active' : ''}`} disabled={busy}
                onClick={() => { haptic('light'); setSide(k); }}>
                <b>{l}</b><small>{m}</small>
              </button>
            ))}
          </div>
        </BetBar>
      )}

      {result && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary big"
            onClick={() => { setResult(null); setDeal(null); setShown(0); }}>
            🔄 Новая раздача
          </motion.button>
        </motion.div>
      )}
    </main>
  );
}
