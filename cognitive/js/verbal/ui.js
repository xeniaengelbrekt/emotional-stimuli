/* ============================================================
   verbal/ui.js — «Вербальное мышление (филворд) · создание стимулов»
   ============================================================ */

import { $, esc, tick, bindDropzone, downloadText, readText } from '../../../js/common/ui.js';
import { parseCSV, parseNum, findColumn, toCSV } from '../../../js/common/csv.js';
import { EMOTIONS, EMOTION_KEYS, EMOTION_BY_KEY, EMOTION_ALIASES, classifyEmotion, scaleStats } from '../../../js/common/emotions.js';
import { meanOf, sdOf, oneWayAnova, formatP } from '../../../js/core/stats.js';
import { toastError, toastSuccess } from '../../../js/core/toast.js';
import { fld, fontField, bindFont, readFont, readInt, readNum, readStr, readCheck, readChecks, onAnyChange } from '../kit/fields.js';
import { panelHead, stepTitle, card, grid, sep, sub, generateBar, alertBox } from '../kit/panel.js';
import { instructionEditorHtml, mountInstructionEditor, drawInstructionText } from '../kit/instr.js';
import { mountResults, metricTable } from '../kit/results.js';
import { evaluateSalience, relativeAoiSalience, salienceBalance, METHOD_LABELS, SAL_KEYS } from '../kit/salience.js';
import { ensureFont } from '../kit/text.js';
import { meanLuminance } from '../kit/luminance.js';
import { ORIENTATIONS, COLOR_MODES, DISTRACTORS, DEFAULTS, generateVerbal, cleanWord, isPlainWord, logFreq } from './generator.js';
import { DEFAULT_STYLE, drawVerbalStimulus, recommendedFont, instructionText } from './render.js';

const state = { raw: [], words: [], fileName: '' };
let editor = null;

const WORD_COL = ['word', 'слово', 'stimulus', 'стимул', 'lemma', 'лемма'];
const FREQ_COL = ['freq', 'frequency', 'частотность', 'частота', 'ipm', 'fpm', 'freqipm'];
const INFO_DEFAULT = 'Столбцы: слово, нейтральность, позитивность, грусть, угроза, частотность (необязательно, на миллион слов); длина считается автоматически';

const INSTRUCTION = [
  'Вверху экрана написано слово, которое нужно найти. Ниже расположена таблица из букв и цифр, в которой это слово спрятано.',
  '',
  'Слово записано **по горизонтали** — слева направо.',
  '',
  'Найдите это слово как можно быстрее и щёлкните по нему левой кнопкой мыши.',
  'Старайтесь не ошибаться.',
  '',
  'Чтобы начать, нажмите ПРОБЕЛ.',
].join('\n');

const instrFor = (o, many) => INSTRUCTION
  .replace('Слово записано **по горизонтали** — слева направо.', o === 'horizontal' ? 'Слово записано **по горизонтали** — слева направо.' : 'Слово записано **по вертикали** — сверху вниз.')
  .replace('Вверху экрана написано слово, которое нужно найти.', many ? 'Вверху экрана написаны слова, которые нужно найти.' : 'Вверху экрана написано слово, которое нужно найти.');

function readStyle() {
  return {
    width: readInt('vb-w', 1920, 640), height: readInt('vb-h', 1080, 360),
    background: readStr('vb-bg'), color: readStr('vb-fg'),
    gridLine: readStr('vb-line'),
    bwFill: readStr('vb-cellbw'),
    fontFamily: readFont('vb-font'),
    fontSize: readInt('vb-size', 0, 0),
    instruction: readStr('vb-label'),
  };
}

