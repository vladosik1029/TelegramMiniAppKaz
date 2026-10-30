// Проверка production-режима: сервер раздаёт собранный клиент + API
const html = await (await fetch('http://localhost:3000/')).text();
console.log('HTML-страница отдаётся:', html.includes('telegram-web-app.js') ? 'да' : 'НЕТ');

const r = await fetch('http://localhost:3000/api/init', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
const d = await r.json();
console.log('API работает:', r.status === 200 && d.balance !== undefined ? 'да, баланс = ' + d.balance : 'НЕТ: ' + JSON.stringify(d));
