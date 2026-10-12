/* ============================================================
   words/ui.js — «Поиск эмоционально окрашенных слов · создание стимулов»
   ============================================================ */

import { $, $$, esc, tick, bindDropzone, downloadText, readText, fmt } from '../../common/ui.js';
import { parseCSV, parseNum, findColumn, toCSV } from '../../common/csv.js';
import { EMOTIONS, EMOTION_KEYS, EMOTION_BY_KEY, EMOTION_ALIASES, classifyEmotion, scaleStats } from '../../common/emotions.js';
import { formatP, meanOf, sdOf } from '../../core/stats.js';
import { toastError, toastSuccess } from '../../core/toast.js';
import { fld, fontField, bindFont } from '../../kit/fields.js';
import { panelHead, stepTitle, card, grid, sep, sub, generateBar } from '../../kit/panel.js';
import { instructionEditorHtml, mountInstructionEditor, drawInstructionText } from '../../kit/instr.js';
import { mountResults, metricTable } from '../../kit/results.js';
import { evaluateSalience, relativeAoiSalience, salienceBalance, METHOD_LABELS } from '../../kit/salience.js';
import { meanLuminance as stimLuminance } from '../../kit/luminance.js';
import { BG, FG, NEXT_LINE, START_LINE } from '../../kit/defaults.js';
import * as M from '../../kit/methods.js';
import { generateWordStimuli, checkFeasibility, balanceReport, logFreq, gridFor } from './generator.js';
import { drawWordStimulus, fitFontSizes, applyCase, recommendFontSize } from './render.js';

let editor = null;
const INSTRUCTION = [
  'Вверху экрана написано слово, которое нужно найти. Ниже расположена таблица со словами.',
  '',
  'Найдите это слово как можно быстрее и щёлкните по нему левой кнопкой мыши.',
  '',
  NEXT_LINE,
  START_LINE,
].join('\n');

const state = { rawRows: [], words: [], result: null, fontSizes: null, fileName: '', sizeTouched: false, recSize: null };

const INFO_DEFAULT = 'Столбцы: слово, нейтральность, позитивность, грусть, угроза, частотность (необязательно, на миллион слов); длина считается автоматически';
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
    ${opts.matchFreq && withoutFreq ? `<div class="alert info">Частотность не задана для ${withoutFreq} слов — им подставляется средняя, уравнивание остальных по частотности работает.</div>` : ''}
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

function invalidate() {
  const box = $('#word-results');
  if (box && !box.hidden) { box.hidden = true; box.innerHTML = ''; }
}

const busy = (on, text) => { $('#word-busy').hidden = !on; if (text) $('#word-busy-text').textContent = text; };

function scaledLayout(L, s) {
  return { ...L, width: Math.round(L.width * s), height: Math.round(L.height * s), fontSize: L.fontSize * s,
    marginX: L.marginX * s, marginBottom: L.marginBottom * s };
}

