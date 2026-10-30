import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const env = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  ADMIN_IDS: new Set((process.env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean)),
  START_BALANCE: Number(process.env.START_BALANCE || 1000),
  DEV_MODE: process.env.DEV_MODE === '1',
  DEV_USER_ID: Number(process.env.DEV_USER_ID || 900001),
  WEBAPP_URL: process.env.WEBAPP_URL || '',
  PORT: Number(process.env.PORT || 3000),
  // username бота (без @) — для ссылок-приглашений за стол
  BOT_USERNAME: (process.env.BOT_USERNAME || 'izzi21_bot').replace(/^@/, ''),
};

/**
 * Проверяет подпись Telegram initData (HMAC-SHA256 по алгоритму из документации
 * Telegram Mini Apps). Возвращает объект пользователя или null.
 */
export function parseInitData(initData) {
  if (!env.BOT_TOKEN || !initData || !initData.includes('hash=')) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
    const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (computed !== hash) return null;

    // initData действителен 24 часа
    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

    const user = JSON.parse(params.get('user') || 'null');
    if (!user || !user.id) return null;
    return user;
  } catch {
    return null;
  }
}

/** Макс. ставка — защита от траты всего баланса одним запросом */
export const MAX_BET = 1000000;
export const MIN_BET = 1;
