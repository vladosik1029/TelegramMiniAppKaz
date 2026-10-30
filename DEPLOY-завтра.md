# TODO: деплой на сервер (завтра утром)

## 1. Подготовка на сервере (Ubuntu/VPS)
- [ ] Node.js 24+ (`node --version`) → если нет: `curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs`
- [ ] Залить проект (`git clone` или scp папку без `node_modules` и `client/dist`)
- [ ] Не заливать `server/.env` и `server/casino.db` — создать полновесные на месте

## 2. Сборка и запуск
- [ ] `npm run install:all` (в корне)
- [ ] `npm run build:client`
- [ ] `server/.env`:
      BOT_TOKEN=*** (если был revoke — новый токен)
      ADMIN_IDS=230833355
      WEBAPP_URL=https://<домен>            ← реальный HTTPS-домен
      DEV_MODE=0
      START_BALANCE=1000, PORT=3000
- [ ] `pm2 start src/index.js --name casino` (или systemd-юнит), `pm2 save && pm2 startup`

## 3. HTTPS
- [ ] Nginx: `server_name` → proxy_pass http://127.0.0.1:3000 + Let's Encrypt (`certbot`)
    - простой шаблон:
      server { listen 443 ssl; server_name <домен>;
        location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; } }
- [ ] Проверка: `curl https://<домен>/api/init` → должен вернуть JSON 401 (не HTML)

## 4. Привязка бота (когда URL поменялся)
- [ ] `cd server && npm run setup:bot`  — обновит кнопку меню на новый WEBAPP_URL
- [ ] Telegram сессии могут кешировать старый URL → перезапустить клиент

## 5. Smoke-test после деплоя
- [ ] Открыть @izzi21_bot → «🎰 Казино»: профиль загрузился, есть вкладка 👑 Админ
- [ ] Blackjack: ставка → добор → дабл; Очко: пан-пан/очко всплывают; Покер: обмен карт
- [ ] Админка: начислить себе фишки, проверить список игроков
- [ ] second account (друг) → проверить, что он в списке у админа

## Известные мелочи
- При смене WEBAPP_URL с публичным IP/доменом — токен бота только в .env, наружу не светить
- If вы делаете revoke токена в @BotFather — обновить BOT_TOKEN + перезапуск pm2
