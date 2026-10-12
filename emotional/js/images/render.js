/* ============================================================
   images/render.js — отрисовка стимула 2×2 на canvas.
   Геометрия (tileRects, fitImage) — чистые функции;
   drawImageStimulus рисует и возвращает точные рамки изображений
   (они нужны для зон интереса при анализе движений глаз).
   ============================================================ */

import { POSITIONS } from './generator.js';

export const DEFAULT_LAYOUT = {
  width: 1920,
  height: 1080,
  margin: 0,            // поле вокруг всей сетки, px
  gap: 0,               // зазор между ячейками, px
  pad: 40,              // отступ изображения от краёв своей ячейки, px
  background: '#7f7f7f',
  fit: 'contain',       // contain — вписать целиком; cover — обрезать по центру до размера плитки
};

/** Плитки (области под изображения) в порядке TL, TR, BL, BR. */
export function tileRects(layout) {
  const L = { ...DEFAULT_LAYOUT, ...layout };
  const cw = (L.width - 2 * L.margin - L.gap) / 2;
  const ch = (L.height - 2 * L.margin - L.gap) / 2;
  const out = {};
  POSITIONS.forEach((pos, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    out[pos] = {
      x: Math.round(L.margin + col * (cw + L.gap) + L.pad),
      y: Math.round(L.margin + row * (ch + L.gap) + L.pad),
      w: Math.round(cw - 2 * L.pad),
      h: Math.round(ch - 2 * L.pad),
    };
  });
  return out;
}

/** Как поместить картинку iw×ih в плитку: прямоугольник источника и приёмника. */
export function fitImage(iw, ih, tile, fit) {
  if (fit === 'cover') {
    const k = Math.max(tile.w / iw, tile.h / ih);
    const sw = tile.w / k, sh = tile.h / k;
    return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, dx: tile.x, dy: tile.y, dw: tile.w, dh: tile.h };
  }
  const k = Math.min(tile.w / iw, tile.h / ih);
  const dw = Math.round(iw * k), dh = Math.round(ih * k);
  return {
    sx: 0, sy: 0, sw: iw, sh: ih,
    dx: tile.x + Math.round((tile.w - dw) / 2), dy: tile.y + Math.round((tile.h - dh) / 2), dw, dh,
  };
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
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const f = fitImage(iw, ih, tiles[cell.pos], L.fit);
    ctx.drawImage(img, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
    boxes.push({ pos: cell.pos, itemId: cell.itemId, x: f.dx, y: f.dy, w: f.dw, h: f.dh });
  }
  return boxes;
}