function readOptions() {
  const orientations = Object.keys(ORIENTATIONS).filter((k) => readChecks('vb-orient').includes(k));
  const colors = Object.keys(COLOR_MODES).filter((k) => readChecks('vb-colors').includes(k));
  return {
    useCategory: readCheck('vb-cat'),
    matchLength: readChecks('vb-match').includes('len'),
    matchFreq: readChecks('vb-match').includes('freq'),
    matchRating: readChecks('vb-match').includes('rate'),
    perCombo: readInt('vb-per', 1, 1, 50),
    orientations, colors,
    targetsPerStimulus: readInt('vb-k', 1, 1, 10),
    cols: readInt('vb-cols', 10, 4, 40),
    rows: readInt('vb-rows', 10, 4, 40),
    distractors: readStr('vb-dist'),
    allowBorder: !readCheck('vb-noborder'),
    seed: readInt('vb-seed', 1),
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
    let dup = 0; let bad = 0; let notPlain = 0;
    state.raw = [];
    for (const r of rows) {
      const word = (r[wordCol] || '').trim();
      if (!word) continue;
      const key = word.toLocaleLowerCase('ru');
      if (seen.has(key)) { dup++; continue; }
      seen.add(key);
      if (!isPlainWord(cleanWord(word))) { notPlain++; continue; }
      const ratings = Object.fromEntries(EMOTION_KEYS.map((k) => [k, parseNum(r[scale[k]])]));
      if (EMOTION_KEYS.some((k) => ratings[k] == null)) { bad++; continue; }
      state.raw.push({ id: key, word, ratings, len: [...word].length, freq: freqCol ? parseNum(r[freqCol]) : null });
    }
    state.fileName = file.name;
    $('#vb-info').textContent = `${file.name}: слов ${state.raw.length}` + (freqCol ? '' : ' · колонки частотности нет — по частотности слова не уравниваются') +
      (dup ? ` · повторов пропущено: ${dup}` : '') + (notPlain ? ` · не только из букв (дефис, пробел…): ${notPlain}` : '') + (bad ? ` · без полных оценок: ${bad}` : '');
    if (!state.raw.length) { toastError('В файле нет подходящих строк'); return; }
    refresh();
    toastSuccess(`Загружено слов: ${state.raw.length}`);
  } catch (e) {
    toastError(`CSV не прочитан: ${e.message}`);
  }
}

function classify() {
  const opts = {
    margin: Math.max(0, readNum('vb-margin', 0)),
    zStats: readCheck('vb-zscale') ? scaleStats(state.raw.map((w) => ({ ratings: w.ratings }))) : null,
  };
  state.words = state.raw.map((w) => ({ ...w, category: classifyEmotion(w.ratings, opts) }));
}

const chip = (c) => (c ? `<span class="emo-chip" style="--c:${EMOTION_BY_KEY[c].color}">${EMOTION_BY_KEY[c].ru}</span>` : '<span class="emo-chip emo-none">—</span>');

function refresh() {
  classify();
  $('#vb-clear').disabled = !state.raw.length;
  $('#vb-table-block').hidden = !state.words.length;
  const LIMIT = 200;
  const head = `<thead><tr><th>Слово</th>${EMOTIONS.map((e) => `<th>${e.ru}</th>`).join('')}<th>Эмоция</th><th>Длина</th><th>Частотность</th></tr></thead>`;
  const body = state.words.slice(0, LIMIT).map((w) => `<tr><td>${esc(w.word)}</td>${EMOTION_KEYS.map((k) => `<td class="num">${w.ratings[k]}</td>`).join('')}<td>${chip(w.category)}</td><td class="num">${w.len}</td><td class="num">${w.freq ?? '—'}</td></tr>`).join('');
  const more = state.words.length > LIMIT ? `<tr><td colspan="8" class="muted">… и ещё ${state.words.length - LIMIT} (показаны первые ${LIMIT})</td></tr>` : '';
  $('#vb-table').innerHTML = head + `<tbody>${body}${more}</tbody>`;
  update();
}

/* ---------------- план и проверки ---------------- */

