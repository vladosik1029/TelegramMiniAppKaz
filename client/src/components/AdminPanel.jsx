import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, haptic } from '../api.js';
import { Sheet } from '../App.jsx';
import { GAME_NAMES } from './Wallet.jsx';

// Админка: игроки (поиск, фильтры, сортировка, карточка с изменением баланса)
// и журнал всех изменений балансов с отменой. Права проверяет сервер.

const PAGE = 30;

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Заходили за 24 ч' },
  { id: 'new', label: 'Новые 7 дн' },
  { id: 'zero', label: 'Без фишек' },
  { id: 'tables', label: 'За столами' },
  { id: 'admins', label: 'Админы' },
];

const SORTS = [
  { id: 'seen', label: 'Недавно заходили' },
  { id: 'balance_desc', label: 'Баланс: больше' },
  { id: 'balance_asc', label: 'Баланс: меньше' },
  { id: 'net_desc', label: 'Итог: в плюсе' },
  { id: 'net_asc', label: 'Итог: в минусе' },
  { id: 'games', label: 'Больше игр' },
  { id: 'new', label: 'Новые' },
];

const MODES = [
  { id: 'add', label: '+ Начислить', verb: 'Начислить' },
  { id: 'sub', label: '− Списать', verb: 'Списать' },
  { id: 'set', label: '= Задать', verb: 'Установить баланс' },
];

const QUICK = [100, 500, 1000, 5000, 10000, 50000];

const LOG_LABELS = { add: 'Начислено', sub: 'Списано', set: 'Установлено', undo: 'Отмена' };

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const games = (n) => `${fmt(n)} ${plural(n, 'игра', 'игры', 'игр')}`;
const netClass = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

// сервер отдаёт UTC «YYYY-MM-DD HH:MM:SS»
const toDate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null);

function ago(s) {
  const d = toDate(s);
  if (!d) return '—';
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'только что';
  if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч назад`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)} дн назад`;
  return d.toLocaleDateString('ru-RU');
}

const dateTime = (s) => toDate(s)?.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) || '—';

