/* ============================================================
   luminance.js — средняя яркость стимула (для анализа зрачка:
   условия не должны различаться по яркости экрана).
   ============================================================ */

/** Средняя относительная яркость кадра, 0–1 (Rec. 709 по sRGB-значениям). */
export function meanLuminance(stim, W) {
  const c = document.createElement('canvas');
  stim.draw(c, Math.min(1, 160 / W));
  const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  let s = 0;
  for (let i = 0; i < data.length; i += 4) s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  return Number((s / (data.length / 4) / 255).toFixed(4));
}
