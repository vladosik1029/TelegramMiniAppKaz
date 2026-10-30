// Клиент API: шлёт Telegram initData в заголовке Authorization: tma ...

let initData = '';
if (window.Telegram?.WebApp?.initData) {
  initData = window.Telegram.WebApp.initData;
}

export async function api(path, body) {
  const res = await fetch('/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'tma ' + initData,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: 'Ошибка сети' }));
  if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
  return data;
}

/** payload Type: Telegram.WebApp */
export const tg = window.Telegram?.WebApp;

export function haptic(type = 'light') {
  try {
    if (type === 'success' || type === 'error') tg?.HapticFeedback?.notificationOccurred(type);
    else tg?.HapticFeedback?.impactOccurred(type);
  } catch {}
}

/**
 * Параметр запуска MiniApp: ссылка https://t.me/<bot>?startapp=room_<id> кладёт
 * «room_<id>» в initDataUnsafe.start_param. В браузере (DEV) можно ?startapp=room_<id>.
 */
export const startParam =
  window.Telegram?.WebApp?.initDataUnsafe?.start_param ||
  new URLSearchParams(window.location.search).get('startapp') || '';

// ─── WebSocket столов: одно соединение на приложение, авто-переподключение ──
let sock = null;
let wanted = false;
let retry = 0;
let retryTimer = null;
const queue = [];
const listeners = new Set();

const emit = (msg) => { for (const fn of [...listeners]) fn(msg); };

export function wsConnect() {
  wanted = true;
  if (sock && (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(retryTimer);
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${window.location.host}/ws?t=${encodeURIComponent(initData)}`);
  sock = ws;
  ws.onopen = () => {
    retry = 0;
    emit({ type: '_open' });
    while (queue.length && ws.readyState === WebSocket.OPEN) ws.send(queue.shift());
  };
  ws.onmessage = (e) => { try { emit(JSON.parse(e.data)); } catch {} };
  ws.onclose = () => {
    if (sock === ws) sock = null;
    emit({ type: '_close' });
    if (!wanted) return;
    // экспоненциальная пауза: 0.5s, 1s, 2s … максимум 10s
    const delay = Math.min(10000, 500 * 2 ** retry++);
    retryTimer = setTimeout(wsConnect, delay);
  };
}

export function wsClose() {
  wanted = false;
  clearTimeout(retryTimer);
  queue.length = 0;
  try { sock?.close(); } catch {}
  sock = null;
}

/** Отправка; пока соединение не открыто — копим (не больше 20 сообщений) */
export function wsSend(msg) {
  const raw = JSON.stringify(msg);
  if (sock?.readyState === WebSocket.OPEN) sock.send(raw);
  else if (queue.length < 20) queue.push(raw);
}

export const wsIsOpen = () => sock?.readyState === WebSocket.OPEN;

/** Подписка на входящие сообщения; возвращает функцию отписки */
export function onWsMsg(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