function useWide() {
  const q = '(min-width: 900px)';
  const [wide, setWide] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function Avatar({ u, big }) {
  const letter = (u.first_name || u.username || '?').trim().charAt(0).toUpperCase();
  const hue = (Number(u.id) * 47) % 360;
  return (
    <div className={`adm-avatar ${big ? 'big' : ''}`} style={{ background: `hsl(${hue} 35% 30%)` }}>
      {letter}
    </div>
  );
}

export default function AdminPanel({ me, refresh }) {
  const wide = useWide();
  const [view, setView] = useState('players'); // players | log
  const [selected, setSelected] = useState(null); // id игрока для карточки
  const [stats, setStats] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // после изменения баланса — обновить список, статистику и свой баланс в шапке
  const changed = useCallback(async (userId) => {
    setReloadKey(k => k + 1);
    if (userId === me.id) await refresh();
  }, [me.id, refresh]);

  const card = selected != null && (
    <PlayerCard key={selected} id={selected} onChanged={changed} reloadKey={reloadKey} />
  );

  return (
    <main className="page admin">
      <div className="adm-head">
        <h3 className="section-title">👑 Админ-панель</h3>
        <div className="adm-tabs">
          <button className={view === 'players' ? 'active' : ''} onClick={() => setView('players')}>👥 Игроки</button>
          <button className={view === 'log' ? 'active' : ''} onClick={() => setView('log')}>🧾 Журнал</button>
        </div>
      </div>

      {stats && (
        <div className="adm-stats">
          <Stat label="Игроков" value={fmt(stats.players)} sub={stats.fresh ? `+${stats.fresh} за сутки` : null} />
          <Stat label="Заходили за 24 ч" value={fmt(stats.active)} />
          <Stat label="Фишек у игроков" value={fmt(stats.chips)} />
          <Stat label="В банках столов" value={fmt(stats.inTables)} />
        </div>
      )}

      <div className={`adm-layout ${wide ? 'wide' : ''}`}>
        <div className="adm-main">
          {view === 'players'
            ? <PlayerList me={me} selected={selected} onSelect={(id) => { haptic('light'); setSelected(id); }}
                onStats={setStats} reloadKey={reloadKey} />
            : <AdminLog onSelect={(id) => { setSelected(id); }} onChanged={changed} reloadKey={reloadKey} />}
        </div>
        {wide && (
          <aside className="adm-side">
            {card || <div className="adm-empty">Выбери игрока слева — здесь будет его карточка, баланс и история.</div>}
          </aside>
        )}
      </div>

      {!wide && <Sheet open={selected != null} onClose={() => setSelected(null)}>{card}</Sheet>}
    </main>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="adm-stat">
      <div className="adm-stat-value">{value}</div>
      <div className="adm-stat-label">{label}</div>
      {sub && <div className="adm-stat-sub">{sub}</div>}
    </div>
  );
}

// ─── список игроков ─────────────────────────────────────────────────────────
function PlayerList({ me, selected, onSelect, onStats, reloadKey }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('seen');
  const [users, setUsers] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = async (offset, keep) => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: debounced, filter, sort, offset, limit: PAGE });
      const d = await api('/admin/users?' + params);
      if (id !== reqId.current) return; // пришёл ответ на устаревший запрос
      setUsers(prev => (keep && prev ? [...prev, ...d.users] : d.users));
      setTotal(d.total);
      onStats(d.stats);
      setErr('');
    } catch (e) {
      if (id === reqId.current) setErr(e.message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  // смена поиска/фильтра/сортировки — с начала; после изменения баланса — те же строки
  useEffect(() => { load(0, false); }, [debounced, filter, sort]);
  useEffect(() => {
    if (reloadKey && users) {
      const id = ++reqId.current;
      const params = new URLSearchParams({ q: debounced, filter, sort, offset: 0, limit: Math.max(PAGE, users.length) });
      api('/admin/users?' + params).then(d => {
        if (id !== reqId.current) return;
        setUsers(d.users); setTotal(d.total); onStats(d.stats);
      }).catch(() => {});
    }
  }, [reloadKey]);

  return (
    <>
      <div className="adm-search">
        <span className="adm-search-icon">🔍</span>
        <input className="input" placeholder="Имя, @username или Telegram ID" value={q}
          onChange={e => setQ(e.target.value)} autoComplete="off" enterKeyHint="search" />
        {q && <button className="adm-search-clear" onClick={() => setQ('')} aria-label="Очистить">✕</button>}
      </div>

      <div className="adm-filters">
        {FILTERS.map(f => (
          <button key={f.id} className={`adm-pill ${filter === f.id ? 'active' : ''}`}
            onClick={() => { haptic('light'); setFilter(f.id); }}>{f.label}</button>
        ))}
      </div>

      <div className="adm-listbar">
        <span>{users ? `Найдено: ${fmt(total)}` : 'Загрузка…'}{loading && users ? ' · …' : ''}</span>
        <select className="adm-select" value={sort} onChange={e => setSort(e.target.value)} aria-label="Сортировка">
          {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {err && <div className="notice">⚠ {err}</div>}

      {users && users.length === 0 && <div className="adm-empty">Никого не нашли. Попробуй другой запрос или фильтр.</div>}

      <div className="adm-list">
        {users?.map(u => (
          <button key={u.id} className={`adm-row ${selected === u.id ? 'active' : ''}`} onClick={() => onSelect(u.id)}>
            <Avatar u={u} />
            <div className="adm-row-main">
              <div className="adm-row-name">
                <span className="adm-ellipsis">{u.first_name || 'Без имени'}</span>
                {u.isAdmin && <span className="adm-tag gold">👑</span>}
                {u.id === me.id && <span className="adm-tag">вы</span>}
              </div>
              <div className="adm-row-meta">
                {u.username ? `@${u.username} · ` : ''}#{u.id}
              </div>
              <div className="adm-row-meta">
                {games(u.games)} · <span className={netClass(u.total_net)}>{signed(u.total_net)}</span> · {ago(u.last_seen)}
              </div>
            </div>
            <div className="adm-row-bal">
              <div className="adm-coins">{fmt(u.balance)} 🪙</div>
              {u.in_tables > 0 && <div className="adm-row-meta">+{fmt(u.in_tables)} на столах</div>}
            </div>
          </button>
        ))}
      </div>

      {users && users.length < total && (
        <button className="btn adm-more" disabled={loading} onClick={() => load(users.length, true)}>
          {loading ? 'Загрузка…' : `Показать ещё (${fmt(total - users.length)})`}
        </button>
      )}
    </>
  );
}

// ─── карточка игрока ────────────────────────────────────────────────────────
function PlayerCard({ id, onChanged, reloadKey }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const load = () => api('/admin/users/' + id).then(d => { setData(d); setErr(''); }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, [id, reloadKey]);

  if (err) return <div className="notice">⚠ {err}</div>;
  if (!data) return <div className="hint">Загрузка…</div>;

  const { user: u, stats, perGame, history, tables, log } = data;
  const winRate = u.games ? Math.round((stats.wins / u.games) * 100) : 0;

  const copyId = async () => {
    try { await navigator.clipboard.writeText(String(u.id)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  return (
    <div className="adm-card">
      <div className="adm-card-head">
        <Avatar u={u} big />
        <div className="adm-card-who">
          <div className="adm-card-name">
            <span className="adm-ellipsis">{u.first_name || 'Без имени'}</span>
            {u.isAdmin && <span className="adm-tag gold">👑 админ</span>}
          </div>
          <div className="adm-card-links">
            {u.username && <a href={`https://t.me/${u.username}`} target="_blank" rel="noreferrer">@{u.username}</a>}
            <button className="adm-copy" onClick={copyId}>#{u.id} {copied ? '✓' : '⧉'}</button>
          </div>
          <div className="adm-row-meta">Был: {ago(u.last_seen)} · с {toDate(u.created_at)?.toLocaleDateString('ru-RU')}</div>
        </div>
      </div>

      <div className="adm-card-balance">
        <div>
          <div className="adm-stat-label">Баланс</div>
          <div className="adm-big-coins">{fmt(u.balance)} 🪙</div>
        </div>
        {u.in_tables > 0 && (
          <div className="adm-right">
            <div className="adm-stat-label">В банках столов</div>
            <div className="adm-coins">{fmt(u.in_tables)} 🪙</div>
          </div>
        )}
      </div>

      <BalanceEditor u={u} onDone={() => onChanged(u.id)} />

      <div className="adm-grid">
        <Cell label="Сыграно" value={fmt(u.games)} />
        <Cell label="Итог" value={signed(u.total_net)} cls={netClass(u.total_net)} />
        <Cell label="Оборот ставок" value={fmt(u.wagered)} />
        <Cell label="Выигрышей" value={`${winRate}%`} />
        <Cell label="Лучший выигрыш" value={signed(stats.bestWin)} cls={netClass(stats.bestWin)} />
        <Cell label="Худший проигрыш" value={signed(stats.worstLoss)} cls={netClass(stats.worstLoss)} />
      </div>

      {tables.length > 0 && (
        <Section title="Сидит за столами">
          {tables.map(t => (
            <div key={t.id} className="adm-line">
              <span className="adm-ellipsis">{t.name} · {GAME_NAMES[t.game] || t.game}</span>
              <b>{fmt(t.bank)} 🪙</b>
            </div>
          ))}
        </Section>
      )}

      {perGame.length > 0 && (
        <Section title="По играм">
          {perGame.map(g => (
            <div key={g.game} className="adm-line">
              <span>{GAME_NAMES[g.game] || g.game} <small className="muted">· {games(g.games)}</small></span>
              <b className={netClass(g.net)}>{signed(g.net)}</b>
            </div>
          ))}
        </Section>
      )}

      <Section title="Изменения баланса админами">
        {log.length === 0 && <div className="hint">Пока не было.</div>}
        {log.map(e => <LogEntry key={e.id} e={e} compact onUndone={() => onChanged(u.id)} />)}
      </Section>

      <Section title="Последние игры">
        {history.length === 0 && <div className="hint">Ещё не играл.</div>}
        {history.map((h, i) => (
          <div key={i} className="adm-line">
            <span>{GAME_NAMES[h.game] || h.game} <small className="muted">· ставка {fmt(h.bet)} · {dateTime(h.created_at)}</small></span>
            <b className={netClass(h.net)}>{signed(h.net)}</b>
          </div>
        ))}
      </Section>
    </div>
  );
}

const Cell = ({ label, value, cls = '' }) => (
  <div className="adm-cell"><div className={`adm-cell-value ${cls}`}>{value}</div><div className="adm-stat-label">{label}</div></div>
);

const Section = ({ title, children }) => (
  <section className="adm-section"><h4>{title}</h4>{children}</section>
);

// ─── изменение баланса: режим → сумма → (комментарий) → подтверждение ─────
function BalanceEditor({ u, onDone }) {
  const [mode, setMode] = useState('add');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  const amt = amount === '' ? null : Number(amount);
  const after = amt == null ? null : mode === 'add' ? u.balance + amt : mode === 'sub' ? u.balance - amt : amt;
  const tooLow = mode === 'sub' && amt != null && amt > u.balance;
  const valid = amt != null && (mode === 'set' ? amt >= 0 : amt > 0) && !tooLow && after !== u.balance;
  const m = MODES.find(x => x.id === mode);

  const pickMode = (id) => { setMode(id); setConfirm(false); setMsg(null); };
  const setAmt = (v) => { setAmount(v); setConfirm(false); setMsg(null); };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api('/admin/balance', { userId: u.id, mode, amount: amt, comment });
      haptic('success');
      setMsg({ ok: true, text: `Готово: ${fmt(r.before)} → ${fmt(r.balance)} 🪙` });
      setAmount(''); setComment(''); setConfirm(false);
      onDone();
    } catch (e) {
      haptic('error');
      setMsg({ ok: false, text: e.message });
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-editor">
      <div className="adm-modes">
        {MODES.map(x => (
          <button key={x.id} className={`adm-mode ${x.id} ${mode === x.id ? 'active' : ''}`} onClick={() => pickMode(x.id)}>
            {x.label}
          </button>
        ))}
      </div>

      <div className="adm-amount">
        <input className="input" inputMode="numeric" placeholder={mode === 'set' ? 'Новый баланс' : 'Сумма'}
          value={amount === '' ? '' : fmt(amount)}
          onChange={e => { const d = e.target.value.replace(/\D/g, '').slice(0, 10); setAmt(d === '' ? '' : String(Number(d))); }} />
        <span className="adm-amount-coin">🪙</span>
      </div>

      <div className="adm-quick">
        {QUICK.map(v => (
          <button key={v} className="chip small" onClick={() => setAmt(String(v))}>{fmt(v)}</button>
        ))}
        {mode !== 'set' && amt != null && (
          <button className="chip small" onClick={() => setAmt(String(amt * 2))}>×2</button>
        )}
        {mode === 'sub' && u.balance > 0 && <button className="chip small" onClick={() => setAmt(String(u.balance))}>Всё</button>}
        {mode === 'set' && <button className="chip small" onClick={() => setAmt('0')}>Обнулить</button>}
      </div>

      <input className="input" placeholder="Причина (необязательно): бонус, возврат, ошибка…" maxLength={200}
        value={comment} onChange={e => setComment(e.target.value)} />

      <div className={`adm-preview ${tooLow ? 'bad' : ''}`}>
        {amt == null
          ? 'Выбери сумму'
          : tooLow
            ? `Не хватает: у игрока ${fmt(u.balance)} 🪙`
            : <>{fmt(u.balance)} → <b>{fmt(after)}</b> 🪙 <span className={netClass(after - u.balance)}>({signed(after - u.balance)})</span></>}
      </div>

      {!confirm ? (
        <button className={`btn big adm-go ${mode === 'sub' ? 'danger' : 'primary'}`} disabled={!valid || busy}
          onClick={() => { haptic('light'); setConfirm(true); }}>
          {mode === 'set' ? `${m.verb}: ${amt == null ? '…' : fmt(amt)} 🪙` : `${m.verb} ${amt == null ? '' : fmt(amt) + ' 🪙'}`}
        </button>
      ) : (
        <div className="adm-confirm">
          <div>
            Точно {mode === 'add' ? 'начислить' : mode === 'sub' ? 'списать' : 'установить'} <b>{fmt(amt)} 🪙</b>
            {mode === 'set' ? ' как баланс' : ''} игроку <b>{u.first_name}</b>?
            <div className="adm-row-meta">Баланс станет {fmt(after)} 🪙{comment.trim() ? ` · «${comment.trim()}»` : ''}</div>
          </div>
          <div className="adm-confirm-btns">
            <button className="btn" onClick={() => setConfirm(false)} disabled={busy}>Отмена</button>
            <button className={`btn ${mode === 'sub' ? 'danger' : 'primary'}`} onClick={submit} disabled={busy}>
              {busy ? '…' : 'Подтвердить'}
            </button>
          </div>
        </div>
      )}

      {msg && <div className={`adm-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.ok ? '✅ ' : '⚠ '}{msg.text}</div>}
    </div>
  );
}

// ─── журнал действий ────────────────────────────────────────────────────────
function LogEntry({ e, compact, onUndone, onSelect }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const delta = e.after - e.before;

  const undo = async () => {
    setBusy(true);
    try {
      await api(`/admin/log/${e.id}/undo`, {});
      haptic('success');
      onUndone();
    } catch (x) {
      haptic('error');
      setErr(x.message);
    } finally {
      setBusy(false); setAsk(false);
    }
  };

  return (
    <div className={`adm-log ${e.undone_by ? 'undone' : ''}`}>
      <div className="adm-log-main">
        <div className="adm-log-top">
          <span className={`adm-log-mode ${e.mode}`}>{LOG_LABELS[e.mode] || e.mode}</span>
          {!compact && (
            <button className="adm-link" onClick={() => onSelect?.(e.user_id)}>
              {e.first_name || 'Игрок'}{e.username ? ` @${e.username}` : ''}
            </button>
          )}
          <b className={netClass(delta)}>{signed(delta)} 🪙</b>
        </div>
        <div className="adm-row-meta">
          {fmt(e.before)} → {fmt(e.after)} · {dateTime(e.created_at)} · {e.admin_name || `#${e.admin_id}`}
          {e.comment && <> · «{e.comment}»</>}
          {e.undone_by && ' · отменено'}
        </div>
        {err && <div className="adm-msg bad">⚠ {err}</div>}
      </div>
      {e.mode !== 'undo' && !e.undone_by && delta !== 0 && (
        ask ? (
          <div className="adm-log-ask">
            <button className="chip small" onClick={() => setAsk(false)} disabled={busy}>Нет</button>
            <button className="chip small danger" onClick={undo} disabled={busy}>Отменить</button>
          </div>
        ) : (
          <button className="chip small" onClick={() => { setErr(''); setAsk(true); }} title="Вернуть баланс как было">↩</button>
        )
      )}
    </div>
  );
}

function AdminLog({ onSelect, onChanged, reloadKey }) {
  const [entries, setEntries] = useState(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async (offset, limit = PAGE) => {
    setLoading(true);
    try {
      const d = await api(`/admin/log?offset=${offset}&limit=${limit}`);
      setEntries(prev => (offset && prev ? [...prev, ...d.entries] : d.entries));
      setTotal(d.total);
      setErr('');
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(0, Math.max(PAGE, entries?.length || 0)); }, [reloadKey]);

  return (
    <>
      <div className="hint">Все изменения балансов админами. ↩ — вернуть как было (запишется отдельной строкой).</div>
      {err && <div className="notice">⚠ {err}</div>}
      {entries && entries.length === 0 && <div className="adm-empty">Журнал пуст.</div>}
      <div className="adm-list">
        {entries?.map(e => <LogEntry key={e.id} e={e} onSelect={onSelect} onUndone={() => onChanged(e.user_id)} />)}
      </div>
      {entries && entries.length < total && (
        <button className="btn adm-more" disabled={loading} onClick={() => load(entries.length)}>
          {loading ? 'Загрузка…' : `Показать ещё (${fmt(total - entries.length)})`}
        </button>
      )}
    </>
  );
}
