/* ============================================================
   palette.js — цвета равной воспринимаемой светлоты (OKLCH),
   чтобы разные цвета не отличались по яркости, а значит и
   по салиентности, только за счёт «светлее/темнее».
   ============================================================ */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const gamma = (u) => (u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055);

export function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map((u) => Math.round(clamp01(gamma(clamp01(u))) * 255));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** n цветов, равномерно по кругу тонов. */
export function equalLightnessPalette(n, { L = 0.62, C = 0.14, start = 20 } = {}) {
  return Array.from({ length: n }, (_, i) => oklchToHex(L, C, (start + (360 * i) / n) % 360));
}
