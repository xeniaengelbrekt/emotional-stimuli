/* ============================================================
   words/ui.js — интерфейс «Слова · создание стимулов»
   ============================================================ */

import { $, $$, esc, tick, bindDropzone, downloadBlob, downloadText, canvasToBlob, readText, openViewer, fmt } from '../common/ui.js';
import { parseCSV, parseNum, findColumn, toCSV } from '../common/csv.js';
import { buildZip } from '../common/zip.js';
import { EMOTIONS, EMOTION_KEYS, EMOTION_BY_KEY, EMOTION_ALIASES, classifyEmotion, scaleStats } from '../common/emotions.js';
import { formatP } from '../core/stats.js';
import { toastError, toastSuccess, toastInfo } from '../core/toast.js';
import { generateWordStimuli, checkFeasibility, balanceReport, logFreq, gridFor } from './generator.js';
import { drawWordStimulus, fitFontSizes, applyCase, recommendFontSize } from './render.js';
import { drawInstruction, WORDS_INSTRUCTION } from '../common/instruction.js';

const state = { rawRows: [], words: [], result: null, fontSizes: null, fileName: '', sizeTouched: false, recSize: null };

const WORD_COL = ['word', 'слово', 'stimulus', 'стимул', 'lemma', 'лемма'];
const FREQ_COL = ['freq', 'frequency', 'частотность', 'частота', 'ipm', 'fpm', 'freqipm'];

const num = (id, d) => { const v = parseNum($(id).value); return v == null ? d : v; };

function readOptions() {
  const levels = [...new Set($('#word-levels').value.split(/[,;\s]+/).map((x) => Math.round(Number(x))).filter((x) => x >= 4 && x <= 200))].sort((a, b) => a - b);
  return {
    levels: levels.length ? levels : [20, 30, 40],
    controlPerCategory: Math.max(0, Math.round(num('#word-ctrl', 1))),
    experimentalPerCategory: Math.max(0, Math.round(num('#word-exp', 1))),
    allowRepeats: $('#word-repeats').checked,
    distractorMode: $('#word-dmode').value,
    matchLength: $('#word-mlen').checked,
    matchFreq: $('#word-mfreq').checked,
    seed: Math.round(num('#word-seed', 1)),
  };
}

