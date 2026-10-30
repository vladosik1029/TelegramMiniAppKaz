import React, { useState, useEffect } from 'react';
import { api, haptic } from '../api.js';
import { Coin } from '../App.jsx';

export default function AdminPanel({ me, refresh }) {
  const [users, setUsers] = useState(null);
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState(null); // открытая строка
  const [amount, setAmount] = useState('100');

  const load = () => api('/admin/users')
    .then(d => setUsers(d.users))
    .catch(e => setMsg('⚠ ' + e.message));
  useEffect(() => { load(); }, []);

  const apply = async (userId, mode) => {
    setMsg('');
    try {
      await api('/admin/balance', { userId, mode, amount: Number(amount) });
      haptic('success');
      setMsg(`✅ Готово: ${mode === 'set' ? 'установлено' : mode === 'add' ? 'начислено' : 'списано'} ${amount} 🪙 для #${userId}`);
      await load();
      await refresh();
    } catch (e) {
      haptic('error');
      setMsg('⚠ ' + e.message);
    }
  };

  if (!users) return <main className="page"><div className="hint">Загрузка…</div></main>;

  const list = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return String(u.id).includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.first_name || '').toLowerCase().includes(q);
  });

  return (
    <main className="page">
      <h3 className="section-title">👑 Админ-панель — управление балансами</h3>
      <div className="hint">Ты можешь устанавливать, начислять и списывать фишки у любого игрока, включая себя.</div>

      <input
        className="input"
        placeholder="Поиск: id, @username, имя"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div className="admin-amount-row">
        <span>Сумма:</span>
        <input className="input short" value={amount}
          onChange={e => setAmount(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
        🪙
      </div>

      {msg && <div className="notice">{msg}</div>}

      {list.map(u => (
        <div key={u.id} className="admin-user">
          <div className="admin-user-row" onClick={() => setEditId(editId === u.id ? null : u.id)}>
            <div>
              <div className="admin-name">
                {u.id === me.id && '👑 '}{u.first_name}
                {u.username && <span className="admin-username"> @{u.username}</span>}
              </div>
              <div className="admin-meta">#{u.id} · игр: {u.games} · итог: {u.total_net}</div>
            </div>
            <div className="admin-balance">{u.balance.toLocaleString('ru-RU')} 🪙</div>
          </div>
          {editId === u.id && (
            <div className="admin-actions">
              <button className="btn small" onClick={() => apply(u.id, 'set')}>Установить</button>
              <button className="btn small primary" onClick={() => apply(u.id, 'add')}>Начислить +</button>
              <button className="btn small danger" onClick={() => apply(u.id, 'sub')}>Списать −</button>
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
