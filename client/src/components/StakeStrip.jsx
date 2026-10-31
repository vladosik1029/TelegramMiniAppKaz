// Ставка сверху экрана: компактная плашка, которая прилипает к верху при
// прокрутке, — чтобы на телефоне всегда было видно, сколько поставлено,
// даже когда панель ставки уехала вниз, а число в поле не помещается.

import React from 'react';
import { AnimatedNumber } from './fx.jsx';

const trim = (x) => x.toLocaleString('ru-RU', { maximumFractionDigits: x < 10 ? 2 : x < 100 ? 1 : 0 });

/** 950 → «950», 125 000 → «125 000», 1 520 000 → «1,52 млн», 3,4e9 → «3,4 млрд» */
export function fmtShort(n) {
  const v = Math.round(Number(n) || 0);
  const a = Math.abs(v);
  if (a < 1e6) return v.toLocaleString('ru-RU');
  if (a < 1e9) return `${trim(v / 1e6)} млн`;
  if (a < 1e12) return `${trim(v / 1e9)} млрд`;
  return `${trim(v / 1e12)} трлн`;
}

/**
 * amount — сколько поставлено (или выбрано для ставки), live — деньги уже в игре
 * (раунд идёт / ставка принята), sub — необязательная вторая часть: «→ 3 600»,
 * «в полёте 2 шарика» и т. п.
 */
export default function StakeStrip({ amount = 0, live = false, label, sub }) {
  const full = Math.round(Number(amount) || 0).toLocaleString('ru-RU');
  return (
    <div className="stake-strip">
      <div className={`stake-pill ${live ? 'live' : ''}`} title={`${full} 🪙`}>
        {live && <span className="stake-dot" aria-hidden />}
        <span className="stake-label">{label ?? (live ? 'В игре' : 'Ставка')}</span>
        <b className="stake-value"><AnimatedNumber value={amount} duration={0.35} format={fmtShort} /> 🪙</b>
        {sub && <span className="stake-sub">{sub}</span>}
      </div>
    </div>
  );
}
