import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { api, haptic } from '../api.js';
import { Hand, BetBar, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import StakeStrip from '../components/StakeStrip.jsx';
import { BetSpot } from '../components/Chips.jsx';

export default function Blackjack({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [view, setView] = useState(null);     // state от сервера
  const [balance, setBalance] = useState(profile.balance);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const deal = async () => {
    setBusy(true); setErr(''); setResult(null);
    try {
      const r = await api('/games/blackjack/start', { bet });
      setBalance(r.balance);
      setView(r.view);
      if (r.finished) { setResult(r); if (r.outcome === 'win') haptic('success'); }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const act = async (action) => {
    setBusy(true); setErr('');
    try {
      const r = await api('/games/blackjack/action', { action });
      setBalance(r.balance);
      setView(r.view);
      if (r.finished) {
        setResult(r);
        haptic(r.outcome === 'win' ? 'success' : r.outcome === 'lose' ? 'error' : 'light');
        await refresh();
      }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const inRound = view && !result;

  // У игрока сразу Blackjack → авто-stand
  React.useEffect(() => {
    if (view && !result && view.stage === 'done' && view.playerTotal === 21 && view.player.length === 2) {
      act('stand');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.stage]);

  return (
    <main className="page game-screen">
      <StakeStrip amount={view ? bet * (view.betUnits ?? 1) : bet} live={!!inRound} sub={inRound && view.betUnits > 1 ? 'дабл ×2' : null} />
      <div className="table-felt">
        <Hand title="🤖 Дилер" cards={view?.dealer ?? []} total={view?.dealerTotal} />
        <BetSpot amount={view ? bet * (view.betUnits ?? 1) : 0} />
        <Hand
          title="🙋 Ты" cards={view?.player ?? []} total={view?.playerTotal}
          label={view?.playerTotal === 21 && view.player.length === 2 && inRound ? 'Blackjack!' :
                 view?.playerTotal > 21 ? 'Перебор' : null}
        />
      </div>

      {result && (
        <ResultBanner
          result={result}
          extra={result.net < 0 ? `Ставка: ${(bet).toLocaleString('ru-RU')} 🪙` : null}
        />
      )}
      {err && <div className="notice">⚠ {err}</div>}

      {!inRound && !result && (
        <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={deal} />
      )}

      {inRound && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary" disabled={busy} onClick={() => act('hit')}>Ещё (hit)</motion.button>
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary" disabled={busy} onClick={() => act('stand')}>Хватит (stand)</motion.button>
          {view.canDouble && (
            <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn" disabled={busy} onClick={() => act('double')}>
              Дабл ×2 ({(bet).toLocaleString('ru-RU')} 🪙)
            </motion.button>
          )}
        </motion.div>
      )}

      {result && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary big" onClick={() => { setResult(null); setView(null); }}>
            🔄 Новый раунд
          </motion.button>
        </motion.div>
      )}
    </main>
  );
}
