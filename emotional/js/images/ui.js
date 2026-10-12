/* ============================================================
   images/ui.js — интерфейс «Изображения · создание стимулов»
   ============================================================ */

import { $, $$, esc, tick, bindDropzone, downloadBlob, downloadText, canvasToBlob, readText, openViewer, fmt, meanLuminance } from '../../../shared/js/common/ui.js';
import { parseCSV, parseNum, findColumn, toCSV } from '../../../shared/js/common/csv.js';
import { buildZip } from '../../../shared/js/common/zip.js';
import { EMOTIONS, EMOTION_KEYS, EMOTION_BY_KEY, EMOTION_ALIASES, classifyEmotion, scaleStats } from '../../../shared/js/common/emotions.js';
import { loadImageFiles } from '../../../shared/js/core/loader.js';
import { computeSaliency } from '../../../shared/js/core/algorithms/index.js';
import { computeMetrics } from '../../../shared/js/core/metrics.js';
import { formatP } from '../../../shared/js/core/stats.js';
import { toastError, toastSuccess, toastInfo } from '../../../shared/js/core/toast.js';
import {
  GROUPS, GROUP_KEYS, GROUP_BY_KEY, POSITIONS, SAL_KEYS, SAL_LABELS,
  parseGroup, groupFromFilename, generateImageStimuli, checkFeasibility, balanceReport,
} from './generator.js';
import { tileRects, fitImage, drawImageStimulus } from './render.js';
import { drawInstruction, IMAGES_INSTRUCTION } from '../../../shared/js/common/instruction.js';

const state = {
  items: [],
  ratings: new Map(),      // ключ имени файла → { ratings, group }
  result: null,            // последний результат генерации
  layout: null,
  nextId: 1,
  busy: false,
};

const REALISM_ALIASES = ['realism', 'realistic', 'реалистичность', 'реалистичный', 'реализм'];
const GROUP_COL_ALIASES = ['group', 'category', 'группа', 'категория', 'тип', 'type'];
const FILE_COL_ALIASES = ['file', 'filename', 'image', 'img', 'name', 'файл', 'имяфайла', 'изображение', 'имя'];

const keyOf = (name) => name.replace(/\.[^.]+$/, '').trim().toLowerCase();

/* ---------------- чтение формы ---------------- */

const num = (id, dflt) => {
  const v = parseNum($(id).value);
  return v == null ? dflt : v;
};