function update() {
  const o = readOptions();
  const style = readStyle();
  const cats = o.useCategory ? 4 : 1;
  const base = o.orientations.length * cats * o.perCombo;
  const total = base * o.colors.length;
  $('#vb-plan').innerHTML = `План: <strong class="hl">${o.orientations.length}</strong> напр. × <strong class="hl">${cats}</strong> катег. × <strong class="hl">${o.perCombo}</strong> × <strong class="hl">${o.colors.length}</strong> цветн. = <strong class="hl">${total}</strong> стимулов; целевых слов нужно: <strong class="hl">${o.orientations.length * o.perCombo * o.targetsPerStimulus * cats}</strong>`;
  const rec = recommendedFont(style, o.rows, o.cols);
  $('#vb-size').placeholder = `авто: ${rec}`;
  const eligible = state.words.filter((w) => w.category);
  const issues = [];
  if (!o.orientations.length) issues.push('Отметьте хотя бы одно направление.');
  if (!o.colors.length) issues.push('Отметьте хотя бы один вариант цветности.');
  if (!state.words.length) issues.push('Загрузите CSV со словами.');
  const maxLen = Math.min(o.rows, o.cols) - (o.allowBorder ? 0 : 2);
  const fit = eligible.filter((w) => w.len <= maxLen && w.len >= 2);
  let table = '';
  if (state.words.length) {
    const need = o.orientations.length * o.perCombo * o.targetsPerStimulus;
    const rows = (o.useCategory ? EMOTION_KEYS : ['any']).map((c) => ({
      c, have: fit.filter((w) => c === 'any' || w.category === c).length, need,
    }));
    if (rows.some((r) => r.have < r.need)) issues.push('Слов не хватает для заданного числа стимулов (см. таблицу «доступно / нужно»); будет собрано максимум возможного.');
    if (eligible.length < state.words.length) issues.push(`${state.words.length - eligible.length} слов не получили эмоциональную категорию (равные или близкие оценки) и не используются.`);
    if (fit.length < eligible.length) issues.push(`${eligible.length - fit.length} слов не помещаются в сетку ${o.cols}×${o.rows} (длиннее ${maxLen} букв) и не используются.`);
    table = `<div class="data-table-wrap tool-gap narrow"><table class="data-table feas-table"><thead><tr><th>Доступно / нужно слов</th>${rows.map((r) => `<th>${r.c === 'any' ? 'Все слова' : EMOTION_BY_KEY[r.c].ru}</th>`).join('')}</tr></thead>
      <tbody><tr><td>Подходящих по длине</td>${rows.map((r) => `<td class="num ${r.have >= r.need ? 'ok-cell' : 'bad-cell'}">${r.have} / ${r.need}</td>`).join('')}</tr></tbody></table></div>`;
  }
  $('#vb-feas').innerHTML = (issues.length ? alertBox('warn', `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`) : '') + table;
  $('#vb-generate').disabled = !state.words.length || !o.orientations.length || !o.colors.length;
  editor?.preview();
}

function invalidate() {
  const box = $('#vb-results');
  if (!box.hidden) { box.hidden = true; box.innerHTML = ''; }
}

const busy = (on, text) => { $('#vb-busy').hidden = !on; if (text) $('#vb-busy-text').textContent = text; };

/* ---------------- генерация ---------------- */

async function generate() {
  const opts = readOptions();
  const style = { ...DEFAULT_STYLE, ...readStyle() };
  const salMode = readStr('vb-sal');
  const method = readStr('vb-sal-method');
  const btn = $('#vb-generate');
  btn.disabled = true;
  busy(true, 'Подбор слов и построение сеток…');
  try {
    await ensureFont(style.fontFamily);
    await tick();
    const eligible = state.words.filter((w) => w.category);
    const res = generateVerbal(eligible, opts);
    if (!res.stimuli.length) throw new Error('Не удалось собрать ни одного стимула — проверьте таблицу «доступно / нужно слов»');
    const stimuli = res.stimuli.map((st) => {
      const obj = { ...st, filter: st.color, tag: st.color === 'bw' ? 'ч/б' : 'цвет', draw: (canvas, scale) => drawVerbalStimulus(canvas, st, style, scale) };
      obj.aoi = drawVerbalStimulus(document.createElement('canvas'), st, style, 0.05);
      return obj;
    });
    for (const st of stimuli) {
      const cat = st.category === 'any' ? null : EMOTION_BY_KEY[st.category];
      st.badges = `<span>${esc(ORIENTATIONS[st.orientation].short)}</span>${cat ? `<span class="emo-chip" style="--c:${cat.color}">${cat.ru}</span>` : ''}`;
      st.infoHtml = `<p class="muted-p">Целевые слова: <strong class="hl">${st.targets.map((w) => esc(cleanWord(w.word))).join(', ')}</strong> (${st.targets.map((w) => `${w.len} букв${w.freq != null ? `, частотность ${w.freq}` : ''}`).join('; ')}). Направление: ${esc(ORIENTATIONS[st.orientation].ru.toLowerCase())}.</p>`;
    }
    if (salMode !== 'off') {
      const todo = stimuli.filter((s) => salMode === 'all' || s.color === 'color');
      let i = 0;
      for (const st of todo) {
        busy(true, `Оценка салиентности (${method.toUpperCase()}): ${++i} из ${todo.length}`);
        await tick();
        const ev = evaluateSalience(st, style.width, style.height, method);
        st.sal = ev.metrics;
        st.relTargets = st.aoi.map((r) => relativeAoiSalience(ev.map, r, style.width, style.height));
      }
    }
    showResults(res, stimuli, opts, style, salMode, method);
    toastSuccess(`Собрано стимулов: ${stimuli.length}`);
  } catch (e) {
    console.error(e);
    toastError(`Не удалось сформировать стимулы: ${e.message}`, 7000);
  } finally {
    busy(false);
    btn.disabled = false;
    update();
  }
}

