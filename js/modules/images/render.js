/* ============================================================
   images/render.js — отрисовка стимула 2×2 на canvas.

   Все четыре картинки показываются в рамках ОДНОГО размера и формата,
   поэтому промежуток между ними по горизонтали и по вертикали всегда
   одинаков (настройка «расстояние между картинками»). Если формат
   картинки отличается от формата рамки, края обрезаются по центру.

   Геометрия (tileRects, fitImage) — чистые функции; drawImageStimulus
   рисует и возвращает точные рамки изображений (зоны интереса).
   ============================================================ */

import { POSITIONS } from './generator.js';
import { BG } from '../../kit/defaults.js';

export const DEFAULT_LAYOUT = {
  width: 1920,
  height: 1080,
  margin: 40,           // минимальное поле от краёв экрана до картинок, px
  gap: 60,              // расстояние между картинками (по горизонтали и по вертикали одинаковое), px
  ratio: 4 / 3,         // формат рамки картинки: ширина / высота
  background: BG,
};

/**
 * Рамки картинок в порядке TL, TR, BL, BR. Рамки одного размера (максимально крупного,
 * при котором сетка 2×2 с заданным расстоянием помещается на экран) и стоят по центру экрана:
 * расстояние между соседними рамками равно gap и по горизонтали, и по вертикали.
 */
export function tileRects(layout) {
  const L = { ...DEFAULT_LAYOUT, ...layout };
  const availW = (L.width - 2 * L.margin - L.gap) / 2;
  const availH = (L.height - 2 * L.margin - L.gap) / 2;
  let w = Math.min(availW, availH * L.ratio);
  w = Math.max(1, Math.floor(w));
  const h = Math.max(1, Math.floor(w / L.ratio));
  const x0 = Math.round((L.width - (2 * w + L.gap)) / 2);
  const y0 = Math.round((L.height - (2 * h + L.gap)) / 2);
  const out = {};
  POSITIONS.forEach((pos, i) => {
    const col = i % 2; const row = Math.floor(i / 2);
    out[pos] = { x: x0 + col * (w + L.gap), y: y0 + row * (h + L.gap), w, h };
  });
  return out;
}

/** Как поместить картинку iw×ih в рамку: обрезка по центру до формата рамки (cover). */
export function fitImage(iw, ih, tile) {
  const k = Math.max(tile.w / iw, tile.h / ih);
  const sw = tile.w / k; const sh = tile.h / k;
  return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, dx: tile.x, dy: tile.y, dw: tile.w, dh: tile.h };
}

/** Доля площади картинки, которая будет обрезана при помещении в рамку формата ratio. */
export function cropShare(iw, ih, ratio) {
  const ir = iw / ih;
  return ir > ratio ? 1 - ratio / ir : 1 - ir / ratio;
}

/**
 * Рисует стимул. imgOf(itemId) → HTMLImageElement | ImageBitmap | canvas.
 * Возвращает [{ pos, itemId, x, y, w, h }] — рамки реально нарисованных изображений.
 */
export function drawImageStimulus(canvas, stimulus, imgOf, layout) {
  const L = { ...DEFAULT_LAYOUT, ...layout };
  canvas.width = L.width;
  canvas.height = L.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = L.background;
  ctx.fillRect(0, 0, L.width, L.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const tiles = tileRects(L);
  const boxes = [];
  for (const cell of stimulus.layout) {
    const img = imgOf(cell.itemId);
    const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
    const f = fitImage(iw, ih, tiles[cell.pos]);
    ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
    boxes.push({ pos: cell.pos, itemId: cell.itemId, x: f.dx, y: f.dy, w: f.dw, h: f.dh });
  }
  return boxes;
}
