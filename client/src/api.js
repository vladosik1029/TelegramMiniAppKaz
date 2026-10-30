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
