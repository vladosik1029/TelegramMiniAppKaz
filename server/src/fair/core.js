// ─── Provably Fair: генератор исходов ────────────────────────────────────────
// Этот файл работает и на сервере, и в браузере (экран «Проверка честности»
// импортирует его напрямую), поэтому здесь нет ни node:crypto, ни WebCrypto:
// HMAC передаётся снаружи.
//
// Поток байт раунда:
//   блок[cursor] = HMAC-SHA256(key = server_seed, msg = `${client_seed}:${nonce}:${cursor}`)
//   cursor = 0, 1, 2 … — блоки по 32 байта склеиваются в бесконечную ленту.
// Из ленты берутся 32-битные числа (4 байта, big-endian). Число в диапазоне
// [0, n) получается отбрасыванием (rejection sampling): значения из «хвоста»
// 2^32 mod n выбрасываются, поэтому все n исходов строго равновероятны —
// никакого перекоса от взятия остатка.
// Колоды тасуются Фишером–Йетсом на той же ленте.

const TWO32 = 2 ** 32;

/** Сообщение HMAC для блока cursor */
export const blockMessage = (clientSeed, nonce, cursor) => `${clientSeed}:${nonce}:${cursor}`;

/** Ленте не хватило заранее посчитанных блоков (браузер считает их асинхронно) */
export class NeedBlock extends Error {
  constructor(cursor) { super('NEED_BLOCK'); this.cursor = cursor; }
}

export class Rng {
  /** @param {(cursor: number) => Uint8Array} block — 32 байта блока cursor */
  constructor(block) {
    this.block = block;
    this.cursor = -1;
    this.buf = null;
    this.pos = 32;
  }

  byte() {
    if (this.pos >= 32) {
      this.cursor += 1;
      this.buf = this.block(this.cursor);
      this.pos = 0;
    }
    return this.buf[this.pos++];
  }

  /** Равномерное целое 0 … 2^32−1 */
  u32() {
    return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
  }

  /** Равномерное целое 0 … n−1 без перекоса (1 ≤ n ≤ 2^32) */
  int(n) {
    if (!Number.isInteger(n) || n < 1 || n > TWO32) throw new Error('BAD_RANGE');
    if (n === TWO32) return this.u32();
    const limit = TWO32 - (TWO32 % n); // всё, что ≥ limit, выбрасываем
    for (;;) {
      const x = this.u32();
      if (x < limit) return x % n;
    }
  }

  /** Фишер–Йетс: новая перемешанная копия массива */
  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// ─── проверка в браузере: асинхронный HMAC (WebCrypto) ──────────────────────

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 строки → hex (WebCrypto: браузер и Node 20+) */
export async function sha256Hex(text, subtle = globalThis.crypto.subtle) {
  return hex(await subtle.digest('SHA-256', enc.encode(text)));
}

/**
 * Посчитать исход в браузере: derive(rng) — синхронная функция из games.js.
 * Блоки ленты считаются WebCrypto пачками, пока derive не перестанет их просить.
 */
export async function deriveAsync(serverSeed, clientSeed, nonce, derive, subtle = globalThis.crypto.subtle) {
  const key = await subtle.importKey('raw', enc.encode(serverSeed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const blocks = new Map();
  const fill = async (from, count) => {
    await Promise.all(Array.from({ length: count }, async (_, k) => {
      const c = from + k;
      if (!blocks.has(c)) {
        blocks.set(c, new Uint8Array(await subtle.sign('HMAC', key, enc.encode(blockMessage(clientSeed, nonce, c)))));
      }
    }));
  };
  await fill(0, 8);
  for (;;) {
    try {
      return derive(new Rng((c) => {
        const b = blocks.get(c);
        if (!b) throw new NeedBlock(c);
        return b;
      }));
    } catch (e) {
      if (!(e instanceof NeedBlock)) throw e;
      await fill(e.cursor, 32);
    }
  }
}
