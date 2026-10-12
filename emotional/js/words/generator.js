/* ============================================================
   words/generator.js — подбор стимулов «найдите слово».
   Чистая логика без DOM (тестируется в Node).

   Контрольный стимул: целевое слово и все дистракторы одной
   эмоциональной категории.
   Экспериментальный: дистракторы — из других категорий (поровну),
   целевое слово — из категории, ради которой собран стимул.

   Слова подбираются по длине и частотности: дистракторы как можно
   ближе к целевому слову, а целевые слова разных категорий —
   как можно ближе друг к другу (иначе эффект эмоции смешается
   с эффектом длины или частотности).
   ============================================================ */

import { makeRng } from '../../../shared/js/common/rng.js';
import { EMOTIONS, EMOTION_KEYS } from '../../../shared/js/common/emotions.js';
import { oneWayAnova, meanOf, sdOf } from '../../../shared/js/core/stats.js';

export const DEFAULT_OPTIONS = {
  levels: [20, 30, 40],
  controlPerCategory: 1,       // контрольных на каждую категорию на каждом уровне
  experimentalPerCategory: 1,  // экспериментальных на каждую категорию целевых слов на уровне
  allowRepeats: false,
  distractorMode: 'other',     // 'other' — только чужие категории; 'all' — все 4 категории поровну
  matchLength: true,
  matchFreq: true,
  seed: 1,
  repeatPenalty: 1.5,
  noise: 0.25,                 // случайность подбора: 0 — всегда ближайшие слова
  attempts: 12,                // сколько раз пробовать с разными порядками и брать лучший по балансу
};

export const logFreq = (f) => (f == null ? null : Math.log10(Math.max(f, 0) + 0.01));

/* ---------------- сетка ---------------- */

/**
 * Размер сетки для N слов в области w×h: стараемся, чтобы ячейки были
 * широкими (слова — горизонтальные объекты), и чтобы пустых ячеек не было.
 */
export function gridFor(N, w, h, targetAspect = 2) {
  let best = null;
  for (let rows = 1; rows <= N; rows++) {
    const cols = Math.ceil(N / rows);
    const empty = rows * cols - N;
    const aspect = (w / cols) / (h / rows);
    const cost = empty * 2 + Math.abs(Math.log(aspect / targetAspect));
    if (!best || cost < best.cost) best = { rows, cols, cost };
  }
  return { rows: best.rows, cols: best.cols };
}

/* ---------------- проверка выполнимости ---------------- */

/** Сколько слов каждой категории потребуется при данных настройках (без повторов). */
export function demandPerCategory(options) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  // каждая категория: свои контрольные (N слов) + участие в чужих экспериментальных
  // и целевые слова — суммарно ровно N слов на «круг» из 4 экспериментальных стимулов
  const perRound = o.levels.reduce((s, N) => s + N, 0);
  return perRound * (o.controlPerCategory + o.experimentalPerCategory);
}

export function checkFeasibility(words, options) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const need = demandPerCategory(o);
  const maxLevel = Math.max(...o.levels);
  const rows = EMOTION_KEYS.map((c) => {
    const have = words.filter((w) => w.category === c).length;
    const required = o.allowRepeats ? maxLevel : need;
    return { category: c, have, need: required, ok: have >= required };
  });
  const warnings = rows.filter((r) => !r.ok).map((r) => {
    const cl = EMOTIONS.find((e) => e.key === r.category).ru.toLowerCase();
    return `Категория «${cl}»: слов ${r.have}, нужно не менее ${r.need}` +
      (o.allowRepeats ? ' (на самый большой уровень сложности)' : ' (без повторов)') + '.';
  });
  return { rows, warnings, ok: warnings.length === 0 };
}

/* ---------------- генерация ---------------- */

/**
 * words: [{ id, word, category, len, freq|null, ratings }]
 * Возвращает { stimuli, warnings, requested, built, feasibility }.
 */
