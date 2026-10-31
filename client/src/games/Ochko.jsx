import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { api, haptic } from '../api.js';
import { Hand, BetBar, ResultBanner, actionsStagger, actionsItem } from '../components/ui.jsx';
import StakeStrip from '../components/StakeStrip.jsx';

const OUTCOME_EXTRA = {
  pan_pan: '🩸 ПАН-ПАН! Обе карты пиковые — выплата 3:1',
  ochko: '⭐ ОЧКО! 21 очко с двух карт — выплата 2:1',
};

export default function Ochko({ profile, refresh }) {
  const [bet, setBet] = useState(50);
  const [view, setView] = useState(null);
  const [balance, setBalance] = useState(profile.balance);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [extraText, setExtraText] = useState('');

  const deal = async () => {
    setBusy(true); setErr(''); setResult(null); setExtraText('');
    try {
      const r = await api('/games/ochko/start', { bet });
      setBalance(r.balance);
      setView(r.view);
      if (r.finished) {
        setResult(r);
        setExtraText(OUTCOME_EXTRA[r.message] || '');
        haptic(r.outcome === 'win' ? 'success' : 'error');
        await refresh();
      }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const act = async (action) => {
    setBusy(true); setErr('');
    try {
      const r = await api('/games/ochko/action', { action });
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

  // мгновенная комбинация на раздатке пропускает этап хода — глушим кнопки,
  // сервер сам завершил раунд (result уже задан), UI просто показывает результат
  return (
    <main className="page game-screen">
      <StakeStrip amount={bet} live={!!inRound} />
      <div className="table-felt">
        <Hand title="🤖 Крупье" cards={view?.dealer ?? []} total={view?.dealerTotal} />
        <div className="felt-sep" />
        <Hand
          title="🙋 Ты" cards={view?.player ?? []} total={view?.playerTotal}
          label={inRound && view.playerTotal === 21 ? 'Очко!' : inRound && view.playerTotal > 21 ? 'Перебор' : null}
        />
      </div>

      {result && <ResultBanner result={result} extra={extraText} />}
      {err && <div className="notice">⚠ {err}</div>}

      {!inRound && !result && <BetBar balance={balance} bet={bet} setBet={setBet} disabled={busy} onDeal={deal} />}

      {inRound && (
        <motion.div className="actions" variants={actionsStagger} initial="hidden" animate="show">
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary" disabled={busy} onClick={() => act('hit')}>Ещё карту</motion.button>
          <motion.button variants={actionsItem} whileTap={{ scale: .95 }} className="btn primary" disabled={busy} onClick={() => act('stop')}>Хватит</motion.button>
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
