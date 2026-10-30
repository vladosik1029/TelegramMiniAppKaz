// Серверная (node:crypto) обвязка ленты Provably Fair — без базы данных,
// чтобы игры и смоук-тесты могли импортировать её напрямую.

import crypto from 'node:crypto';
import { Rng, blockMessage } from './core.js';

export const randomHex = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
export const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** Лента случайных байт раунда (синхронный HMAC) */
export const rngFor = (serverSeed, clientSeed, nonce) =>
  new Rng((cursor) => crypto.createHmac('sha256', serverSeed).update(blockMessage(clientSeed, nonce, cursor)).digest());

/** Лента со случайным сидом — для игр, вызванных без раунда (смоук-тесты) */
export const randomRng = () => rngFor(randomHex(), 'local', 0);
