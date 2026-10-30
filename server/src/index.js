import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { env } from './telegram.js';
import { api } from './routes.js';

const app = express();
app.use(express.json());

// лог всех входящих запросов (для отладки туннеля)
app.use((req, res, next) => {
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(new Date().toLocaleTimeString('ru-RU'), req.method, req.originalUrl,
        '->', res.statusCode, '| UA:', (req.headers['user-agent'] || '').slice(0, 40));
    }
  });
  next();
});

app.use('/api', api);

// Раздаём собранный клиент (production: npm run build:client)
const clientDist = path.join(process.cwd(), '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(env.PORT, () => {
  console.log(`Casino API: http://localhost:${env.PORT}`);
  if (env.DEV_MODE) {
    console.log(`DEV_MODE включён: браузер работает как тестовый игрок (id=${env.DEV_USER_ID})`);
    console.log(
      env.ADMIN_IDS.has(env.DEV_USER_ID)
        ? 'Dev-игрок — АДМИН'
        : 'Dev-игрок — НЕ админ (добавь его id в ADMIN_IDS)'
    );
  }
  if (!env.ADMIN_IDS.size) console.warn('⚠ ADMIN_IDS пуст — админ-панель недоступна никому');
  if (!env.BOT_TOKEN && !env.DEV_MODE) console.warn('⚠ BOT_TOKEN не задан — авторизация Telegram не будет работать');
});
