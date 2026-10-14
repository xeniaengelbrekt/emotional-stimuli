/* ============================================================
   verbal/generator.js — вербальное мышление: классический филворд.

   Целевые слова из CSV прячутся в сетке букв (и цифр) по горизонтали
   или по вертикали (слева направо / сверху вниз). Все остальные клетки
   заполняются случайными буквами или буквами и цифрами.

   • Состав целевых слов в стимуле: из четырёх эмоциональных категорий
     поровну (по умолчанию 4 слова — по одному из каждой) или из одной
     категории (для каждой категории — свои стимулы); можно не учитывать
     категории вовсе. При учёте категорий и составе «из четырёх» число
     слов всегда кратно 4.
   • Слова разных категорий в одном «ряду» подбираются максимально
     похожими по длине, частотности и силе оценки (оценка своей шкалы).
   • Слова не повторяются (по умолчанию) или могут повторяться между
     стимулами, но не внутри одного стимула.
   • Слова могут (или не могут) пересекаться и касаться друг друга.
     Если слова не помещаются, стимул пропускается и выдаётся предупреждение.
   • Положение целевых слов выравнивается по 9 зонам сетки (каждое слово
     ставится в наименее занятую из зон, куда оно помещается).
   • В сетке нет «лишних» вхождений целевых слов (в том числе задом
     наперёд и в другом направлении).
   • Чёрно-белый и цветной варианты — разные стимулы: у каждого свои
     целевые слова и свои буквы (слова между ними не повторяются).

   Модуль чистый (без DOM) — проверяется в Node.
   ============================================================ */

import { makeRng } from '../../common/rng.js';
import { sameLexeme, hasRelative } from '../../common/lexeme.js';
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

export const COMPOSITIONS = {
  four: { ru: 'Из четырёх эмоциональных категорий поровну', short: 'mix4' },
  one:  { ru: 'Из одной категории (для каждой категории — свои стимулы)', short: '' },
};

