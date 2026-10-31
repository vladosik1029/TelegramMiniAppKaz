// Темы оформления: меняют только фон и «обёртку» приложения, игры не трогают.
// Выбор хранится в localStorage (сразу при запуске, без мигания) и на сервере
// (чтобы совпадал на телефоне и ПК).
import { api, tg } from './api.js';

export const THEMES = [
  { id: 'classic', name: 'Изумрудный клуб', sub: 'Классика казино', bg: '#101a13', glow: '#3f7d55', dots: ['#e6c065', '#3f7d55', '#e9efe9'] },
  { id: 'neon', name: 'Ночной неон', sub: 'Розовый и голубой свет', bg: '#0b0917', glow: '#ff3cc8', glow2: '#28c8ff', dots: ['#63e6ff', '#ff5fd6', '#7a34f0'] },
  { id: 'royal', name: 'Чёрное золото', sub: 'Люкс и ар-деко', bg: '#0a0907', glow: '#f2cf74', dots: ['#f2cf74', '#8c6b2c', '#f4eddd'] },
  { id: 'cosmos', name: 'Глубокий космос', sub: 'Туманности и звёзды', bg: '#070c1c', glow: '#825aff', glow2: '#2878ff', dots: ['#ffd27a', '#3d66cc', '#e9efff'] },
  { id: 'velvet', name: 'Бордовый бархат', sub: 'Вино и золото', bg: '#15080d', glow: '#c8325f', dots: ['#eec47c', '#8f2b47', '#f7eaee'] },
  { id: 'aurora', name: 'Северное сияние', sub: 'Мята и сирень', bg: '#061116', glow: '#3cf0b4', glow2: '#825fff', dots: ['#6ff0c8', '#1e8a78', '#e7f6f4'] },
];

const KEY = 'izzi.theme';
const byId = (id) => THEMES.find(t => t.id === id);
let current = 'classic';
const listeners = new Set();

export const getTheme = () => current;
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Применить тему к странице (без сохранения на сервере) */
export function applyTheme(id) {
  const t = byId(id) || THEMES[0];
  current = t.id;
  const root = document.documentElement;
  if (t.id === 'classic') delete root.dataset.theme; else root.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg);
  // цвет шапки и фона самого Telegram под тему
  try { tg?.setHeaderColor?.(t.bg); tg?.setBackgroundColor?.(t.bg); tg?.setBottomBarColor?.(t.bg); } catch {}
  try { localStorage.setItem(KEY, t.id); } catch {}
  for (const fn of [...listeners]) fn(t.id);
}

/** Выбор игрока: применить и запомнить на сервере */
export function chooseTheme(id) {
  applyTheme(id);
  return api('/settings/theme', { theme: current }).catch(() => {});
}

/** При запуске: локальный выбор сразу, потом — что сохранено на сервере */
export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  applyTheme(saved || 'classic');
}
export function syncThemeFromServer(serverTheme) {
  if (serverTheme && byId(serverTheme) && serverTheme !== current) applyTheme(serverTheme);
  else if (!serverTheme && current !== 'classic') api('/settings/theme', { theme: current }).catch(() => {});
}