export function generateWordStimuli(allWords, options) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  let best = null;
  for (let k = 0; k < Math.max(1, o.attempts); k++) {
    const res = generateOnce(allWords, { ...o, seed: o.seed + k * 7919 });
    // главное — собрать все стимулы; затем — чтобы категории не различались по длине и частоте
    const ps = res.stimuli.length
      ? balanceReport(res.stimuli).filter((r) => r.scope === 'all').map((r) => (r.anova ? r.anova.p : 1))
      : [1];
    res.quality = Math.min(...ps);
    res.seedUsed = o.seed + k * 7919;
    if (!best || res.built > best.built || (res.built === best.built && res.quality > best.quality)) best = res;
  }
  return best;
}

function generateOnce(allWords, o) {
  const rng = makeRng(o.seed);
  const words = allWords.filter((w) => w.category);
  const feasibility = checkFeasibility(words, o);
  const warnings = [...feasibility.warnings];

  // признаки для сопоставления
  // слова без частоты не выключают уравнивание: им подставляется средняя log-частотность
  const withFreq = words.filter((w) => w.freq != null);
  const useFreq = o.matchFreq && withFreq.length >= 0.5 * words.length;
  if (o.matchFreq && !useFreq) {
    warnings.push('Частотность задана менее чем для половины слов — по частотности слова не уравниваются.');
  } else if (o.matchFreq && withFreq.length < words.length) {
    warnings.push(`Частотность не задана для ${words.length - withFreq.length} слов — им подставлена средняя; проверьте таблицу.`);
  }
  const meanLogFreq = withFreq.length ? meanOf(withFreq.map((w) => logFreq(w.freq))) : 0;
  const feat = [];
  if (o.matchLength) feat.push((w) => w.len);
  if (useFreq) feat.push((w) => (w.freq == null ? meanLogFreq : logFreq(w.freq)));
  const stats = feat.map((f) => {
    const v = words.map(f);
    return { mu: meanOf(v), sd: sdOf(v) > 0 ? sdOf(v) : 1 };
  });
  const vec = new Map(words.map((w) => [w.id, feat.map((f, i) => (f(w) - stats[i].mu) / stats[i].sd)]));
  const ZERO = feat.map(() => 0);
  const d2 = (a, b) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);

  const usage = new Map(words.map((w) => [w.id, 0]));
  const extra = Object.fromEntries(EMOTION_KEYS.map((c) => [c, 0]));   // кому достался «лишний» дистрактор
  const cellUse = new Map();                                            // `${N}:${cell}` → n
  const catZone = Object.fromEntries(EMOTION_KEYS.map((c) => [c, new Array(9).fill(0)]));

  const reserved = new Set();      // целевые слова всех заданий: в дистракторы не попадают
  const pool = (c, taken) => words.filter((w) =>
    w.category === c && !taken.has(w.id) && !reserved.has(w.id) && (o.allowRepeats || usage.get(w.id) === 0));

  /** k слов из кандидатов, ближайших к точке ref. */
  function nearest(cands, ref, k, noise = o.noise) {
    if (cands.length < k) return null;
    return cands
      .map((w) => ({ w, s: d2(vec.get(w.id), ref) + o.repeatPenalty * usage.get(w.id) + noise * rng.next() }))
      .sort((a, b) => a.s - b.s)
      .slice(0, k)
      .map((x) => x.w);
  }

  /**
   * Целевые слова подбираются «кругами»: в каждом круге по одному слову каждой
   * категории, максимально похожие друг на друга по длине и частотности
   * (и близкие к середине распределения — типичные слова).
   */
  function pickTargetRound() {
    // из каждой категории берём 80 самых «типичных» доступных слов — перебор остаётся быстрым
    const pools = EMOTION_KEYS.map((c) => words
      .filter((w) => w.category === c && !reserved.has(w.id) && (o.allowRepeats || usage.get(w.id) === 0))
      .map((w) => ({ w, s: d2(vec.get(w.id), ZERO) + o.repeatPenalty * usage.get(w.id) }))
      .sort((a, b) => a.s - b.s)
      .slice(0, 80)
      .map((x) => x.w));
    if (pools.some((p) => !p.length)) return null;
    let best = null;
    for (let s = 0; s < 4; s++) {
      for (const a of pools[s]) {
        const tuple = pools.map((p, t) => {
          if (t === s) return a;
          let bw = null, bd = Infinity;
          for (const x of p) {
            const d = d2(vec.get(a.id), vec.get(x.id)) + o.repeatPenalty * usage.get(x.id);
            if (d < bd) { bd = d; bw = x; }
          }
          return bw;
        });
        const vs = tuple.map((w) => vec.get(w.id));
        const mean = ZERO.map((_, j) => vs.reduce((acc, v) => acc + v[j], 0) / 4);
        const spread = vs.reduce((acc, v) => acc + d2(v, mean), 0) / 4;
        const cost = spread + 0.5 * d2(mean, ZERO);
        if (!best || cost < best.cost) best = { cost, tuple };
      }
    }
    return best.tuple;
  }

  function placeTarget(N, grid, cat) {
    const total = grid.rows * grid.cols;
    let best = null;
    for (let cell = 0; cell < total; cell++) {
      const r = Math.floor(cell / grid.cols), c = cell % grid.cols;
      const zone = Math.min(2, Math.floor((r / grid.rows) * 3)) * 3 + Math.min(2, Math.floor((c / grid.cols) * 3));
      const cost = 2 * (cellUse.get(`${N}:${cell}`) || 0) + catZone[cat][zone] + rng.next() * 0.5;
      if (!best || cost < best.cost) best = { cost, cell, zone };
    }
    cellUse.set(`${N}:${best.cell}`, (cellUse.get(`${N}:${best.cell}`) || 0) + 1);
    catZone[cat][best.zone]++;
    return best.cell;
  }

  function build(job) {
    const { type, N, category: tc } = job;
    const taken = new Set();
    const t = job.target;
    if (!t) return null;
    taken.add(t.id);
    const tv = vec.get(t.id);

    // сколько дистракторов из какой категории
    let quota;
    if (type === 'control') {
      quota = { [tc]: N - 1 };
    } else if (o.distractorMode === 'all') {
      quota = splitEvenly(EMOTION_KEYS, N, extra);
      quota[tc] -= 1;                          // целевое слово уже учтено в своей категории
    } else {
      quota = splitEvenly(EMOTION_KEYS.filter((c) => c !== tc), N - 1, extra);
    }

    const picked = [];
    for (const [c, k] of Object.entries(quota)) {
      if (k <= 0) continue;
      const got = nearest(pool(c, taken), tv, k);
      if (!got) return null;
      got.forEach((w) => { taken.add(w.id); picked.push(w); });
    }
    // счётчики меняем только после успеха
    return { type, N, category: tc, target: t, distractors: picked };
  }

  // «лишние» слова при неделимом числе: передаём той категории, у которой их меньше всего
  function splitEvenly(cats, total, extraCnt) {
    const base = Math.floor(total / cats.length);
    const rem = total - base * cats.length;
    const order = rng.shuffle(cats).sort((a, b) => extraCnt[a] - extraCnt[b]);
    const out = Object.fromEntries(cats.map((c) => [c, base]));
    order.slice(0, rem).forEach((c) => { out[c]++; extraCnt[c]++; });
    return out;
  }

  const jobs = [];
  for (const N of o.levels) {
    for (const c of EMOTION_KEYS) {
      for (let i = 0; i < o.controlPerCategory; i++) jobs.push({ type: 'control', N, category: c, rep: i });
      for (let i = 0; i < o.experimentalPerCategory; i++) jobs.push({ type: 'experimental', N, category: c, rep: i });
    }
  }
  const requested = jobs.length;
  const built = [];
  const failed = [];

  // круги целевых слов: каждому «слоту» (уровень × номер повторения) — по слову на категорию
  const bySlot = new Map();
  for (const job of jobs) {
    const key = `${job.N}:${job.type}:${job.rep}`;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push(job);
  }
  for (const group of bySlot.values()) {
    const tuple = pickTargetRound();
    if (tuple) tuple.forEach((w) => reserved.add(w.id));
    for (const job of group) job.target = tuple ? tuple[EMOTION_KEYS.indexOf(job.category)] : null;
  }

  for (const job of rng.shuffle(jobs)) {
    // состояние extra сохраняем: при неудаче откатываем
    const snapshot = { ...extra };
    const res = build(job);
    if (!res) { Object.assign(extra, snapshot); failed.push(job); continue; }
    for (const w of [res.target, ...res.distractors]) usage.set(w.id, usage.get(w.id) + 1);
    built.push(res);
  }

  if (failed.length) {
    const n = failed.length;
    warnings.push(`Не удалось собрать стимулов: ${n} из ${requested}. ` +
      (o.allowRepeats ? 'В одной из категорий слов меньше, чем нужно для уровня.' :
        'Слова закончились — включите повторы или загрузите больше слов.'));
  }

  // раскладка по сетке (после отбора — в порядке имён, чтобы счётчики позиций были детерминированы)
  built.sort((a, b) => a.N - b.N ||
    (a.type === b.type ? 0 : a.type === 'control' ? -1 : 1) ||
    EMOTION_KEYS.indexOf(a.category) - EMOTION_KEYS.indexOf(b.category));
  const counters = new Map();
  for (const st of built) {
    const grid = gridFor(st.N, o.layoutArea?.w ?? 1920, o.layoutArea?.h ?? 900);
    const total = grid.rows * grid.cols;
    const targetCell = placeTarget(st.N, grid, st.category);
    const free = rng.shuffle([...Array(total).keys()].filter((c) => c !== targetCell));
    const cells = [{ w: st.target, cell: targetCell, isTarget: true },
      ...st.distractors.map((w, i) => ({ w, cell: free[i], isTarget: false }))];
    st.grid = grid;
    st.cells = cells.map((c) => ({
      item: c.w, cell: c.cell, isTarget: c.isTarget,
      jx: rng.range(-1, 1), jy: rng.range(-1, 1),     // единичные смещения; масштабируются при отрисовке
    })).sort((a, b) => a.cell - b.cell);
    st.targetCell = targetCell;
    const key = `${st.type}/${st.N}/${st.category}`;
    const idx = (counters.get(key) || 0) + 1;
    counters.set(key, idx);
    st.index = idx;
    st.distractorMode = st.type === 'control' ? 'same' : o.distractorMode;
    st.name = wordStimulusName(st, idx);
  }

  return { stimuli: built, warnings, requested, built: built.length, feasibility };
}

