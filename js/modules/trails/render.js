/* ============================================================
   trails/render.js — отрисовка стимула «Траектории»
   ============================================================ */

import { prepareCanvas, measureText } from '../../kit/text.js';
import { recommendedFont } from './generator.js';
import { BG, FG } from '../../kit/defaults.js';
import { drawInstructionText } from '../../kit/instr.js';

export const DEFAULT_STYLE = {
  width: 1920, height: 1080,
  background: BG,
  color: FG,
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

/**
 * Экран оценки: текст и пять квадратов с цифрами 1–5, по которым участник щёлкает мышью.
 * Возвращает области (в пикселях стимула).
 */
export function drawRatingScale(canvas, styleIn, text, scale = 1) {
  const s = { ...DEFAULT_STYLE, ...styleIn };
  const W = s.width; const H = s.height;
  drawInstructionText(canvas, { width: W, height: H, background: s.background, color: s.color, fontFamily: s.fontFamily, text, scale, sizeRatio: 0.034 });
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const side = Math.round(H * 0.1); const gap = Math.round(H * 0.045);
  const total = 5 * side + 4 * gap;
  const x0 = Math.round((W - total) / 2); const y0 = Math.round(H * 0.74);
  const boxes = [];
  ctx.lineWidth = Math.max(2, H * 0.003);
  ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
  ctx.font = `700 ${Math.round(side * 0.55)}px ${s.fontFamily}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 5; i++) {
    const x = x0 + i * (side + gap);
    ctx.strokeRect(x, y0, side, side);
    ctx.fillText(String(i + 1), x + side / 2, y0 + side / 2 + side * 0.03);
    boxes.push({ value: i + 1, x, y: y0, w: side, h: side });
  }
  return boxes;
}
