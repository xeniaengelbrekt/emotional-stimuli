/* ============================================================
   trails/generator.js — «Траектории» (по мотивам теста Кинга — Дэвика).

   Числа от 1 до N расставлены строками. Участник прослеживает их
   взглядом по возрастанию (1 → N) или по убыванию (N → 1), не называя
   вслух и не нажимая, а в конце оценивает по шкале от 1 до 5, как
   хорошо справился (клавиша на клавиатуре).

   Что можно менять у каждого стимула:
     • сколько чисел и в скольких строках;
     • расположение: по прямой (ровные ряды) или по зигзагу
       (соседние числа ряда чередуются выше и ниже);
     • расстояние между числами: фиксированное или разное;
     • направление (на расположение не влияет — меняется только инструкция);
     • дистракторы: число другого цвета, буква, квадрат или треугольник.
       Дистрактор ЗАМЕНЯЕТ число (не первое и не последнее), на него
       смотреть нельзя.

   Модуль чистый (без DOM) — проверяется в Node.
   ============================================================ */

import { makeRng } from '../../../js/common/rng.js';

export const DIRECTIONS = {
  ascending:  { ru: 'По возрастанию (1 → N)', short: 'asc' },
  descending: { ru: 'По убыванию (N → 1)', short: 'desc' },
};
export const ARRANGEMENTS = {
  straight: { ru: 'По прямой (ровные ряды)', short: 'straight' },
  zigzag:   { ru: 'По зигзагу (числа в ряду чередуются выше и ниже)', short: 'zigzag' },
};
export const SPACINGS = {
  fixed:  { ru: 'Фиксированное', short: 'fixed' },
  varied: { ru: 'Разное (неравномерное)', short: 'varied' },
};
export const DISTRACTOR_KINDS = {
  none:     { ru: 'Без дистрактора', short: 'none' },
  recolor:  { ru: 'Число другого цвета', short: 'recolor' },
  letter:   { ru: 'Буква', short: 'letter' },
  square:   { ru: 'Квадрат', short: 'square' },
  triangle: { ru: 'Треугольник', short: 'triangle' },
};

export const DEFAULTS = {
  n: 15, rows: 3,
  directions: ['ascending', 'descending'],
  arrangements: ['straight', 'zigzag'],
  distractors: ['none', 'letter'],
  letters: ['А'],
  dCount: 1,
  spacings: ['fixed'],
  perVariant: 1,
  seed: 1,
};

/** Параметры по умолчанию для одного стимула (строка таблицы). */
export const blankRow = (o = {}) => ({
  n: 15, rows: 3, arrangement: 'straight', direction: 'ascending',
  distractor: 'none', letter: 'А', dCount: 1, spacing: 'fixed', fontSize: 0, ...o,
});

/** Все варианты по общим настройкам: по perVariant стимулов на каждое сочетание. */
export function buildRows(o = {}) {
  const c = { ...DEFAULTS, ...o };
  const rows = [];
  for (const arrangement of c.arrangements) for (const direction of c.directions) for (const spacing of c.spacings) {
    for (const kind of c.distractors) {
      const letters = kind === 'letter' ? (c.letters.length ? c.letters : ['А']) : [null];
      for (const letter of letters) {
        for (let k = 0; k < c.perVariant; k++) {
          rows.push(blankRow({
            n: c.n, rows: c.rows, arrangement, direction, spacing, distractor: kind,
            letter: letter || 'А', dCount: kind === 'none' ? 0 : c.dCount,
          }));
        }
      }
    }
  }
  return rows;
}

const TRANSLIT = { А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'Zh', З: 'Z', И: 'I', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'Kh', Ц: 'Ts', Ч: 'Ch', Ш: 'Sh', Щ: 'Sch', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'Yu', Я: 'Ya' };
const translit = (s) => [...String(s).toLocaleUpperCase('ru')].map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch)).join('') || 'x';

/** Рекомендуемый размер шрифта по размеру «ячейки» одного числа. */
export function recommendedFont(W, H, n, rows) {
  const cols = Math.ceil(n / rows);
  const slotW = (W * (1 - 2 * AREA.mx)) / cols;
  const slotH = (H * (AREA.bottom - AREA.top)) / rows;
  return Math.max(16, Math.floor(Math.min(slotH * 0.42, slotW * 0.34)));
}

