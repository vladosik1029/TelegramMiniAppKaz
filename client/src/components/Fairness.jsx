// «Проверка честности» (Provably Fair): сиды игрока, смена сида, история раундов
// и проверка прямо в браузере. Проверка импортирует тот же код генерации
// исходов, что работает на сервере (server/src/fair, алиас @fair), а HMAC и
// SHA-256 считает WebCrypto браузера — серверу для проверки верить не нужно.

import React, { useEffect, useState } from 'react';
import { api, haptic, randomHex } from '../api.js';
import { verifyRound, deriveRound } from '@fair/verify.js';
import { describe } from '@fair/games.js';
import { sha256Hex } from '@fair/core.js';
import { GAME_NAMES } from './Wallet.jsx';
import { Sheet } from '../App.jsx';

const SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;
const short = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—');

/** Браузер один раз заменяет серверный client seed своим случайным (App.jsx) */
export async function ensureBrowserSeed() {
  try {
    const st = await api('/fair');
    if (!st.clientSeedByPlayer) await api('/fair/client-seed', { clientSeed: randomHex(12) });
  } catch {}
}

export default function Fairness() {
  const [st, setSt] = useState(null);
  const [seed, setSeed] = useState('');
  const [rounds, setRounds] = useState([]);
  const [crash, setCrash] = useState(null);
  const [revealed, setRevealed] = useState(null);
  const [tab, setTab] = useState('mine'); // mine | crash | manual
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const load = async () => {
    const [s, h] = await Promise.all([api('/fair'), api('/fair/history?limit=40')]);
    setSt(s); setSeed(s.clientSeed); setRounds(h.rounds);
  };
  useEffect(() => { load().catch(e => setErr(e.message)); }, []);
  useEffect(() => {
    if (tab === 'crash' && !crash) api('/fair/crash?limit=20').then(setCrash).catch(e => setErr(e.message));
  }, [tab]);

  const run = async (fn) => {
    setBusy(true); setErr(''); setNote('');
    try { await fn(); } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const saveSeed = () => run(async () => {
    const s = await api('/fair/client-seed', { clientSeed: seed });
    setSt(s); setNote('Client seed сохранён — следующие игры считаются с ним'); haptic('success');
  });

  const rotate = () => run(async () => {
    const r = await api('/fair/rotate', { clientSeed: SEED_RE.test(seed) ? seed : undefined });
    setRevealed(r.revealed); haptic('success');
    await load();
  });

  if (!st) return <div className="fair">{err ? <div className="notice">⚠ {err}</div> : <div className="hint">Загрузка…</div>}</div>;

  return (
    <div className="fair">
      <div className="rules-title">🛡 Проверка честности</div>
      <div className="rules-sub">Provably Fair: каждый исход можно пересчитать самому</div>

      <details className="fair-how">
        <summary>Как это работает — простыми словами</summary>
        <ol className="rules-steps">
          <li>Ещё до игры сервер загадывает секретное число — <b>server seed</b> — и сразу показывает тебе его «отпечаток» (хэш SHA-256). По отпечатку число не угадать, но и поменять его потом незаметно нельзя.</li>
          <li>Твой браузер добавляет своё случайное число — <b>client seed</b> (можешь вписать любое). Сервер не знал его, когда загадывал своё.</li>
          <li>Каждая ставка получает номер — <b>nonce</b>. Карты, числа и мины получаются из HMAC-SHA256(server seed, client seed:nonce) по открытому алгоритму, без «подкрутки».</li>
          <li>Нажимаешь «Сменить server seed» — старый сид раскрывается, и любую прошлую игру можно пересчитать прямо здесь: результат обязан совпасть.</li>
          <li>За столами и в Ракете сид раунда объявляется до ставок, а в client seed входят сиды всех игроков. В Ракете все раунды заранее связаны цепочкой хэшей.</li>
        </ol>
      </details>

      <div className="seg fair-tabs">
        {[['mine', 'Мои игры'], ['crash', 'Ракета'], ['manual', 'Ручная проверка']].map(([id, l]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>

      {err && <div className="notice">⚠ {err}</div>}
      {note && <div className="hint fair-ok">✓ {note}</div>}

      {tab === 'mine' && (
        <>
          <div className="fair-card">
            <Field label="Server seed (хэш активного)" value={st.serverSeedHash} />
            <Field label="Следующий server seed (хэш)" value={st.nextServerSeedHash} />
            <div className="fair-label">Client seed</div>
            <div className="fair-seed-row">
              <input className="input" value={seed} maxLength={64} onChange={e => setSeed(e.target.value.trim())} />
              <button className="btn small" disabled={busy} onClick={() => setSeed(randomHex(12))} aria-label="Случайный">🎲</button>
            </div>
            {!SEED_RE.test(seed) && <div className="hint">Латиница, цифры, «-» и «_», до 64 символов</div>}
            <div className="fair-meta">Ставок на этой паре сидов (nonce): <b>{st.nonce}</b></div>
            <div className="actions">
              <button className="btn" disabled={busy || seed === st.clientSeed || !SEED_RE.test(seed)} onClick={saveSeed}>💾 Сохранить seed</button>
              <button className="btn primary" disabled={busy || st.activeGame} onClick={rotate}>🔄 Сменить server seed</button>
            </div>
            {st.activeGame && <div className="hint">Сменить сид можно после того, как доиграешь начатую игру.</div>}
          </div>

          {revealed && (
            <div className="fair-card fair-revealed">
              <div className="fair-label">Раскрыт прошлый server seed ({revealed.nonces} ставок)</div>
              <code className="fair-code">{revealed.serverSeed}</code>
              <div className="hint">Его хэш: {short(revealed.hash)} — тот, что был показан до игр. Ниже все эти игры можно проверить.</div>
            </div>
          )}

          <h3 className="section-title">История раундов</h3>
          {rounds.length === 0 && <div className="hint">Сыграй любую игру — она появится здесь</div>}
          {rounds.map(r => <RoundRow key={r.id} r={r} />)}
        </>
      )}

      {tab === 'crash' && (
        <>
          <div className="fair-card">
            <Field label={`Цепочка №${crash?.chainId ?? '…'}: публикация h[${crash?.chainLength ?? '…'}]`} value={crash?.commitment} />
            {crash?.round && <Field label={`Раунд ${crash.round.idx}: хэш сида (виден до ставок)`} value={crash.round.hash} />}
            <div className="hint">
              Сид раунда j — звено цепочки: хэшируешь его j раз и получаешь публикацию, а один раз — сид прошлого раунда.
              Поэтому все точки взрыва зафиксированы заранее. Точку дополнительно «солят» сиды всех, кто поставил.
            </div>
          </div>
          <h3 className="section-title">Последние раунды</h3>
          {!crash && <div className="hint">Загрузка…</div>}
          {crash?.rounds.map(r => <RoundRow key={r.id} r={r} />)}
        </>
      )}

      {tab === 'manual' && <ManualCheck />}
    </div>
  );
}

function Field({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  };
  return (
    <div className="fair-field">
      <div className="fair-label">{label}</div>
      <button className="fair-code" onClick={copy} title="Скопировать">{copied ? 'Скопировано ✓' : value || '—'}</button>
    </div>
  );
}

/** Раунд из истории: по нажатию — проверка в браузере */
function RoundRow({ r }) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState(null);
  const [checking, setChecking] = useState(false);

  const toggle = async () => {
    setOpen(!open);
    if (open || res || !r.serverSeed || !r.done) return;
    setChecking(true);
    try { setRes(await verifyRound(r)); } catch (e) { setRes({ error: e.message }); }
    setChecking(false);
  };

  const badge = !r.done ? ['идёт', ''] : !r.serverSeed ? ['🔒 сид скрыт', ''] : res?.ok ? ['✓ честно', 'pos'] : res && !res.ok ? ['✗ не сошлось', 'neg'] : ['проверить', 'gold'];

  return (
    <div className={`fair-round ${open ? 'open' : ''}`}>
      <button className="history-row fair-round-head" onClick={toggle}>
        <div>
          <div className="history-game">{GAME_NAMES[r.game] || r.game}</div>
          <div className="history-time">{r.createdAt} · nonce {r.nonce}</div>
        </div>
        <div>
          <div className={`fair-badge ${badge[1]}`}>{badge[0]}</div>
          {r.summary && <div className="history-bet">{r.summary}</div>}
        </div>
      </button>
      {open && (
        <div className="fair-round-body">
          <Field label="Хэш server seed (показан до игры)" value={r.serverSeedHash} />
          {r.serverSeed
            ? <Field label="Server seed (раскрыт)" value={r.serverSeed} />
            : <div className="hint">Server seed ещё в игре — он раскроется, когда ты нажмёшь «Сменить server seed».</div>}
          <Field label="Client seed" value={r.clientSeed} />
          {checking && <div className="hint">Пересчитываю в браузере…</div>}
          {res?.error && <div className="notice">⚠ {res.error}</div>}
          {res && !res.error && (
            <div className="fair-checks">
              <Check ok={res.hashOk} text="SHA-256(server seed) = хэш, показанный до игры" />
              {res.chainOk !== undefined && <Check ok={res.chainOk} text="Сид — звено опубликованной цепочки хэшей" />}
              <Check ok={res.recordOk} text="Пересчитанный исход = сыгранный на сервере" />
              <div className="fair-outcome">{res.text}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const Check = ({ ok, text }) => <div className={`fair-check ${ok ? 'pos' : 'neg'}`}>{ok ? '✓' : '✗'} {text}</div>;

const MANUAL_GAMES = ['roulette', 'dice', 'slots', 'plinko', 'mines', 'hilo', 'limbo', 'tower', 'keno', 'blackjack', 'ochko', 'poker', 'baccarat', 'crash',
  'roulette_room', 'blackjack_room', 'ochko_room', 'poker_room', 'durak_room'];

/** Пересчёт по любым сидам — например, скопированным из истории */
function ManualCheck() {
  const [f, setF] = useState({ game: 'dice', serverSeed: '', clientSeed: '', nonce: 0, mines: 3, cards: 5, level: 'medium' });
  const [out, setOut] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const calc = async () => {
    try {
      const params = f.game === 'mines' ? { mines: Number(f.mines) } : f.game === 'hilo' ? { cards: Number(f.cards) } : f.game === 'tower' ? { level: f.level } : {};
      const record = await deriveRound({ game: f.game, serverSeed: f.serverSeed, clientSeed: f.clientSeed, nonce: Number(f.nonce), params });
      setOut({ hash: await sha256Hex(f.serverSeed), text: describe(f.game, record) });
    } catch (e) { setOut({ error: e.message }); }
  };

  return (
    <div className="fair-card">
      <div className="fair-label">Игра</div>
      <select className="input" value={f.game} onChange={set('game')}>
        {MANUAL_GAMES.map(g => <option key={g} value={g}>{GAME_NAMES[g] || g}</option>)}
      </select>
      <div className="fair-label">Server seed</div>
      <input className="input" value={f.serverSeed} onChange={set('serverSeed')} placeholder="раскрытый сид" />
      <div className="fair-label">Client seed</div>
      <input className="input" value={f.clientSeed} onChange={set('clientSeed')} />
      <div className="fair-label">Nonce</div>
      <input className="input" type="number" min={0} value={f.nonce} onChange={set('nonce')} />
      {f.game === 'mines' && <><div className="fair-label">Мин на поле</div><input className="input" type="number" min={1} max={24} value={f.mines} onChange={set('mines')} /></>}
      {f.game === 'tower' && <><div className="fair-label">Сложность</div><select className="input" value={f.level} onChange={set('level')}>
        <option value="easy">Лёгкая</option><option value="medium">Средняя</option><option value="hard">Сложная</option><option value="expert">Эксперт</option></select></>}
      {f.game === 'hilo' && <><div className="fair-label">Сколько карт открыто</div><input className="input" type="number" min={1} max={500} value={f.cards} onChange={set('cards')} /></>}
      <div className="actions"><button className="btn primary big" disabled={!f.serverSeed} onClick={calc}>Пересчитать</button></div>
      {out?.error && <div className="notice">⚠ {out.error}</div>}
      {out && !out.error && (
        <div className="fair-checks">
          <Field label="SHA-256(server seed) — сравни с хэшем, показанным до игры" value={out.hash} />
          <div className="fair-outcome">{out.text}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Строка «хэш сида раунда» на экранах столов и Ракеты: хэш виден до ставок,
 * сид прошлого раунда уже раскрыт — по нажатию открывается его проверка.
 */
export function FairLine({ hash, last }) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState(null);
  const check = async () => {
    setOpen(true);
    setRes(null);
    if (!last?.seed) return;
    try { setRes(await verifyRound({ ...last, serverSeed: last.seed, serverSeedHash: last.hash, params: last.params ?? {} })); }
    catch (e) { setRes({ error: e.message }); }
  };
  return (
    <>
      <button className="fair-line" onClick={() => { haptic('light'); check(); }} title="Проверка честности">
        🛡 сид раунда <code>{short(hash)}</code>{last?.seed && <span> · проверить прошлый</span>}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <div className="fair">
          <div className="rules-title">🛡 Честность раунда</div>
          <Field label="Хэш сида текущего раунда (виден до ставок)" value={hash} />
          {last?.seed ? (
            <>
              <h3 className="section-title">Прошлый раунд</h3>
              <Field label="Хэш (был показан до ставок)" value={last.hash} />
              <Field label="Server seed (раскрыт)" value={last.seed} />
              <Field label={`Client seed (сиды игроков) · nonce ${last.nonce}`} value={last.clientSeed} />
              {!res && <div className="hint">Пересчитываю в браузере…</div>}
              {res?.error && <div className="notice">⚠ {res.error}</div>}
              {res && !res.error && (
                <div className="fair-checks">
                  <Check ok={res.hashOk} text="SHA-256(server seed) = хэш, показанный до ставок" />
                  {res.chainOk !== undefined && <Check ok={res.chainOk} text="Сид — звено опубликованной цепочки хэшей" />}
                  <div className="fair-outcome">{res.text}</div>
                </div>
              )}
            </>
          ) : <div className="hint">Прошлого раунда ещё нет — проверка появится после первого раунда.</div>}
          <div className="hint">Все свои раунды можно проверить в «🛡 Проверка честности» на главном экране.</div>
        </div>
      </Sheet>
    </>
  );
}