async function generate() {
  const opts = readOptions();
  const L = readLayout();
  const salOn = $('#word-sal-on').checked;
  const method = $('#word-sal-method').value;
  const btn = $('#word-generate');
  btn.disabled = true;
  busy(true, 'Подбор слов…');
  try {
    await tick();
    const area = { w: L.width - 2 * L.marginX, h: L.height - Math.round(L.height * L.topBand) - L.marginBottom };
    const res = generateWordStimuli(state.words, { ...opts, layoutArea: area });
    if (!res.stimuli.length) throw new Error('Не удалось собрать ни одного стимула — проверьте таблицу «доступно / нужно слов»');
    const fontSizes = fitFontSizes(res.stimuli, L, measurer);
    const scratch = document.createElement('canvas');
    const stimuli = res.stimuli.map((st) => {
      const obj = {
        ...st, filter: st.type, tag: st.type === 'control' ? 'контроль' : 'эксперимент',
        draw: (canvas, scale = 1) => drawWordStimulus(canvas, st, scale === 1 ? L : scaledLayout(L, scale), fontSizes[st.N] * scale),
      };
      obj.boxes = drawWordStimulus(scratch, st, L, fontSizes[st.N]);
      return obj;
    });
    if (salOn) {
      let i = 0;
      for (const st of stimuli) {
        busy(true, `Оценка салиентности стимулов (${method.toUpperCase()}): ${++i} из ${stimuli.length}`);
        await tick();
        const ev = evaluateSalience(st, L.width, L.height, method);
        st.sal = ev.metrics;
        st.rel = st.boxes.map((b) => relativeAoiSalience(ev.map, b, L.width, L.height));
      }
    }
    for (const st of stimuli) {
      const e = EMOTION_BY_KEY[st.category];
      st.badges = `<span>${st.N} слов</span><span>цель: <span class="emo-chip" style="--c:${e.color}">${e.ru}</span></span>`;
      const dist = {};
      st.distractors.forEach((w) => { dist[w.category] = (dist[w.category] || 0) + 1; });
      const rowsT = EMOTION_KEYS.filter((c) => dist[c] || c === st.target.category).map((c) => `<tr><td><span class="emo-chip" style="--c:${EMOTION_BY_KEY[c].color}">${EMOTION_BY_KEY[c].ru}</span></td><td class="num">${(dist[c] || 0) + (c === st.target.category ? 1 : 0)}</td></tr>`).join('');
      st.infoHtml = `<p class="muted-p">Искомое слово: <strong class="hl">${esc(st.target.word)}</strong> (${EMOTION_BY_KEY[st.target.category].ru.toLowerCase()}, ${st.target.len} букв${st.target.freq != null ? `, частотность ${st.target.freq}` : ''}); ячейка ${st.targetCell + 1} из ${st.grid.rows * st.grid.cols}.</p>
        <div class="data-table-wrap narrow"><table class="data-table"><thead><tr><th>Категория</th><th>Слов (с искомым)</th></tr></thead><tbody>${rowsT}</tbody></table></div>`;
    }
    showResults(res, stimuli, opts, L, fontSizes, salOn, method);
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
const pText = (a) => (a ? `F(${a.df1}, ${a.df2}) = ${a.F.toFixed(2)}, p ${formatP(a.p).startsWith('<') ? formatP(a.p) : '= ' + formatP(a.p)}` : '—');

function showResults(res, stimuli, opts, L, fontSizes, salOn, method) {
  const W = L.width; const H = L.height;
  const wordOf = (st, b) => st.cells.find((c) => c.cell === b.cell).item;
  const lum = new Map(stimuli.map((st) => [st.name, stimLuminance(st, W)]));
  const rows = stimuli.map((st) => {
    const r = {
      stimulus: st.name, type: st.type, n_words: st.N, target_category: st.category,
      distractors: st.type === 'control' ? 'same category' : (st.distractorMode === 'all' ? 'all categories' : 'other categories'),
      target_word: st.target.word, target_length: st.target.len, target_frequency: st.target.freq ?? '',
      target_cell: st.targetCell + 1, target_row: Math.floor(st.targetCell / st.grid.cols) + 1, target_col: (st.targetCell % st.grid.cols) + 1,
      grid_rows: st.grid.rows, grid_cols: st.grid.cols, font_px: fontSizes[st.N], width: W, height: H,
      mean_luminance: lum.get(st.name),
      mean_length: (st.cells.reduce((a, c) => a + c.item.len, 0) / st.cells.length).toFixed(2),
      mean_log_frequency: st.cells.every((c) => c.item.freq != null) ? (st.cells.reduce((a, c) => a + logFreq(c.item.freq), 0) / st.cells.length).toFixed(3) : '',
    };
    if (st.sal) {
      for (const k of ['mean', 'entropy', 'center_bias', 'spread_pct']) r[`screen_salience_${k}`] = st.sal[k];
      r.target_salience_rel = f3(st.rel[st.boxes.findIndex((b) => b.isTarget)]);
    }
    return r;
  });
  const wordsRows = [];
  for (const st of stimuli) {
    st.boxes.forEach((b, k) => {
      const w = wordOf(st, b);
      wordsRows.push({
        stimulus: st.name, type: st.type, word: w.word, is_target: b.isTarget ? 1 : 0, emotion_category: w.category,
        length: w.len, frequency: w.freq ?? '',
        rating_neutral: w.ratings.neutral, rating_positive: w.ratings.positive, rating_sad: w.ratings.sad, rating_threat: w.ratings.threat,
        cell: b.cell + 1, row: b.row, col: b.col, aoi_x: b.x, aoi_y: b.y, aoi_w: b.w, aoi_h: b.h,
        salience_rel: st.rel ? f3(st.rel[k]) : '',
      });
    });
  }
  const keyRows = stimuli.map((st) => {
    const b = st.boxes.find((x) => x.isTarget);
    return {
      stimulus: st.name, file: `stimuli/${st.name}.png`, response_type: 'mouse_click', correct_response: st.target.word,
      aoi_x: b.x, aoi_y: b.y, aoi_w: b.w, aoi_h: b.h,
      meaning: 'верный ответ — щелчок мыши внутри рамки искомого слова (координаты в пикселях стимула), затем ПРОБЕЛ',
    };
  });
  // использованные слова
  const useInfo = new Map();
  for (const st of stimuli) for (const w of [st.target, ...st.distractors]) {
    const u = useInfo.get(w.id) || { w, total: 0, asTarget: 0 };
    u.total++; if (w === st.target) u.asTarget++;
    useInfo.set(w.id, u);
  }
  const wordList = [...useInfo.values()].map(({ w, total, asTarget }) => ({
    word: w.word, emotion_category: w.category, length: w.len, frequency: w.freq ?? '',
    rating_neutral: w.ratings.neutral, rating_positive: w.ratings.positive, rating_sad: w.ratings.sad, rating_threat: w.ratings.threat,
    times_used: total, times_as_target: asTarget,
  }));
  const repeated = wordList.filter((x) => x.times_used > 1).length;
  const ctrl = stimuli.filter((s) => s.type === 'control').length;
  const exp = stimuli.length - ctrl;

  // баланс по длине и частотности
  const label = { len: 'Длина слова (букв)', logfreq: 'log10 частотности' };
  const bal = balanceReport(stimuli);
  const balRows = bal.filter((b) => !(b.metric === 'logfreq' && b.perCat.every((p) => !p.n))).map((b) => ({
    label: `${b.scope === 'all' ? 'Все слова' : 'Целевые'} · ${label[b.metric]}`,
    cells: b.perCat.map((p) => ({ n: p.n, mean: p.mean, sd: p.sd })), extra: pText(b.anova), extraBad: b.anova ? b.anova.p < 0.05 : false,
  }));
  const catHeaders = EMOTIONS.map((e) => e.ru);
  const zones = Array(9).fill(0);
  for (const st of stimuli) {
    const row = Math.floor(st.targetCell / st.grid.cols); const col = st.targetCell % st.grid.cols;
    zones[Math.min(2, Math.floor((row / st.grid.rows) * 3)) * 3 + Math.min(2, Math.floor((col / st.grid.cols) * 3))]++;
  }
  let summary = `
    <h4 class="sub-heading">Баланс по длине и частотности между эмоциональными категориями</h4>
    <p class="muted-p">Однофакторный ANOVA по уникальным словам: p &gt; .05 — категории не различаются. Слова одного стимула подобраны под его целевое слово, поэтому наблюдения не полностью независимы — таблица ориентировочная.</p>
    ${metricTable(catHeaders, balRows)}
    <h4 class="sub-heading">Где стоят целевые слова</h4>
    <p class="muted-p">Число стимулов, где целевое слово попало в каждую из 9 зон экрана (под надписью).</p>
    <div class="data-table-wrap narrow zone-table"><table class="data-table"><tbody>${[0, 1, 2].map((rw) => `<tr>${[0, 1, 2].map((c) => `<td class="num">${zones[rw * 3 + c]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  let salRows = null; let typeRows = null; let typeHeaders = [];
  if (salOn) {
    const types = [['control', 'Контрольные'], ['experimental', 'Экспериментальные']].filter(([k]) => stimuli.some((s) => s.type === k));
    typeHeaders = types.map((t) => t[1]);
    typeRows = salienceBalance(stimuli, (s) => s.type, types);
    const vals = EMOTION_KEYS.map((c) => stimuli.filter((s) => s.category === c).map((s) => s.rel[s.boxes.findIndex((b) => b.isTarget)]).filter(Number.isFinite));
    const a = vals.every((v) => v.length > 1) ? oneWayAnovaSafe(vals) : null;
    salRows = [{ label: 'Относительная салиентность искомого слова', cells: vals.map((v) => ({ n: v.length, mean: meanOf(v), sd: sdOf(v) })), extra: pText(a), extraBad: a ? a.p < 0.05 : false }];
    summary += `
      <h4 class="sub-heading">Салиентность готовых стимулов (${esc(METHOD_LABELS[method])})</h4>
      <p class="muted-p">Оценена для всего экрана. «Относительная салиентность» — средняя салиентность рамки слова относительно среднего по экрану (1 — как в среднем). Значения для каждого слова — в <code>stimuli_words.csv</code>; их можно использовать как ковариату.</p>
      ${metricTable(typeHeaders, typeRows)}
      ${metricTable(catHeaders.map((h) => `Цель: ${h.toLowerCase()}`), salRows)}`;
  }

  const insText = editor.texts().main;
  const pngs = editor.enabled() ? [{ path: 'instruction.png', desc: 'Инструкция для участника', draw: (c, s = 1) => drawInstructionText(c, { width: W, height: H, background: L.background, color: L.color, fontFamily: L.fontFamily, text: editor.texts().main, scale: s }) }] : [];

  mountResults($('#word-results'), {
    prefix: 'word', step: 3, width: W, height: H, stimuli, title: 'Поиск эмоционально окрашенных слов',
    filters: [['control', 'Контрольные'], ['experimental', 'Экспериментальные']],
    requested: res.requested, built: stimuli.length, warnings: res.warnings,
    resultNote: `Контрольных ${ctrl}, экспериментальных ${exp}. Использовано слов: ${useInfo.size}${repeated ? `, из них повторяются: ${repeated}` : ', повторов нет'}.`,
    summaryHtml: summary, pngs, answerKey: keyRows,
    manifests: [
      { file: 'stimuli.csv', rows, desc: 'По строке на стимул: тип, число слов, категория и характеристики искомого слова, положение в сетке, размер шрифта, средняя яркость, салиентность' },
      { file: 'stimuli_words.csv', rows: wordsRows, desc: 'По строке на слово в стимуле: категория, длина, частотность, оценки, положение, область интереса в пикселях, относительная салиентность' },
      { file: 'words.csv', rows: wordList, desc: 'По строке на использованное слово: категория, длина, частотность, оценки, сколько раз использовано и сколько раз как искомое' },
    ],
    methods: () => methodsDoc({ res, stimuli, opts, L, fontSizes, salOn, method, balRows, salRows, typeRows, typeHeaders, zones, wordList, ctrl, exp, insText: editor.texts().main, instructionOn: editor.enabled() }),
    readmeIntro: 'Стимулы поиска слова: сверху надпись «Найдите слово: …», ниже сетка слов. Ответ — щелчок мыши по искомому слову, затем ПРОБЕЛ.',
    archiveName: 'emotional_words_stimuli',
    settings: { experiment: 'emotional-word-search', options: opts, layout: L, fontSizes, seedUsed: res.seedUsed, wordList: state.fileName, saliency: salOn ? method : null, instruction: editor.enabled() ? insText : null },
  });
  $('#word-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

import { oneWayAnova } from '../../core/stats.js';
const oneWayAnovaSafe = (v) => oneWayAnova(v);

/* ---------------- описание для раздела «Методы» ---------------- */

function methodsDoc(c) {
  const { H1, H2, P, TABLE, paramTable } = M;
  const { res, stimuli, opts, L, fontSizes, salOn, method, balRows, salRows, typeRows, typeHeaders, zones, wordList, ctrl, exp } = c;
  const catRu = (k) => EMOTION_BY_KEY[k].ru.toLowerCase();
  const catHeaders = EMOTIONS.map((e) => e.ru);
  const levels = [...new Set(stimuli.map((s) => s.N))].sort((a, b) => a - b);
  const wordsPerCat = EMOTION_KEYS.map((k) => String(wordList.filter((w) => w.emotion_category === k).length));
  const marginCat = num('#word-margin', 0);
  const blocks = [
    H1('Поиск эмоционально окрашенных слов: описание стимулов'),
    P(`Набор содержит ${stimuli.length} стимулов: ${ctrl} контрольных и ${exp} экспериментальных. Каждый стимул — экран ${L.width} × ${L.height} пикс.: в верхней части написано «${L.instruction.replace('{word}', 'искомое слово')}», ниже расположена сетка слов, ` +
      `расположенных вразброс (слова смещены от центров ячеек случайным образом). Участник должен найти искомое слово и щёлкнуть по нему левой кнопкой мыши, после чего нажать клавишу ПРОБЕЛ. ` +
      `Уровни сложности — число слов на экране: ${levels.join(', ')}.`),
    P('В контрольном стимуле искомое слово и все слова-дистракторы принадлежат одной эмоциональной категории. В экспериментальном искомое слово принадлежит одной категории, а дистракторы — ' +
      `${opts.distractorMode === 'all' ? 'всем четырём категориям поровну' : 'трём другим категориям в равных долях (при числе дистракторов, не делящемся на три, «лишние» слова поочерёдно достаются разным категориям)'}.`),
    H2('1. Исходный материал'),
    P(`Список содержал ${state.rawRows.length} слов (файл ${state.fileName || '—'}). Эмоциональная категория слова определялась по средним оценкам (нейтральность, позитивность, грусть, угроза): категорией считалась шкала с наибольшей оценкой` +
      `${marginCat > 0 ? `; слова, у которых главная шкала опережала вторую менее чем на ${marginCat} балла, не использовались` : '; при равных двух наибольших оценках категория не присваивалась, и слово не использовалось'}` +
      `${$('#word-zscale').checked ? '; шкалы сравнивались в стандартизованном виде (z-оценки)' : ''}. Длина слова — число букв. ${state.rawRows.some((w) => w.freq != null) ? 'Частотность задана в списке (число словоупотреблений на миллион слов); при подборе использовался её десятичный логарифм.' : 'Частотность в списке не задана; по частотности слова не уравнивались.'}`),
    P('Число использованных в наборе слов по категориям:'),
    TABLE(catHeaders, [wordsPerCat]),
    H2('2. Параметры стимулов'),
    paramTable([
      ['Размер стимула', `${L.width} × ${L.height} пикс.`],
      ['Цвет фона', M.colorText(L.background)],
      ['Цвет текста', M.colorText(L.color)],
      ['Шрифт', L.fontFamily.split(',')[0].replace(/'/g, '')],
      ['Размер шрифта слов', levels.map((n) => `${n} слов: ${fontSizes[n]} пикс.`).join('; '), `максимум задан ${L.fontSize} пикс.; при нехватке места шрифт уровня уменьшается одинаково для всех стимулов уровня`],
      ['Написание букв', { asis: 'как в списке', lower: 'строчные', upper: 'прописные' }[L.textCase]],
      ['Разброс слов внутри ячейки', `${Math.round(L.jitter * 100)}%`, '0% — строгая сетка, 100% — максимальное смещение внутри ячейки'],
      ['Надпись над сеткой', L.instruction, 'искомое слово выводится жирным'],
      ['Уровни сложности (число слов)', levels.join(', ')],
      ['Контрольных на каждую эмоцию на каждом уровне', opts.controlPerCategory],
      ['Экспериментальных на каждую эмоцию искомого слова на каждом уровне', opts.experimentalPerCategory],
      ['Слова-дистракторы в экспериментальных стимулах', opts.distractorMode === 'all' ? 'из всех четырёх категорий поровну' : 'только из других категорий'],
      ['Подбор слов, близких по', [opts.matchLength && 'длине', opts.matchFreq && 'частотности'].filter(Boolean).join(', ') || 'не используется'],
      ['Повторы слов', opts.allowRepeats ? 'допускаются' : 'не допускаются'],
      ['Номер случайного набора', `${opts.seed}${res.seedUsed != null && res.seedUsed !== opts.seed ? ` (лучший из ${opts.attempts ?? 12} вариантов подбора: ${res.seedUsed})` : ''}`],
    ]),
    H2('3. Подбор слов и расстановка'),
    P('Искомые слова четырёх эмоциональных категорий подбирались «кругами»: в каждом круге по одному слову каждой категории, максимально близких друг к другу по длине и частотности и близких к типичным значениям списка (стандартизованные длина и десятичный логарифм частотности). ' +
      'Дистракторы подбирались как ближайшие к искомому слову по тем же признакам внутри своей категории. ' +
      `${opts.allowRepeats ? 'При разрешённых повторах использовались наименее употреблённые слова. ' : 'Каждое слово использовалось не более одного раза. '}` +
      'Подбор повторялся несколько раз с разными порядками, выбирался вариант с наибольшим числом собранных стимулов и лучшим балансом длины и частотности между категориями.'),
    P(`Слова размещались в ячейках сетки: размер сетки выбирался по числу слов и пропорциям области под надписью (по умолчанию ${levels.map((n) => { const g = stimuli.find((s) => s.N === n).grid; return `${n} слов — ${g.cols} × ${g.rows}`; }).join('; ')}). ` +
      'Ячейка искомого слова выбиралась так, чтобы по набору искомые слова равномерно распределялись по ячейкам и по девяти зонам экрана (отдельно для каждой категории); остальные слова расставлялись по свободным ячейкам случайно. Каждое слово смещено от центра ячейки на случайную долю свободного места.'),
    H2('4. Состав набора'),
    TABLE(['Тип', 'Слов', ...catHeaders.map((h) => `Искомое: ${h.toLowerCase()}`)], [...['control', 'experimental'].flatMap((t) => levels.map((n) => [t === 'control' ? 'контроль' : 'эксперимент', String(n), ...EMOTION_KEYS.map((k) => String(stimuli.filter((s) => s.type === t && s.N === n && s.category === k).length))]))]),
    P('Перечень стимулов (имя файла, искомое слово, его длина, ячейка):'),
    TABLE(['Имя файла', 'Искомое слово', 'Длина', 'Ячейка'], stimuli.map((s) => [`${s.name}.png`, s.target.word, String(s.target.len), `${s.targetCell + 1} из ${s.grid.rows * s.grid.cols}`]), [5, 3, 1.2, 1.8]),
    H2('5. Баланс по длине и частотности'),
    P('Среднее ± стандартное отклонение по уникальным словам набора и однофакторный дисперсионный анализ (p > 0,05 — категории не различаются). Слова подбирались под искомое слово, поэтому наблюдения не полностью независимы, и таблица носит ориентировочный характер:'),
    M.balanceTable(catHeaders, balRows),
    P(`Положение искомых слов по девяти зонам экрана (строки сверху вниз, столбцы слева направо): ${zones.join(', ')}.`),
  ];
  if (salOn) {
    blocks.push(H2('6. Салиентность'), ...M.salienceParagraphs(method));
    blocks.push(P('Сравнение контрольных и экспериментальных стимулов:'), M.balanceTable(typeHeaders, typeRows));
    blocks.push(P('Относительная салиентность рамки искомого слова по его эмоциональной категории (1 — как в среднем по экрану):'), M.balanceTable(catHeaders.map((h) => `Цель: ${h.toLowerCase()}`), salRows));
  }
  blocks.push(H2(salOn ? '7. Яркость' : '6. Яркость'), M.luminanceParagraph());
  blocks.push(H2(salOn ? '8. Инструкция для участника' : '7. Инструкция для участника'));
  if (c.instructionOn) blocks.push(P(`Инструкция предъявляется отдельным экраном instruction.png (того же размера и цвета, что стимулы). Текст: ${String(c.insText).replace(/\*\*/g, '').replace(/\n+/g, ' ')}`));
  else blocks.push(P('Инструкция в архив не включена.'));
  blocks.push(H2(salOn ? '9. Ответы и области интереса' : '8. Ответы и области интереса'),
    P('Правильный ответ — щелчок мыши внутри рамки искомого слова. Рамки (в пикселях стимула) приведены в answer_key.csv для искомых слов и в stimuli_words.csv для всех слов экрана.'),
    M.reproducibilityParagraph(opts.seed));
  return blocks;
}

/* ---------------- инициализация ---------------- */

function panelHtml() {
  return `
    ${panelHead('02', 'Поиск эмоционально окрашенных слов · создание стимулов', `
      Сверху — надпись «Найдите слово: …», под ней — сетка слов, расставленных вразброс; искомое слово каждый раз в другом месте экрана.
      Контрольный стимул: все слова одной эмоциональной категории. Экспериментальный: дистракторы из других категорий в равных долях.`)}

    ${stepTitle(1, 'Список слов')}
    <div class="dropzone" id="word-dropzone" tabindex="0">
      <input type="file" id="word-file" accept=".csv,.tsv,.txt" hidden>
      <div class="dropzone-inner">
        <div class="dropzone-icon">⤓</div>
        <p class="dropzone-text">Перетащите CSV со словами сюда</p>
        <p class="dropzone-or">— или —</p>
        <button class="btn btn-primary" type="button">Выбрать файл</button>
        <p class="dropzone-hint">Слово · нейтральность · позитивность · грусть · угроза · частотность</p>
      </div>
    </div>
    <div class="toolbar tool-gap">
      <button class="btn btn-ghost" id="word-template" type="button">↓ Скачать образец таблицы</button>
      <span class="toolbar-info" id="word-info">${INFO_DEFAULT}</span>
      <span class="toolbar-spacer"></span>
      <button class="btn btn-ghost" id="word-clear" type="button" disabled>⊘ Убрать все слова</button>
    </div>
    <div id="word-table-block" hidden><div class="data-table-wrap table-scroll tool-gap"><table class="data-table" id="word-table"></table></div></div>

    ${stepTitle(2, 'Параметры')}
    ${card(`
      ${sub('Что создаём')}
      ${grid(`
        ${fld.text('word-levels', 'Уровни сложности: число слов на экране (через запятую)', '20, 30, 40')}
        ${fld.num('word-ctrl', 'Контрольных стимулов на каждую эмоцию на каждом уровне', 1, { min: 0 })}
        ${fld.num('word-exp', 'Экспериментальных стимулов на каждую эмоцию искомого слова на каждом уровне', 1, { min: 0 })}
        ${fld.select('word-dmode', 'Слова-помехи (дистракторы) в экспериментальных стимулах', [['other', 'Только из других эмоций (по умолчанию)'], ['all', 'Из всех четырёх эмоций поровну']], 'other')}
        <div class="field"><label>Подбирать слова, близкие по</label>
          <div class="check-row">
            <label class="check"><input type="checkbox" id="word-mlen" checked><span>длине</span></label>
            <label class="check"><input type="checkbox" id="word-mfreq" checked><span>частотности</span></label>
          </div></div>
        ${fld.num('word-margin', 'Минимальный отрыв главной шкалы от второй, баллы', 0, { min: 0, step: 0.1, hint: 'Эмоция слова — шкала с наибольшей оценкой. Если отрыв от второй шкалы меньше, слово «смешанное» и не используется. 0 — не ограничивать.' })}
        ${fld.num('word-seed', 'Номер случайного набора', 1, { hint: 'При том же номере и тех же данных получится тот же набор. Поменяйте номер, чтобы получить другой.' })}
        ${fld.check('word-zscale', 'Сравнивать шкалы в стандартизованном виде (z-оценки)', false, { hint: 'Включите, если шкалы нельзя сравнивать напрямую, например у них разный диапазон оценок.' })}
        ${fld.check('word-repeats', 'Разрешить использовать одно слово в нескольких стимулах', false, { hint: 'Если выключено и слов не хватает, появится предупреждение.' })}
      `)}
      ${sep()}
      ${sub('Внешний вид')}
      ${grid(`
        ${fld.pair('word-w', 'word-h', 'Размер стимула: ширина × высота, пикс.', 1920, 1080, { min: 480 })}
        ${fontField('word-font', 'Шрифт слов', 'Arial, Helvetica, sans-serif')}
        <div class="field"><label for="word-size">Размер шрифта слов, пикс.</label>
          <input type="number" id="word-size" value="40" min="10" step="1">
          <span class="hint" id="word-size-hint">Загрузите список слов — размер подберётся по самому большому уровню сложности.</span>
          <button class="btn btn-ghost btn-small" id="word-size-apply" type="button" hidden>Применить рекомендуемый размер</button></div>
        ${fld.select('word-case', 'Написание букв', [['asis', 'Как в списке слов'], ['lower', 'все строчные'], ['upper', 'ВСЕ ЗАГЛАВНЫЕ']], 'asis')}
        <div class="field"><label for="word-jitter">Степень «разброса» слов внутри ячейки</label><input type="range" id="word-jitter" min="0" max="100" value="70"></div>
        ${fld.colors('word-bg', 'word-fg', 'Цвет фона / цвет текста', BG, FG)}
        ${fld.text('word-instr', 'Надпись над таблицей слов ({word} — искомое слово)', 'Найдите слово: {word}', { wide: true })}
      `)}
      ${sep()}
      ${sub('Салиентность')}
      ${grid(`
        ${fld.check('word-sal-on', 'Оценить салиентность готовых стимулов', true, { hint: 'Для каждого стимула считается карта салиентности всего экрана и относительная салиентность рамки каждого слова (ковариата для анализа движений глаз).' })}
        ${fld.select('word-sal-method', 'Алгоритм оценки салиентности', [['ft', 'FT — рекомендуется'], ['local', 'Local Contrast — цветовой контраст'], ['dog', 'DoG — по яркости'], ['sr', 'SR — спектральный остаток (яркость)']], 'ft')}
      `)}
      ${instructionEditorHtml('word', { items: [{ key: 'main', label: 'Инструкция', text: INSTRUCTION }], lead: 'Сохраняется в архив отдельной картинкой <code>instruction.png</code> того же размера, что и стимулы. Проверьте, что текст соответствует вашей процедуре.' })}
    `)}
    ${generateBar('word')}`;
}

function downloadTemplate() {
  const rows = [
    ['дом', 6.2, 1.8, 1.1, 1.0, 650.3],
    ['радость', 1.3, 6.5, 1.2, 1.1, 120.4],
    ['одиночество', 1.5, 1.4, 6.1, 1.9, 35.2],
    ['опасность', 1.4, 1.2, 2.0, 6.4, 90.7],
  ].map(([w, n, p, s, t, f]) => ({ 'слово': w, 'нейтральность': n, 'позитивность': p, 'грусть': s, 'угроза': t, 'частотность': f }));
  downloadText(toCSV(rows), 'words_template.csv');
}

export function initWordsGenerator() {
  $('#mode-word').innerHTML = panelHtml();
  editor = mountInstructionEditor('word', [{ key: 'main', label: 'Инструкция', text: INSTRUCTION }], () => {
    const l = readLayout();
    return { width: l.width, height: l.height, background: l.background, color: l.color, fontFamily: l.fontFamily };
  });
  bindDropzone($('#word-dropzone'), $('#word-file'), loadFile);
  $('#word-template').addEventListener('click', downloadTemplate);
  $('#word-clear').addEventListener('click', () => {
    state.rawRows = []; state.words = [];
    $('#word-info').textContent = INFO_DEFAULT;
    invalidate(); refreshWords();
  });
  bindFont('word-font', () => { editor.preview(); updateSizeRecommendation(); invalidate(); });
  $$('#mode-word .params-card input, #mode-word .params-card select').forEach((el) => {
    if (el.id.includes('-ins-') || el.id === 'word-font') return;
    el.addEventListener('change', () => {
      editor.preview();
      updateSizeRecommendation();
      invalidate();
      if (el.id === 'word-margin' || el.id === 'word-zscale') refreshWords(); else renderFeasibility();
    });
  });
  $('#word-font-custom').addEventListener('change', () => { invalidate(); editor.preview(); updateSizeRecommendation(); });
  $('#word-size').addEventListener('input', () => { state.sizeTouched = true; updateSizeRecommendation(); });
  $('#word-size-apply').addEventListener('click', () => {
    state.sizeTouched = false; $('#word-size').value = state.recSize; invalidate(); updateSizeRecommendation();
  });
  $('#word-generate').addEventListener('click', generate);
  editor.preview();
  updateSizeRecommendation();
  renderFeasibility();
}

export { gridFor, applyCase };
