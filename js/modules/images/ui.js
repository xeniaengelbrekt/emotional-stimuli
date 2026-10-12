/* ============================================================
   images/ui.js — «Эмоционально окрашенные изображения · создание стимулов»
   ============================================================ */

import { $, $$, esc, tick, bindDropzone, downloadText, readText, fmt } from '../../common/ui.js';
import { parseCSV, parseNum, findColumn, toCSV } from '../../common/csv.js';
import { EMOTIONS, EMOTION_KEYS, EMOTION_BY_KEY, EMOTION_ALIASES, classifyEmotion, scaleStats } from '../../common/emotions.js';
import { loadImageFiles } from '../../core/loader.js';
import { computeSaliency } from '../../core/algorithms/index.js';
import { computeMetrics } from '../../core/metrics.js';
import { formatP, meanOf, sdOf, oneWayAnova as oneWay } from '../../core/stats.js';
import { toastError, toastSuccess, toastInfo } from '../../core/toast.js';
import { fld, readCheck } from '../../kit/fields.js';
import { panelHead, stepTitle, card, grid, sep, sub, generateBar, alertBox } from '../../kit/panel.js';
import { instructionEditorHtml, mountInstructionEditor, drawInstructionText } from '../../kit/instr.js';
import { mountResults, metricTable } from '../../kit/results.js';
import { evaluateSalience, relativeAoiSalience, salienceBalance, METHOD_LABELS, SAL_NAMES } from '../../kit/salience.js';
import { meanLuminance as stimLuminance } from '../../kit/luminance.js';
import { BG, FG, NEXT_LINE, START_LINE } from '../../kit/defaults.js';
import * as M from '../../kit/methods.js';
import {
  GROUPS, GROUP_KEYS, GROUP_BY_KEY, POSITIONS, SAL_KEYS, SAL_LABELS,
  parseGroup, groupFromFilename, generateImageStimuli, checkFeasibility, balanceReport,
} from './generator.js';
import { tileRects, drawImageStimulus, cropShare } from './render.js';

const state = {
  items: [],
  ratings: new Map(),      // ключ имени файла → { ratings, group }
  nextId: 1,
  busy: false,
};
let editor = null;

const REALISM_ALIASES = ['realism', 'realistic', 'реалистичность', 'реалистичный', 'реализм'];
const GROUP_COL_ALIASES = ['group', 'category', 'группа', 'категория', 'тип', 'type'];
const FILE_COL_ALIASES = ['file', 'filename', 'image', 'img', 'name', 'файл', 'имяфайла', 'изображение', 'имя'];

const keyOf = (name) => name.replace(/\.[^.]+$/, '').trim().toLowerCase();

const INSTRUCTION = [
  'На экране будут появляться по четыре изображения.',
  'Рассматривайте их так, как вам удобно.',
  '',
  'Когда рассмотрите, щёлкните левой кнопкой мыши по тому изображению, которое привлекло ваше внимание больше всего.',
  '',
  NEXT_LINE,
  START_LINE,
].join('\n');

/* ---------------- чтение формы ---------------- */

const num = (id, dflt) => {
  const v = parseNum($(id).value);
  return v == null ? dflt : v;
};

const AUTO_RATIOS = [1, 5 / 4, 4 / 3, 3 / 2, 16 / 9];
const RATIO_OPTIONS = [['auto', 'Автоматически — по самым частым изображениям'], ['1.333333', '4 : 3'], ['1.5', '3 : 2'], ['1.777778', '16 : 9'], ['1.25', '5 : 4'], ['1', '1 : 1 (квадрат)']];