function readLayout() {
  return {
    width: Math.max(320, Math.round(num('#img-w', 1920))),
    height: Math.max(240, Math.round(num('#img-h', 1080))),
    pad: Math.max(0, num('#img-pad', 40)),
    gap: Math.max(0, num('#img-gap', 0)),
    margin: Math.max(0, num('#img-margin', 0)),
    fit: $('#img-fit').value,
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

/** Средняя яркость рабочей копии изображения (0–255). */
function workingLuminance(imageData) {
  const d = imageData.data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return Math.round((s / (d.length / 4)) * 10) / 10;
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
  $('#img-busy').hidden = !on;
  if (text) $('#img-busy-text').textContent = text;
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

function generate() {
  const opts = readOptions();
  state.layout = readLayout();
  const res = generateImageStimuli(generatorItems(), opts);
  state.result = { ...res, options: opts, layout: state.layout, method: $('#img-method').value };
  renderResults();
  $('#img-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (res.warnings.length) toastError('Есть предупреждения — см. блок результатов', 6000);
  else toastSuccess(`Собрано стимулов: ${res.built}`);
}

function invalidateResult() {
  if (state.result) {
    state.result = null;
    $('#img-results').hidden = true;
    $('#img-results').innerHTML = '';
  }
}

/* ---------------- результаты ---------------- */

function renderResults() {
  const r = state.result;
  const box = $('#img-results');
  box.hidden = false;
  const ctrl = r.stimuli.filter((s) => s.type === 'control').length;
  const exp = r.stimuli.length - ctrl;

  const bal = balanceReport(r.stimuli, r.options.metrics);
  const balRows = bal.map((b) => `
    <tr><td>${SAL_LABELS[b.metric]}</td>
      ${b.perCat.map((p) => `<td class="num">${fmt(p.mean, 3)} <span class="muted">± ${fmt(p.sd, 3)}</span></td>`).join('')}
      <td class="num ${b.anova && b.anova.p < 0.05 ? 'bad-cell' : 'ok-cell'}">${b.anova ? `F(${b.anova.df1}, ${b.anova.df2}) = ${fmt(b.anova.F, 2)}, p ${formatP(b.anova.p) .startsWith('<') ? formatP(b.anova.p) : '= ' + formatP(b.anova.p)}` : '—'}</td></tr>`).join('');

  const posCnt = Object.fromEntries(EMOTION_KEYS.map((c) => [c, [0, 0, 0, 0]]));
  for (const st of r.stimuli.filter((s) => s.type === 'experimental')) {
    for (const c of st.layout) posCnt[c.category][POSITIONS.indexOf(c.pos)]++;
  }
  const posRows = EMOTION_KEYS.map((c) => `<tr><td>${EMOTION_BY_KEY[c].ru}</td>${posCnt[c].map((n) => `<td class="num">${n}</td>`).join('')}</tr>`).join('');

  const usage = new Map();
  for (const st of r.stimuli) for (const c of st.layout) usage.set(c.itemId, (usage.get(c.itemId) || 0) + 1);
  const repeated = [...usage.values()].filter((n) => n > 1).length;

  box.innerHTML = `
    <h3 class="step-title"><span class="step-num">3</span>Результат</h3>
    ${r.warnings.length ? `<div class="alert warn"><strong>Предупреждения</strong><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <div class="alert ${r.built === r.requested ? 'ok' : 'warn'}">
      Собрано стимулов: <strong>${r.built}</strong> из ${r.requested} (контрольных ${ctrl}, экспериментальных ${exp}).
      Использовано изображений: ${usage.size}${repeated ? `, из них повторяются: ${repeated}` : ', повторов нет'}.
    </div>

    <div class="toolbar tool-gap">
      <div class="subtab-bar flush" id="img-filter">
        <button class="subtab active" data-f="all" type="button">Все</button>
        <button class="subtab" data-f="control" type="button">Контрольные</button>
        <button class="subtab" data-f="experimental" type="button">Экспериментальные</button>
      </div>
      <span class="toolbar-spacer"></span>
      <button class="btn" id="img-dl-csv" type="button">↓ CSV</button>
      <button class="btn btn-primary" id="img-dl-zip" type="button">↓ PNG-архив (ZIP)</button>
    </div>
    <div class="busy-bar tool-gap" id="img-zip-busy" hidden><span class="busy-spinner"></span><span id="img-zip-text"></span></div>

    <div class="result-grid stim-grid" id="img-gallery"></div>

    <h4 class="sub-heading">Баланс салиентности по эмоциональным категориям</h4>
    <p class="muted-p">Использованные изображения, метод ${esc(r.method.toUpperCase())}. Однофакторный ANOVA: p &gt; .05 — категории не различаются по метрике.</p>
    <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Метрика</th>${EMOTIONS.map((e) => `<th>${e.ru}</th>`).join('')}<th>ANOVA</th></tr></thead><tbody>${balRows}</tbody></table></div>

    <h4 class="sub-heading">Положение категорий в экспериментальных стимулах</h4>
    <p class="muted-p">Сколько раз категория оказалась в каждой ячейке (всего экспериментальных: ${exp}).</p>
    <div class="data-table-wrap narrow"><table class="data-table"><thead><tr><th></th><th>Лево-верх</th><th>Право-верх</th><th>Лево-низ</th><th>Право-низ</th></tr></thead><tbody>${posRows}</tbody></table></div>
  `;

  $('#img-dl-zip').addEventListener('click', downloadArchive);
  $('#img-dl-csv').addEventListener('click', () => {
    const { stimuliRows, tilesRows } = buildManifests();
    downloadText(toCSV(stimuliRows), 'stimuli.csv');
    setTimeout(() => downloadText(toCSV(tilesRows), 'stimuli_tiles.csv'), 300);
  });
  $$('#img-filter .subtab').forEach((b) => b.addEventListener('click', () => {
    $$('#img-filter .subtab').forEach((x) => x.classList.toggle('active', x === b));
    renderGallery(b.dataset.f);
  }));
  renderGallery('all');
}

const THUMB_W = 480;

function scaled(layout, s) {
  return { ...layout, width: Math.round(layout.width * s), height: Math.round(layout.height * s),
    pad: layout.pad * s, gap: layout.gap * s, margin: layout.margin * s };
}

async function renderGallery(filter) {
  const r = state.result;
  const grid = $('#img-gallery');
  grid.innerHTML = '';
  const list = r.stimuli.filter((s) => filter === 'all' || s.type === filter);
  const L = scaled(r.layout, THUMB_W / r.layout.width);
  for (const st of list) {
    const card = document.createElement('div');
    card.className = 'result-card stim-card';
    const canvas = document.createElement('canvas');
    drawImageStimulus(canvas, st, (id) => state.items.find((x) => x.id === id).img, L);
    const legend = POSITIONS.map((pos) => {
      const c = st.layout.find((x) => x.pos === pos);
      return `<i style="background:${EMOTION_BY_KEY[c.category].color}" title="${EMOTION_BY_KEY[c.category].ru}"></i>`;
    }).join('');
    card.innerHTML = `
      <div class="result-thumb stim-thumb"><span class="result-tag">${st.type === 'control' ? 'контроль' : 'эксперимент'}</span></div>
      <div class="result-body">
        <div class="result-name">${esc(st.name)}</div>
        <div class="result-stats"><span>${GROUP_BY_KEY[st.group].ru}</span>
          <span class="mini-grid">${legend}</span></div>
      </div>`;
    card.querySelector('.stim-thumb').prepend(canvas);
    card.addEventListener('click', () => view(st));
    grid.appendChild(card);
  }
}

function view(st) {
  const r = state.result;
  const rows = st.layout.map((c) => {
    const it = state.items.find((x) => x.id === c.itemId);
    const e = EMOTION_BY_KEY[c.category];
    return `<tr><td>${c.pos}</td><td>${esc(it.name)}</td><td><span class="emo-chip" style="--c:${e.color}">${e.ru}</span></td><td class="num">${fmt(it.metrics.mean, 4)}</td></tr>`;
  }).join('');
  openViewer({
    title: st.name,
    info: `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Ячейка</th><th>Файл</th><th>Эмоция</th><th>Средняя салиентность</th></tr></thead><tbody>${rows}</tbody></table></div>`,
    canvasFactory: () => {
      const c = document.createElement('canvas');
      drawImageStimulus(c, st, (id) => state.items.find((x) => x.id === id).img, r.layout);
      return c;
    },
  });
}

/* ---------------- экспорт ---------------- */

function buildManifests() {
  const r = state.result;
  const L = r.layout;
  const tiles = tileRects(L);
  const stimuliRows = [];
  const tilesRows = [];
  const scratch = document.createElement('canvas');
  for (const st of r.stimuli) {
    drawImageStimulus(scratch, st, (id) => state.items.find((x) => x.id === id).img, L);
    const row = {
      stimulus: st.name, type: st.type, group: st.group,
      emotion_category: st.type === 'control' ? st.category : 'mixed',
      width: L.width, height: L.height,
      stimulus_luminance: meanLuminance(scratch),
    };
    for (const pos of POSITIONS) {
      const c = st.layout.find((x) => x.pos === pos);
      row[`${pos}_image`] = state.items.find((x) => x.id === c.itemId).name;
      row[`${pos}_emotion`] = c.category;
    }
    for (const m of r.options.metrics) {
      const v = st.layout.map((c) => state.items.find((x) => x.id === c.itemId).metrics[m]);
      row[`salience_${m}_mean`] = (v.reduce((a, b) => a + b, 0) / v.length).toFixed(4);
      row[`salience_${m}_range`] = (Math.max(...v) - Math.min(...v)).toFixed(4);
    }
    stimuliRows.push(row);
    for (const pos of POSITIONS) {
      const c = st.layout.find((x) => x.pos === pos);
      const it = state.items.find((x) => x.id === c.itemId);
      const f = fitImage(it.w, it.h, tiles[pos], L.fit);
      tilesRows.push({
        stimulus: st.name, type: st.type, group: st.group, position: pos,
        image: it.name, emotion_category: c.category,
        rating_neutral: it.ratings.neutral, rating_positive: it.ratings.positive,
        rating_sad: it.ratings.sad, rating_threat: it.ratings.threat, rating_realism: it.ratings.realism,
        ...Object.fromEntries(SAL_KEYS.map((k) => [`salience_${k}`, it.metrics[k]])),
        luminance_mean: it.lum ?? '',
        aoi_x: f.dx, aoi_y: f.dy, aoi_w: Math.round(f.dw), aoi_h: Math.round(f.dh),
        tile_x: tiles[pos].x, tile_y: tiles[pos].y, tile_w: tiles[pos].w, tile_h: tiles[pos].h,
      });
    }
  }
  return { stimuliRows, tilesRows };
}

async function downloadArchive() {
  const r = state.result;
  const busy = $('#img-zip-busy');
  busy.hidden = false;
  $('#img-dl-zip').disabled = true;
  try {
    const enc = new TextEncoder();
    const entries = [];
    const canvas = document.createElement('canvas');
    let i = 0;
    for (const st of r.stimuli) {
      $('#img-zip-text').textContent = `Отрисовка PNG: ${++i} из ${r.stimuli.length}`;
      await tick();
      drawImageStimulus(canvas, st, (id) => state.items.find((x) => x.id === id).img, r.layout);
      const blob = await canvasToBlob(canvas);
      entries.push({ name: `stimuli/${st.name}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const ins = readInstruction();
    if (ins.on) {
      drawInstruction(canvas, instructionOpts(r.layout, ins));
      const blob = await canvasToBlob(canvas);
      entries.unshift({ name: 'instruction.png', data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const { stimuliRows, tilesRows } = buildManifests();
    const bom = '﻿';
    entries.push({ name: 'stimuli.csv', data: enc.encode(bom + toCSV(stimuliRows)) });
    entries.push({ name: 'stimuli_tiles.csv', data: enc.encode(bom + toCSV(tilesRows)) });
    entries.push({ name: 'settings.json', data: enc.encode(JSON.stringify({
      experiment: 'images-2x2', generated: new Date().toISOString(),
      options: r.options, layout: r.layout, saliencyMethod: r.method, seedUsed: r.seedUsed,
      instruction: ins.on ? { title: ins.title, body: ins.body, footer: ins.footer } : null,
    }, null, 2)) });
    const zip = buildZip(entries);
    downloadBlob(new Blob([zip], { type: 'application/zip' }), `emotional_images_stimuli_${stamp()}.zip`);
    toastSuccess(`Архив готов: ${r.stimuli.length} PNG + таблицы`);
  } catch (e) {
    toastError(`Не удалось собрать архив: ${e.message}`);
  } finally {
    busy.hidden = true;
    $('#img-dl-zip').disabled = false;
  }
}

/* ---------------- инструкция ---------------- */

const readInstruction = () => ({
  on: $('#img-instr-on').checked,
  title: $('#img-instr-title').value.trim(),
  body: $('#img-instr-body').value,
  footer: $('#img-instr-footer').value.trim(),
});

const instructionOpts = (L, ins) => ({
  width: L.width, height: L.height, background: L.background,
  fontFamily: 'Arial, Helvetica, sans-serif', title: ins.title, body: ins.body, footer: ins.footer,
});

function updateInstructionPreview() {
  const L = readLayout();
  const s = 960 / L.width;
  drawInstruction($('#img-instr-canvas'), instructionOpts({ ...L, width: Math.round(L.width * s), height: Math.round(L.height * s) }, readInstruction()));
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

/* ---------------- инициализация ---------------- */

export function initImagesGenerator() {
  $('#img-groups').innerHTML = GROUPS.map((g) =>
    `<label class="check"><input type="checkbox" value="${g.key}" checked><span>${g.ru}</span></label>`).join('');
  $('#img-metrics').innerHTML = SAL_KEYS.map((k) =>
    `<label class="check"><input type="checkbox" value="${k}" checked><span>${SAL_LABELS[k]}</span></label>`).join('');
  $('#img-bulk-group').innerHTML = GROUPS.map((g) => `<option value="${g.key}">${g.ru}</option>`).join('');

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
  $('#img-instr-body').value = IMAGES_INSTRUCTION.body;
  $('#img-instr-title').value = IMAGES_INSTRUCTION.title;
  $('#img-instr-footer').value = IMAGES_INSTRUCTION.footer;
  $$('#mode-img-gen .params-card input, #mode-img-gen .params-card select').forEach((el) => {
    if (el.id === 'img-method' || el.id.includes('-instr-')) return;
    el.addEventListener('change', () => { invalidateResult(); refreshDerived(); updateInstructionPreview(); });
  });
  $$('#mode-img-gen [id^="img-instr-"]').forEach((el) => el.addEventListener('input', updateInstructionPreview));
  updateInstructionPreview();
  $('#img-generate').addEventListener('click', generate);
  renderFeasibility();
}

// для тестов в браузере
export const _state = state;
