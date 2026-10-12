/* ============================================================
   images/generator.js — подбор стимулов 2×2 из изображений.
   Чистая логика без DOM (тестируется в Node).

   Контрольный стимул: 4 изображения ОДНОЙ эмоциональной категории
   и одной группы (человек / группа людей / животные / предметы).
   Экспериментальный: 4 изображения РАЗНЫХ категорий одной группы,
   положения категорий по ячейкам выровнены по всему набору.

   Внутри стимула изображения подбираются так, чтобы низкоуровневая
   салиентность (z-оценки выбранных метрик) различалась как можно
   меньше: иначе эффект эмоции нельзя отделить от «яркости» картинки.
   ============================================================ */

import { makeRng, permutations } from '../../common/rng.js';
import { EMOTIONS, EMOTION_KEYS } from '../../common/emotions.js';
import { oneWayAnova, meanOf, sdOf } from '../../core/stats.js';

export const GROUPS = [
  { key: 'person',  ru: 'Один человек',   slug: 'person',
    aliases: ['person', 'single', 'one', 'portrait', 'human', 'человек', 'один', 'однолюдей', 'одинчеловек', 'портрет'] },
  { key: 'people',  ru: 'Группа людей',   slug: 'people',
    aliases: ['people', 'group', 'crowd', 'persons', 'группа', 'группалюдей', 'люди', 'толпа'] },
  { key: 'animals', ru: 'Животные',       slug: 'animals',
    aliases: ['animal', 'animals', 'животные', 'животное'] },
  { key: 'objects', ru: 'Предметы',       slug: 'objects',
    aliases: ['object', 'objects', 'item', 'items', 'thing', 'предметы', 'предмет', 'объекты', 'объект'] },
];
export const GROUP_KEYS = GROUPS.map((g) => g.key);
export const GROUP_BY_KEY = Object.fromEntries(GROUPS.map((g) => [g.key, g]));

export const POSITIONS = ['TL', 'TR', 'BL', 'BR'];
export const SAL_KEYS = ['mean', 'entropy', 'center_bias', 'spread_pct'];
export const SAL_LABELS = {
  mean: 'средняя салиентность',
  entropy: 'энтропия карты',
  center_bias: 'смещение к центру',
  spread_pct: 'доля заметной площади, %',
};

const norm = (s) => String(s).toLowerCase().replace(/[^a-zа-яё0-9]/g, '');

/** Группа по значению ячейки CSV («группа людей», «animals», …). */
export function parseGroup(text) {
  const t = norm(text || '');
  if (!t) return null;
  for (const g of GROUPS) if (g.aliases.some((a) => norm(a) === t)) return g.key;
  return null;
}

/** Группа по префиксу имени файла: `animals_01.jpg`, `person-12.png`, `объекты 3.jpg`. */
export function groupFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  const first = base.split(/[_\-\s.0-9]+/).find(Boolean);
  return first ? parseGroup(first) : null;
}

export const DEFAULT_OPTIONS = {
  groups: GROUP_KEYS,
  controlPerCategory: 1,       // контрольных на каждую категорию в каждой группе
  experimentalPerGroup: 4,     // экспериментальных на каждую группу
  allowRepeats: false,
  metrics: SAL_KEYS,
  seed: 1,
  repeatPenalty: 1.5,          // «штраф» за повторное использование изображения (в ед. z²)
  attempts: 12,                // сколько раз пробовать с разными случайными порядками и брать лучший по балансу
};

/* ---------------- проверка выполнимости ---------------- */