export function wordStimulusName(st, idx) {
  const cat = EMOTIONS.find((e) => e.key === st.category).slug;
  const nn = String(idx).padStart(2, '0');
  if (st.type === 'control') return `word_ctrl_${st.N}w_${cat}_${nn}`;
  const mode = st.distractorMode === 'all' ? '_dist-all' : '';
  return `word_exp_${st.N}w_target-${cat}${mode}_${nn}`;
}

/* ---------------- отчёт о балансе ---------------- */

/** Длина и логарифм частотности по категориям (все слова / только целевые) + ANOVA. */
export function balanceReport(stimuli) {
  const all = new Map();
  const targets = new Map();
  for (const st of stimuli) {
    all.set(st.target.id, st.target);
    targets.set(`${st.name}`, st.target);
    for (const d of st.distractors) all.set(d.id, d);
  }
  const make = (list, label) => {
    const metrics = [['len', (w) => w.len], ['logfreq', (w) => logFreq(w.freq)]];
    return metrics.map(([m, f]) => {
      const perCat = EMOTION_KEYS.map((c) => {
        const v = list.filter((w) => w.category === c).map(f).filter((x) => x != null && Number.isFinite(x));
        return { category: c, n: v.length, mean: meanOf(v), sd: sdOf(v), values: v };
      });
      const hasData = perCat.every((p) => p.n > 0);
      return {
        scope: label, metric: m,
        perCat: perCat.map(({ values, ...r }) => r),
        anova: hasData ? oneWayAnova(perCat.map((p) => p.values)) : null,
      };
    });
  };
  return [...make([...all.values()], 'all'), ...make([...targets.values()], 'targets')];
}
