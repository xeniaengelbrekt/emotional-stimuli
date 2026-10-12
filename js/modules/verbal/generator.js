/* ============================================================
   verbal/generator.js — вербальное мышление: классический филворд.

   Целевые слова из CSV прячутся в сетке букв (и цифр) по горизонтали
   или по вертикали (слева направо / сверху вниз). Все остальные клетки
   заполняются случайными буквами или буквами и цифрами.

   • Стимулов — по числу сочетаний «категория слова × направление»
     (× заданное число повторов); категории — те же 4 эмоциональные.
   • Слова разных категорий в одном «ряду» подбираются максимально
     похожими по длине, частотности и силе оценки (оценка своей шкалы).
   • Положение целевых слов выравнивается по 9 зонам сетки (каждое слово
     ставится в наименее занятую из зон, куда оно помещается).
   • В сетке нет «лишних» вхождений целевых слов (в том числе задом
     наперёд и в другом направлении).
   • Цветность — лишь заливка клеток: слова и буквы у ч/б и цветного
     варианта одного стимула одинаковы.

   Модуль чистый (без DOM) — проверяется в Node.
   ============================================================ */

import { makeRng } from '../../common/rng.js';
import { EMOTION_KEYS } from '../../common/emotions.js';

export const ORIENTATIONS = {
  horizontal: { ru: 'Горизонталь (слева направо)', short: 'horizontal' },
  vertical:   { ru: 'Вертикаль (сверху вниз)', short: 'vertical' },
};
export const COLOR_MODES = {
  bw:    { ru: 'Чёрно-белая сетка', short: 'bw' },
  color: { ru: 'Каждая клетка своего цвета', short: 'color' },
};
export const DISTRACTORS = {
  'letters-digits': { ru: 'Буквы и цифры', short: 'ld' },
  letters:          { ru: 'Только буквы', short: 'l' },
};

export const ALPHABETS = {
  ru: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
  en: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
};
const DIGITS = '0123456789';

export const DEFAULTS = {
  useCategory: true,
  matchLength: true,
  matchFreq: true,
  matchRating: true,
  perCombo: 1,
  orientations: ['horizontal', 'vertical'],
  colors: ['bw'],
  targetsPerStimulus: 1,
  rows: 10,
  cols: 10,
  distractors: 'letters-digits',
  allowBorder: true,
  seed: 1,
};

export const cleanWord = (w) => String(w).trim().toLocaleUpperCase('ru');
export const isPlainWord = (w) => /^[\p{L}]+$/u.test(w);

/** Алфавит заполнителей: латиница, если в целевых словах преобладает латиница. */
export function pickAlphabet(words) {
  let lat = 0; let cyr = 0;
  for (const w of words) for (const ch of w) { if (/[A-Z]/.test(ch)) lat++; else if (/[А-ЯЁ]/.test(ch)) cyr++; }
  return lat > cyr ? 'en' : 'ru';
}

export const logFreq = (f) => Math.log10(Math.max(f, 0.001));

/* ---------------- подбор целевых слов ---------------- */

function zFeatures(words, o) {
  const f = (arr, get) => {
    const v = arr.map(get).filter(Number.isFinite);
    const m = v.reduce((a, b) => a + b, 0) / (v.length || 1);
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1)) || 1;
    return (x) => (Number.isFinite(x) ? (x - m) / sd : 0);
  };
  const zl = f(words, (w) => w.len);
  const zf = f(words, (w) => (w.freq != null ? logFreq(w.freq) : NaN));
  const zr = f(words, (w) => w.ratings[w.category]);
  for (const w of words) {
    w._z = { len: zl(w.len), freq: zf(w.freq != null ? logFreq(w.freq) : NaN), rating: zr(w.ratings[w.category]) };
  }
  return (a, b) => {
    let c = 0;
    if (o.matchLength) c += 1000 * (a.len - b.len) ** 2 + (a._z.len - b._z.len) ** 2;
    if (o.matchFreq) c += (a._z.freq - b._z.freq) ** 2;
    if (o.matchRating) c += (a._z.rating - b._z.rating) ** 2;
    return c;
  };
}

/**
 * Подбирает G «рядов»: по одному слову каждой категории, максимально близких
 * по длине / частотности / оценке. Возвращает { groups: [{cat: word}], warnings }.
 */
