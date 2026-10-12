/* ============================================================
   rotation/render.js — отрисовка стимула «ментальное вращение».
   Раскладка в долях экрана повторяет презентацию автора (16:9):
   фигура-задание сверху по центру, четыре варианта в ряд ниже,
   под каждым — его номер; слева вверху — фиксационный крест.
   ============================================================ */

import { makeRng } from '../../common/rng.js';
import { equalLightnessPalette } from '../../kit/palette.js';
import { prepareCanvas } from '../../kit/text.js';

export const DEFAULT_STYLE = {
  width: 1920, height: 1080,
  cell: 0,                       // 0 — автоматически (доля ширины, как в презентации)
  background: '#ffffff',
  fill: '#666666',               // цвет закрашенных клеток в ч/б варианте
  grid: '#b7b7b7',               // цвет линий сетки
  labelColor: '#666666',
  fontFamily: 'Montserrat, Arial, sans-serif',
};

export const autoCell = (W) => Math.round(W * 0.01775);

/** Прямоугольники полей: задание и четыре варианта (в пикселях стимула). */
export function layoutRects(style, n = 10) {
  const { width: W, height: H } = style;
  const cell = style.cell > 0 ? style.cell : autoCell(W);
  const g = cell * n;
  const target = { x: Math.round(W / 2 - g / 2), y: Math.round(H * 0.0444), w: g, h: g };
  const options = [0, 1, 2, 3].map((i) => ({
    x: Math.round(W * (0.16225 + 0.225 * i) - g / 2), y: Math.round(H * 0.4524), w: g, h: g,
  }));
  const labelY = Math.round(H * 0.82);
  const fontPx = Math.round(H * 0.04);
  return { cell, grid: g, target, options, labelY, fontPx };
}

/** Проверка: помещаются ли поля на экран и не налезают ли друг на друга. */
export function checkLayout(style, n = 10) {
  const L = layoutRects(style, n);
  const issues = [];
  const { width: W, height: H } = style;
  if (L.target.y + L.grid > L.options[0].y) issues.push('Поле-задание налезает на ряд вариантов — уменьшите размер клетки.');
  if (L.options[0].x < 0 || L.options[3].x + L.grid > W) issues.push('Варианты не помещаются по ширине экрана — уменьшите размер клетки.');
  if (L.options[0].y + L.grid + L.fontPx * 1.6 > H) issues.push('Варианты с номерами не помещаются по высоте — уменьшите размер клетки.');
  if (L.options[0].x + L.grid > L.options[1].x) issues.push('Соседние варианты налезают друг на друга — уменьшите размер клетки.');
  return issues;
}

/** Цвета клеток стимула: один и тот же цвет сопровождает клетку при любом преобразовании. */
export function cellColors(stim, style) {
  if (stim.color === 'bw') return () => style.fill;
  const n = stim.figure.cells.length;
  const count = stim.color === 'square' ? n : stim.figure.pieces.length;
  const palette = makeRng(stim.colorSeed).shuffle(equalLightnessPalette(Math.max(count, 8)));
  return (cell) => palette[stim.color === 'square' ? cell.id : cell.piece];
}

function drawField(ctx, rect, cell, n, cells, colorOf, style) {
  const lw = Math.max(1, cell * 0.03);
  ctx.strokeStyle = style.grid;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    ctx.moveTo(rect.x + i * cell, rect.y); ctx.lineTo(rect.x + i * cell, rect.y + n * cell);
    ctx.moveTo(rect.x, rect.y + i * cell); ctx.lineTo(rect.x + n * cell, rect.y + i * cell);
  }
  ctx.stroke();
  for (const c of cells) {
    ctx.fillStyle = colorOf(c);
    ctx.fillRect(rect.x + c.c * cell + lw / 2, rect.y + c.r * cell + lw / 2, cell - lw, cell - lw);
  }
}

/** Рисует стимул; возвращает области интереса. */
export function drawRotationStimulus(canvas, stim, styleIn, scale = 1) {
  const style = { ...DEFAULT_STYLE, ...styleIn };
  const n = stim.figure.n;
  const L = layoutRects(style, n);
  const ctx = prepareCanvas(canvas, style.width, style.height, scale, style.background);
  const colorOf = cellColors(stim, style);
  drawField(ctx, L.target, L.cell, n, stim.figure.cells, colorOf, style);
  stim.options.forEach((o, i) => {
    drawField(ctx, L.options[i], L.cell, n, o.cells, colorOf, style);
    ctx.fillStyle = style.labelColor;
    ctx.font = `400 ${L.fontPx}px ${style.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(o.pos), L.options[i].x + L.grid / 2, L.labelY);
  });
  return {
    task: L.target,
    options: stim.options.map((o, i) => ({ pos: o.pos, op: o.op, correct: o.correct, ...L.options[i] })),
  };
}

/** Фиксационный крест «+» в левом верхнем углу (как в презентации). */
export function drawFixation(canvas, styleIn, scale = 1) {
  const style = { ...DEFAULT_STYLE, ...styleIn };
  const { width: W, height: H } = style;
  const ctx = prepareCanvas(canvas, W, H, scale, style.background);
  const cx = W * 0.083; const cy = H * 0.127; const half = W * 0.0285;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(2, W * 0.0025);
  ctx.beginPath();
  ctx.moveTo(cx - half, cy); ctx.lineTo(cx + half, cy);
  ctx.moveTo(cx, cy - half); ctx.lineTo(cx, cy + half);
  ctx.stroke();
}