const f3 = (v) => (v == null || !Number.isFinite(v) ? '' : Number(v.toFixed(3)));

function showResults(res, stimuli, opts, style, salMode, method) {
  const W = style.width; const H = style.height;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rows = stimuli.map((st) => {
    const r = {
      stimulus: st.name, category: st.category, orientation: st.orientation, color_mode: st.color,
      n_targets: st.targets.length, target_words: st.targets.map((w) => cleanWord(w.word)).join(' | '),
      target_length_mean: mean(st.targets.map((w) => w.len)).toFixed(2),
      target_frequency_mean: st.targets.every((w) => w.freq != null) ? mean(st.targets.map((w) => w.freq)).toFixed(2) : '',
      target_rating_mean: mean(st.targets.map((w) => w.ratings[w.category])).toFixed(2),
      grid_cols: opts.cols, grid_rows: opts.rows, distractors: opts.distractors, border_allowed: opts.allowBorder ? 1 : 0, width: W, height: H,
      mean_luminance: meanLuminance(st, W),
    };
    if (st.sal) {
      for (const k of SAL_KEYS) r[`salience_${k}`] = st.sal[k];
      r.salience_rel_targets = f3(mean(st.relTargets));
    }
    return r;
  });
  const tRows = [];
  for (const st of stimuli) {
    st.targets.forEach((w, i) => {
      const a = st.aoi[i];
      tRows.push({
        stimulus: st.name, word: a.word, category: w.category, orientation: st.orientation, length: w.len, frequency: w.freq ?? '',
        rating_neutral: w.ratings.neutral, rating_positive: w.ratings.positive, rating_sad: w.ratings.sad, rating_threat: w.ratings.threat,
        row: a.row, col: a.col, aoi_x: a.x, aoi_y: a.y, aoi_w: a.w, aoi_h: a.h, salience_rel: st.relTargets ? f3(st.relTargets[i]) : '',
      });
    });
  }

  const keyRows = tRows.map((r) => ({
    stimulus: r.stimulus, file: `stimuli/${r.stimulus}.png`, response_type: 'click', correct_response: r.word,
    n_targets: stimuli.find((s) => s.name === r.stimulus).targets.length,
    aoi_x: r.aoi_x, aoi_y: r.aoi_y, aoi_w: r.aoi_w, aoi_h: r.aoi_h,
    meaning: 'щелчок внутри рамки целевого слова — верный ответ; несколько слов — каждое находят и нажимают по очереди',
  }));

  // баланс слов между категориями
  const base = new Map();
  for (const st of stimuli) for (const w of st.targets) base.set(w.id, w);
  const catList = opts.useCategory ? EMOTION_KEYS : ['any'];
  const rowsBal = [['Длина слова (букв)', (w) => w.len], ['log10 частотности', (w) => (w.freq != null ? logFreq(w.freq) : NaN)], ['Оценка по своей шкале', (w) => w.ratings[w.category]]].map(([label, get]) => {
    const vals = catList.map((c) => [...base.values()].filter((w) => c === 'any' || w.category === c).map(get).filter(Number.isFinite));
    const a = vals.length > 1 ? oneWayAnova(vals) : null;
    return { label, cells: vals.map((v) => ({ n: v.length, mean: meanOf(v), sd: sdOf(v) })), extra: a ? `F(${a.df1}, ${a.df2}) = ${a.F.toFixed(2)}, p ${formatP(a.p).startsWith('<') ? formatP(a.p) : '= ' + formatP(a.p)}` : '—', extraBad: a ? a.p < 0.05 : false };
  });

  const zones = Array(9).fill(0);
  for (const st of stimuli.filter((s) => s.color === opts.colors[0])) {
    const p = st.placements[0]; const mid = p.cells[Math.floor(p.cells.length / 2)];
    zones[Math.min(2, Math.floor((mid[0] / opts.rows) * 3)) * 3 + Math.min(2, Math.floor((mid[1] / opts.cols) * 3))]++;
  }
  let summary = `
    <h4 class="sub-heading">Баланс целевых слов между эмоциональными категориями</h4>
    <p class="muted-p">Среднее ± SD по уникальным словам и однофакторный ANOVA: p &gt; .05 — категории не различаются. Слова подбирались «рядами», поэтому наблюдения не полностью независимы — таблица ориентировочная.</p>
    ${metricTable(catList.map((c) => (c === 'any' ? 'Все слова' : EMOTION_BY_KEY[c].ru)), rowsBal)}
    <h4 class="sub-heading">Где стоят целевые слова</h4>
    <p class="muted-p">Число стимулов, где первое целевое слово оказалось в каждой из 9 зон сетки (без учёта цветности).</p>
    <div class="data-table-wrap narrow zone-table"><table class="data-table"><tbody>${[0, 1, 2].map((r) => `<tr>${[0, 1, 2].map((c) => `<td class="num">${zones[r * 3 + c]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  if (salMode !== 'off') {
    const withSal = stimuli.filter((s) => s.sal);
    const groups = opts.colors.filter((c) => withSal.some((s) => s.color === c)).map((c) => [c, COLOR_MODES[c].ru]);
    const rel = withSal.map((s) => mean(s.relTargets));
    summary += `
      <h4 class="sub-heading">Салиентность (${esc(METHOD_LABELS[method])})</h4>
      <p class="muted-p">${salMode === 'color-only' ? 'Оценена для цветных стимулов: у чёрно-белой сетки одинаковые клетки и буквы, различиям в заметности браться неоткуда.' : 'Оценена для всех стимулов.'}
        «Относительная салиентность цели» — средняя салиентность рамки целевого слова относительно среднего по экрану (1 — как в среднем).
        Среднее по стимулам: <strong class="hl">${f3(mean(rel))}</strong> (от ${f3(Math.min(...rel))} до ${f3(Math.max(...rel))}). Значение в таблице <code>stimuli_targets.csv</code> можно использовать как ковариату в анализе.</p>
      ${groups.length > 1 ? metricTable(groups.map((g) => g[1]), salienceBalance(withSal, (s) => s.color, groups)) : ''}`;
  }

  const pngs = [];
  if (editor.enabled()) {
    const many = opts.targetsPerStimulus > 1;
    for (const o of opts.orientations) {
      const key = o;
      pngs.push({ path: `instruction_${ORIENTATIONS[o].short}.png`, draw: (c, s = 1) => drawInstructionText(c, { width: W, height: H, background: style.background, color: style.color, fontFamily: style.fontFamily, text: editor.texts()[key] ?? instrFor(o, many), scale: s }) });
    }
  }
  mountResults($('#vb-results'), {
    prefix: 'vb', step: 3, width: W, height: H, stimuli,
    filters: opts.colors.length > 1 ? opts.colors.map((c) => [c, COLOR_MODES[c].short]) : null,
    requested: res.requested, built: stimuli.length, warnings: res.warnings,
    summaryHtml: summary, pngs, answerKey: keyRows,
    manifests: [{ file: 'stimuli.csv', rows }, { file: 'stimuli_targets.csv', rows: tRows }],
    archiveName: 'filword_stimuli',
    settings: { experiment: 'verbal-thinking-filword', options: opts, style, wordList: state.fileName, alphabet: res.alphabet, saliency: salMode === 'off' ? null : { method, mode: salMode }, instructions: editor.enabled() ? editor.texts() : null },
  });
  $('#vb-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function downloadTemplate() {
  const rows = [
    ['дом', 6.2, 1.8, 1.1, 1.0, 650.3], ['радость', 1.3, 6.5, 1.2, 1.1, 120.4],
    ['одиночество', 1.5, 1.4, 6.1, 1.9, 35.2], ['опасность', 1.4, 1.2, 2.0, 6.4, 90.7],
  ].map(([w, n, p, s, t, f]) => ({ 'слово': w, 'нейтральность': n, 'позитивность': p, 'грусть': s, 'угроза': t, 'частотность': f }));
  downloadText(toCSV(rows), 'words_template.csv');
}

/* ---------------- инициализация ---------------- */

export function initVerbal() {
  $('#mode-verbal').innerHTML = `
    ${panelHead('02', 'Вербальное мышление (филворд) · создание стимулов', `
      Классический филворд: сетка букв (и цифр), в которой спрятаны целевые слова из вашего CSV. Участник находит слово,
      записанное по горизонтали или по вертикали, и щёлкает по нему мышью. По умолчанию — по одному стимулу на каждую из
      четырёх эмоциональных категорий для горизонтали и для вертикали; слова разных категорий подбираются максимально
      близкими по длине, частотности и оценке.`)}

    ${stepTitle(1, 'Целевые слова')}
    <div class="dropzone" id="vb-dropzone" tabindex="0">
      <input type="file" id="vb-file" accept=".csv,.tsv,.txt" hidden>
      <div class="dropzone-inner">
        <div class="dropzone-icon">⤓</div>
        <p class="dropzone-text">Перетащите CSV со словами сюда</p>
        <p class="dropzone-or">— или —</p>
        <button class="btn btn-primary" type="button">Выбрать файл</button>
        <p class="dropzone-hint">Слово · нейтральность · позитивность · грусть · угроза · частотность</p>
      </div>
    </div>
    <div class="toolbar tool-gap">
      <button class="btn btn-ghost" id="vb-template" type="button">↓ Скачать образец таблицы</button>
      <span class="toolbar-info" id="vb-info">${INFO_DEFAULT}</span>
      <span class="toolbar-spacer"></span>
      <button class="btn btn-ghost" id="vb-clear" type="button" disabled>⊘ Убрать все слова</button>
    </div>
    <div id="vb-table-block" hidden><div class="data-table-wrap table-scroll tool-gap"><table class="data-table" id="vb-table"></table></div></div>

    ${stepTitle(2, 'Параметры')}
    ${card(`
      ${sub('Что создаём')}
      ${grid(`
        ${fld.checks('vb-orient', 'Направление слова (для каждого отмеченного создаются свои стимулы)', Object.entries(ORIENTATIONS).map(([k, v]) => [k, v.ru, true]), { wide: true })}
        ${fld.checks('vb-colors', 'Цветность сетки (можно выбрать несколько)', [['bw', COLOR_MODES.bw.ru, true], ['color', COLOR_MODES.color.ru, false]], { wide: true,
          hint: 'Чёрно-белая: все клетки белые. Цветная: у каждой клетки свой цвет (светлые тона одинаковой светлоты, соседние клетки не совпадают). Слова и буквы в чёрно-белом и цветном варианте одного стимула одинаковы.' })}
        ${fld.num('vb-per', 'Стимулов на каждое сочетание «категория × направление»', 1, { min: 1, max: 50, hint: 'Если категории не учитываются — стимулов на каждое направление.' })}
        ${fld.num('vb-k', 'Количество целевых слов в одном стимуле', 1, { min: 1, max: 10, hint: 'Несколько слов в одном стимуле — всегда из одной категории.' })}
        ${fld.check('vb-cat', 'Учитывать эмоциональную категорию слов', true, { hint: 'Включено: отдельные стимулы для каждой из четырёх категорий. Выключено: слова берутся из всего списка без разделения на категории.' })}
        ${fld.checks('vb-match', 'Уравнивать слова разных категорий по', [['len', 'длине', true], ['freq', 'частотности', true], ['rate', 'оценке по своей шкале', true]], { wide: true,
          hint: 'Слова подбираются «рядами» — по одному из каждой категории, максимально близких по выбранным признакам. Длина уравнивается строго (одинаковое число букв), если слов достаточно.' })}
        ${fld.num('vb-seed', 'Номер случайного набора', 1, { hint: 'При том же номере и тех же данных получится тот же набор. Поменяйте номер, чтобы получить другой.' })}
      `)}
      ${sep()}
      ${sub('Сетка')}
      ${grid(`
        ${fld.pair('vb-cols', 'vb-rows', 'Размер сетки: столбцов × строк', 10, 10, { min: 4 })}
        ${fld.select('vb-dist', 'Чем заполнены остальные клетки (дистракторы)', Object.entries(DISTRACTORS).map(([k, v]) => [k, v.ru]), 'letters-digits')}
        ${fld.check('vb-noborder', 'Не размещать слова у внешних границ сетки', false, { hint: 'Выключено (по умолчанию): слова могут касаться внешних стен сетки. Включено: крайние строки и столбцы заполнены только дистракторами.' })}
        ${fld.check('vb-zscale', 'Сравнивать шкалы слов в стандартизованном виде (z-оценки)', false, { hint: 'Включите, если шкалы нельзя сравнивать напрямую, например у них разный диапазон оценок.' })}
        ${fld.num('vb-margin', 'Минимальный отрыв главной шкалы от второй, баллы', 0, { min: 0, step: 0.1, hint: 'Эмоция слова — шкала с наибольшей оценкой. Если отрыв от второй шкалы меньше, слово «смешанное» и не используется. 0 — не ограничивать.' })}
      `)}
      ${sep()}
      ${sub('Внешний вид')}
      ${grid(`
        ${fld.pair('vb-w', 'vb-h', 'Размер стимула: ширина × высота, пикс.', 1920, 1080, { min: 320 })}
        ${fontField('vb-font', 'Шрифт', 'Arial, Helvetica, sans-serif')}
        ${fld.num('vb-size', 'Размер шрифта букв, пикс.', '', { min: 8, placeholder: 'авто', hint: 'Оставьте пустым — размер подберётся по размеру клетки сетки (рекомендуется).' })}
        ${fld.colors('vb-bg', 'vb-fg', 'Цвет фона / цвет текста', '#d9d9d9', '#111111')}
        ${fld.colors('vb-cellbw', 'vb-line', 'Цвет клеток в ч/б сетке / цвет линий сетки', '#ffffff', '#8a8a8a')}
        ${fld.text('vb-label', 'Надпись над сеткой ({word} — искомое слово)', 'Найдите слово: {word}', { wide: true })}
      `)}
      ${sep()}
      ${sub('Салиентность')}
      <p class="muted-p"><strong>Нужно ли оценивать?</strong> Для чёрно-белой сетки — нет: все клетки и буквы одинаковы, а положение слова не меняет визуальной статистики экрана. Для цветной — да: случайные цвета клеток делают одни места заметнее других, и заметность рамки целевого слова стоит включить в анализ как ковариату. Поэтому по умолчанию оцениваются только цветные стимулы.</p>
      ${grid(`
        ${fld.select('vb-sal', 'Оценивать салиентность', [['color-only', 'Только цветные стимулы (рекомендуется)'], ['all', 'Все стимулы'], ['off', 'Не оценивать']], 'color-only')}
        ${fld.select('vb-sal-method', 'Алгоритм', Object.entries(METHOD_LABELS), 'ft')}
      `)}
      ${instructionEditorHtml('vb', { items: [{ key: 'horizontal', label: ORIENTATIONS.horizontal.ru, text: instrFor('horizontal') }, { key: 'vertical', label: ORIENTATIONS.vertical.ru, text: instrFor('vertical') }] })}
    `)}
    ${generateBar('vb')}`;

  bindDropzone($('#vb-dropzone'), $('#vb-file'), loadFile);
  $('#vb-template').addEventListener('click', downloadTemplate);
  $('#vb-clear').addEventListener('click', () => { state.raw = []; state.words = []; $('#vb-info').textContent = INFO_DEFAULT; invalidate(); refresh(); });
  bindFont('vb-font', () => editor.preview());
  editor = mountInstructionEditor('vb', [{ key: 'horizontal', label: ORIENTATIONS.horizontal.ru, text: instrFor('horizontal') }, { key: 'vertical', label: ORIENTATIONS.vertical.ru, text: instrFor('vertical') }], () => {
    const s = readStyle();
    return { width: s.width, height: s.height, background: s.background, color: s.color, fontFamily: s.fontFamily };
  });
  onAnyChange($('#mode-verbal'), (el) => {
    if (el.id.startsWith('vb-ins') || el.id === 'vb-file') return;
    invalidate();
    if (el.id === 'vb-margin' || el.id === 'vb-zscale') refresh(); else update();
  });
  $('#vb-generate').addEventListener('click', generate);
  update();
}
