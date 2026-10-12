/* ============================================================
   text.js — шрифты и измерение текста на canvas
   ============================================================ */

let mctx = null;
export function measureText(text, font) {
  mctx = mctx || document.createElement('canvas').getContext('2d');
  mctx.font = font;
  return mctx.measureText(text).width;
}

/** Дожидается загрузки веб-шрифта (если он подключён на странице). */
export async function ensureFont(fontFamily, weights = [400, 700]) {
  if (!document.fonts || !document.fonts.load) return;
  const first = fontFamily.split(',')[0].trim();
  try { await Promise.all(weights.map((w) => document.fonts.load(`${w} 20px ${first}`, 'Аб1Aa'))); } catch { /* ничего */ }
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

/** Готовит canvas к рисованию в «полных» координатах стимула с масштабом scale. */
export function prepareCanvas(canvas, W, H, scale = 1, background = '#ffffff') {
  canvas.width = Math.max(1, Math.round(W * scale));
  canvas.height = Math.max(1, Math.round(H * scale));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  return ctx;
}
