/* ============================================================
   diff/render.js — отрисовка одного кадра серии «определение различий»
   ============================================================ */

import { prepareCanvas } from '../../kit/text.js';
import { measureText } from '../../kit/text.js';

export const DEFAULT_STYLE = {
  width: 1920, height: 1080,
  background: '#d9d9d9',
  color: '#111111',
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 90,
};

/** Рамка объекта (область интереса): по размеру текста с небольшим полем. */
export function objectBox(style, p, text) {
  const wText = measureText(text, `700 ${style.fontSize}px ${style.fontFamily}`);
  const w = Math.max(wText, style.fontSize * 0.75) * 1.25;
  const h = style.fontSize * 1.3;
  return { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w: Math.round(w), h: Math.round(h) };
}

/** Рисует кадр, возвращает рамки всех объектов. */
export function drawDiffFrame(canvas, series, frameIndex, styleIn, scale = 1) {
  const s = { ...DEFAULT_STYLE, ...styleIn };
  const ctx = prepareCanvas(canvas, s.width, s.height, scale, s.background);
  ctx.fillStyle = s.color;
  ctx.font = `700 ${s.fontSize}px ${s.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const frame = series.frames[frameIndex];
  return series.positions.map((p, i) => {
    const text = frame.values[i];
    ctx.fillText(text, p.x, p.y + s.fontSize * 0.04);
    return { index: i, text, ...objectBox(s, p, text), row: p.row, col: p.col };
  });
}
