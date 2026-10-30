// Проверка через HTTPS-туннель: клиент + авторизация (валидная/невалидная подпись)
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = dotenv.config({ path: path.join(__dirname, '..', '.env') }).parsed;

const BASE = env.WEBAPP_URL;

// 1) клиент отдаётся
const html = await (await fetch(BASE + '/')).text();
console.log('1. Клиент через HTTPS:', html.includes('telegram-web-app.js') ? 'да ✅' : 'НЕТ ❌');

// функция подписи initData (как делает Telegram: data-check-string из ДЕКОДИРОВАННЫХ значений)
function sign(data) {
  const secret = crypto.createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}
const userData = JSON.stringify({ id: 230833355, first_name: 'Тест', username: 'test_auth' });
const sp = new URLSearchParams();
sp.set('auth_date', String(Math.floor(Date.now() / 1000)));
sp.set('user', userData);
const dataCheckString = [...sp.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
const goodInit = sp.toString() + `&hash=${sign(dataCheckString)}`;

// 2) валидная подпись → должен создаться пользователь
let r = await fetch(BASE + '/api/init', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + goodInit },
  body: '{}',
});
const good = await r.json();
console.log('2. Валидная подпись:',
  r.status === 200 && good.id === 230833355
    ? `да ✅ (id ${good.id}, баланс ${good.balance}, админ: ${good.isAdmin})`
    : 'НЕТ ❌ ' + JSON.stringify(good));

// 3) подделанная подпись → 401
const badInit = goodInit.replace(/hash=.*/, 'hash=ff');
r = await fetch(BASE + '/api/init', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'tma ' + badInit },
  body: '{}',
});
console.log('3. Поддельная подпись отклоняется:', r.status === 401 ? 'да ✅' : 'НЕТ ❌ (status ' + r.status + ')');

// 4) без initData → 401 (DEV_MODE выключен)
r = await fetch(BASE + '/api/init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
console.log('4. Запрос без Telegram отклоняется:', r.status === 401 ? 'да ✅' : 'НЕТ ❌ (status ' + r.status + ')');
