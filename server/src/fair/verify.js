// ─── Provably Fair: независимая проверка раунда ──────────────────────────────
// Работает в браузере (WebCrypto) и в тестах Node. Сервер этот файл не
// использует: проверка не опирается на серверный HMAC.

import { deriveAsync, sha256Hex } from './core.js';
import { DERIVE, describe, sameRecord } from './games.js';

/** Пересчитать исход по сидам. round: { game, clientSeed, nonce, params } + serverSeed */
export async function deriveRound({ game, serverSeed, clientSeed, nonce, params = {} }, subtle) {
  const derive = DERIVE[game];
  if (!derive) throw new Error('Неизвестная игра: ' + game);
  return deriveAsync(serverSeed, clientSeed, nonce, (rng) => derive(rng, params), subtle);
}

/** SHA-256 от h, повторённый n раз */
export async function hashTimes(h, n, subtle) {
  for (let i = 0; i < n; i++) h = await sha256Hex(h, subtle);
  return h;
}

/**
 * Полная проверка раунда из истории:
 *   hashOk   — SHA-256(server seed) совпадает с хэшем, показанным до игры;
 *   recordOk — пересчитанный исход совпадает с тем, что сыграл сервер;
 *   chainOk  — (Ракета) сид лежит в опубликованной цепочке хэшей.
 */
export async function verifyRound(round, subtle) {
  const hashOk = (await sha256Hex(round.serverSeed, subtle)) === round.serverSeedHash;
  const record = await deriveRound(round, subtle);
  const res = {
    hashOk,
    record,
    recordOk: round.record ? sameRecord(record, round.record) : null,
    text: describe(round.game, record),
  };
  if (round.game === 'crash' && round.params?.commitment) {
    res.chainOk = (await hashTimes(round.serverSeed, round.params.idx, subtle)) === round.params.commitment;
  }
  res.ok = res.hashOk && res.recordOk !== false && res.chainOk !== false;
  return res;
}