export const DEFAULTS = {
  useCategory: true,
  composition: 'four',
  matchLength: true,
  matchFreq: true,
  matchRating: true,
  fixedLength: 0,           // 0 — длина не фиксируется; N — все слова во всех стимулах ровно N букв
  perCombo: 1,
  orientations: ['horizontal', 'vertical'],
  colors: ['bw'],
  targetsPerStimulus: 4,
  rows: 10,
  cols: 10,
  distractors: 'letters-digits',
  allowBorder: true,
  allowOverlap: false,      // слова могут иметь общие клетки (общие буквы)
  allowTouch: false,        // слова могут стоять в соседних клетках (в том числе по диагонали)
  allowRepeats: false,      // одно и то же слово может встречаться в разных стимулах
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

/**
 * Нормализует настройки состава: при учёте категорий и составе «из четырёх» число слов
 * округляется вверх до кратного 4. Возвращает { o, notes }.
 */
export function normalizeOptions(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const notes = [];
  o.targetsPerStimulus = Math.max(1, Math.round(o.targetsPerStimulus));
  if (o.useCategory && o.composition === 'four' && o.targetsPerStimulus % 4 !== 0) {
    const fixed = Math.ceil(o.targetsPerStimulus / 4) * 4;
    notes.push(`При составе «из четырёх категорий» число слов должно быть кратно 4: вместо ${o.targetsPerStimulus} используется ${fixed}.`);
    o.targetsPerStimulus = fixed;
  }
  return { o, notes };
}

/** Сколько «рядов» (по слову на категорию) нужно на один стимул и сколько стимулов-блоков. */
export function planOf(o) {
  const O = o.orientations.length;
  const C = Math.max(1, (o.colors || []).length);   // цветная и ч/б сетки — разные стимулы: у каждой свои слова и буквы
  const k = o.targetsPerStimulus;
  if (o.useCategory && o.composition === 'four') return { slots: O * C * o.perCombo, rowsPerSlot: k / 4, perCat: 1, mode: 'four' };
  if (o.useCategory) return { slots: O * C * o.perCombo, rowsPerSlot: k, perCat: 4, mode: 'one' };
  return { slots: O * C * o.perCombo, rowsPerSlot: k, perCat: 1, mode: 'any' };
}

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

/** Наибольшая длина слова, которое вообще может поместиться в сетку. */
export const maxWordLength = (o) => Math.min(o.rows, o.cols) - (o.allowBorder ? 0 : 2);

/**
 * Подбирает блоки «рядов»: ряд — по одному слову каждой категории, максимально близких
 * по длине / частотности / оценке. В блоке rowsPerBlock рядов; слова в блоке не повторяются.
 * Без повторов слово используется один раз за весь набор; с повторами — берутся наименее
 * использованные. Возвращает { blocks: [[{cat: word}, …]], warnings }.
 */
export function matchBlocks(words, nBlocks, rowsPerBlock, o, rng) {
  const warnings = [];
  const maxLen = maxWordLength(o);
  const fixLen = o.fixedLength > 0 ? o.fixedLength : 0;
  const eligible = words.filter((w) => w.category && w.len <= maxLen && w.len >= 2 && (!fixLen || w.len === fixLen));
  if (fixLen && fixLen > maxLen) warnings.push(`Слова длиной ${fixLen} букв не помещаются в сетку ${o.cols}×${o.rows}.`);
  if (words.length && !fixLen && eligible.length < words.filter((w) => w.category).length) {
    warnings.push(`Слова длиннее ${maxLen} букв не помещаются в сетку ${o.cols}×${o.rows} и не используются.`);
  }
  const cost = zFeatures(eligible, o);
  const cats = o.useCategory ? EMOTION_KEYS : ['any'];
  const usage = new Map(eligible.map((w) => [w.id, 0]));
  const shuffled = Object.fromEntries(cats.map((c) => [c, rng.shuffle(eligible.filter((w) => c === 'any' || w.category === c))]));
  const blocks = [];
  let short = false;
  for (let b = 0; b < nBlocks && !short; b++) {
    const inBlock = new Set();
    const blockWords = [];          // слова блока: словоформы одного слова в одном стимуле не допускаются
    const rows = [];
    for (let r = 0; r < rowsPerBlock; r++) {
      const avail = Object.fromEntries(cats.map((c) => [c, shuffled[c].filter((w) =>
        !inBlock.has(w.id) && (o.allowRepeats || usage.get(w.id) === 0) && !hasRelative(w.word, blockWords))]));
      if (cats.some((c) => !avail[c].length)) { short = true; break; }
      let pick;
      if (cats.length === 1) {
        const least = Math.min(...avail.any.map((w) => usage.get(w.id)));
        pick = { any: avail.any.find((w) => usage.get(w.id) === least) };
      } else {
        const anchorCat = cats.reduce((best, c) => (avail[c].length < avail[best].length ? c : best), cats[0]);
        let best = null;
        for (const a of avail[anchorCat]) {
          const cand = { [anchorCat]: a };
          let total = 5 * usage.get(a.id);
          let ok = true;
          for (const c of cats) {
            if (c === anchorCat) continue;
            let bw = null; let bc = Infinity;
            for (const w of avail[c]) {
              if (Object.values(cand).some((x) => sameLexeme(x.word, w.word))) continue;
              const k = cost(a, w) + 5 * usage.get(w.id); if (k < bc) { bc = k; bw = w; }
            }
            if (!bw) { ok = false; break; }
            cand[c] = bw; total += bc;
          }
          if (!ok) continue;
          if (!best || total < best.total) best = { total, cand };
        }
        if (!best) { short = true; break; }
        pick = best.cand;
      }
      for (const w of Object.values(pick)) { inBlock.add(w.id); blockWords.push(w); usage.set(w.id, usage.get(w.id) + 1); }
      rows.push(pick);
    }
    if (rows.length === rowsPerBlock) blocks.push(rows);
  }
  if (blocks.length < nBlocks) {
    warnings.push(`Слов${fixLen ? ` длиной ${fixLen} букв` : ''} не хватает: нужно блоков по ${rowsPerBlock} слов${rowsPerBlock === 1 ? 'у' : ''} в категории — ${nBlocks}, подобрано ${blocks.length}. ` +
      (o.allowRepeats ? 'В одной из категорий слов меньше, чем нужно для одного стимула.' : 'Слова закончились: разрешите повторы слов, загрузите больше слов или уменьшите число стимулов.'));
  }
  return { blocks, warnings };
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

export class PlacementError extends Error {}

/** Одна попытка расстановки; бросает PlacementError, если слово некуда поставить. */
function tryBuildGrid(rng, { rows, cols, words, orientation, allowBorder, allowOverlap, allowTouch, alphabet, distractors, zoneUse }) {
  const rlo = allowBorder ? 0 : 1; const rhi = rows - 1 - rlo;
  const clo = allowBorder ? 0 : 1; const chi = cols - 1 - clo;
  const owner = new Map();                 // "r,c" → индексы слов
  const letterAt = new Map();
  const placements = [];
  const horiz = orientation === 'horizontal';
  // длинные слова ставим первыми: им труднее всего найти место
  const order = words.map((w, i) => i).sort((a, b) => words[b].length - words[a].length || rng.next() - 0.5);
  const key = (r, c) => `${r},${c}`;

  for (const i of order) {
    const word = words[i];
    const L = word.length;
    const cand = [];
    for (let r = rlo; r <= (horiz ? rhi : rhi - L + 1); r++) {
      for (let c = clo; c <= (horiz ? chi - L + 1 : chi); c++) {
        const cells = Array.from({ length: L }, (_, k) => (horiz ? [r, c + k] : [r + k, c]));
        const overlapped = new Set();
        let bad = false;
        let shared = 0;
        cells.forEach(([a, b], k) => {
          const o = owner.get(key(a, b));
          if (o) {
            if (!allowOverlap || letterAt.get(key(a, b)) !== word[k]) bad = true;
            else { shared++; o.forEach((x) => overlapped.add(x)); }
          }
        });
        if (bad || shared === L) continue;                       // слово целиком внутри уже стоящих
        if (!allowTouch) {
          const own = new Set(cells.map(([a, b]) => key(a, b)));
          for (const [a, b] of cells) {
            for (let da = -1; da <= 1 && !bad; da++) for (let db = -1; db <= 1; db++) {
              const kk = key(a + da, b + db);
              if (own.has(kk)) continue;
              const o = owner.get(kk);
              if (o && ![...o].every((x) => overlapped.has(x))) { bad = true; break; }
            }
            if (bad) break;
          }
        }
        if (!bad) cand.push(cells);
      }
    }
    if (!cand.length) throw new PlacementError(`слово «${word}» не помещается в сетку ${cols}×${rows} вместе с остальными`);
    // положение выравниваем по 9 зонам: наименее занятая из зон, куда слово можно поставить
    const zoneOfCells = (cells) => { const mid = cells[Math.floor(cells.length / 2)]; return zoneOf(mid[0], mid[1], rows, cols); };
    const reachable = [...new Set(cand.map(zoneOfCells))];
    const least = Math.min(...reachable.map((z) => zoneUse[z]));
    const bestZones = reachable.filter((z) => zoneUse[z] === least);
    const zone = bestZones[rng.int(bestZones.length)];
    const pool = cand.filter((cells) => zoneOfCells(cells) === zone);
    const cells = pool[rng.int(pool.length)];
    zoneUse[zone]++;
    cells.forEach(([a, b], k) => {
      const kk = key(a, b);
      owner.set(kk, [...(owner.get(kk) || []), i]);
      letterAt.set(kk, word[k]);
    });
    placements[i] = { word, orientation, cells };
  }
  const symbols = alphabet + (distractors === 'letters-digits' ? '0123456789' : '');
  const letters = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const p of placements) p.cells.forEach(([r, c], k) => { letters[r][c] = p.word[k]; });
  const used = new Set(owner.keys());
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!letters[r][c]) letters[r][c] = symbols[rng.int(symbols.length)];

  // никаких «лишних» вхождений целевых слов
  for (let guard = 0; guard < 200; guard++) {
    let dirty = false;
    for (const p of placements) {
      for (const occ of findOccurrences(letters, rows, cols, p.word)) {
        const same = !occ.reversed && occ.cells.every(([r, c], k) => p.cells[k][0] === r && p.cells[k][1] === c);
        if (same) continue;
        const free = occ.cells.filter(([r, c]) => !used.has(key(r, c)));
        if (!free.length) continue;
        const [r, c] = free[rng.int(free.length)];
        letters[r][c] = symbols[rng.int(symbols.length)];
        dirty = true;
      }
    }
    if (!dirty) break;
  }
  // проверка: каждое слово встречается ровно один раз (в том числе слово не «спрятано» внутри другого)
  for (const p of placements) {
    const occ = findOccurrences(letters, rows, cols, p.word);
    if (occ.length !== 1) throw new PlacementError(`слово «${p.word}» оказалось в сетке несколько раз`);
  }
  return { letters, placements };
}

