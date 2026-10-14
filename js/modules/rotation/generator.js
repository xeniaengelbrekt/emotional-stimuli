/* ============================================================
   rotation/generator.js — плоскостное ментальное вращение.

   Поле 10×10 (размер настраивается) с закрашенными клетками — «фигурки»
   (линии заданной длины, по умолчанию 3, 2, 2, 1, 1, 1 клеток),
   не касающиеся друг друга даже углами; по умолчанию не занимают
   крайний ряд поля. Сверху — фигура-задание, ниже — четыре варианта ответа
   (1–4). Варианты — это та же фигура после четырёх преобразований:
     • для заданий «90° по часовой», «90° против часовой», «зеркально»:
       поворот 90° по часовой, поворот 90° против часовой,
       зеркальное отражение (лево↔право), отражение сверху вниз;
     • для задания «180°»: поворот 180°, поворот 90° по часовой,
       поворот 90° против часовой, зеркальное отражение (лево↔право).
   Верный вариант — преобразование из задания; его номер равномерно
   меняется от стимула к стимулу.

   Модуль чистый (без DOM) — проверяется в Node.
   ============================================================ */

import { makeRng } from '../../common/rng.js';

export const TRANSFORMS = {
  cw90:   { ru: 'Поворот на 90° по часовой стрелке', short: 'rot-cw90',  action: 'повернуть фигуру-задание **по часовой стрелке на 90 градусов**' },
  ccw90:  { ru: 'Поворот на 90° против часовой стрелки', short: 'rot-ccw90', action: 'повернуть фигуру-задание **против часовой стрелки на 90 градусов**' },
  mirror: { ru: 'Зеркальное отражение (лево↔право)', short: 'mirror', action: '**отразить** фигуру-задание **зеркально относительно вертикальной оси** (левая и правая стороны меняются местами)' },
  r180:   { ru: 'Поворот на 180°', short: 'rot-180', action: '**повернуть** фигуру-задание **на 180 градусов**' },
};
export const TRANSFORM_KEYS = Object.keys(TRANSFORMS);

/** Все операции над клеткой (r, c) в поле n×n. */
const OPS = {
  cw90:   (r, c, n) => [c, n - 1 - r],
  ccw90:  (r, c, n) => [n - 1 - c, r],
  r180:   (r, c, n) => [n - 1 - r, n - 1 - c],
  mirror: (r, c, n) => [r, n - 1 - c],
  flipV:  (r, c, n) => [n - 1 - r, c],
};
export const OP_RU = {
  cw90: 'поворот 90° по часовой', ccw90: 'поворот 90° против часовой', r180: 'поворот 180°',
  mirror: 'зеркало лево↔право', flipV: 'зеркало верх↔низ',
};

/** Набор из четырёх вариантов для каждого задания. */
export const OPTION_SETS = {
  cw90:   ['cw90', 'ccw90', 'mirror', 'flipV'],
  ccw90:  ['ccw90', 'cw90', 'mirror', 'flipV'],
  mirror: ['mirror', 'flipV', 'cw90', 'ccw90'],
  r180:   ['r180', 'cw90', 'ccw90', 'mirror'],
};

export const COLOR_MODES = {
  bw:     { ru: 'Чёрно-белый (одного цвета)', short: 'bw' },
  square: { ru: 'Каждый квадратик своего цвета', short: 'sq-color' },
  figure: { ru: 'Каждая фигурка своего цвета', short: 'fig-color' },
};
export const COLOR_KEYS = Object.keys(COLOR_MODES);

export const DEFAULTS = {
  transforms: TRANSFORM_KEYS,
  colors: COLOR_KEYS,
  perCombo: 1,
  n: 10,
  pieces: [3, 2, 2, 1, 1, 1],
  allowBorder: false,
  seed: 1,
};

/**
 * Готовые составы фигурок (длины линий). Для текущего размера поля показываются только те,
 * которые удалось расставить без касаний (в том числе по диагонали) во всех пробных расстановках.
 */
export const PIECE_PRESETS = [
  [3, 2, 2, 1, 1, 1], [4, 3, 2, 1], [3, 3, 2, 1, 1], [4, 2, 2, 1, 1], [2, 2, 2, 2, 1, 1], [3, 2, 1, 1, 1, 1, 1],
  [2, 2, 2, 1, 1, 1, 1], [3, 3, 3, 1], [4, 3, 3], [3, 2, 2, 1], [2, 2, 1, 1], [3, 2, 2, 2, 1, 1, 1], [4, 3, 2, 2, 1],
];

export const presetLabel = (pieces) => {
  const cells = pieces.reduce((a, b) => a + b, 0);
  const word = (n, a, b, c) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
  return `${pieces.join(' + ')} — ${pieces.length} ${word(pieces.length, 'фигурка', 'фигурки', 'фигурок')}, ${cells} ${word(cells, 'клетка', 'клетки', 'клеток')}`;
};

