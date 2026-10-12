/* ============================================================
   verbal/render.js — отрисовка филворда: сверху надпись
   «Найдите слово» / «Найдите слова» (какие именно — не указывается),
   ниже — сетка букв (и цифр).
   ============================================================ */

import { makeRng } from '../../common/rng.js';
import { equalLightnessPalette } from '../../kit/palette.js';
import { prepareCanvas } from '../../kit/text.js';
import { cellFills } from './generator.js';
import { BG, FG } from '../../kit/defaults.js';

export const DEFAULT_STYLE = {
  width: 1920, height: 1080,
  background: BG,
  color: FG,
  gridLine: '#8a8a8a',
  bwFill: '#ffffff',
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 0,                           // 0 — рекомендуемый (по размеру клетки)
  labelOne: 'Найдите слово',
  labelMany: 'Найдите слова',
  topBand: 0.14,
  margin: 0.05,
};

export function layoutOf(styleIn, rows, cols) {
  const s = { ...DEFAULT_STYLE, ...styleIn };
  const { width: W, height: H } = s;
  const top = Math.round(H * s.topBand);
  const mx = Math.round(W * s.margin);
  const mb = Math.round(H * s.margin * 0.8);
  const cell = Math.floor(Math.min((W - 2 * mx) / cols, (H - top - mb) / rows));
  const gw = cell * cols; const gh = cell * rows;
  const gx = Math.round((W - gw) / 2);
  const gy = top + Math.round((H - top - mb - gh) / 2);
  const font = s.fontSize > 0 ? s.fontSize : Math.round(cell * 0.56);
  return { cell, gx, gy, gw, gh, font, top, instrSize: Math.round(H * 0.05) };
}

export const recommendedFont = (style, rows, cols) => layoutOf(style, rows, cols).font;

/** Надпись над сеткой: «Найдите слово» (одно целевое слово) или «Найдите слова» (несколько); слова не называются. */
export function labelText(style, count) {
  const s = { ...DEFAULT_STYLE, ...style };
  return count > 1 ? (s.labelMany || DEFAULT_STYLE.labelMany) : (s.labelOne || DEFAULT_STYLE.labelOne);
}

/** Рисует стимул и возвращает рамки целевых слов (в пикселях стимула). */
export function drawVerbalStimulus(canvas, stim, styleIn, scale = 1) {
  const s = { ...DEFAULT_STYLE, ...styleIn };
  const rows = stim.letters.length; const cols = stim.letters[0].length;
  const L = layoutOf(s, rows, cols);
  const ctx = prepareCanvas(canvas, s.width, s.height, scale, s.background);

  ctx.fillStyle = s.color;
  ctx.font = `700 ${L.instrSize}px ${s.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText(s, stim.placements.length), s.width / 2, L.top * 0.5);

  let fills = null; let palette = null;
  if (stim.color === 'color') {
    palette = equalLightnessPalette(12, { L: 0.86, C: 0.075, start: 15 });
    fills = cellFills(makeRng(stim.fillSeed), rows, cols, palette.length);
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = fills ? palette[fills[r][c]] : s.bwFill;
      ctx.fillRect(L.gx + c * L.cell, L.gy + r * L.cell, L.cell, L.cell);
    }
  }
  ctx.strokeStyle = s.gridLine;
  ctx.lineWidth = Math.max(1, L.cell * 0.015);
  ctx.beginPath();
  for (let i = 0; i <= cols; i++) { ctx.moveTo(L.gx + i * L.cell, L.gy); ctx.lineTo(L.gx + i * L.cell, L.gy + rows * L.cell); }
  for (let i = 0; i <= rows; i++) { ctx.moveTo(L.gx, L.gy + i * L.cell); ctx.lineTo(L.gx + cols * L.cell, L.gy + i * L.cell); }
  ctx.stroke();

  ctx.fillStyle = s.color;
  ctx.font = `700 ${L.font}px ${s.fontFamily}`;
  ctx.textBaseline = 'middle';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) ctx.fillText(stim.letters[r][c], L.gx + (c + 0.5) * L.cell, L.gy + (r + 0.55) * L.cell);
  }

  return stim.placements.map((p) => {
    const rs = p.cells.map((x) => x[0]); const cs = p.cells.map((x) => x[1]);
    const r0 = Math.min(...rs); const c0 = Math.min(...cs);
    return {
      word: p.word, row: r0 + 1, col: c0 + 1,
      x: L.gx + c0 * L.cell, y: L.gy + r0 * L.cell,
      w: (Math.max(...cs) - c0 + 1) * L.cell, h: (Math.max(...rs) - r0 + 1) * L.cell,
    };
  });
}
