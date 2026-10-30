// Разовая настройка бота: привязывает MiniApp к кнопке меню и команде /start.
// Запуск: npm run setup:bot   (из папки server)
// Требует BOT_TOKEN и WEBAPP_URL в server/.env

import { env } from './telegram.js';

const API = (method, params) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).then(r => r.json());

if (!env.BOT_TOKEN) { console.error('BOT_TOKEN не задан в server/.env'); process.exit(1); }
if (!env.WEBAPP_URL || env.WEBAPP_URL.includes('example.com')) {
  console.error('WEBAPP_URL не задан (нужен HTTPS-адрес MiniApp)'); process.exit(1);
}

const me = await API('getMe');
if (!me.ok) { console.error('Токен недействителен:', me.description); process.exit(1); }
console.log('Бот:', me.result.username, `(@${me.result.username})`);

const cmds = await API('setMyCommands', {
  commands: [{ command: 'start', description: '🎰 Открыть казино' }],
});
console.log('setMyCommands:', cmds.ok ? 'ok' : cmds.description);

const menu = await API('setChatMenuButton', {
  menu_button: { type: 'web_app', text: '🎰 Казино', web_app: { url: env.WEBAPP_URL } },
});
console.log('setChatMenuButton:', menu.ok ? 'ok' : menu.description);

console.log(`\nГотово. Открой бота @${me.result.username} и нажми кнопку меню (слева от поля ввода).`);
