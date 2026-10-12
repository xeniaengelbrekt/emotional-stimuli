/* ============================================================
   diff/generator.js — определение различий.

   Серия экранов с одними и теми же местами объектов: на первом
   экране N объектов нужно запомнить, на каждом следующем один
   объект меняется — на него нужно нажать (кадров в серии по
   умолчанию 6, то есть 5 раз надо найти различие).
   Объекты на экране всегда разные (без повторов); один и тот же
   объект не меняется два раза подряд, а места меняются по кругу,
   пока не будут использованы все.

   Модуль чистый (без DOM) — проверяется в Node.
   ============================================================ */

import { makeRng } from '../../common/rng.js';

export const OBJECT_TYPES = {
  letters: { ru: 'Буквы', short: 'letters' },
  numbers: { ru: 'Числа', short: 'numbers' },
};
export const ARRANGEMENTS = {
  grid:   { ru: 'По сетке, по центру экрана', short: 'grid' },
  random: { ru: 'Хаотично по экрану', short: 'random' },
};
export const ALPHABETS = {
  ru: { ru: 'Русский', letters: 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ' },
  en: { ru: 'Латинский', letters: 'ABCDEFGHJKLMNPRSTUVWXYZ' },
};

export const DEFAULTS = {
  objectTypes: ['letters'],
  arrangements: ['grid'],
  counts: [4, 6, 8, 10],
  frames: 6,                    // экранов в серии: 1 «запоминание» + (frames − 1) с изменением
  alphabet: 'ru',
  numMin: 1,
  numMax: 99,
  width: 1920, height: 1080,
  fontSize: 90,
  step: 0,                      // шаг сетки, пикс.; 0 — автоматически
  seed: 1,
};

/** Столбцы и строки сетки для N объектов — как можно ближе к пропорциям экрана. */
export function gridShape(N, W, H) {
  let best = null;
  for (let rows = 1; rows <= N; rows++) {
    const cols = Math.ceil(N / rows);
    const empty = cols * rows - N;
    const ratio = cols / rows;
    const score = Math.abs(Math.log(ratio / 1.5)) + empty * 0.35;
    if (!best || score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

export function autoStep(opts) {
  const { width: W, height: H, fontSize } = opts;
  return Math.max(Math.round(fontSize * 1.9), Math.round(Math.min(W * 0.115, H * 0.2)));
}

/** Центры объектов. grid — по центру экрана; random — хаотично, но не слишком близко и не у краёв. */
export function makePositions(rng, N, arrangement, opts) {
  const { width: W, height: H, fontSize } = opts;
  if (arrangement === 'grid') {
    const { cols, rows } = gridShape(N, W, H);
    const step = opts.step > 0 ? opts.step : autoStep(opts);
    // последняя неполная строка центрируется
    const out = [];
    for (let i = 0; i < N; i++) {
      const r = Math.floor(i / cols);
      const inRow = r === rows - 1 ? N - r * cols : cols;
      const c = i % cols;
      out.push({ x: W / 2 + (c - (inRow - 1) / 2) * step, y: H / 2 + (r - (rows - 1) / 2) * step, row: r + 1, col: c + 1 });
    }
    return out;
  }
  const mx = Math.max(fontSize * 1.2, W * 0.08);
  const my = Math.max(fontSize * 1.2, H * 0.1);
  let minDist = fontSize * 2.2;
  for (let attempt = 0; attempt < 60; attempt++) {
    const pts = [];
    let tries = 0;
    while (pts.length < N && tries < 4000) {
      tries++;
      const p = { x: mx + rng.next() * (W - 2 * mx), y: my + rng.next() * (H - 2 * my) };
      if (pts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= minDist)) pts.push({ ...p, row: null, col: null });
    }
    if (pts.length === N) return pts;
    minDist *= 0.95;
  }
  throw new Error('Не удалось расставить объекты без наложений — уменьшите число объектов или размер шрифта');
}

function pool(opts, type) {
  if (type === 'letters') return [...ALPHABETS[opts.alphabet].letters];
  const out = [];
  for (let v = opts.numMin; v <= opts.numMax; v++) out.push(String(v));
  return out;
}

/** Одна серия: позиции, кадры (значения объектов) и последовательность изменений. */
export function makeSeries(rng, { type, arrangement, N, frames, ...opts }) {
  const o = { ...DEFAULTS, ...opts };
  const values = pool(o, type);
  if (values.length < N + 1) throw new Error(`Для ${N} объектов нужно не меньше ${N + 1} разных значений (сейчас ${values.length})`);
  const positions = makePositions(rng, N, arrangement, o);
  let current = rng.shuffle(values).slice(0, N);
  const frameList = [{ index: 0, values: current.slice(), changed: null }];
  const changes = [];
  const useCount = new Array(N).fill(0);
  let prev = -1;
  for (let f = 1; f < frames; f++) {
    const min = Math.min(...useCount.filter((_, i) => i !== prev));
    const cand = [...Array(N).keys()].filter((i) => i !== prev && useCount[i] === min);
    const idx = cand[rng.int(cand.length)];
    const free = values.filter((v) => !current.includes(v));
    const to = free[rng.int(free.length)];
    const from = current[idx];
    current = current.slice();
    current[idx] = to;
    useCount[idx]++;
    prev = idx;
    frameList.push({ index: f, values: current.slice(), changed: idx });
    changes.push({ frame: f, index: idx, from, to });
  }
  return { positions, frames: frameList, changes };
}

export function generateDiff(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rng = makeRng(o.seed);
  const series = [];
  let n = 0;
  for (const type of o.objectTypes) {
    for (const arrangement of o.arrangements) {
      for (const N of o.counts) {
        n++;
        const s = makeSeries(rng, { ...o, type, arrangement, N, frames: o.frames });
        const id = `${OBJECT_TYPES[type].short}_${ARRANGEMENTS[arrangement].short}_n${String(N).padStart(2, '0')}`;
        series.push({
          id, number: n, type, arrangement, N, ...s,
          stimuli: s.frames.map((fr) => ({
            name: `diff_${id}_s${String(n).padStart(2, '0')}_f${fr.index}-${fr.index === 0 ? 'memorize' : 'change'}`,
          })),
        });
      }
    }
  }
  return { series, options: o };
}
