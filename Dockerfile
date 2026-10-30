# Telegram MiniApp Casino — одно изображение: API + собранный клиент.
# Требуется Node 24+ (встроенный node:sqlite) — поэтому база node:24.

# ---------- Стадия 1: сборка клиента (Vite) ----------
FROM node:24-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
# экран «Проверка честности» импортирует код генерации исходов с сервера (алиас @fair)
COPY server/src/fair/ /app/server/src/fair/
RUN npm run build

# ---------- Стадия 2: рантайм ----------
FROM node:24-bookworm-slim
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src/ ./src/
# index.js ищет клиент по ../client/dist от process.cwd() (/app/server) => /app/client/dist
COPY --from=client-build /app/client/dist /app/client/dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]