/** Формат рамки: заданный или самый частый среди загруженных изображений (ближайший из стандартных). */
function resolveRatio() {
  const v = $('#img-ratio').value;
  if (v !== 'auto') return Number(v);
  const counts = new Map();
  for (const it of state.items) {
    const r = AUTO_RATIOS.reduce((best, x) => (Math.abs(x - it.w / it.h) < Math.abs(best - it.w / it.h) ? x : best), AUTO_RATIOS[0]);
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  if (!counts.size) return 4 / 3;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function readLayout() {
  return {
    width: Math.max(320, Math.round(num('#img-w', 1920))),
    height: Math.max(240, Math.round(num('#img-h', 1080))),
    gap: Math.max(0, Math.round(num('#img-gap', 60))),
    margin: Math.max(0, Math.round(num('#img-margin', 40))),
    ratio: resolveRatio(),
    background: $('#img-bg').value,
  };
}

function readOptions() {
  const groups = $$('#img-groups input:checked').map((i) => i.value);
  const metrics = $$('#img-metrics input:checked').map((i) => i.value);
  return {
    groups,
    metrics: metrics.length ? metrics : SAL_KEYS,
    controlPerCategory: Math.max(0, Math.round(num('#img-ctrl', 1))),
    experimentalPerGroup: Math.max(0, Math.round(num('#img-exp', 4))),
    allowRepeats: $('#img-repeats').checked,
    seed: Math.round(num('#img-seed', 1)),
  };
}

/* ---------------- категории ---------------- */

function recomputeCategories() {
  const opts = {
    margin: Math.max(0, num('#img-margin-cat', 0)),
    zStats: $('#img-zscale').checked ? scaleStats(state.items) : null,
  };
  const minReal = parseNum($('#img-minreal').value);
  for (const it of state.items) {
    it.category = classifyEmotion(it.ratings, opts);
    it.excluded = null;
    if (it.category && minReal != null && it.ratings.realism != null && it.ratings.realism < minReal) {
      it.excluded = 'низкая реалистичность';
      it.category = null;
    }
  }
}

function refreshDerived() {
  recomputeCategories();
  $$('#img-table tbody tr').forEach((tr) => {
    const it = state.items.find((x) => x.id === tr.dataset.id);
    if (it) tr.querySelector('.cat-cell').innerHTML = catChip(it);
  });
  renderFeasibility();
}

const catChip = (it) => {
  if (it.category) {
    const e = EMOTION_BY_KEY[it.category];
    return `<span class="emo-chip" style="--c:${e.color}">${e.ru}</span>`;
  }
  return `<span class="emo-chip emo-none" title="${esc(it.excluded || 'нет оценок или шкалы равны')}">${esc(it.excluded || '—')}</span>`;
};

/* ---------------- загрузка изображений ---------------- */

async function addFiles(files) {
  if (state.busy) return;
  const imgs = files.filter((f) => /\.(jpe?g|png|webp|bmp)$/i.test(f.name));
  if (!imgs.length) { toastError('Нужны файлы JPG, PNG, WebP или BMP'); return; }
  state.busy = true;
  setBusy(true, 'Загрузка изображений…');
  const { ok, errors } = await loadImageFiles(imgs);
  errors.forEach((e) => toastError(e.message));
  const method = $('#img-method').value;
  let done = 0;
  for (const r of ok) {
    const key = keyOf(r.name);
    if (state.items.some((it) => keyOf(it.name) === key)) { toastInfo(`Пропущен дубликат: ${r.name}`); continue; }
    setBusy(true, `Оценка салиентности (${method.toUpperCase()}): ${++done} из ${ok.length}`);
    await tick();
    const sal = computeSaliency(r.imageData, method);
    const m = computeMetrics(sal, sal.width, sal.height);
    const lum = workingLuminance(r.imageData);
    const fromCsv = state.ratings.get(key);
    state.items.push({
      id: `i${state.nextId++}`, name: r.name, thumb: r.thumb, img: r.origImage, w: r.origW, h: r.origH,
      method, lum,
      group: fromCsv?.group ?? groupFromFilename(r.name),
      ratings: { ...blankRatings(), ...(fromCsv?.ratings || {}) },
      metrics: Object.fromEntries(SAL_KEYS.map((k) => [k, m[k]])),
      category: null, excluded: null,
    });
  }
  state.busy = false;
  setBusy(false);
  invalidateResult();
  renderTable();
  toastSuccess(`Загружено изображений: ${done}`);
}

/** Средняя относительная яркость рабочей копии изображения, 0–1 (Rec. 709 по значениям sRGB). */
function workingLuminance(imageData) {
  const d = imageData.data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return Number((s / (d.length / 4) / 255).toFixed(4));
}

const blankRatings = () => ({ neutral: null, positive: null, sad: null, threat: null, realism: null });

async function recomputeSalience() {
  if (!state.items.length || state.busy) return;
  const method = $('#img-method').value;
  if (state.items.every((it) => it.method === method)) return;
  state.busy = true;
  let i = 0;
  for (const it of state.items) {
    setBusy(true, `Пересчёт салиентности (${method.toUpperCase()}): ${++i} из ${state.items.length}`);
    await tick();
    // рабочая копия строится заново из оригинала
    const c = document.createElement('canvas');
    const k = 256 / Math.max(it.w, it.h);
    c.width = Math.max(8, Math.round(it.w * k)); c.height = Math.max(8, Math.round(it.h * k));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(it.img, 0, 0, c.width, c.height);
    const sal = computeSaliency(ctx.getImageData(0, 0, c.width, c.height), method);
    const m = computeMetrics(sal, sal.width, sal.height);
    it.metrics = Object.fromEntries(SAL_KEYS.map((key) => [key, m[key]]));
    it.method = method;
  }
  state.busy = false;
  setBusy(false);
  invalidateResult();
  renderTable();
  toastSuccess('Салиентность пересчитана');
}

function setBusy(on, text) {
  $('#img-load-busy').hidden = !on;
  if (text) $('#img-load-busy-text').textContent = text;
}

/* ---------------- оценки из CSV ---------------- */

async function loadRatingsFile(file) {
  const { columns, rows } = parseCSV(await readText(file));
  const fileCol = findColumn(columns, FILE_COL_ALIASES) || columns[0];
  const groupCol = findColumn(columns, GROUP_COL_ALIASES);
  const scaleCols = {};
  for (const k of EMOTION_KEYS) scaleCols[k] = findColumn(columns, EMOTION_ALIASES[k]);
  const realCol = findColumn(columns, REALISM_ALIASES);
  const missing = EMOTION_KEYS.filter((k) => !scaleCols[k]).map((k) => EMOTION_BY_KEY[k].ru.toLowerCase());
  if (missing.length) { toastError(`В CSV нет колонок: ${missing.join(', ')}`, 7000); return; }
  if (!realCol) toastInfo('Колонка «реалистичность» не найдена — порог реалистичности применяться не будет', 6000);

  let matched = 0;
  const seen = new Set();
  for (const r of rows) {
    const key = keyOf(r[fileCol] || '');
    if (!key) continue;
    seen.add(key);
    const ratings = {
      ...Object.fromEntries(EMOTION_KEYS.map((k) => [k, parseNum(r[scaleCols[k]])])),
      realism: realCol ? parseNum(r[realCol]) : null,
    };
    const group = groupCol ? parseGroup(r[groupCol]) : null;
    state.ratings.set(key, { ratings, group });
    const it = state.items.find((x) => keyOf(x.name) === key);
    if (it) {
      it.ratings = ratings;
      if (group) it.group = group;
      matched++;
    }
  }
  const noRatings = state.items.filter((it) => !seen.has(keyOf(it.name))).length;
  $('#img-ratings-info').textContent =
    `${file.name}: строк ${rows.length}, сопоставлено с изображениями ${matched}` +
    (state.items.length ? `, без оценок ${noRatings}` : ' (изображения ещё не загружены — оценки применятся при загрузке)');
  if (!state.items.length) toastSuccess('Оценки прочитаны');
  else if (noRatings) toastInfo(`Оценки применены к ${matched} изображениям, без оценок: ${noRatings}`, 6000);
  else toastSuccess(`Оценки применены к ${matched} изображениям`);
  invalidateResult();
  renderTable();
}

function downloadTemplate() {
  const rows = [
    ['person_01.jpg', 'один человек', 1.2, 6.1, 1.1, 1.0, 6.5],
    ['people_01.jpg', 'группа людей', 5.8, 1.5, 1.4, 1.2, 6.8],
    ['animals_01.jpg', 'животные', 1.4, 1.3, 5.9, 1.6, 6.2],
    ['objects_01.jpg', 'предметы', 1.1, 1.2, 1.5, 6.3, 6.7],
  ].map(([file, group, neu, pos, sad, thr, real]) => ({
    'файл': file, 'группа': group, 'нейтральность': neu, 'позитивность': pos, 'грусть': sad, 'угроза': thr, 'реалистичность': real,
  }));
  downloadText(toCSV(rows), 'ratings_template.csv');
}

/* ---------------- таблица изображений ---------------- */

function renderTable() {
  recomputeCategories();
  $('#img-table-block').hidden = !state.items.length;
  $('#img-clear').disabled = !state.items.length;
  const head = `<thead><tr><th></th><th>Файл</th><th>Группа</th>${EMOTIONS.map((e) => `<th>${e.ru}</th>`).join('')}<th>Реалистичность</th><th>Эмоция</th><th>Средняя салиентность</th></tr></thead>`;
  const body = state.items.map((it) => `
    <tr data-id="${it.id}">
      <td><img class="row-thumb" src="${it.thumb}" alt=""></td>
      <td title="${esc(it.name)}">${esc(it.name)}</td>
      <td><div class="select-wrap select-cell"><select data-f="group"><option value="">—</option>${GROUPS.map((g) => `<option value="${g.key}"${it.group === g.key ? ' selected' : ''}>${g.ru}</option>`).join('')}</select></div></td>
      ${[...EMOTION_KEYS, 'realism'].map((k) => `<td><input class="cell-num" type="number" step="0.01" data-r="${k}" value="${it.ratings[k] ?? ''}"></td>`).join('')}
      <td class="cat-cell">${catChip(it)}</td>
      <td class="num">${fmt(it.metrics.mean, 4)}</td>
    </tr>`).join('');
  $('#img-table').innerHTML = head + `<tbody>${body}</tbody>`;
  const noGroup = state.items.filter((it) => !it.group).length;
  const noRat = state.items.filter((it) => EMOTION_KEYS.some((k) => it.ratings[k] == null)).length;
  $('#img-count').innerHTML = `Изображений: <strong class="hl">${state.items.length}</strong>` +
    (noGroup ? ` · без группы: <span class="warn-text">${noGroup}</span>` : '') +
    (noRat ? ` · без оценок: <span class="warn-text">${noRat}</span>` : '');
  renderFeasibility();
}

function onTableEdit(e) {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const it = state.items.find((x) => x.id === tr.dataset.id);
  if (e.target.dataset.f === 'group') it.group = e.target.value || null;
  else if (e.target.dataset.r) it.ratings[e.target.dataset.r] = parseNum(e.target.value);
  else return;
  invalidateResult();
  refreshDerived();
}

/* ---------------- выполнимость ---------------- */

function renderFeasibility() {
  const opts = readOptions();
  const eligible = state.items.filter((it) => it.group && it.category);
  const box = $('#img-feas');
  const generate = $('#img-generate');
  if (!state.items.length) {
    box.innerHTML = '';
    generate.disabled = true;
    $('#img-plan').textContent = '';
    return;
  }
  const f = checkFeasibility(eligible, opts);
  const nCtrl = opts.groups.length * 4 * opts.controlPerCategory;
  const nExp = opts.groups.length * opts.experimentalPerGroup;
  $('#img-plan').innerHTML = `План: <strong class="hl">${nCtrl}</strong> контрольных + <strong class="hl">${nExp}</strong> экспериментальных = <strong class="hl">${nCtrl + nExp}</strong>`;
  const cell = (g, c) => {
    const r = f.rows.find((x) => x.group === g && x.category === c);
    return `<td class="num ${r.ok ? 'ok-cell' : 'bad-cell'}">${r.have} / ${r.need}</td>`;
  };
  const table = `
    <div class="data-table-wrap tool-gap"><table class="data-table feas-table">
      <thead><tr><th>Доступно / нужно</th>${EMOTIONS.map((e) => `<th>${e.ru}</th>`).join('')}</tr></thead>
      <tbody>${opts.groups.map((g) => `<tr><td>${GROUP_BY_KEY[g].ru}</td>${EMOTION_KEYS.map((c) => cell(g, c)).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  const excluded = state.items.length - eligible.length;
  const notes = [];
  if (excluded) notes.push(`Не участвуют в подборе ${excluded} изображений (нет группы, оценок или не прошли порог реалистичности).`);
  box.innerHTML = `
    ${f.ok ? '' : `<div class="alert warn"><strong>Изображений не хватает для заданного числа стимулов${opts.allowRepeats ? '' : ' без повторов'}.</strong>
      <ul>${f.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      Можно загрузить больше изображений, уменьшить число стимулов или разрешить повторы. Если сформировать так, как есть, будет собрано максимум возможного.</div>`}
    ${notes.map((n) => `<div class="alert info">${esc(n)}</div>`).join('')}
    ${table}`;
  generate.disabled = !eligible.length || !opts.groups.length || nCtrl + nExp === 0;
}

/* ---------------- генерация ---------------- */

const generatorItems = () => state.items.map((it) => ({
  id: it.id, name: it.name, group: it.group, category: it.category, sal: it.metrics, ratings: it.ratings, w: it.w, h: it.h,
}));

const busy = (on, text) => { $('#img-busy').hidden = !on; if (text) $('#img-busy-text').textContent = text; };

function invalidateResult() {
  const box = $('#img-results');
  if (box && !box.hidden) { box.hidden = true; box.innerHTML = ''; }
}

async function generate() {
  const opts = readOptions();
  const L = readLayout();
  const salOn = readCheck('img-sal-on');
  const method = $('#img-method').value;
  const btn = $('#img-generate');
  btn.disabled = true;
  busy(true, 'Подбор стимулов…');
  try {
    await tick();
    const res = generateImageStimuli(generatorItems(), opts);
    if (!res.stimuli.length) throw new Error('Не удалось собрать ни одного стимула — проверьте таблицу «доступно / нужно» и назначенные группы и оценки');
    const byId = new Map(state.items.map((it) => [it.id, it]));
    const imgOf = (id) => byId.get(id).img;
    const tiles = tileRects(L);
    const stimuli = res.stimuli.map((st) => {
      const obj = {
        ...st, filter: st.type, tag: st.type === 'control' ? 'контроль' : 'эксперимент',
        draw: (canvas, scale = 1) => drawImageStimulus(canvas, st, imgOf,
          scale === 1 ? L : { ...L, width: Math.round(L.width * scale), height: Math.round(L.height * scale), gap: L.gap * scale, margin: L.margin * scale }),
      };
      obj.aoi = st.layout.map((c) => ({ pos: c.pos, itemId: c.itemId, ...tiles[c.pos] }));
      return obj;
    });
    if (salOn) {
      let i = 0;
      for (const st of stimuli) {
        busy(true, `Оценка салиентности стимулов (${method.toUpperCase()}): ${++i} из ${stimuli.length}`);
        await tick();
        const ev = evaluateSalience(st, L.width, L.height, method);
        st.sal = ev.metrics;
        st.rel = st.aoi.map((r) => relativeAoiSalience(ev.map, r, L.width, L.height));
      }
    }
    for (const st of stimuli) {
      const legend = POSITIONS.map((pos) => {
        const c = st.layout.find((x) => x.pos === pos);
        return `<i style="background:${EMOTION_BY_KEY[c.category].color}" title="${EMOTION_BY_KEY[c.category].ru}"></i>`;
      }).join('');
      st.badges = `<span>${GROUP_BY_KEY[st.group].ru}</span><span class="mini-grid">${legend}</span>`;
      const trs = st.layout.map((c, k) => {
        const it = byId.get(c.itemId); const e = EMOTION_BY_KEY[c.category];
        return `<tr><td>${c.pos}</td><td>${esc(it.name)}</td><td><span class="emo-chip" style="--c:${e.color}">${e.ru}</span></td><td class="num">${fmt(it.metrics.mean, 4)}</td>${st.rel ? `<td class="num">${fmt(st.rel[st.aoi.findIndex((a) => a.pos === c.pos)], 3)}</td>` : ''}</tr>`;
      }).join('');
      st.infoHtml = `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Ячейка</th><th>Файл</th><th>Эмоция</th><th>Салиентность картинки (средняя)</th>${st.rel ? '<th>Относительная салиентность в стимуле</th>' : ''}</tr></thead><tbody>${trs}</tbody></table></div>`;
    }
    showResults(res, stimuli, opts, L, salOn, method, tiles, byId);
    toastSuccess(`Собрано стимулов: ${stimuli.length}`);
  } catch (e) {
    console.error(e);
    toastError(`Не удалось сформировать стимулы: ${e.message}`, 7000);
  } finally {
    busy(false);
    btn.disabled = false;
    renderFeasibility();
  }
}

const f3 = (v) => (v == null || !Number.isFinite(v) ? '' : Number(v.toFixed(3)));

/** Строки «показатель × эмоция»: среднее ± SD по изображениям и ANOVA. */
function categoryRows(items, getters) {
  return getters.map(([label, get]) => {
    const vals = EMOTION_KEYS.map((c) => items.filter((it) => it.category === c).map(get).filter(Number.isFinite));
    const a = oneWay(vals);
    return { label, cells: vals.map((v) => ({ n: v.length, mean: meanOf(v), sd: sdOf(v) })), extra: a ? `F(${a.df1}, ${a.df2}) = ${a.F.toFixed(2)}, p ${formatP(a.p).startsWith('<') ? formatP(a.p) : '= ' + formatP(a.p)}` : '—', extraBad: a ? a.p < 0.05 : false };
  });
}

function showResults(res, stimuli, opts, L, salOn, method, tiles, byId) {
  const W = L.width; const H = L.height;
  const usedIds = [...new Set(stimuli.flatMap((s) => s.layout.map((c) => c.itemId)))];
  const usedItems = usedIds.map((id) => byId.get(id));
  const uses = new Map();
  for (const st of stimuli) for (const c of st.layout) uses.set(c.itemId, (uses.get(c.itemId) || 0) + 1);
  const crops = usedItems.map((it) => ({ it, share: cropShare(it.w, it.h, L.ratio) }));
  const warnings = [...res.warnings];
  const heavy = crops.filter((c) => c.share > 0.05);
  if (heavy.length) warnings.push(`У ${heavy.length} изображений формат отличается от формата рамки (${L.ratio.toFixed(2)}): края обрезаются по центру, до ${Math.round(Math.max(...heavy.map((c) => c.share)) * 100)}% площади. Чтобы не обрезать, выберите формат рамки как у ваших изображений или подготовьте изображения заранее.`);

  const ctrl = stimuli.filter((s) => s.type === 'control').length;
  const rows = stimuli.map((st) => {
    const r = {
      stimulus: st.name, type: st.type, group: st.group,
      emotion_category: st.type === 'control' ? st.category : 'mixed',
      width: W, height: H, tile_w: tiles.TL.w, tile_h: tiles.TL.h, gap_px: L.gap,
      mean_luminance: stimLuminance(st, W),
    };
    for (const pos of POSITIONS) {
      const c = st.layout.find((x) => x.pos === pos);
      r[`${pos}_image`] = byId.get(c.itemId).name;
      r[`${pos}_emotion`] = c.category;
    }
    for (const m of opts.metrics) {
      const v = st.layout.map((c) => byId.get(c.itemId).metrics[m]);
      r[`image_${m}_mean`] = (v.reduce((a, b) => a + b, 0) / v.length).toFixed(4);
      r[`image_${m}_range`] = (Math.max(...v) - Math.min(...v)).toFixed(4);
    }
    if (st.sal) for (const k of SAL_KEYS) r[`screen_salience_${k}`] = st.sal[k];
    return r;
  });
  const tilesRows = [];
  for (const st of stimuli) {
    for (const pos of POSITIONS) {
      const c = st.layout.find((x) => x.pos === pos);
      const it = byId.get(c.itemId);
      const k = st.aoi.findIndex((a) => a.pos === pos);
      tilesRows.push({
        stimulus: st.name, type: st.type, group: st.group, position: pos,
        image: it.name, emotion_category: c.category,
        rating_neutral: it.ratings.neutral, rating_positive: it.ratings.positive,
        rating_sad: it.ratings.sad, rating_threat: it.ratings.threat, rating_realism: it.ratings.realism,
        ...Object.fromEntries(SAL_KEYS.map((m) => [`image_salience_${m}`, it.metrics[m]])),
        image_luminance: it.lum ?? '', crop_share: f3(cropShare(it.w, it.h, L.ratio)),
        salience_rel_in_stimulus: st.rel ? f3(st.rel[k]) : '',
        aoi_x: tiles[pos].x, aoi_y: tiles[pos].y, aoi_w: tiles[pos].w, aoi_h: tiles[pos].h,
      });
    }
  }
  const imageRows = usedItems.map((it) => ({
    image: it.name, group: it.group, emotion_category: it.category,
    rating_neutral: it.ratings.neutral, rating_positive: it.ratings.positive, rating_sad: it.ratings.sad, rating_threat: it.ratings.threat, rating_realism: it.ratings.realism,
    ...Object.fromEntries(SAL_KEYS.map((m) => [`salience_${m}`, it.metrics[m]])), salience_method: it.method,
    luminance: it.lum ?? '', original_w: it.w, original_h: it.h, crop_share: f3(cropShare(it.w, it.h, L.ratio)), times_used: uses.get(it.id),
  }));

  // баланс исходных изображений по эмоциям
  const bal = balanceReport(res.stimuli, opts.metrics);
  const balRows = bal.map((b) => ({
    label: SAL_LABELS[b.metric],
    cells: b.perCat.map((p) => ({ n: p.n, mean: p.mean, sd: p.sd })),
    extra: b.anova ? `F(${b.anova.df1}, ${b.anova.df2}) = ${b.anova.F.toFixed(2)}, p ${formatP(b.anova.p).startsWith('<') ? formatP(b.anova.p) : '= ' + formatP(b.anova.p)}` : '—',
    extraBad: b.anova ? b.anova.p < 0.05 : false,
  }));
  const lumRows = categoryRows(usedItems, [['Яркость картинки (0–1)', (it) => it.lum]]);
  const catHeaders = EMOTIONS.map((e) => e.ru);

  const posCnt = Object.fromEntries(EMOTION_KEYS.map((c) => [c, [0, 0, 0, 0]]));
  for (const st of stimuli.filter((s) => s.type === 'experimental')) for (const c of st.layout) posCnt[c.category][POSITIONS.indexOf(c.pos)]++;
  const exp = stimuli.length - ctrl;
  const repeated = [...uses.values()].filter((n) => n > 1).length;

  let summary = `
    <h4 class="sub-heading">Баланс салиентности исходных изображений по эмоциям</h4>
    <p class="muted-p">Использованные изображения, метод ${esc(method.toUpperCase())}. Однофакторный ANOVA: p &gt; .05 — эмоции не различаются по метрике.</p>
    ${metricTable(catHeaders, balRows)}
    <h4 class="sub-heading">Яркость исходных изображений по эмоциям</h4>
    <p class="muted-p">Нужна для анализа зрачка: изображения разных эмоций не должны различаться по яркости.</p>
    ${metricTable(catHeaders, lumRows)}
    <h4 class="sub-heading">Положение эмоций в экспериментальных стимулах</h4>
    <p class="muted-p">Сколько раз эмоция оказалась в каждой ячейке (всего экспериментальных: ${exp}).</p>
    <div class="data-table-wrap narrow"><table class="data-table"><thead><tr><th></th><th>Лево-верх</th><th>Право-верх</th><th>Лево-низ</th><th>Право-низ</th></tr></thead><tbody>${EMOTION_KEYS.map((c) => `<tr><td>${EMOTION_BY_KEY[c].ru}</td>${posCnt[c].map((n) => `<td class="num">${n}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  let salByType = null; let relRows = null; let typeHeaders = [];
  if (salOn) {
    const types = [['control', 'Контрольные'], ['experimental', 'Экспериментальные']].filter(([k]) => stimuli.some((s) => s.type === k));
    typeHeaders = types.map((t) => t[1]);
    salByType = salienceBalance(stimuli, (s) => s.type, types);
    const tileRel = stimuli.flatMap((s) => s.layout.map((c, i) => ({ category: c.category, rel: s.rel[s.aoi.findIndex((a) => a.pos === c.pos)] })));
    const vals = EMOTION_KEYS.map((c) => tileRel.filter((t) => t.category === c).map((t) => t.rel).filter(Number.isFinite));
    const a = oneWay(vals);
    relRows = [{ label: 'Относительная салиентность картинки в стимуле', cells: vals.map((v) => ({ n: v.length, mean: meanOf(v), sd: sdOf(v) })),
      extra: a ? `F(${a.df1}, ${a.df2}) = ${a.F.toFixed(2)}, p ${formatP(a.p).startsWith('<') ? formatP(a.p) : '= ' + formatP(a.p)}` : '—', extraBad: a ? a.p < 0.05 : false }];
    summary += `
      <h4 class="sub-heading">Салиентность готовых стимулов (${esc(METHOD_LABELS[method])})</h4>
      <p class="muted-p">Оценена для всего экрана (картинки на фоне). «Относительная салиентность» — средняя салиентность рамки картинки относительно среднего по экрану (1 — как в среднем): если картинки одной эмоции заметнее других, на них будут смотреть чаще независимо от эмоции.</p>
      ${metricTable(types.map((t) => t[1]), salByType)}
      ${metricTable(catHeaders, relRows)}`;
  }

  const pngs = [];
  const insText = editor.texts().main;
  if (editor.enabled()) {
    pngs.push({ path: 'instruction.png', desc: 'Инструкция для участника', draw: (c, s = 1) => drawInstructionText(c, { width: W, height: H, background: L.background, color: FG, fontFamily: 'Arial, Helvetica, sans-serif', text: editor.texts().main, scale: s }) });
  }

  mountResults($('#img-results'), {
    prefix: 'img', step: 3, width: W, height: H, stimuli, title: 'Эмоционально окрашенные изображения',
    filters: [['control', 'Контрольные'], ['experimental', 'Экспериментальные']],
    requested: res.requested, built: stimuli.length, warnings,
    resultNote: `Контрольных ${ctrl}, экспериментальных ${exp}. Использовано изображений: ${usedIds.length}${repeated ? `, из них повторяются: ${repeated}` : ', повторов нет'}.`,
    summaryHtml: summary, pngs,
    manifests: [
      { file: 'stimuli.csv', rows, desc: 'По строке на стимул: тип, группа, состав по ячейкам, средняя яркость, салиентность исходных картинок и готового стимула' },
      { file: 'stimuli_tiles.csv', rows: tilesRows, desc: 'По строке на картинку в стимуле: эмоция, оценки по шкалам, салиентность, яркость, доля обрезки, область интереса в пикселях' },
      { file: 'images.csv', rows: imageRows, desc: 'По строке на использованное изображение: группа, эмоция, оценки, салиентность, яркость, размер, сколько раз использовано' },
    ],
    methods: () => methodsDoc({ res, stimuli, opts, L, salOn, method, tiles, usedItems, uses, balRows, lumRows, salByType, typeHeaders, relRows, posCnt, ctrl, exp, crops, insText: editor.texts().main, instructionOn: editor.enabled() }),
    readmeIntro: 'Стимулы 2×2 из эмоционально окрашенных изображений. Правильных ответов в методике нет — зоны интереса каждой картинки приведены в stimuli_tiles.csv.',
    archiveName: 'emotional_images_stimuli',
    settings: { experiment: 'emotional-images-2x2', options: opts, layout: L, saliencyMethod: method, saliencyOnStimuli: salOn, seedUsed: res.seedUsed, instruction: editor.enabled() ? insText : null },
  });
  $('#img-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- описание для раздела «Методы» ---------------- */

function methodsDoc(c) {
  const { H1, H2, P, UL, TABLE, paramTable } = M;
  const { res, stimuli, opts, L, salOn, method, tiles, usedItems, uses, balRows, lumRows, salByType, typeHeaders, relRows, posCnt, ctrl, exp, crops } = c;
  const catRu = (k) => EMOTION_BY_KEY[k].ru.toLowerCase();
  const loaded = state.items;
  const cellCounts = GROUP_KEYS.filter((g) => opts.groups.includes(g)).map((g) => [GROUP_BY_KEY[g].ru, ...EMOTION_KEYS.map((k) => String(usedItems.filter((it) => it.group === g && it.category === k).length))]);
  const loadedCounts = GROUP_KEYS.filter((g) => opts.groups.includes(g)).map((g) => [GROUP_BY_KEY[g].ru, ...EMOTION_KEYS.map((k) => String(loaded.filter((it) => it.group === g && it.category === k).length))]);
  const catHeaders = EMOTIONS.map((e) => e.ru);
  const marginCat = num('#img-margin-cat', 0); const minReal = parseNum($('#img-minreal').value);
  const blocks = [
    H1('Эмоционально окрашенные изображения: описание стимулов'),
    P(`Набор содержит ${stimuli.length} стимулов: ${ctrl} контрольных и ${exp} экспериментальных. Каждый стимул — экран ${L.width} × ${L.height} пикс. с четырьмя изображениями, расположенными в сетке 2 × 2. ` +
      'Все четыре изображения одного стимула относятся к одной группе объектов (один человек, группа людей, животные, предметы). ' +
      'В контрольном стимуле все четыре изображения принадлежат одной эмоциональной категории; в экспериментальном — четырём разным категориям (нейтральная, позитивная, грусть, угроза). Правильных ответов в методике нет.'),
    H2('1. Исходный материал'),
    P(`В подборе участвовали ${loaded.length} загруженных изображений; в готовый набор вошло ${usedItems.length}. Эмоциональная категория изображения определялась по средним оценкам массовой валидации: категорией считалась шкала с наибольшей средней оценкой (нейтральность, позитивность, грусть, угроза)` +
      `${marginCat > 0 ? `; изображения, у которых главная шкала опережала вторую менее чем на ${marginCat} балла, не использовались` : '; при равенстве двух наибольших оценок категория не присваивалась, и изображение не использовалось'}` +
      `${$('#img-zscale').checked ? '; шкалы сравнивались в стандартизованном виде (z-оценки по всем изображениям)' : ''}` +
      `${minReal != null ? `; изображения с оценкой реалистичности ниже ${minReal} не использовались` : ''}. Группа объектов задана в таблице оценок или назначена вручную.`),
    P('Число загруженных изображений с назначенными группой и категорией:'),
    TABLE(['Группа', ...catHeaders], loadedCounts),
    P('Число изображений, вошедших в набор:'),
    TABLE(['Группа', ...catHeaders], cellCounts),
    H2('2. Параметры стимулов'),
    paramTable([
      ['Размер стимула', `${L.width} × ${L.height} пикс.`],
      ['Цвет фона', M.colorText(L.background)],
      ['Размер рамки каждой картинки', `${tiles.TL.w} × ${tiles.TL.h} пикс.`, 'Рамки четырёх картинок одинаковы'],
      ['Формат рамки (ширина : высота)', `${L.ratio.toFixed(3)}`, 'Если формат изображения отличается, края обрезаются по центру'],
      ['Расстояние между картинками', `${L.gap} пикс.`, 'Одинаковое по горизонтали и по вертикали'],
      ['Поле от краёв экрана', `не менее ${L.margin} пикс.`, 'Сетка 2×2 расположена по центру экрана'],
      ['Контрольных стимулов на каждую эмоцию в каждой группе', opts.controlPerCategory],
      ['Экспериментальных стимулов на каждую группу', opts.experimentalPerGroup],
      ['Группы', opts.groups.map((g) => GROUP_BY_KEY[g].ru).join('; ')],
      ['Повторы изображений в разных стимулах', opts.allowRepeats ? 'допускаются' : 'не допускаются'],
      ['Показатели салиентности для уравнивания', opts.metrics.map((k) => SAL_LABELS[k]).join('; ')],
      ['Алгоритм оценки салиентности', METHOD_LABELS[method]],
      ['Номер случайного набора', `${opts.seed}${res.seedUsed != null && res.seedUsed !== opts.seed ? ` (лучший из ${opts.attempts ?? 12} вариантов подбора: ${res.seedUsed})` : ''}`],
    ]),
    H2('3. Подбор изображений в стимулы'),
    P('Для каждого исходного изображения оценена низкоуровневая салиентность (см. раздел «Салиентность»). Показатели салиентности стандартизованы (z-оценки по всем подходящим изображениям). ' +
      'Для каждого стимула четыре изображения подбирались так, чтобы различие их салиентности было минимальным: перебирались опорные изображения, к каждому подбирались ближайшие по вектору z-оценок изображения нужных категорий, выбиралась комбинация с наименьшей суммарной дисперсией z-оценок. ' +
      `${opts.allowRepeats ? 'При разрешённых повторах к стоимости комбинации добавлялся штраф за повторное использование изображения, чтобы изображения использовались равномерно. ' : 'Каждое изображение использовалось не более одного раза. '}` +
      'Подбор повторялся несколько раз с разным случайным порядком, выбирался вариант, в котором собрано больше стимулов, а затем — с лучшим балансом салиентности между эмоциями.'),
    P('Положение эмоций по ячейкам сетки в экспериментальных стимулах выравнивалось по всему набору: для каждого стимула из 24 возможных расстановок выбиралась та, которая минимизирует перекос счётчиков «эмоция × ячейка»; одинаковые раскладки в пределах группы по возможности не повторялись' + (opts.allowRepeats ? ', а повторно используемое изображение по возможности ставилось в другую ячейку' : '') + '.'),
    H2('4. Состав набора'),
    TABLE(['Условие', 'Число стимулов'], [...new Set(stimuli.map((s) => `${s.type === 'control' ? 'контроль' : 'эксперимент'} · ${GROUP_BY_KEY[s.group].ru}${s.type === 'control' ? ' · ' + catRu(s.category) : ''}`))].map((k) => [k, String(stimuli.filter((s) => `${s.type === 'control' ? 'контроль' : 'эксперимент'} · ${GROUP_BY_KEY[s.group].ru}${s.type === 'control' ? ' · ' + catRu(s.category) : ''}` === k).length)])),
    P('Положение эмоций в экспериментальных стимулах (сколько раз эмоция оказалась в каждой ячейке):'),
    TABLE(['Эмоция', 'Лево-верх', 'Право-верх', 'Лево-низ', 'Право-низ'], EMOTION_KEYS.map((k) => [EMOTION_BY_KEY[k].ru, ...posCnt[k].map(String)])),
    P('Перечень стимулов (в таблице: имя файла, тип, группа, эмоции в ячейках лево-верх / право-верх / лево-низ / право-низ):'),
    TABLE(['Имя файла', 'Тип', 'Группа', 'Эмоции по ячейкам'], stimuli.map((s) => [`${s.name}.png`, s.type === 'control' ? 'контроль' : 'эксперимент', GROUP_BY_KEY[s.group].ru, POSITIONS.map((p) => EMOTION_BY_KEY[s.layout.find((x) => x.pos === p).category].short).join(' / ')]), [5, 2, 2.5, 3.5]),
    H2('5. Салиентность и яркость'),
    ...M.salienceParagraphs(method, opts.metrics),
    P('Сравнение салиентности исходных изображений между эмоциональными категориями (среднее ± стандартное отклонение; n — число изображений; однофакторный дисперсионный анализ, p > 0,05 — категории не различаются):'),
    M.balanceTable(catHeaders, balRows),
    P('Яркость исходных изображений (средняя относительная яркость рабочей копии по значениям sRGB, коэффициенты Rec. 709, шкала 0–1) по эмоциональным категориям:'),
    M.balanceTable(catHeaders, lumRows),
  ];
  if (salOn) {
    blocks.push(P('Салиентность оценивалась и для готовых стимулов целиком (картинки на фоне). Сравнение контрольных и экспериментальных стимулов:'));
    blocks.push(M.balanceTable(typeHeaders, salByType));
    blocks.push(P('Относительная салиентность рамок картинок в готовых стимулах по эмоциям (1 — как в среднем по экрану):'));
    blocks.push(M.balanceTable(catHeaders, relRows));
  }
  blocks.push(M.luminanceParagraph());
  blocks.push(H2('6. Инструкция для участника'));
  if (c.instructionOn) blocks.push(P(`Инструкция предъявляется отдельным экраном instruction.png (того же размера и цвета фона, что стимулы). Текст: ${String(c.insText).replace(/\*\*/g, '').replace(/\n+/g, ' ')}`));
  else blocks.push(P('Инструкция в архив не включена.'));
  blocks.push(H2('7. Области интереса и обработка обрезки'),
    P(`Область интереса каждой картинки — её рамка (${tiles.TL.w} × ${tiles.TL.h} пикс.); координаты приведены в stimuli_tiles.csv. ` +
      `Изображения приводятся к формату рамки с обрезкой краёв по центру; максимальная доля обрезанной площади среди использованных изображений — ${Math.round(Math.max(0, ...crops.map((x) => x.share)) * 100)}%.`),
    M.reproducibilityParagraph(opts.seed));
  return blocks;
}

/* ---------------- инициализация ---------------- */

function panelHtml() {
  return `
    ${panelHead('01', 'Эмоционально окрашенные изображения · создание стимулов', `
      Стимул — сетка 2×2 из четырёх изображений одной группы (один человек, группа людей, животные, предметы).
      Контрольный: все четыре изображения одной эмоциональной категории. Экспериментальный: четыре разные категории,
      положения категорий по ячейкам не повторяются. Промежутки между картинками по горизонтали и по вертикали всегда равны.`)}

    ${stepTitle(1, 'Изображения и оценки')}
    <div class="dropzone" id="img-dropzone" tabindex="0">
      <input type="file" id="img-file" accept="image/jpeg,image/png,image/webp,image/bmp" multiple hidden>
      <div class="dropzone-inner">
        <div class="dropzone-icon">⤓</div>
        <p class="dropzone-text">Перетащите изображения сюда</p>
        <p class="dropzone-or">— или —</p>
        <button class="btn btn-primary" type="button">Выбрать файлы</button>
        <p class="dropzone-hint">JPG · PNG · WebP · BMP — сразу много</p>
      </div>
    </div>
    <div class="toolbar tool-gap">
      <label class="btn" for="img-ratings-file">↑ Загрузить таблицу оценок (CSV)</label>
      <input type="file" id="img-ratings-file" accept=".csv,.tsv,.txt" hidden>
      <button class="btn btn-ghost" id="img-template" type="button">↓ Скачать образец таблицы</button>
      <span class="toolbar-info" id="img-ratings-info">Столбцы таблицы: файл, группа (необязательно), нейтральность, позитивность, грусть, угроза, реалистичность</span>
      <span class="toolbar-spacer"></span>
      <button class="btn btn-ghost" id="img-clear" type="button" disabled>⊘ Убрать все изображения</button>
    </div>
    <div class="busy-bar tool-gap" id="img-load-busy" hidden><span class="busy-spinner"></span><span id="img-load-busy-text">Оценка салиентности…</span></div>
    <div id="img-table-block" hidden>
      <div class="toolbar tool-gap">
        <span class="toolbar-info" id="img-count"></span>
        <span class="toolbar-spacer"></span>
        <span class="toolbar-info">Назначить группу всем изображениям, у которых она не указана:</span>
        <div class="select-wrap select-inline"><select id="img-bulk-group"></select></div>
        <button class="btn" id="img-bulk-apply" type="button">Назначить</button>
      </div>
      <div class="data-table-wrap table-scroll tool-gap"><table class="data-table" id="img-table"></table></div>
    </div>

    ${stepTitle(2, 'Параметры')}
    ${card(`
      ${sub('Что создаём')}
      ${grid(`
        ${fld.num('img-ctrl', 'Контрольных стимулов на каждую эмоцию в каждой группе', 1, { min: 0 })}
        ${fld.num('img-exp', 'Экспериментальных стимулов на каждую группу', 4, { min: 0 })}
        <div class="field"><label>Какие группы изображений использовать</label><div class="check-row" id="img-groups"></div></div>
        ${fld.num('img-seed', 'Номер случайного набора', 1, { hint: 'При том же номере и тех же данных получится тот же набор стимулов. Поменяйте номер, чтобы получить другой.' })}
        ${fld.check('img-repeats', 'Разрешить использовать одно изображение в нескольких стимулах', false, { hint: 'Если выключено и изображений не хватает, появится предупреждение.' })}
      `)}
      ${sep()}
      ${sub('Эмоциональная категория изображения')}
      ${grid(`
        ${fld.num('img-margin-cat', 'Минимальный отрыв главной шкалы от второй, баллы', 0, { min: 0, step: 0.1, hint: 'Эмоция картинки — шкала с наибольшей оценкой. Если отрыв от второй шкалы меньше этого значения, картинка считается «смешанной» и не используется. 0 — не ограничивать.' })}
        ${fld.num('img-minreal', 'Минимальная реалистичность', '', { step: 0.1, placeholder: 'не ограничивать', hint: 'Картинки с оценкой реалистичности ниже порога не используются.' })}
        ${fld.check('img-zscale', 'Сравнивать шкалы в стандартизованном виде (z-оценки)', false, { hint: 'Включите, если шкалы нельзя сравнивать напрямую, например у них разный диапазон оценок.' })}
      `)}
      ${sep()}
      ${sub('Внешний вид')}
      ${grid(`
        ${fld.pair('img-w', 'img-h', 'Размер стимула: ширина × высота, пикс.', 1920, 1080, { min: 240 })}
        ${fld.num('img-gap', 'Расстояние между картинками, пикс.', 60, { min: 0, hint: 'Одинаковое по горизонтали и по вертикали: четыре рамки одного размера стоят по центру экрана.' })}
        ${fld.num('img-margin', 'Минимальное поле от краёв экрана, пикс.', 40, { min: 0 })}
        ${fld.select('img-ratio', 'Формат рамки картинки', RATIO_OPTIONS, 'auto', { hint: 'Все четыре картинки показываются в рамках одного размера и формата. Если формат картинки другой, края обрезаются по центру; доля обрезки показывается в результатах.' })}
        ${fld.color('img-bg', 'Цвет фона стимула', BG)}
      `)}
      ${sep()}
      ${sub('Салиентность')}
      ${grid(`
        ${fld.select('img-method', 'Алгоритм оценки салиентности', [['ft', 'FT — для цветных сцен (рекомендуется)'], ['local', 'Local Contrast — цветовой контраст'], ['dog', 'DoG — по яркости'], ['sr', 'SR — спектральный остаток (яркость)']], 'ft')}
        <div class="field"><label>Показатели салиентности, по которым уравниваются картинки внутри стимула</label><div class="check-row" id="img-metrics"></div></div>
        ${fld.check('img-sal-on', 'Оценить салиентность готовых стимулов целиком', true, { hint: 'Для каждого стимула считается карта салиентности всего экрана и относительная салиентность рамки каждой картинки (нужна как ковариата для анализа движений глаз).' })}
      `)}
      ${instructionEditorHtml('img', { items: [{ key: 'main', label: 'Инструкция', text: INSTRUCTION }], lead: 'Сохраняется в архив отдельной картинкой <code>instruction.png</code> того же размера, что и стимулы. Проверьте, что текст соответствует вашей процедуре: что именно должен делать участник.' })}
    `)}
    ${generateBar('img')}`;
}

export function initImagesGenerator() {
  $('#mode-img').innerHTML = panelHtml();
  $('#img-groups').innerHTML = GROUPS.map((g) =>
    `<label class="check"><input type="checkbox" value="${g.key}" checked><span>${g.ru}</span></label>`).join('');
  $('#img-metrics').innerHTML = SAL_KEYS.map((k) =>
    `<label class="check"><input type="checkbox" value="${k}" checked><span>${SAL_LABELS[k]}</span></label>`).join('');
  $('#img-bulk-group').innerHTML = GROUPS.map((g) => `<option value="${g.key}">${g.ru}</option>`).join('');
  editor = mountInstructionEditor('img', [{ key: 'main', label: 'Инструкция', text: INSTRUCTION }], () => {
    const l = readLayout();
    return { width: l.width, height: l.height, background: l.background, color: FG, fontFamily: 'Arial, Helvetica, sans-serif' };
  });

  bindDropzone($('#img-dropzone'), $('#img-file'), addFiles);
  $('#img-ratings-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) try { await loadRatingsFile(f); } catch (err) { toastError(`CSV не прочитан: ${err.message}`); }
  });
  $('#img-template').addEventListener('click', downloadTemplate);
  $('#img-clear').addEventListener('click', () => {
    state.items = []; state.ratings.clear();
    $('#img-ratings-info').textContent = 'Столбцы таблицы: файл, группа (необязательно), нейтральность, позитивность, грусть, угроза, реалистичность';
    invalidateResult(); renderTable();
  });
  $('#img-bulk-apply').addEventListener('click', () => {
    const g = $('#img-bulk-group').value;
    let n = 0;
    state.items.forEach((it) => { if (!it.group) { it.group = g; n++; } });
    invalidateResult(); renderTable();
    toastInfo(n ? `Группа «${GROUP_BY_KEY[g].ru}» назначена ${n} изображениям` : 'Все изображения уже с группой');
  });
  $('#img-table').addEventListener('change', onTableEdit);
  $('#img-method').addEventListener('change', recomputeSalience);
  $$('#mode-img .params-card input, #mode-img .params-card select').forEach((el) => {
    if (el.id === 'img-method' || el.id.includes('-ins-')) return;
    el.addEventListener('change', () => { invalidateResult(); refreshDerived(); editor.preview(); });
  });
  $('#img-generate').addEventListener('click', generate);
  editor.preview();
  renderFeasibility();
}