/** Доля удачных расстановок без касаний (0–1) за `trials` пробных попыток. */
export function figureFeasibility(pieces, n, allowBorder, trials = 40) {
  let ok = 0;
  for (let i = 0; i < trials; i++) {
    try { makeFigure(makeRng(7000 + i), { n, pieces, allowBorder }); ok++; } catch { /* не поместилось */ }
  }
  return ok / trials;
}

/** Составы из PIECE_PRESETS, которые помещаются на поле n×n всегда. */
export const feasiblePresets = (n, allowBorder) => PIECE_PRESETS.filter((p) => figureFeasibility(p, n, allowBorder) === 1);

export const applyOp = (cells, op, n) => cells.map((c) => {
  const [r, cc] = OPS[op](c.r, c.c, n);
  return { ...c, r, c: cc };
});

export const patternKey = (cells) => cells.map((c) => `${c.r},${c.c}`).sort().join(';');

/** Фигура: расставляет линии заданной длины без касаний (в том числе по диагонали). */
export function makeFigure(rng, { n = 10, pieces = DEFAULTS.pieces, allowBorder = false } = {}) {
  const lo = allowBorder ? 0 : 1;
  const hi = n - 1 - lo;
  const sorted = pieces.slice().sort((a, b) => b - a);
  for (let attempt = 0; attempt < 400; attempt++) {
    const taken = Array.from({ length: n }, () => new Array(n).fill(false));
    const cells = [];
    let ok = true;
    sorted.forEach((len, piece) => {
      if (!ok) return;
      let placed = false;
      for (let t = 0; t < 300 && !placed; t++) {
        const horiz = len === 1 ? true : rng.int(2) === 0;
        const maxR = horiz ? hi : hi - len + 1;
        const maxC = horiz ? hi - len + 1 : hi;
        if (maxR < lo || maxC < lo) break;
        const r0 = lo + rng.int(maxR - lo + 1);
        const c0 = lo + rng.int(maxC - lo + 1);
        const spots = Array.from({ length: len }, (_, i) => (horiz ? [r0, c0 + i] : [r0 + i, c0]));
        const free = spots.every(([r, c]) => {
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr; const cc = c + dc;
            if (rr >= 0 && rr < n && cc >= 0 && cc < n && taken[rr][cc]) return false;
          }
          return true;
        });
        if (!free) continue;
        for (const [r, c] of spots) { taken[r][c] = true; cells.push({ r, c, piece, id: cells.length }); }
        placed = true;
      }
      if (!placed) ok = false;
    });
    if (ok) return { n, cells, pieces: sorted };
  }
  throw new Error('Не удалось расставить фигурки: уменьшите их число или увеличьте поле');
}

/** Один стимул: фигура-задание и четыре варианта; верный вариант есть всегда. */
export function makeTrial(rng, { transform, n, pieces, allowBorder, correctPos }) {
  const set = OPTION_SETS[transform];
  for (let attempt = 0; attempt < 500; attempt++) {
    const fig = makeFigure(rng, { n, pieces, allowBorder });
    const versions = set.map((op) => ({ op, cells: applyOp(fig.cells, op, n) }));
    const keys = new Set([patternKey(fig.cells), ...versions.map((v) => patternKey(v.cells))]);
    if (keys.size !== 5) continue;                       // симметричная фигура: варианты совпали бы
    const correct = versions[0];
    const others = rng.shuffle(versions.slice(1));
    const options = [];
    let k = 0;
    for (let pos = 1; pos <= 4; pos++) options.push(pos === correctPos ? correct : others[k++]);
    return {
      figure: fig,
      options: options.map((o, i) => ({ pos: i + 1, op: o.op, cells: o.cells, correct: o === correct })),
      correctPos,
    };
  }
  throw new Error('Не удалось подобрать несимметричную фигуру');
}

/** Номера верных ответов: каждый из 1–4 встречается поровну (с точностью до 1). */
export function balancedPositions(total, rng) {
  const out = [];
  while (out.length < total) out.push(...rng.shuffle([1, 2, 3, 4]));
  return out.slice(0, total);
}

export function generateRotation(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rng = makeRng(o.seed);
  const combos = [];
  for (const transform of o.transforms) for (const color of o.colors) combos.push({ transform, color });
  const total = combos.length * o.perCombo;
  const positions = balancedPositions(total, rng);
  const stimuli = [];
  let idx = 0;
  for (const { transform, color } of combos) {
    for (let k = 1; k <= o.perCombo; k++) {
      const correctPos = positions[idx++];
      const trial = makeTrial(rng, { transform, n: o.n, pieces: o.pieces, allowBorder: o.allowBorder, correctPos });
      const colorSeed = rng.int(1e9);
      stimuli.push({
        name: `mrot_${TRANSFORMS[transform].short}_${COLOR_MODES[color].short}_${String(k).padStart(2, '0')}_ans${correctPos}`,
        transform, color, index: k, colorSeed, ...trial,
      });
    }
  }
  return { stimuli, requested: total, options: o };
}