/** Сколько изображений нужно и сколько есть — по каждой паре группа × категория. */
export function checkFeasibility(items, options) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const rows = [];
  const warnings = [];
  for (const g of o.groups) {
    for (const c of EMOTION_KEYS) {
      const have = items.filter((it) => it.group === g && it.category === c).length;
      const needPerUse = o.controlPerCategory * 4 + o.experimentalPerGroup;
      // без повторов все стимулы делят один пул; с повторами нужно лишь 4 разных на контрольный
      const need = o.allowRepeats
        ? (o.controlPerCategory > 0 ? 4 : (o.experimentalPerGroup > 0 ? 1 : 0))
        : needPerUse;
      rows.push({ group: g, category: c, have, need, ok: have >= need });
    }
  }
  for (const r of rows.filter((x) => !x.ok)) {
    const gl = GROUP_BY_KEY[r.group].ru;
    const cl = EMOTIONS.find((e) => e.key === r.category).ru.toLowerCase();
    warnings.push(
      `Группа «${gl}», категория «${cl}»: есть ${r.have}, нужно ${r.need}` +
      (o.allowRepeats ? '' : ' (без повторов)') + '.');
  }
  return { rows, warnings, ok: warnings.length === 0 };
}

/* ---------------- вспомогательное ---------------- */

function zVectors(items, metrics) {
  const stats = metrics.map((m) => {
    const v = items.map((it) => it.sal[m]).filter(Number.isFinite);
    const mu = meanOf(v);
    const sd = sdOf(v);
    return { mu, sd: sd > 0 ? sd : 1 };
  });
  const map = new Map();
  for (const it of items) {
    map.set(it.id, metrics.map((m, i) => {
      const x = it.sal[m];
      return Number.isFinite(x) ? (x - stats[i].mu) / stats[i].sd : 0;
    }));
  }
  return map;
}

const d2 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s; };

function spreadCost(vs) {
  const k = vs.length, n = vs[0].length;
  let cost = 0;
  for (let j = 0; j < n; j++) {
    let mu = 0;
    for (const v of vs) mu += v[j];
    mu /= k;
    for (const v of vs) cost += (v[j] - mu) ** 2;
  }
  return cost / k;
}

/* ---------------- основная функция ---------------- */

/**
 * items: [{ id, name, group, category, sal:{mean,...} }]
 * Возвращает { stimuli, warnings, requested, built, feasibility }.
 */
export function generateImageStimuli(allItems, options) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  let best = null;
  for (let k = 0; k < Math.max(1, o.attempts); k++) {
    const res = generateOnce(allItems, { ...o, seed: o.seed + k * 7919 });
    // главное — собрать все стимулы; затем — чтобы категории не различались по салиентности
    const ps = res.stimuli.length ? balanceReport(res.stimuli, o.metrics).map((r) => (r.anova ? r.anova.p : 1)) : [1];
    res.quality = Math.min(...ps);
    res.seedUsed = o.seed + k * 7919;
    if (!best || res.built > best.built || (res.built === best.built && res.quality > best.quality)) best = res;
  }
  return best;
}