function readFontFamily() {
  const v = $('#word-font').value;
  if (v !== 'custom') return v;
  const name = $('#word-font-custom').value.trim().replace(/['"]/g, '');
  return name ? `'${name}', Arial, sans-serif` : 'Arial, Helvetica, sans-serif';
}

/** Рекомендуемый размер — по уровню с наибольшим числом слов и самому длинному слову списка. */
function updateSizeRecommendation() {
  const hint = $('#word-size-hint');
  const btn = $('#word-size-apply');
  const eligible = state.words.filter((w) => w.category);
  if (!eligible.length) {
    state.recSize = null;
    btn.hidden = true;
    hint.textContent = 'Загрузите список слов — размер подберётся по самому большому уровню сложности.';
    return;
  }
  const levels = readOptions().levels;
  const N = Math.max(...levels);
  const rec = recommendFontSize(eligible.map((w) => w.word), readLayout(), N, measurer);
  state.recSize = rec.size;
  if (!state.sizeTouched) $('#word-size').value = rec.size;
  const cur = num('#word-size', rec.size);
  hint.innerHTML = `Рекомендуется <strong class="hl">${rec.size} пикс.</strong> — по уровню с наибольшим числом слов (${N}): ` +
    `сетка ${rec.cols}×${rec.rows}, ячейка ${rec.cellW}×${rec.cellH} пикс., самое длинное слово «${esc(rec.longest)}». ` +
    (cur > rec.size ? '<span class="warn-text">Заданный размер больше: слова на этом уровне будут уменьшены автоматически.</span> ' : '') +
    'Заданный размер — максимум: если слова не помещаются, шрифт уровня уменьшается.';
  btn.hidden = cur === rec.size;
}

function readLayout() {
  const W = Math.max(640, Math.round(num('#word-w', 1920)));
  const H = Math.max(480, Math.round(num('#word-h', 1080)));
  const k = W / 1920;
  return {
    width: W, height: H,
    fontFamily: readFontFamily(),
    fontSize: Math.max(10, num('#word-size', 40)),
    textCase: $('#word-case').value,
    jitter: num('#word-jitter', 70) / 100,
    background: $('#word-bg').value,
    color: $('#word-fg').value,
    instruction: $('#word-instr').value.includes('{word}') ? $('#word-instr').value : 'Найдите слово: {word}',
    instructionScale: 1.35,
    topBand: 0.16,
    marginX: Math.round(80 * k),
    marginBottom: Math.round(60 * k),
  };
}

/* ---------------- загрузка слов ---------------- */

async function loadFile(files) {
  const file = files[0];
  try {
    const { columns, rows } = parseCSV(await readText(file));
    const wordCol = findColumn(columns, WORD_COL) || columns[0];
    const scale = {};
    for (const k of EMOTION_KEYS) scale[k] = findColumn(columns, EMOTION_ALIASES[k]);
    const missing = EMOTION_KEYS.filter((k) => !scale[k]).map((k) => EMOTION_BY_KEY[k].ru.toLowerCase());
    if (missing.length) { toastError(`В CSV нет колонок: ${missing.join(', ')}`, 7000); return; }
    const freqCol = findColumn(columns, FREQ_COL);
    const seen = new Set();
    let dup = 0, bad = 0;
    state.rawRows = [];
    for (const r of rows) {
      const word = (r[wordCol] || '').trim();
      if (!word) continue;
      const key = word.toLocaleLowerCase('ru');
      if (seen.has(key)) { dup++; continue; }
      seen.add(key);
      const ratings = Object.fromEntries(EMOTION_KEYS.map((k) => [k, parseNum(r[scale[k]])]));
      if (EMOTION_KEYS.some((k) => ratings[k] == null)) { bad++; continue; }
      state.rawRows.push({
        id: key, word, ratings, len: [...word].length,
        freq: freqCol ? parseNum(r[freqCol]) : null,
      });
    }
    state.fileName = file.name;
    $('#word-info').textContent =
      `${file.name}: слов ${state.rawRows.length}` +
      (freqCol ? '' : ' · колонки частотности нет — по частотности слова не уравниваются') +
      (dup ? ` · повторов в списке пропущено: ${dup}` : '') + (bad ? ` · без полных оценок: ${bad}` : '');
    if (!state.rawRows.length) { toastError('В файле нет подходящих строк'); return; }
    invalidate();
    state.sizeTouched = false;
    refreshWords();
    toastSuccess(`Загружено слов: ${state.rawRows.length}`);
  } catch (e) {
    toastError(`CSV не прочитан: ${e.message}`);
  }
}

function classify() {
  const opts = {
    margin: Math.max(0, num('#word-margin', 0)),
    zStats: $('#word-zscale').checked ? scaleStats(state.rawRows.map((w) => ({ ratings: w.ratings }))) : null,
  };
  state.words = state.rawRows.map((w) => ({ ...w, category: classifyEmotion(w.ratings, opts) }));
}

const chip = (c) => c
  ? `<span class="emo-chip" style="--c:${EMOTION_BY_KEY[c].color}">${EMOTION_BY_KEY[c].ru}</span>`
  : '<span class="emo-chip emo-none">—</span>';

function refreshWords() {
  classify();
  $('#word-clear').disabled = !state.rawRows.length;
  $('#word-table-block').hidden = !state.words.length;
  const LIMIT = 300;
  const head = `<thead><tr><th>Слово</th>${EMOTIONS.map((e) => `<th>${e.ru}</th>`).join('')}<th>Эмоция</th><th>Длина, букв</th><th>Частотность</th></tr></thead>`;
  const body = state.words.slice(0, LIMIT).map((w) => `
    <tr><td>${esc(w.word)}</td>${EMOTION_KEYS.map((k) => `<td class="num">${w.ratings[k]}</td>`).join('')}
    <td>${chip(w.category)}</td><td class="num">${w.len}</td><td class="num">${w.freq ?? '—'}</td></tr>`).join('');
  const more = state.words.length > LIMIT ? `<tr><td colspan="9" class="muted">… и ещё ${state.words.length - LIMIT} (показаны первые ${LIMIT})</td></tr>` : '';
  $('#word-table').innerHTML = head + `<tbody>${body}${more}</tbody>`;
  renderFeasibility();
  updateSizeRecommendation();
}

/* ---------------- выполнимость ---------------- */

function renderFeasibility() {
  const box = $('#word-feas');
  const gen = $('#word-generate');
  if (!state.words.length) { box.innerHTML = ''; gen.disabled = true; $('#word-plan').textContent = ''; return; }
  const opts = readOptions();
  const eligible = state.words.filter((w) => w.category);
  const f = checkFeasibility(eligible, opts);
  const per = opts.levels.length * 4;
  const nCtrl = per * opts.controlPerCategory;
  const nExp = per * opts.experimentalPerCategory;
  $('#word-plan').innerHTML = `План: <strong class="hl">${nCtrl}</strong> контрольных + <strong class="hl">${nExp}</strong> экспериментальных = <strong class="hl">${nCtrl + nExp}</strong>`;
  const table = `
    <div class="data-table-wrap tool-gap narrow"><table class="data-table feas-table">
      <thead><tr><th>Доступно / нужно слов</th>${EMOTIONS.map((e) => `<th>${e.ru}</th>`).join('')}</tr></thead>
      <tbody><tr><td>Все уровни (${opts.levels.join(', ')})</td>${f.rows.map((r) => `<td class="num ${r.ok ? 'ok-cell' : 'bad-cell'}">${r.have} / ${r.need}</td>`).join('')}</tr></tbody>
    </table></div>`;
  const excl = state.words.length - eligible.length;
  const withoutFreq = state.words.filter((w) => w.freq == null).length;
  box.innerHTML = `
    ${f.ok ? '' : `<div class="alert warn"><strong>Слов не хватает для заданного числа стимулов${opts.allowRepeats ? '' : ' без повторов'}.</strong>
      <ul>${f.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      Можно загрузить больше слов, убрать лишний уровень сложности, уменьшить число стимулов или разрешить повторы.
      Если сформировать так, как есть, будет собрано максимум возможного.</div>`}
    ${excl ? `<div class="alert info">${excl} слов не получили категорию (равные или близкие оценки) и не участвуют в подборе.</div>` : ''}
    ${opts.matchFreq && withoutFreq ? `<div class="alert info">Частотность задана не для ${withoutFreq} слов — по частотности слова уравниваться не будут.</div>` : ''}
    ${table}`;
  gen.disabled = nCtrl + nExp === 0;
}

/* ---------------- генерация ---------------- */

const measurer = (() => {
  let ctx = null;
  return (text, font) => {
    ctx = ctx || document.createElement('canvas').getContext('2d');
    ctx.font = font;
    return ctx.measureText(text).width;
  };
})();

function generate() {
  const opts = readOptions();
  const layout = readLayout();
  const area = { w: layout.width - 2 * layout.marginX, h: layout.height - Math.round(layout.height * layout.topBand) - layout.marginBottom };
  const res = generateWordStimuli(state.words, { ...opts, layoutArea: area });
  state.layout = layout;
  state.fontSizes = fitFontSizes(res.stimuli, layout, measurer);
  state.result = { ...res, options: opts, layout };
  renderResults();
  $('#word-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (res.warnings.length) toastError('Есть предупреждения — см. блок результатов', 6000);
  else toastSuccess(`Собрано стимулов: ${res.built}`);
}

function invalidate() {
  if (state.result) {
    state.result = null;
    $('#word-results').hidden = true;
    $('#word-results').innerHTML = '';
  }
}

/* ---------------- результаты ---------------- */

function renderResults() {
  const r = state.result;
  const box = $('#word-results');
  box.hidden = false;
  const ctrl = r.stimuli.filter((s) => s.type === 'control').length;
  const exp = r.stimuli.length - ctrl;
  const bal = balanceReport(r.stimuli);
  const label = { len: 'Длина слова (букв)', logfreq: 'log10 частотности' };
  const pTxt = (a) => (a ? `F(${a.df1}, ${a.df2}) = ${fmt(a.F, 2)}, p ${formatP(a.p).startsWith('<') ? formatP(a.p) : '= ' + formatP(a.p)}` : '—');
  const rows = bal.filter((b) => !(b.metric === 'logfreq' && b.perCat.every((p) => !p.n))).map((b) => `
    <tr><td>${b.scope === 'all' ? 'Все слова' : 'Целевые'} · ${label[b.metric]}</td>
      ${b.perCat.map((p) => `<td class="num">${fmt(p.mean, 2)} <span class="muted">± ${fmt(p.sd, 2)}</span> <span class="muted">(n=${p.n})</span></td>`).join('')}
      <td class="num ${b.anova && b.anova.p < 0.05 ? 'bad-cell' : 'ok-cell'}">${pTxt(b.anova)}</td></tr>`).join('');

  // где оказались целевые слова: зоны 3×3
  const zones = [...Array(9)].map(() => 0);
  for (const st of r.stimuli) {
    const row = Math.floor(st.targetCell / st.grid.cols), col = st.targetCell % st.grid.cols;
    zones[Math.min(2, Math.floor((row / st.grid.rows) * 3)) * 3 + Math.min(2, Math.floor((col / st.grid.cols) * 3))]++;
  }
  const zoneTable = [0, 1, 2].map((rw) => `<tr>${[0, 1, 2].map((c) => `<td class="num">${zones[rw * 3 + c]}</td>`).join('')}</tr>`).join('');

  const used = new Map();
  for (const st of r.stimuli) for (const w of [st.target, ...st.distractors]) used.set(w.id, (used.get(w.id) || 0) + 1);
  const repeated = [...used.values()].filter((n) => n > 1).length;

  box.innerHTML = `
    <h3 class="step-title"><span class="step-num">3</span>Результат</h3>
    ${r.warnings.length ? `<div class="alert warn"><strong>Предупреждения</strong><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <div class="alert ${r.built === r.requested ? 'ok' : 'warn'}">
      Собрано стимулов: <strong>${r.built}</strong> из ${r.requested} (контрольных ${ctrl}, экспериментальных ${exp}).
      Использовано слов: ${used.size}${repeated ? `, из них повторяются: ${repeated}` : ', повторов нет'}.
    </div>
    <div class="toolbar tool-gap">
      <div class="subtab-bar flush" id="word-filter">
        <button class="subtab active" data-f="all" type="button">Все</button>
        <button class="subtab" data-f="control" type="button">Контрольные</button>
        <button class="subtab" data-f="experimental" type="button">Экспериментальные</button>
      </div>
      <span class="toolbar-spacer"></span>
      <button class="btn" id="word-dl-csv" type="button">↓ CSV</button>
      <button class="btn btn-primary" id="word-dl-zip" type="button">↓ PNG-архив (ZIP)</button>
    </div>
    <div class="busy-bar tool-gap" id="word-zip-busy" hidden><span class="busy-spinner"></span><span id="word-zip-text"></span></div>
    <div class="result-grid stim-grid" id="word-gallery"></div>

    <h4 class="sub-heading">Баланс по длине и частотности между эмоциональными категориями</h4>
    <p class="muted-p">Однофакторный ANOVA по уникальным словам: p &gt; .05 — категории не различаются. Слова одного стимула подобраны под его целевое слово, поэтому наблюдения не полностью независимы — таблица ориентировочная.</p>
    <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Показатель</th>${EMOTIONS.map((e) => `<th>${e.ru}</th>`).join('')}<th>ANOVA</th></tr></thead><tbody>${rows}</tbody></table></div>

    <h4 class="sub-heading">Где стоят целевые слова</h4>
    <p class="muted-p">Число стимулов, где целевое слово попало в каждую из 9 зон экрана (под инструкцией).</p>
    <div class="data-table-wrap narrow zone-table"><table class="data-table"><tbody>${zoneTable}</tbody></table></div>
  `;
  $('#word-dl-zip').addEventListener('click', downloadArchive);
  $('#word-dl-csv').addEventListener('click', () => {
    const { stimuliRows, wordsRows } = buildManifests();
    downloadText(toCSV(stimuliRows), 'stimuli.csv');
    setTimeout(() => downloadText(toCSV(wordsRows), 'stimuli_words.csv'), 300);
  });
  $$('#word-filter .subtab').forEach((b) => b.addEventListener('click', () => {
    $$('#word-filter .subtab').forEach((x) => x.classList.toggle('active', x === b));
    renderGallery(b.dataset.f);
  }));
  renderGallery('all');
}

const THUMB_W = 480;

function scaledLayout(L, s) {
  return { ...L, width: Math.round(L.width * s), height: Math.round(L.height * s), fontSize: L.fontSize * s,
    marginX: L.marginX * s, marginBottom: L.marginBottom * s };
}

function renderGallery(filter) {
  const r = state.result;
  const grid = $('#word-gallery');
  grid.innerHTML = '';
  const s = THUMB_W / r.layout.width;
  const L = scaledLayout(r.layout, s);
  for (const st of r.stimuli.filter((x) => filter === 'all' || x.type === filter)) {
    const card = document.createElement('div');
    card.className = 'result-card stim-card';
    const canvas = document.createElement('canvas');
    drawWordStimulus(canvas, st, L, state.fontSizes[st.N] * s);
    const e = EMOTION_BY_KEY[st.category];
    card.innerHTML = `
      <div class="result-thumb stim-thumb"><span class="result-tag">${st.type === 'control' ? 'контроль' : 'эксперимент'}</span></div>
      <div class="result-body">
        <div class="result-name">${esc(st.name)}</div>
        <div class="result-stats"><span>${st.N} слов</span>
          <span>цель: <span class="emo-chip" style="--c:${e.color}">${e.ru}</span></span></div>
      </div>`;
    card.querySelector('.stim-thumb').prepend(canvas);
    card.addEventListener('click', () => view(st));
    grid.appendChild(card);
  }
}

function view(st) {
  const r = state.result;
  const dist = {};
  st.distractors.forEach((w) => { dist[w.category] = (dist[w.category] || 0) + 1; });
  const rows = EMOTION_KEYS.filter((c) => dist[c] || c === st.target.category).map((c) => {
    const n = (dist[c] || 0) + (c === st.target.category ? 1 : 0);
    return `<tr><td><span class="emo-chip" style="--c:${EMOTION_BY_KEY[c].color}">${EMOTION_BY_KEY[c].ru}</span></td><td class="num">${n}</td></tr>`;
  }).join('');
  openViewer({
    title: st.name,
    info: `<p class="muted-p">Целевое слово: <strong class="hl">${esc(st.target.word)}</strong> (${EMOTION_BY_KEY[st.target.category].ru.toLowerCase()}, ${st.target.len} букв${st.target.freq != null ? `, частотность ${st.target.freq}` : ''}); ячейка ${st.targetCell + 1} из ${st.grid.rows * st.grid.cols}.</p>
      <div class="data-table-wrap narrow"><table class="data-table"><thead><tr><th>Категория</th><th>Слов (с целевым)</th></tr></thead><tbody>${rows}</tbody></table></div>`,
    canvasFactory: () => {
      const c = document.createElement('canvas');
      drawWordStimulus(c, st, r.layout, state.fontSizes[st.N]);
      return c;
    },
  });
}

/* ---------------- экспорт ---------------- */

function manifestsFrom(boxesByStim) {
  const r = state.result;
  const stimuliRows = [];
  const wordsRows = [];
  for (const st of r.stimuli) {
    const boxes = boxesByStim.get(st.name);
    stimuliRows.push({
      stimulus: st.name, type: st.type, n_words: st.N, target_category: st.category,
      distractors: st.type === 'control' ? 'same category' : (st.distractorMode === 'all' ? 'all categories' : 'other categories'),
      target_word: st.target.word, target_length: st.target.len, target_frequency: st.target.freq ?? '',
      target_cell: st.targetCell + 1, target_row: Math.floor(st.targetCell / st.grid.cols) + 1, target_col: (st.targetCell % st.grid.cols) + 1,
      grid_rows: st.grid.rows, grid_cols: st.grid.cols, font_px: state.fontSizes[st.N],
      width: r.layout.width, height: r.layout.height,
      mean_length: (st.cells.reduce((a, c) => a + c.item.len, 0) / st.cells.length).toFixed(2),
      mean_log_frequency: st.cells.every((c) => c.item.freq != null)
        ? (st.cells.reduce((a, c) => a + logFreq(c.item.freq), 0) / st.cells.length).toFixed(3) : '',
    });
    for (const b of boxes) {
      const w = st.cells.find((c) => c.cell === b.cell).item;
      wordsRows.push({
        stimulus: st.name, type: st.type, word: w.word, is_target: b.isTarget ? 1 : 0, emotion_category: w.category,
        length: w.len, frequency: w.freq ?? '',
        rating_neutral: w.ratings.neutral, rating_positive: w.ratings.positive, rating_sad: w.ratings.sad, rating_threat: w.ratings.threat,
        cell: b.cell + 1, row: b.row, col: b.col, aoi_x: b.x, aoi_y: b.y, aoi_w: b.w, aoi_h: b.h,
      });
    }
  }
  return { stimuliRows, wordsRows };
}

function buildManifests() {
  const r = state.result;
  const c = document.createElement('canvas');
  const map = new Map();
  for (const st of r.stimuli) map.set(st.name, drawWordStimulus(c, st, r.layout, state.fontSizes[st.N]));
  return manifestsFrom(map);
}

async function downloadArchive() {
  const r = state.result;
  const busy = $('#word-zip-busy');
  busy.hidden = false;
  $('#word-dl-zip').disabled = true;
  try {
    const enc = new TextEncoder();
    const entries = [];
    const canvas = document.createElement('canvas');
    const boxes = new Map();
    let i = 0;
    for (const st of r.stimuli) {
      $('#word-zip-text').textContent = `Отрисовка PNG: ${++i} из ${r.stimuli.length}`;
      await tick();
      boxes.set(st.name, drawWordStimulus(canvas, st, r.layout, state.fontSizes[st.N]));
      const blob = await canvasToBlob(canvas);
      entries.push({ name: `stimuli/${st.name}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const ins = readInstruction();
    if (ins.on) {
      drawInstruction(canvas, instructionOpts(r.layout, ins));
      const blob = await canvasToBlob(canvas);
      entries.unshift({ name: 'instruction.png', data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const { stimuliRows, wordsRows } = manifestsFrom(boxes);
    entries.push({ name: 'stimuli.csv', data: enc.encode('﻿' + toCSV(stimuliRows)) });
    entries.push({ name: 'stimuli_words.csv', data: enc.encode('﻿' + toCSV(wordsRows)) });
    entries.push({ name: 'settings.json', data: enc.encode(JSON.stringify({
      experiment: 'word-search', generated: new Date().toISOString(),
      options: r.options, layout: r.layout, fontSizes: state.fontSizes, seedUsed: r.seedUsed, wordList: state.fileName,
      instruction: ins.on ? { title: ins.title, body: ins.body, footer: ins.footer } : null,
    }, null, 2)) });
    downloadBlob(new Blob([buildZip(entries)], { type: 'application/zip' }), `emotional_words_stimuli_${stamp()}.zip`);
    toastSuccess(`Архив готов: ${r.stimuli.length} PNG + таблицы`);
  } catch (e) {
    toastError(`Не удалось собрать архив: ${e.message}`);
  } finally {
    busy.hidden = true;
    $('#word-dl-zip').disabled = false;
  }
}

/* ---------------- инструкция ---------------- */

const readInstruction = () => ({
  on: $('#word-instr-on').checked,
  title: $('#word-instr-title').value.trim(),
  body: $('#word-instr-body').value,
  footer: $('#word-instr-footer').value.trim(),
});

const instructionOpts = (L, ins) => ({
  width: L.width, height: L.height, background: L.background, color: L.color,
  fontFamily: L.fontFamily, title: ins.title, body: ins.body, footer: ins.footer,
});

function updateInstructionPreview() {
  const L = readLayout();
  const s = 960 / L.width;
  drawInstruction($('#word-instr-canvas'), instructionOpts({ ...L, width: Math.round(L.width * s), height: Math.round(L.height * s) }, readInstruction()));
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

function downloadTemplate() {
  const rows = [
    ['дом', 6.2, 1.8, 1.1, 1.0, 650.3],
    ['радость', 1.3, 6.5, 1.2, 1.1, 120.4],
    ['одиночество', 1.5, 1.4, 6.1, 1.9, 35.2],
    ['опасность', 1.4, 1.2, 2.0, 6.4, 90.7],
  ].map(([w, n, p, s, t, f]) => ({ 'слово': w, 'нейтральность': n, 'позитивность': p, 'грусть': s, 'угроза': t, 'частотность': f }));
  downloadText(toCSV(rows), 'words_template.csv');
}

/* ---------------- инициализация ---------------- */

export function initWordsGenerator() {
  bindDropzone($('#word-dropzone'), $('#word-file'), loadFile);
  $('#word-template').addEventListener('click', downloadTemplate);
  $('#word-clear').addEventListener('click', () => {
    state.rawRows = []; state.words = [];
    $('#word-info').textContent = 'Столбцы: слово, нейтральность, позитивность, грусть, угроза, частотность (необязательно, на миллион слов); длина считается автоматически';
    invalidate(); refreshWords();
  });
  $('#word-instr-body').value = WORDS_INSTRUCTION.body;
  $('#word-instr-title').value = WORDS_INSTRUCTION.title;
  $('#word-instr-footer').value = WORDS_INSTRUCTION.footer;
  $$('#mode-word-gen [id^="word-instr-"]').forEach((el) => el.addEventListener('input', updateInstructionPreview));
  $$('#mode-word-gen .params-card input, #mode-word-gen .params-card select').forEach((el) => {
    if (el.id.startsWith('word-instr-')) return;
    el.addEventListener('change', () => {
      updateInstructionPreview();
      updateSizeRecommendation();
      invalidate();
      if (el.id === 'word-margin' || el.id === 'word-zscale') refreshWords(); else renderFeasibility();
    });
  });
  $('#word-generate').addEventListener('click', generate);
  $('#word-font').addEventListener('change', () => { $('#word-font-custom').hidden = $('#word-font').value !== 'custom'; });
  $('#word-font-custom').addEventListener('change', () => { invalidate(); updateInstructionPreview(); updateSizeRecommendation(); });
  $('#word-size').addEventListener('input', () => { state.sizeTouched = true; updateSizeRecommendation(); });
  $('#word-size-apply').addEventListener('click', () => {
    state.sizeTouched = false; $('#word-size').value = state.recSize; invalidate(); updateSizeRecommendation();
  });
  updateInstructionPreview();
  renderFeasibility();
}

export const _state = state;
export { gridFor, applyCase };