export function matchGroups(words, G, o, rng) {
  const warnings = [];
  const maxLen = Math.min(o.rows, o.cols) - (o.allowBorder ? 0 : 2);
  const eligible = words.filter((w) => w.category && w.len <= maxLen && w.len >= 2);
  if (words.length && eligible.length < words.filter((w) => w.category).length) {
    warnings.push(`Слова длиннее ${maxLen} букв не помещаются в сетку ${o.cols}×${o.rows} и не используются.`);
  }
  const cost = zFeatures(eligible, o);
  const cats = o.useCategory ? EMOTION_KEYS : ['any'];
  const pools = Object.fromEntries(cats.map((c) => [c, rng.shuffle(eligible.filter((w) => c === 'any' || w.category === c))]));
  const groups = [];
  for (let g = 0; g < G; g++) {
    const sizes = cats.map((c) => pools[c].length);
    if (Math.min(...sizes) === 0) break;
    if (cats.length === 1) {
      groups.push({ any: pools.any.shift() });
      continue;
    }
    const anchorCat = cats[sizes.indexOf(Math.min(...sizes))];
    let best = null;
    for (const a of pools[anchorCat]) {
      const pick = { [anchorCat]: a };
      let total = 0;
      for (const c of cats) {
        if (c === anchorCat) continue;
        let bw = null; let bc = Infinity;
        for (const w of pools[c]) { const k = cost(a, w); if (k < bc) { bc = k; bw = w; } }
        pick[c] = bw; total += bc;
      }
      if (!best || total < best.total) best = { total, pick };
    }
    for (const c of cats) pools[c].splice(pools[c].indexOf(best.pick[c]), 1);
    groups.push(best.pick);
  }
  if (groups.length < G) {
    warnings.push(`Слов не хватает: нужно рядов по ${G}, подобрано ${groups.length}. Загрузите больше слов, уменьшите число стимулов или число целевых слов.`);
  }
  return { groups, warnings };
}

/* ---------------- построение сетки ---------------- */

const zoneOf = (r, c, rows, cols) => Math.min(2, Math.floor((r / rows) * 3)) * 3 + Math.min(2, Math.floor((c / cols) * 3));

/** Все вхождения слова в сетку: [{cells, dir, reversed}] — по строкам, столбцам, вперёд и назад. */
export function findOccurrences(letters, rows, cols, word) {
  const out = [];
  const L = word.length;
  const rev = [...word].reverse().join('');
  const line = (cells) => {
    const s = cells.map(([r, c]) => letters[r][c]).join('');
    for (let i = 0; i + L <= cells.length; i++) {
      const sub = s.slice(i, i + L);
      if (sub === word) out.push({ cells: cells.slice(i, i + L), reversed: false });
      if (rev !== word && sub === rev) out.push({ cells: cells.slice(i, i + L), reversed: true });
    }
  };
  for (let r = 0; r < rows; r++) line(Array.from({ length: cols }, (_, c) => [r, c]));
  for (let c = 0; c < cols; c++) line(Array.from({ length: rows }, (_, r) => [r, c]));
  return out;
}