export function buildGrid(rng, opts) {
  const base = { allowBorder: true, allowOverlap: false, allowTouch: true, zoneUse: Array(9).fill(0), ...opts };
  let lastErr = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const zoneUse = base.zoneUse.slice();
    try {
      const res = tryBuildGrid(rng, { ...base, zoneUse });
      for (let z = 0; z < 9; z++) base.zoneUse[z] = zoneUse[z];
      return res;
    } catch (e) {
      if (!(e instanceof PlacementError)) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Проверка «поместятся ли слова»: пробуем расставить самые длинные слова из нужного состава.
 * Возвращает { ok, message?, tried }.
 */
export function checkFit(words, optsIn) {
  const { o } = normalizeOptions(optsIn);
  const maxLen = maxWordLength(o);
  const fixLen = o.fixedLength > 0 ? o.fixedLength : 0;
  const eligible = words.filter((w) => w.category && w.len >= 2 && w.len <= maxLen && (!fixLen || w.len === fixLen));
  if (!eligible.length) return { ok: false, message: fixLen ? `Нет слов длиной ${fixLen} букв, которые помещаются в сетку.` : `Нет слов подходящей длины (от 2 до ${maxLen} букв).`, tried: 0 };
  const plan = planOf(o);
  const k = o.targetsPerStimulus;
  const cats = o.useCategory ? EMOTION_KEYS : ['any'];
  let longest = [];
  if (plan.mode === 'four') {
    for (const c of cats) longest.push(...eligible.filter((w) => w.category === c).sort((a, b) => b.len - a.len).slice(0, k / 4));
  } else if (plan.mode === 'one') {
    // для каждой категории отдельно — берём худший случай
    longest = cats.map((c) => eligible.filter((w) => w.category === c).sort((a, b) => b.len - a.len).slice(0, k)).sort((a, b) => b.reduce((s, w) => s + w.len, 0) - a.reduce((s, w) => s + w.len, 0))[0] || [];
  } else longest = eligible.slice().sort((a, b) => b.len - a.len).slice(0, k);
  const texts = longest.map((w) => cleanWord(w.word));
  if (texts.length < k) return { ok: true, tried: 0 };
  for (const orientation of o.orientations) {
    let ok = 0;
    for (let i = 0; i < 12; i++) {
      try { buildGrid(makeRng(900 + i), { rows: o.rows, cols: o.cols, words: texts, orientation, allowBorder: o.allowBorder, allowOverlap: o.allowOverlap, allowTouch: o.allowTouch, alphabet: ALPHABETS.ru, distractors: 'letters' }); ok++; } catch { /* не поместилось */ }
    }
    if (ok < 12) {
      return { ok: false, tried: 12, message: `Самые длинные слова (${texts.join(', ')}) ${ok === 0 ? 'не помещаются' : 'помещаются не всегда'} в сетку ${o.cols}×${o.rows} (${orientation === 'horizontal' ? 'по горизонтали' : 'по вертикали'}) ` +
        `${o.allowTouch ? '' : 'без касаний '}${o.allowOverlap ? 'с пересечениями' : 'без пересечений'}. Увеличьте сетку, уменьшите число слов или разрешите касание и пересечение.` };
    }
  }
  return { ok: true, tried: 12 };
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

export function generateVerbal(wordsIn, opts = {}) {
  const { o, notes } = normalizeOptions(opts);
  // без учёта категорий используются все слова, в том числе без эмоциональной категории
  const words = o.useCategory ? wordsIn : wordsIn.map((w) => ({ ...w, category: w.category || 'any' }));
  const rng = makeRng(o.seed);
  const warnings = [...notes];
  const plan = planOf(o);
  const k = o.targetsPerStimulus;
  const cats = o.useCategory ? EMOTION_KEYS : ['any'];
  const m = matchBlocks(words, plan.slots, plan.rowsPerSlot, o, rng);
  warnings.push(...m.warnings);
  const alphabet = ALPHABETS[o.alphabet || pickAlphabet(words.map((w) => cleanWord(w.word)))];
  const zoneUse = Array(9).fill(0);

  const stimCats = plan.mode === 'one' ? cats : [plan.mode === 'four' ? 'mixed4' : 'any'];
  const bases = [];
  const failed = [];
  const colorList = o.colors.length ? o.colors : ['bw'];
  o.orientations.forEach((orientation, oi) => colorList.forEach((color, ci) => {
    for (let s = 0; s < o.perCombo; s++) {
      const block = m.blocks[(oi * colorList.length + ci) * o.perCombo + s];
      if (!block) continue;
      for (const cat of stimCats) {
        let picked;
        if (plan.mode === 'four') picked = block.flatMap((row) => EMOTION_KEYS.map((c) => row[c]));
        else picked = block.map((row) => row[plan.mode === 'one' ? cat : 'any']);
        if (picked.length < k || picked.some((w) => !w)) continue;
        const texts = picked.map((w) => cleanWord(w.word));
        try {
          const grid = buildGrid(rng, {
            rows: o.rows, cols: o.cols, words: texts, orientation, allowBorder: o.allowBorder,
            allowOverlap: o.allowOverlap, allowTouch: o.allowTouch, alphabet, distractors: o.distractors, zoneUse,
          });
          // порядок целевых слов в stimuli.targets = порядок размещения (как в texts)
          bases.push({ category: cat, orientation, color, slot: s + 1, targets: picked, ...grid, fillSeed: rng.int(1e9) });
        } catch (e) {
          if (!(e instanceof PlacementError)) throw e;
          failed.push(`${ORIENTATIONS[orientation].short} №${s + 1}${cat === 'any' || cat === 'mixed4' ? '' : ` (${cat})`}: ${e.message}`);
        }
      }
    }
  }));
  if (failed.length) {
    warnings.push(`Не удалось расставить слова в ${failed.length} стимулах — слова не помещаются в сетку ${o.cols}×${o.rows}` +
      `${o.allowTouch ? '' : ' без касаний'}${o.allowOverlap ? '' : ' и без пересечений'}. ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? '…' : ''}`);
  }

  const requested = plan.slots * stimCats.length;
  const stimuli = [];
  for (const b of bases) {
    const lens = b.targets.map((w) => w.len);
    const lenTxt = Math.min(...lens) === Math.max(...lens) ? `len${lens[0]}` : `len${Math.min(...lens)}-${Math.max(...lens)}`;
    const catTxt = b.category === 'any' ? 'mixed' : b.category === 'mixed4' ? 'mix4' : b.category;
    stimuli.push({
      ...b,
      name: `filword_${catTxt}_${ORIENTATIONS[b.orientation].short}_${COLOR_MODES[b.color].short}_${o.cols}x${o.rows}_${DISTRACTORS[o.distractors].short}_w${k}_${lenTxt}_${String(b.slot).padStart(2, '0')}`,
    });
  }
  return { stimuli, requested, warnings, options: o, alphabet, plan };
}