function generateOnce(allItems, o) {
  const rng = makeRng(o.seed);
  const items = allItems.filter((it) => it.category && it.group && o.groups.includes(it.group));
  const feasibility = checkFeasibility(items, o);
  const warnings = [...feasibility.warnings];
  const vec = zVectors(items, o.metrics);
  const byId = new Map(items.map((it) => [it.id, it]));
  const usage = new Map(items.map((it) => [it.id, 0]));
  const itemPos = new Map(items.map((it) => [it.id, [0, 0, 0, 0]]));
  const posCount = Object.fromEntries(EMOTION_KEYS.map((c) => [c, [0, 0, 0, 0]]));
  const groupPerms = new Map();           // `${group}` → Map(permKey → n)
  const perms = permutations([0, 1, 2, 3]);

  const pool = (g, c) => items.filter((it) =>
    it.group === g && it.category === c && (o.allowRepeats || usage.get(it.id) === 0));
  const pen = (it) => o.repeatPenalty * usage.get(it.id);

  /** 4 изображений из 4 разных пулов: минимум разброса салиентности. */
  function pickExperimental(pools) {
    if (pools.some((p) => !p.length)) return null;
    let best = null;
    for (let s = 0; s < 4; s++) {
      for (const a of pools[s]) {
        const chosen = [];
        let ok = true;
        for (let t = 0; t < 4; t++) {
          if (t === s) { chosen.push(a); continue; }
          let bx = null, bd = Infinity;
          for (const x of pools[t]) {
            const d = d2(vec.get(a.id), vec.get(x.id)) + pen(x) + rng.next() * 1e-6;
            if (d < bd) { bd = d; bx = x; }
          }
          if (!bx) { ok = false; break; }
          chosen.push(bx);
        }
        if (!ok) continue;
        // chosen уложен в порядке слотов (индекс = категория)
        const ordered = [];
        for (let t = 0; t < 4; t++) ordered[t] = t === s ? a : chosen[t];
        const cost = spreadCost(ordered.map((x) => vec.get(x.id))) +
          ordered.reduce((acc, x) => acc + pen(x), 0) / 4;
        if (!best || cost < best.cost) best = { cost, items: ordered };
      }
    }
    return best && best.items;
  }

  /** 4 изображения одного пула: минимум разброса салиентности. */
  function pickControl(cands) {
    if (cands.length < 4) return null;
    let best = null;
    for (const a of cands) {
      const others = cands.filter((x) => x !== a)
        .map((x) => ({ x, d: d2(vec.get(a.id), vec.get(x.id)) + pen(x) + rng.next() * 1e-6 }))
        .sort((p, q) => p.d - q.d)
        .slice(0, 3)
        .map((p) => p.x);
      const four = [a, ...others];
      const cost = spreadCost(four.map((x) => vec.get(x.id))) +
        four.reduce((acc, x) => acc + pen(x), 0) / 4;
      if (!best || cost < best.cost) best = { cost, items: four };
    }
    return best.items;
  }

  /** Перестановка «слот → ячейка» с наименьшим перекосом счётчиков. */
  function choosePerm(group, slotItems, slotCats) {
    const seen = groupPerms.get(group) || new Map();
    groupPerms.set(group, seen);
    let best = null;
    for (const p of perms) {
      let cost = rng.next() * 1e-3;
      for (let s = 0; s < 4; s++) {
        if (slotCats) cost += 2 * posCount[slotCats[s]][p[s]];
        cost += 3 * itemPos.get(slotItems[s].id)[p[s]];
      }
      cost += 2 * (seen.get(p.join('')) || 0);
      if (!best || cost < best.cost) best = { cost, p };
    }
    seen.set(best.p.join(''), (seen.get(best.p.join('')) || 0) + 1);
    return best.p;
  }

  function commit(group, type, slotItems, slotCats) {
    const p = choosePerm(group, slotItems, slotCats);
    const layout = new Array(4);
    slotItems.forEach((it, s) => {
      layout[p[s]] = { pos: POSITIONS[p[s]], itemId: it.id, category: it.category };
      usage.set(it.id, usage.get(it.id) + 1);
      itemPos.get(it.id)[p[s]]++;
      if (slotCats) posCount[slotCats[s]][p[s]]++;
    });
    return { type, group, layout };
  }

  // задания в случайном порядке — чтобы «лучшие» изображения не уходили всегда в один тип
  const jobs = [];
  for (const g of o.groups) {
    for (let i = 0; i < o.experimentalPerGroup; i++) jobs.push({ type: 'experimental', group: g });
    for (const c of EMOTION_KEYS) {
      for (let i = 0; i < o.controlPerCategory; i++) jobs.push({ type: 'control', group: g, category: c });
    }
  }
  const requested = jobs.length;
  const built = [];
  const failed = { experimental: new Map(), control: new Map() };

  for (const job of rng.shuffle(jobs)) {
    if (job.type === 'experimental') {
      const chosen = pickExperimental(EMOTION_KEYS.map((c) => pool(job.group, c)));
      if (!chosen) {
        failed.experimental.set(job.group, (failed.experimental.get(job.group) || 0) + 1);
        continue;
      }
      built.push(commit(job.group, 'experimental', chosen, EMOTION_KEYS));
    } else {
      const chosen = pickControl(pool(job.group, job.category));
      if (!chosen) {
        const k = `${job.group}/${job.category}`;
        failed.control.set(k, (failed.control.get(k) || 0) + 1);
        continue;
      }
      const st = commit(job.group, 'control', chosen, null);
      st.category = job.category;
      built.push(st);
    }
  }

  for (const [g, n] of failed.experimental) {
    warnings.push(`Не удалось собрать экспериментальных стимулов для группы «${GROUP_BY_KEY[g].ru}»: ${n} из ${o.experimentalPerGroup}. ` +
      (o.allowRepeats ? 'Не хватает изображений в одной из категорий.' : 'Изображения закончились; включите повторы или загрузите больше.'));
  }
  for (const [k, n] of failed.control) {
    const [g, c] = k.split('/');
    warnings.push(`Не удалось собрать контрольных стимулов «${GROUP_BY_KEY[g].ru} / ${EMOTIONS.find((e) => e.key === c).ru.toLowerCase()}»: ${n}.`);
  }

  // имена: порядок группа → тип → категория → номер
  built.sort((a, b) =>
    GROUP_KEYS.indexOf(a.group) - GROUP_KEYS.indexOf(b.group) ||
    (a.type === b.type ? 0 : a.type === 'control' ? -1 : 1) ||
    (EMOTION_KEYS.indexOf(a.category) - EMOTION_KEYS.indexOf(b.category)));
  const counter = new Map();
  for (const st of built) {
    const key = `${st.type}/${st.group}/${st.category || ''}`;
    const idx = (counter.get(key) || 0) + 1;
    counter.set(key, idx);
    st.index = idx;
    st.name = stimulusName(st, idx, st.type === 'experimental'
      ? built.filter((x) => x.type === 'experimental' && x.group === st.group).indexOf(st) + 1
      : idx);
    st.items = st.layout.map((cell) => byId.get(cell.itemId));
  }

  return { stimuli: built, warnings, requested, built: built.length, feasibility };
}