export const AREA = { mx: 0.08, top: 0.18, bottom: 0.82 };

/**
 * Раскладка одного стимула: центры, виды и значения элементов (по порядку 1..N слева направо, сверху вниз).
 * style: { width, height, zigzag (доля высоты строки), spread (разброс расстояний, 0–1) }.
 */
export function layoutTrail(spec, style, rng) {
  const { width: W, height: H } = style;
  const n = spec.n; const rows = Math.max(1, Math.min(spec.rows, n));
  const cols = Math.ceil(n / rows);
  const mx = W * AREA.mx;
  const areaTop = H * AREA.top; const rowH = (H * (AREA.bottom - AREA.top)) / rows;
  const amp = (style.zigzag ?? 0.22) * rowH;
  const spread = Math.min(0.8, Math.max(0, style.spread ?? 0.4));

  // индексы дистракторов: не 1-е и не последнее число
  const dIdx = new Set();
  const want = spec.distractor === 'none' ? 0 : Math.min(spec.dCount, Math.max(0, n - 2));
  const cand = rng.shuffle(Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1));
  for (let i = 0; i < want; i++) dIdx.add(cand[i]);

  const items = [];
  for (let r = 0; r < rows; r++) {
    const count = Math.min(cols, n - r * cols);
    let xs;
    if (spec.spacing === 'varied') {
      const w = Array.from({ length: cols }, () => 1 + (rng.next() * 2 - 1) * spread);
      const total = w.reduce((a, b) => a + b, 0);
      let acc = 0;
      xs = w.map((v) => { const seg = (v / total) * (W - 2 * mx); const c = mx + acc + seg / 2; acc += seg; return c; });
    } else {
      const slot = (W - 2 * mx) / cols;
      xs = Array.from({ length: cols }, (_, c) => mx + (c + 0.5) * slot);
    }
    for (let c = 0; c < count; c++) {
      const order = r * cols + c;                 // 0-based
      const y0 = areaTop + (r + 0.5) * rowH;
      const y = spec.arrangement === 'zigzag' ? y0 + (c % 2 === 0 ? -amp : amp) : y0;
      const isD = dIdx.has(order);
      let kind = 'number';
      let text = String(order + 1);
      if (isD && spec.distractor === 'recolor') kind = 'recolored';
      else if (isD && spec.distractor === 'letter') { kind = 'letter'; text = String(spec.letter || 'А').toLocaleUpperCase('ru').slice(0, 1); }
      else if (isD && (spec.distractor === 'square' || spec.distractor === 'triangle')) { kind = spec.distractor; text = ''; }
      items.push({ order, value: order + 1, kind, text, x: xs[c], y, row: r + 1, col: c + 1, isDistractor: isD });
    }
  }
  return { items, cols, rows };
}

export function distractorLabel(spec) {
  if (spec.distractor === 'none') return 'none';
  const base = spec.distractor === 'letter' ? `letter-${translit(spec.letter)}` : spec.distractor;
  return spec.dCount > 1 ? `${base}-x${spec.dCount}` : base;
}

export function generateTrails(rowSpecs, opts = {}) {
  const seed = opts.seed ?? 1;
  const used = new Map();
  const stimuli = rowSpecs.map((spec, i) => {
    const rng = makeRng(seed * 1009 + i * 7919 + 17);
    const style = { width: opts.width, height: opts.height, zigzag: opts.zigzag, spread: opts.spread };
    const layout = layoutTrail(spec, style, rng);
    const base = `trail_${ARRANGEMENTS[spec.arrangement].short}_${DIRECTIONS[spec.direction].short}_${distractorLabel(spec)}_n${spec.n}_r${spec.rows}_${SPACINGS[spec.spacing].short}`;
    const k = (used.get(base) || 0) + 1;
    used.set(base, k);
    return { spec: { ...spec }, layout, name: `${base}_${String(k).padStart(2, '0')}`, index: i + 1 };
  });
  return stimuli;
}
