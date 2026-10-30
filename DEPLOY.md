# DEPLOY — продакшен-инфа и runbook

## Текущая схема (развёрнута)

```
Telegram → https://poker.izzinet.xyz (Caddy + Let's Encrypt)
         → docker-контейнер casino (image casino:latest, сеть remnawave-network)
         → node:24 внутри контейнера: API + раздача client/dist, порт 3100
         → SQLite: /app/server/data/casino.db (volume хоста: /opt/TelegramMiniAppKaz/casino-data/)
```

- Сервер: `node-42581` (LXC), проект в `/opt/TelegramMiniAppKaz`.
- Caddy: контейнер `caddy`, конфиг `/opt/caddy/Caddyfile` (бэкап: `Caddyfile.bak`),
  блок для казино: `poker.izzinet.xyz { reverse_proxy casino:3100 }`.
- `.env` лежит в `server/.env` (BOT_TOKEN, ADMIN_IDS, WEBAPP_URL=https://poker.izzinet.xyz,
  DEV_MODE=0, START_BALANCE=1000, PORT — задаёт compose).
- Кнопка «🎰 Казино» привязана к WebApp один раз (`npm run setup:bot`), при ребутах не пересоздаётся.

## Обновление кода на сервере

```bash
cd /opt/TelegramMiniAppKaz
git pull
docker compose up -d --build        # пересборка + замена контейнера, downtime ~ секунды
```
Только конфиг (.env) изменился без изменений кода:
```bash
docker compose up -d                # пересоздать контейнер, чтобы забрать новый env
```
Изменился только Caddyfile:
```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Смок-тесты после деплоя/обновления

```bash
docker ps | grep casino                                  # Up X минут, рестартов нет
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/init   # 401 — норма
curl -s https://poker.izzinet.xyz/api/init               # JSON «Не удалось проверить...»
docker logs casino --tail 20                             # без traceback
```
В Telegram: бот → «🎰 Casino» → профиль, ставка в Blackjack/Очко/Покере, вкладка 👑 у админа.

## Полезные команды

```bash
docker logs casino -f --tail 100      # живые логи
docker compose restart casino         # рестарт без пересборки
docker compose down                   # стоп (база в ./casino-data сохранится)
docker compose up -d                  # старт
docker exec -it casino sh             # внутрь контейнера (npm run setup:bot и т.п.)
```

## База данных

- Путь на хосте: `/opt/TelegramMiniAppKaz/casino-data/casino.db` (монтируется как volume).
- Снести игроков и начать заново: `docker compose down` → удалить `casino-data/casino.db`
  (и рядом `casino.db-*`, если появятся) → `docker compose up -d`.
- Перед рискованными операциями: `cp casino-data/casino.db casino-data/casino.db.bak-YYYYMMDD`.

## Секреты и доступы

- `BOT_TOKEN` — только в `server/.env` на сервере, в git не попадает (см. `.gitignore`).
- Если токен утёк — @BotFather → /revoke → новый токен в `server/.env`
  → `docker compose up -d` → `cd server && npm run setup:bot`
  (setup:bot переустанавливает меню-кнопку бота на актуальные данные).
- ADMIN_IDS — Telegram ID админов через запятую.

## Известные особенности

- При смене WEBAPP_URL: обновить `.env` + `docker compose up -d` + `npm run setup:bot`.
- Порт 3000 на хосте занят remnawave-backend — casino живёт на 3100, не переезжать.
- Первый запрос по https после reload Caddy может занять до минуты (получение сертификата).
