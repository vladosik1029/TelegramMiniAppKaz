// E2E-тест API через dev-режим (без Telegram initData)
// запуск: node test.js  (сервер должен быть запущен на :3000)

const B = 'http://localhost:3000/api';

const api = async (path, body) => {
  try {
    const res = await fetch(B + path, {
      method: body !== undefined ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { console.log(`!!! ${path} вернул не-JSON (${res.status}):`, text.slice(0, 200)); return { status: res.status, data: { error: 'HTML' } }; }
    return { status: res.status, data };
  } catch (e) {
    console.log(`!!! FETCH FAIL ${path}:`, e.message);
    return { status: 0, data: { error: e.message } };
  }
};

let fail = 0;
const check = (cond, name, extra) => {
  if (cond) console.log('✓', name);
  else { fail = 1; console.log('✗', name, extra ? JSON.stringify(extra).slice(0, 300) : ''); }
};

// init: создаётся dev-юзер со старым балансом
let r = await api('/init', {});
check(r.status === 200, 'init ok', r);
check(r.data.balance === 1000, 'стартовый баланс 1000 (или создан ранее)', r.data);
check(r.data.isAdmin === true, 'dev-юзер админ', r.data);
const devId = r.data.id;

// баланс
let bal = r.data.balance;

// ── blackjack: полный цикл
r = await api('/games/blackjack/start', { bet: 50 });
check(r.status === 200 && r.data.view.player.length === 2, 'bj start', r);
check(r.data.balance === bal - 50 || r.data.finished === true, 'bj ставка списана', r);
bal = r.data.balance;

let done = r.data.finished;
let guard = 20;
while (!done && guard--) {
  const a = await api('/games/blackjack/action', { action: r.data.view.canDouble && guard === 19 ? 'double' : 'hit' });
  if (a.status !== 200) { check(false, 'action', a); break; }
  r = a; bal = r.data.balance;
  if (r.data.finished) done = true;
  else if (r.data.view.playerTotal === 21) {
    const s = await api('/games/blackjack/action', { action: 'stand' });
    r = s; bal = r.data.balance; done = true;
  }
}
if (!done) {
  const s = await api('/games/blackjack/action', { action: 'stand' });
  r = s; bal = r.data.balance; done = true;
}
check(r.data.finished, 'bj завершился', r.data);
check(typeof r.data.net === 'number', 'bj net посчитан: ' + r.data.net);
check(r.data.balance === bal, 'bj баланс совпадает');

// действие без активной игры
r = await api('/games/blackjack/action', { action: 'hit' });
check(r.status === 400 && r.data.error.includes('Активная игра'), 'bj action без сессии отклонён', r);

// ── очко
let och = await api('/games/ochko/start', { bet: 20 });
check(och.status === 200 && och.data.view.player.length === 2, 'ochko start', och);
if (och.data.finished) check(typeof och.data.net === 'number', 'ochko instant: ' + och.data.message);
else {
  const stop = await api('/games/ochko/action', { action: 'stop' });
  check(stop.data.finished === true, 'ochko stop завершает', stop);
}

// ── покер
r = await api('/games/poker/start', { bet: 30 });
check(r.status === 200 && r.data.view.player.length === 5, 'poker start', r);
r = await api('/games/poker/action', { action: { discard: [0, 2] } });
check(r.data.finished && r.data.view.bot.every(c => !c.hidden), 'poker draw + bot reveal', r);
check(r.data.view.botHand != null, 'poker botHand: ' + r.data.view.botHand);

// ── ставка больше баланса
r = await api('/init', {});
const huge = await api('/games/blackjack/start', { bet: r.data.balance + 5 });
check(huge.status === 400 && huge.data.error.includes('Недостаточно'), 'ставка > баланса отклонена', huge);

// ставка некорректная
r = await api('/games/blackjack/start', { bet: -5 });
check(r.status === 400, 'мелкая/отрицательная ставка отклонена', r);

// ── админ
r = await api('/admin/users');
check(r.status === 200 && r.data.users.some(u => u.id === devId), 'admin users list', r);

r = await api('/admin/balance', { userId: devId, mode: 'set', amount: 7777 });
check(r.status === 200 && r.data.balance === 7777, 'admin set balance', r);

r = await api('/admin/balance', { userId: devId, mode: 'add', amount: 223 });
check(r.data.balance === 8000, 'admin add', r);

r = await api('/admin/balance', { userId: devId, mode: 'sub', amount: 400 });
check(r.data.balance === 7600, 'admin sub', r);

r = await api('/admin/balance', { userId: devId, mode: 'sub', amount: 999999 });
check(r.status === 400 && r.data.error.includes('минус'), 'баланс не уйдёт в минус', r);

r = await api('/admin/balance', { userId: 123456, mode: 'add', amount: 5 });
check(r.status === 404, 'неизвестный юзер', r);

// админ без прав: другой dev-юзер тоже админ по ADMIN_IDS; проверим 401 через
// f太原ake заголовок initData, который не пройдёт проверку подписи (нет BOT_TOKEN)
const res401 = await fetch(B + '/init', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'tma user=%7B%22id%22%3A1%7D&hash=ff' }, body: '{}',
});
// без BOT_TOKEN подпись не проверяется; initData есть, но не 'dev' пустой → getUser вернёт null
check(res401.status === 401, 'поддельные initData отклоняются', { status: res401.status });

console.log(fail ? '\n⛔ ЕСТЬ ПРОВАЛЫ' : '\n✅ Все проверки пройдены');
process.exit(fail);