export function buildGrid(rng, { rows, cols, words, orientation, allowBorder, alphabet, distractors, zoneUse = Array(9).fill(0) }) {
  const rlo = allowBorder ? 0 : 1; const rhi = rows - 1 - rlo;
  const clo = allowBorder ? 0 : 1; const chi = cols - 1 - clo;
  const used = new Set();
  const placements = [];
  const order = words.map((w, i) => i);
  for (const i of order) {
    const word = words[i];
    const L = word.length;
    const cand = [];
    const horiz = orientation === 'horizontal';
    for (let r = rlo; r <= (horiz ? rhi : rhi - L + 1); r++) {
      for (let c = clo; c <= (horiz ? chi - L + 1 : chi); c++) {
        const cells = Array.from({ length: L }, (_, k) => (horiz ? [r, c + k] : [r + k, c]));
        if (cells.some(([a, b]) => used.has(`${a},${b}`))) continue;
        cand.push(cells);
      }
    }
    if (!cand.length) throw new Error(`Слово «${word}» не удаётся разместить в сетке ${cols}×${rows}`);
    // положение выравниваем по 9 зонам: берём наименее занятую из зон, куда слово можно поставить
    const zoneOfCells = (cells) => { const mid = cells[Math.floor(cells.length / 2)]; return zoneOf(mid[0], mid[1], rows, cols); };
    const reachable = [...new Set(cand.map(zoneOfCells))];
    const least = Math.min(...reachable.map((z) => zoneUse[z]));
    const bestZones = reachable.filter((z) => zoneUse[z] === least);
    const zone = bestZones[rng.int(bestZones.length)];
    const pool = cand.filter((cells) => zoneOfCells(cells) === zone);
    const cells = pool[rng.int(pool.length)];
    zoneUse[zone]++;
    cells.forEach(([a, b]) => used.add(`${a},${b}`));
    placements.push({ word, orientation, cells });
  }
  const symbols = alphabet + (distractors === 'letters-digits' ? DIGITS : '');
  const letters = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const p of placements) p.cells.forEach(([r, c], k) => { letters[r][c] = p.word[k]; });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!letters[r][c]) letters[r][c] = symbols[rng.int(symbols.length)];

  // никаких «лишних» вхождений целевых слов
  for (let guard = 0; guard < 200; guard++) {
    let dirty = false;
    for (const p of placements) {
      for (const occ of findOccurrences(letters, rows, cols, p.word)) {
        const same = !occ.reversed && occ.cells.every(([r, c], k) => p.cells[k][0] === r && p.cells[k][1] === c);
        if (same) continue;
        const free = occ.cells.filter(([r, c]) => !used.has(`${r},${c}`));
        if (!free.length) continue;
        const [r, c] = free[rng.int(free.length)];
        letters[r][c] = symbols[rng.int(symbols.length)];
        dirty = true;
      }
    }
    if (!dirty) break;
  }
  return { letters, placements };
}

/** Заливка клеток цветного варианта: соседние клетки (слева и сверху) не совпадают. */
export function cellFills(rng, rows, cols, palette) {
  const fills = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bad = new Set([c > 0 ? fills[r][c - 1] : -1, r > 0 ? fills[r - 1][c] : -1]);
      let k;
      do { k = rng.int(palette); } while (bad.has(k));
      fills[r][c] = k;
    }
  }
  return fills;
}

/* ---------------- весь набор ---------------- */

export function generateVerbal(words, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rng = makeRng(o.seed);
  const warnings = [];
  const O = o.orientations.length;
  const k = Math.max(1, o.targetsPerStimulus);
  const G = O * o.perCombo * k;
  const m = matchGroups(words, G, o, rng);
  warnings.push(...m.warnings);
  const cats = o.useCategory ? EMOTION_KEYS : ['any'];
  const alphabet = ALPHABETS[o.alphabet || pickAlphabet(words.map((w) => cleanWord(w.word)))];
  const zoneUse = Array(9).fill(0);

  const bases = [];
  o.orientations.forEach((orientation, oi) => {
    for (const cat of cats) {
      for (let s = 0; s < o.perCombo; s++) {
        const idx = (oi * o.perCombo + s) * k;
        const picked = [];
        for (let j = 0; j < k; j++) { const g = m.groups[idx + j]; if (g && g[cat]) picked.push(g[cat]); }
        if (picked.length < k) continue;
        const texts = picked.map((w) => cleanWord(w.word));
        const grid = buildGrid(rng, {
          rows: o.rows, cols: o.cols, words: texts, orientation, allowBorder: o.allowBorder,
          alphabet, distractors: o.distractors, zoneUse,
        });
        bases.push({ category: cat, orientation, slot: s + 1, targets: picked, ...grid, fillSeed: rng.int(1e9) });
      }
    }
  });

  const requested = o.orientations.length * cats.length * o.perCombo * o.colors.length;
  const stimuli = [];
  for (const b of bases) {
    for (const color of o.colors) {
      const lens = b.targets.map((w) => w.len);
      const lenTxt = Math.min(...lens) === Math.max(...lens) ? `len${lens[0]}` : `len${Math.min(...lens)}-${Math.max(...lens)}`;
      stimuli.push({
        ...b, color,
        name: `filword_${b.category === 'any' ? 'mixed' : b.category}_${ORIENTATIONS[b.orientation].short}_${COLOR_MODES[color].short}_${o.cols}x${o.rows}_${DISTRACTORS[o.distractors].short}_w${k}_${lenTxt}_${String(b.slot).padStart(2, '0')}`,
      });
    }
  }
  return { stimuli, requested, warnings, options: o, alphabet };
}
