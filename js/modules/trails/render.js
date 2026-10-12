/* ============================================================
   trails/render.js — отрисовка стимула «Траектории»
   ============================================================ */

import { prepareCanvas, measureText } from '../../kit/text.js';
import { recommendedFont } from './generator.js';

export const DEFAULT_STYLE = {
  width: 1920, height: 1080,
  background: '#d9d9d9',
  color: '#111111',
  distractorColor: '#d62728',
  fontFamily: 'Arial, Helvetica, sans-serif',
  zigzag: 0.22,
  spread: 0.4,
};

export const fontSizeOf = (style, spec) => (spec.fontSize > 0 ? spec.fontSize : recommendedFont(style.width, style.height, spec.n, spec.rows));

/** Рамки элементов (области интереса). */
export function itemBox(style, font, it) {
  if (it.kind === 'square' || it.kind === 'triangle') {
    const s = font * 0.8;
    return { x: Math.round(it.x - s / 2), y: Math.round(it.y - s / 2), w: Math.round(s), h: Math.round(s) };
  }
  const w = Math.max(measureText(it.text, `700 ${font}px ${style.fontFamily}`), font * 0.6) * 1.25;
  const h = font * 1.25;
  return { x: Math.round(it.x - w / 2), y: Math.round(it.y - h / 2), w: Math.round(w), h: Math.round(h) };
}

export function drawTrailStimulus(canvas, stim, styleIn, scale = 1) {
  const s = { ...DEFAULT_STYLE, ...styleIn };
  const font = fontSizeOf(s, stim.spec);
  const ctx = prepareCanvas(canvas, s.width, s.height, scale, s.background);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${font}px ${s.fontFamily}`;
  const boxes = [];
  for (const it of stim.layout.items) {
    ctx.fillStyle = it.kind === 'recolored' ? s.distractorColor : s.color;
    if (it.kind === 'square') {
      const a = font * 0.72;
      ctx.fillStyle = s.color;
      ctx.fillRect(it.x - a / 2, it.y - a / 2, a, a);
    } else if (it.kind === 'triangle') {
      const b = font * 0.82; const h = font * 0.72;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(it.x, it.y - h / 2); ctx.lineTo(it.x + b / 2, it.y + h / 2); ctx.lineTo(it.x - b / 2, it.y + h / 2);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.fillText(it.text, it.x, it.y + font * 0.04);
    }
    boxes.push({ ...it, ...itemBox(s, font, it) });
  }
  return { boxes, font };
}