/** Уникальное английское имя из характеристик стимула. */
export function stimulusName(st, idxInKey, idxInGroup) {
  const g = GROUP_BY_KEY[st.group].slug;
  const nn = String(st.type === 'experimental' ? idxInGroup : idxInKey).padStart(2, '0');
  if (st.type === 'control') {
    const cat = EMOTIONS.find((e) => e.key === st.category).slug;
    return `img_ctrl_${g}_${cat}_${nn}`;
  }
  const lay = POSITIONS.map((pos) => {
    const cell = st.layout.find((c) => c.pos === pos);
    return `${pos}-${EMOTIONS.find((e) => e.key === cell.category).short}`;
  }).join('_');
  return `img_exp_${g}_${nn}_${lay}`;
}

/* ---------------- отчёт о балансе ---------------- */

/**
 * Для использованных изображений: средние и SD метрик по эмоциональным категориям
 * и однофакторный ANOVA (категория → метрика). p > .05 желательно.
 */
export function balanceReport(stimuli, metrics = SAL_KEYS) {
  const used = new Map();
  for (const st of stimuli) for (const it of st.items) used.set(it.id, it);
  const list = [...used.values()];
  return metrics.map((m) => {
    const perCat = EMOTION_KEYS.map((c) => {
      const v = list.filter((it) => it.category === c).map((it) => it.sal[m]).filter(Number.isFinite);
      return { category: c, n: v.length, mean: meanOf(v), sd: sdOf(v), values: v };
    });
    const anova = oneWayAnova(perCat.map((p) => p.values));
    return { metric: m, perCat: perCat.map(({ values, ...r }) => r), anova };
  });
}
