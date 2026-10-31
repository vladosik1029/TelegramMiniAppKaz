// Звуки без файлов: короткие синтезированные сэмплы через WebAudio.
// Включение/выключение хранится в localStorage (на устройство), по умолчанию — вкл.
// AudioContext создаётся лениво на первом звуке: браузеры и Telegram WebView
// разрешают звук только после касания, а звуки у нас как раз идут от касаний.

const KEY = 'izzi.sound';
let ctx = null;
let master = null;
let enabled = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();
const listeners = new Set();

export const soundOn = () => enabled;
export function setSoundOn(v) {
  enabled = !!v;
  try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch {}
  listeners.forEach(f => f(enabled));
  if (enabled) play('click');
}
export function onSoundChange(f) { listeners.add(f); return () => listeners.delete(f); }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// одна нота: тип волны, частота (можно скольжение), громкость, атака/затухание
function tone(a, { type = 'sine', f, f2, at = 0, dur = 0.12, vol = 0.5 }) {
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

// шорох: отфильтрованный шум (раздача карты, бросок)
function swish(a, { at = 0, dur = 0.09, vol = 0.35, freq = 2400 }) {
  const t = a.currentTime + at;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.9;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(bp).connect(g).connect(master);
  src.start(t);
}

const SOUNDS = {
  click: (a) => tone(a, { type: 'triangle', f: 1300, f2: 900, dur: 0.05, vol: 0.25 }),
  soft: (a) => tone(a, { type: 'sine', f: 700, f2: 500, dur: 0.06, vol: 0.18 }),
  chip: (a) => { tone(a, { type: 'square', f: 2600, f2: 1800, dur: 0.03, vol: 0.08 }); tone(a, { type: 'triangle', f: 1900, at: 0.035, dur: 0.05, vol: 0.12 }); },
  card: (a) => swish(a, { dur: 0.08, vol: 0.3, freq: 3000 }),
  turn: (a) => { tone(a, { f: 880, dur: 0.12, vol: 0.3 }); tone(a, { f: 1320, at: 0.1, dur: 0.18, vol: 0.3 }); },
  win: (a) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(a, { type: 'triangle', f, at: i * 0.07, dur: 0.22, vol: 0.32 }));
    [2093, 2637, 3136].forEach((f, i) => tone(a, { f, at: 0.3 + i * 0.05, dur: 0.12, vol: 0.12 }));
  },
  lose: (a) => { tone(a, { type: 'triangle', f: 330, f2: 220, dur: 0.22, vol: 0.3 }); tone(a, { type: 'triangle', f: 247, f2: 147, at: 0.16, dur: 0.3, vol: 0.28 }); },
};

/** Сыграть звук по имени: click | soft | chip | card | turn | win | lose */
const last = {};
export function play(name) {
  if (!enabled) return;
  const fn = SOUNDS[name];
  if (!fn) return;
  // пачка одинаковых звуков (раздача 10 карт разом) — не чаще раза в 45 мс
  const now = performance.now();
  if (now - (last[name] ?? -1e9) < 45) return;
  last[name] = now;
  try { const a = audio(); if (a) fn(a); } catch {}
}

// haptic(type) из api.js → звук того же смысла
export const HAPTIC_SOUND = { light: 'click', soft: 'soft', medium: 'turn', heavy: 'turn', success: 'win', error: 'lose' };
