/* ============================================================
   salience.js — оценка салиентности готового стимула
   (алгоритмы и метрики — из модуля «Салиентность»).
   ============================================================ */

import { computeSaliency, METHOD_LABELS } from '../core/algorithms/index.js';
import { computeMetrics } from '../core/metrics.js';
import { workSize } from '../core/loader.js';

export { METHOD_LABELS };
export const SAL_KEYS = ['mean', 'entropy', 'center_bias', 'spread_pct'];
export const SAL_NAMES = {
  mean: 'Средняя салиентность',
  entropy: 'Энтропия карты',
  center_bias: 'Смещение к центру',
  spread_pct: 'Доля площади с высокой салиентностью, %',
};

/**
 * stim.draw(canvas, scale) рисует стимул. Возвращает { metrics, map } — карту в рабочем разрешении
 * (длинная сторона 256 px) и метрики mean / entropy / center_bias / spread_pct.
 */
export function evaluateSalience(stim, W, H, method = 'ft') {
  const { width, height } = workSize(W, H);
  const c = document.createElement('canvas');
  stim.draw(c, width / W);
  const ctx = c.getContext('2d');
  const sal = computeSaliency(ctx.getImageData(0, 0, c.width, c.height), method);
  const m = computeMetrics(sal, sal.width, sal.height);
  return { metrics: Object.fromEntries(SAL_KEYS.map((k) => [k, m[k]])), map: sal };
}

/**
 * Средняя салиентность внутри прямоугольника области интереса (координаты стимула в пикселях)
 * относительно средней по всей карте: 1 — как в среднем, > 1 — область заметнее остальных.
 */
export function relativeAoiSalience(map, rect, W, H) {
  const sx = map.width / W;
  const sy = map.height / H;
  const x0 = Math.max(0, Math.floor(rect.x * sx));
  const y0 = Math.max(0, Math.floor(rect.y * sy));
  const x1 = Math.min(map.width, Math.max(x0 + 1, Math.ceil((rect.x + rect.w) * sx)));
  const y1 = Math.min(map.height, Math.max(y0 + 1, Math.ceil((rect.y + rect.h) * sy)));
  let s = 0; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += map[y * map.width + x]; n++; }
  let tot = 0;
  for (let i = 0; i < map.length; i++) tot += map[i];
  const mean = tot / map.length;
  return n && mean > 0 ? s / n / mean : null;
}

/* ---------- баланс салиентности между условиями ---------- */

import { meanOf, sdOf, oneWayAnova, formatP } from '../core/stats.js';

/**
 * list — стимулы с полем sal ({mean, entropy, …}); groupOf(stim) → ключ условия; groups = [[ключ, подпись]].
 * Возвращает строки для metricTable: среднее ± SD по условиям и ANOVA (p > .05 — условия не различаются).
 */
export function salienceBalance(list, groupOf, groups, keys = SAL_KEYS) {
  return keys.map((k) => {
    const per = groups.map(([g]) => {
      const v = list.filter((s) => groupOf(s) === g && s.sal).map((s) => s.sal[k]).filter(Number.isFinite);
      return { n: v.length, mean: meanOf(v), sd: sdOf(v), v };
    });
    const a = oneWayAnova(per.map((p) => p.v));
    const p = a ? formatP(a.p) : null;
    return {
      label: SAL_NAMES[k],
      cells: per.map(({ n, mean, sd }) => ({ n, mean, sd })),
      extra: a ? `F(${a.df1}, ${a.df2}) = ${a.F.toFixed(2)}, p ${p.startsWith('<') ? p : '= ' + p}` : '—',
      extraBad: a ? a.p < 0.05 : false,
    };
  });
}
