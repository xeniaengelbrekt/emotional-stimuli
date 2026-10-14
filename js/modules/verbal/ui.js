/* ============================================================
   verbal/ui.js — «Вербальное мышление (филворд) · создание стимулов»
   ============================================================ */

import { $, esc, tick, bindDropzone, downloadText, readText } from '../../common/ui.js';
import { parseCSV, parseNum, findColumn, toCSV } from '../../common/csv.js';
import { EMOTIONS, EMOTION_KEYS, EMOTION_BY_KEY, EMOTION_ALIASES, classifyEmotion, scaleStats } from '../../common/emotions.js';
import { meanOf, sdOf, oneWayAnova, formatP } from '../../core/stats.js';
import { toastError, toastSuccess } from '../../core/toast.js';
import { fld, fontField, bindFont, readFont, readInt, readNum, readStr, readCheck, readChecks, onAnyChange } from '../../kit/fields.js';
import { panelHead, stepTitle, card, grid, sep, sub, generateBar, alertBox } from '../../kit/panel.js';
import { instructionEditorHtml, mountInstructionEditor, drawInstructionText } from '../../kit/instr.js';
import { mountResults, metricTable } from '../../kit/results.js';
import { evaluateSalience, relativeAoiSalience, salienceBalance, METHOD_LABELS, SAL_KEYS } from '../../kit/salience.js';
import { ensureFont } from '../../kit/text.js';
import { meanLuminance } from '../../kit/luminance.js';
import { ORIENTATIONS, COLOR_MODES, DISTRACTORS, COMPOSITIONS, DEFAULTS, generateVerbal, cleanWord, isPlainWord, logFreq, normalizeOptions, planOf, checkFit, maxWordLength } from './generator.js';
import { DEFAULT_STYLE, drawVerbalStimulus, recommendedFont, labelText } from './render.js';
import { BG, FG, NEXT_LINE, START_LINE } from '../../kit/defaults.js';
import * as M from '../../kit/methods.js';

const state = { raw: [], words: [], fileName: '' };
let editor = null;

const WORD_COL = ['word', 'слово', 'stimulus', 'стимул', 'lemma', 'лемма'];
const FREQ_COL = ['freq', 'frequency', 'частотность', 'частота', 'ipm', 'fpm', 'freqipm'];
const INFO_DEFAULT = 'Столбцы: слово, нейтральность, позитивность, грусть, угроза, частотность (необязательно, на миллион слов); длина считается автоматически';

/** Текст инструкции: «слово» / «слова» подставляется автоматически, сами слова не называются. */
function instrFor(orientation, many, distractors = 'letters-digits') {
  const symbols = distractors === 'letters-digits' ? 'букв и цифр' : 'букв';
  const dir = orientation === 'horizontal' ? '**по горизонтали** — слева направо' : '**по вертикали** — сверху вниз';
  return many
    ? [
      `Вверху экрана написано, что нужно найти слова. Ниже расположена таблица из ${symbols}, в которой эти слова спрятаны.`,
      '',
      `Слова записаны ${dir}.`,
      '',
      'Найдите все слова и щёлкните по каждому из них левой кнопкой мыши.',
      '',
      'Когда найдёте все слова, нажмите **ПРОБЕЛ**, чтобы перейти к следующему заданию.',
      START_LINE,
    ].join('\n')
    : [
      `Вверху экрана написано, что нужно найти слово. Ниже расположена таблица из ${symbols}, в которой это слово спрятано.`,
      '',
      `Слово записано ${dir}.`,
      '',
      'Найдите его как можно быстрее и щёлкните по нему левой кнопкой мыши.',
      '',
      NEXT_LINE,
      START_LINE,
    ].join('\n');
}

const instrItems = (o) => Object.keys(ORIENTATIONS).map((k) => ({ key: k, label: ORIENTATIONS[k].ru, text: instrFor(k, o.targetsPerStimulus > 1, o.distractors) }));
let lastDefaults = {};

function readStyle() {
  return {
    width: readInt('vb-w', 1920, 640), height: readInt('vb-h', 1080, 360),
    background: readStr('vb-bg'), color: readStr('vb-fg'),
    gridLine: readStr('vb-line'),
    bwFill: readStr('vb-cellbw'),
    fontFamily: readFont('vb-font'),
    fontSize: readInt('vb-size', 0, 0),
    labelOne: readStr('vb-label1') || 'Найдите слово',
    labelMany: readStr('vb-label2') || 'Найдите слова',
  };
}

function readOptions() {
  const orientations = Object.keys(ORIENTATIONS).filter((k) => readChecks('vb-orient').includes(k));
  const colors = Object.keys(COLOR_MODES).filter((k) => readChecks('vb-colors').includes(k));
  return {
    useCategory: readCheck('vb-cat'),
    composition: readStr('vb-comp') || 'four',
    allowOverlap: readCheck('vb-overlap'),
    allowTouch: readCheck('vb-touch'),
    allowRepeats: readCheck('vb-repeat'),
    matchLength: readChecks('vb-match').includes('len'),
    matchFreq: readChecks('vb-match').includes('freq'),
    matchRating: readChecks('vb-match').includes('rate'),
    perCombo: readInt('vb-per', 1, 1, 50),
    orientations, colors,
    targetsPerStimulus: readInt('vb-k', 4, 1, 40),
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
  Object.assign(lastDefaults, Object.fromEntries(instrItems({ ...DEFAULTS }).map((it) => [it.key, it.text])));
  update();
}

/* ---------------- план и проверки ---------------- */

function comboText(o) {
  const parts = [];
  if (o.useCategory && o.composition === 'one') parts.push('категория');
  parts.push('направление', 'цветность');
  return parts.join(' × ');
}

function update() {
  const raw = readOptions();
  const { o, notes } = normalizeOptions(raw);
  const style = readStyle();
  const plan = planOf(o);
  const stimCats = plan.mode === 'one' ? 4 : 1;
  const total = plan.slots * stimCats;
  // подписи полей зависят от состава
  const lbl = $('label[for="vb-per"]');
  if (lbl) lbl.textContent = `Стимулов на каждое сочетание «${comboText(o)}»`;
  const kHint = $('#vb-k-hint');
  if (kHint) kHint.textContent = o.useCategory && o.composition === 'four'
    ? 'При составе «из четырёх категорий» число слов кратно 4 (по умолчанию 4 — по одному слову из каждой категории).'
    : 'Любое число слов. При составе «из одной категории» все слова стимула — одной эмоциональной категории.';
  const compSel = $('#vb-comp');
  if (compSel) compSel.disabled = !o.useCategory;
  $('#vb-plan').innerHTML = `План: <strong class="hl">${total}</strong> разных стимулов (ч/б и цветные — отдельные, с разными словами); слов в стимуле: <strong class="hl">${o.targetsPerStimulus}</strong>`;
  const rec = recommendedFont(style, o.rows, o.cols);
  $('#vb-size').placeholder = `авто: ${rec}`;
  const eligible = state.words.filter((w) => w.category);
  const issues = notes.slice();
  if (!o.orientations.length) issues.push('Отметьте хотя бы одно направление.');
  if (!o.colors.length) issues.push('Отметьте хотя бы один вариант цветности.');
  if (!state.words.length) issues.push('Загрузите CSV со словами.');
  const maxLen = maxWordLength(o);
  const pool = o.useCategory ? eligible : state.words;
  const fit = pool.filter((w) => w.len <= maxLen && w.len >= 2);
  let table = '';
  if (state.words.length && o.orientations.length) {
    const need = o.allowRepeats ? plan.rowsPerSlot : plan.slots * plan.rowsPerSlot;
    const rows = (o.useCategory ? EMOTION_KEYS : ['any']).map((c) => ({
      c, have: fit.filter((w) => c === 'any' || w.category === c).length, need,
    }));
    if (rows.some((r) => r.have < r.need)) issues.push(`Слов не хватает для заданного числа стимулов${o.allowRepeats ? '' : ' без повторов'} (см. таблицу «доступно / нужно»); будет собрано максимум возможного. Можно разрешить повторы слов, загрузить больше слов или уменьшить число стимулов.`);
    if (o.useCategory && eligible.length < state.words.length) issues.push(`${state.words.length - eligible.length} слов не получили эмоциональную категорию (равные или близкие оценки) и не используются.`);
    if (fit.length < pool.length) issues.push(`${pool.length - fit.length} слов не помещаются в сетку ${o.cols}×${o.rows} (длиннее ${maxLen} букв) и не используются.`);
    const f = checkFit(o.useCategory ? eligible : state.words.map((w) => ({ ...w, category: w.category || 'any' })), raw);
    if (!f.ok) issues.push(f.message);
    table = `<div class="data-table-wrap tool-gap narrow"><table class="data-table feas-table"><thead><tr><th>Доступно / нужно слов</th>${rows.map((r) => `<th>${r.c === 'any' ? 'Все слова' : EMOTION_BY_KEY[r.c].ru}</th>`).join('')}</tr></thead>
      <tbody><tr><td>Подходящих по длине</td>${rows.map((r) => `<td class="num ${r.have >= r.need ? 'ok-cell' : 'bad-cell'}">${r.have} / ${r.need}</td>`).join('')}</tr></tbody></table></div>`;
  }
  $('#vb-feas').innerHTML = (issues.length ? alertBox('warn', `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`) : '') + table;
  $('#vb-generate').disabled = !state.words.length || !o.orientations.length || !o.colors.length;
  // «слово» / «слова» и состав символов в инструкции обновляются сами, пока текст не правили вручную
  if (editor) {
    const items = instrItems(o);
    const cur = editor.texts();
    for (const it of items) {
      if (lastDefaults[it.key] !== undefined && cur[it.key] === lastDefaults[it.key] && lastDefaults[it.key] !== it.text) editor.setText(it.key, it.text);
      lastDefaults[it.key] = it.text;
    }
  }
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
    const eligible = opts.useCategory ? state.words.filter((w) => w.category) : state.words;
    const res = generateVerbal(eligible, opts);
    if (!res.stimuli.length) throw new Error('Не удалось собрать ни одного стимула — проверьте таблицу «доступно / нужно слов»');
    const stimuli = res.stimuli.map((st) => {
      const obj = { ...st, filter: st.color, tag: st.color === 'bw' ? 'ч/б' : 'цвет', draw: (canvas, scale) => drawVerbalStimulus(canvas, st, style, scale) };
      obj.aoi = drawVerbalStimulus(document.createElement('canvas'), st, style, 0.05);
      return obj;
    });
    for (const st of stimuli) {
      const cat = EMOTION_BY_KEY[st.category] || null;
      st.badges = `<span>${esc(ORIENTATIONS[st.orientation].short)}</span>${cat ? `<span class="emo-chip" style="--c:${cat.color}">${cat.ru}</span>` : `<span>${st.category === 'mixed4' ? '4 категории' : 'без категорий'}</span>`}`;
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
    showResults(res, stimuli, res.options, style, salMode, method);
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
    stimulus: r.stimulus, file: `stimuli/${r.stimulus}.png`, response_type: 'mouse_click', correct_response: r.word,
    n_targets: stimuli.find((s) => s.name === r.stimulus).targets.length,
    aoi_x: r.aoi_x, aoi_y: r.aoi_y, aoi_w: r.aoi_w, aoi_h: r.aoi_h,
    meaning: 'верный ответ — щелчок мыши внутри рамки целевого слова (координаты в пикселях стимула); если слов несколько, нужно найти каждое; затем ПРОБЕЛ',
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
  for (const st of stimuli) {
    const p = st.placements[0]; const mid = p.cells[Math.floor(p.cells.length / 2)];
    zones[Math.min(2, Math.floor((mid[0] / opts.rows) * 3)) * 3 + Math.min(2, Math.floor((mid[1] / opts.cols) * 3))]++;
  }
  let summary = `
    <h4 class="sub-heading">Баланс целевых слов между эмоциональными категориями</h4>
    <p class="muted-p">Среднее ± SD по уникальным словам и однофакторный ANOVA: p &gt; .05 — категории не различаются. Слова подбирались «рядами», поэтому наблюдения не полностью независимы — таблица ориентировочная.</p>
    ${metricTable(catList.map((c) => (c === 'any' ? 'Все слова' : EMOTION_BY_KEY[c].ru)), rowsBal)}
    <h4 class="sub-heading">Где стоят целевые слова</h4>
    <p class="muted-p">Число стимулов, где первое целевое слово оказалось в каждой из 9 зон сетки.</p>
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
  const insTexts = editor.texts();
  if (editor.enabled()) {
    for (const o of opts.orientations) {
      pngs.push({ path: `instruction_${ORIENTATIONS[o].short}.png`, draw: (c, s = 1) => drawInstructionText(c, { width: W, height: H, background: style.background, color: style.color, fontFamily: style.fontFamily, text: insTexts[o], scale: s }) });
    }
  }
  mountResults($('#vb-results'), {
    prefix: 'vb', step: 3, width: W, height: H, stimuli, title: 'Вербальное мышление (филворд)',
    filters: opts.colors.length > 1 ? opts.colors.map((c) => [c, COLOR_MODES[c].short]) : null,
    requested: res.requested, built: stimuli.length, warnings: res.warnings,
    summaryHtml: summary, pngs, answerKey: keyRows,
    manifests: [
      { file: 'stimuli.csv', rows, desc: 'По строке на стимул: категория, направление, цветность, целевые слова, их длина, частотность и оценка, параметры сетки, средняя яркость, салиентность (если оценивалась)' },
      { file: 'stimuli_targets.csv', rows: tRows, desc: 'По строке на целевое слово: категория, длина, частотность, оценки по шкалам, положение в сетке и область интереса в пикселях, относительная салиентность' },
    ],
    methods: () => methodsDoc({ res, stimuli, opts, style, salMode, method, texts: insTexts, instructionOn: editor.enabled(), rowsBal, catList, zones }),
    readmeIntro: 'Стимулы филворда: сетка букв (и цифр) со спрятанными целевыми словами. Участник находит слова, щёлкает по ним мышью и нажимает ПРОБЕЛ.',
    archiveName: 'filword_stimuli',
    settings: { experiment: 'verbal-thinking-filword', options: opts, style, wordList: state.fileName, alphabet: res.alphabet, saliency: salMode === 'off' ? null : { method, mode: salMode }, instructions: editor.enabled() ? insTexts : null },
  });
  $('#vb-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- описание для раздела «Методы» ---------------- */

function methodsDoc({ res, stimuli, opts, style, salMode, method, texts, instructionOn, rowsBal, catList, zones }) {
  const { H1, H2, P, UL, TABLE, paramTable } = M;
  const plan = res.plan;
  const many = opts.targetsPerStimulus > 1;
  const catRu = (c) => (c === 'any' ? 'без учёта категории' : c === 'mixed4' ? 'четыре категории поровну' : EMOTION_BY_KEY[c].ru);
  const blocks = [
    H1('Филворд (вербальное мышление): описание стимулов'),
    P(`Набор содержит ${M.nStim(stimuli.length)} (запрошено ${res.requested}). Каждый стимул — прямоугольная сетка ${opts.cols} × ${opts.rows} клеток, заполненная буквами` +
      `${opts.distractors === 'letters-digits' ? ' и цифрами' : ''}, в которой спрятано ${opts.targetsPerStimulus} ${M.plural(opts.targetsPerStimulus, 'целевое слово', 'целевых слова', 'целевых слов')} из предоставленного списка. ` +
      `Слова записаны по ${opts.orientations.length > 1 ? 'горизонтали (слева направо) или по вертикали (сверху вниз) — отдельные стимулы для каждого направления' : opts.orientations[0] === 'horizontal' ? 'горизонтали (слева направо)' : 'вертикали (сверху вниз)'}. ` +
      `Над сеткой написано «${style.labelOne}» или «${style.labelMany}» (в зависимости от числа слов); сами слова участнику не называются. ` +
      'Участник находит слова, щёлкает по каждому левой кнопкой мыши и затем нажимает клавишу ПРОБЕЛ.'),
    H2('1. Параметры стимулов'),
    paramTable([
      ['Размер стимула', `${style.width} × ${style.height} пикс.`],
      ['Цвет фона', M.colorText(style.background)],
      ['Цвет букв, цифр и надписи', M.colorText(style.color)],
      ['Цвет клеток (чёрно-белая сетка) / цвет линий сетки', `${M.colorText(style.bwFill)} / ${M.colorText(style.gridLine)}`],
      ['Шрифт', style.fontFamily.split(',')[0].replace(/'/g, '')],
      ['Размер шрифта букв', style.fontSize > 0 ? `${style.fontSize} пикс.` : `подобран автоматически (${recommendedFont(style, opts.rows, opts.cols)} пикс. — 56% размера клетки)`],
      ['Размер сетки', `${opts.cols} столбцов × ${opts.rows} строк`],
      ['Заполнение остальных клеток (дистракторы)', DISTRACTORS[opts.distractors].ru, `алфавит: ${res.alphabet === 'ru' ? 'русский (без повторения целевых слов)' : 'латинский'}`],
      ['Направления', opts.orientations.map((k) => ORIENTATIONS[k].ru).join('; ')],
      ['Цветность', opts.colors.map((k) => COLOR_MODES[k].ru).join('; ')],
      ['Эмоциональные категории слов учитываются', M.yesNo(opts.useCategory)],
      ['Состав слов в стимуле', opts.useCategory ? COMPOSITIONS[opts.composition].ru : 'без учёта категорий'],
      ['Слов в одном стимуле', opts.targetsPerStimulus],
      ['Стимулов на сочетание условий', opts.perCombo],
      ['Слова у внешних границ сетки', opts.allowBorder ? 'допускаются' : 'не допускаются'],
      ['Пересечение слов (общие клетки)', opts.allowOverlap ? 'допускается' : 'не допускается'],
      ['Касание слов (соседние клетки)', opts.allowTouch ? 'допускается' : 'не допускается (между словами не менее одной свободной клетки, в том числе по диагонали)'],
      ['Повторы слов в разных стимулах', opts.allowRepeats ? 'допускаются' : 'не допускаются'],
      ['Уравнивание слов по', [opts.matchLength && 'длине', opts.matchFreq && 'частотности', opts.matchRating && 'оценке по своей шкале'].filter(Boolean).join(', ') || 'не используется'],
      ['Список слов', state.fileName || '—', `использовано слов в наборе: ${new Set(stimuli.flatMap((s) => s.targets.map((w) => w.id))).size}`],
      ['Номер случайного набора', opts.seed],
    ]),
    H2('2. Подбор слов и построение сеток'),
    P('Эмоциональная категория слова определялась по шкале с наибольшей средней оценкой (нейтральность, позитивность, грусть, угроза); слова с равными максимальными оценками, а также слова, не помещающиеся в сетку, не использовались.' +
      `${Number(opts.matchLength) ? ' Слова подбирались «рядами»: в ряд входит по одному слову каждой категории, максимально близких по длине (приоритетно — одинаковое число букв), десятичному логарифму частотности и величине оценки по своей шкале.' : ''}` +
      `${plan.mode === 'four' ? ` Стимул составлен из ${opts.targetsPerStimulus / 4} ряд(ов): поровну слов каждой из четырёх категорий.` : plan.mode === 'one' ? ' Каждый стимул составлен из слов одной категории; для каждой категории созданы отдельные стимулы.' : ' Категории не учитывались.'}`),
    P(`Слова размещались в сетке по очереди, начиная с самых длинных, в случайных позициях при условии соблюдения заданных ограничений (границы, касание, пересечение). Положение слов выравнивалось по 9 зонам сетки: каждое слово ставилось в наименее занятую зону, куда оно помещается. ` +
      'Остальные клетки заполнены случайными символами; все вхождения целевых слов, кроме заданного (в том числе записанные в обратном порядке и в другом направлении), были устранены, так что каждое слово встречается в сетке ровно один раз.'),
    P(`Цветность: «${COLOR_MODES.bw.ru}» — все клетки одного цвета; «${COLOR_MODES.color.ru}» — у каждой клетки свой цвет из палитры 12 цветов равной воспринимаемой светлоты (OKLCH, светлота 0,86, насыщенность 0,075), соседние клетки (слева и сверху) не совпадают. ` +
      'Буквы и положение слов в чёрно-белом и цветном вариантах одного стимула совпадают.'),
    H2('3. Состав набора'),
    TABLE(['Условие', 'Число стимулов'], [...new Set(stimuli.map((s) => `${catRu(s.category)} · ${ORIENTATIONS[s.orientation].short} · ${COLOR_MODES[s.color].short}`))].map((k) => [k, stimuli.filter((s) => `${catRu(s.category)} · ${ORIENTATIONS[s.orientation].short} · ${COLOR_MODES[s.color].short}` === k).length])),
    P('Перечень стимулов и их целевых слов:'),
    TABLE(['Имя файла', 'Целевые слова', 'Длина (букв)'], stimuli.map((s) => [`${s.name}.png`, s.targets.map((w) => cleanWord(w.word)).join(', '), s.targets.map((w) => w.len).join(', ')]), [5, 4, 2]),
    H2('4. Баланс целевых слов между категориями'),
    P('Среднее ± стандартное отклонение по уникальным словам набора и однофакторный дисперсионный анализ (p > 0,05 — категории по показателю не различаются). Слова подбирались рядами, поэтому наблюдения не полностью независимы, и таблица носит ориентировочный характер.'),
    M.balanceTable(catList.map((c) => (c === 'any' ? 'Все слова' : EMOTION_BY_KEY[c].ru)), rowsBal),
    P(`Положение первого целевого слова по девяти зонам сетки (строки сверху вниз, столбцы слева направо): ${zones.join(', ')}.`),
  ];
  if (salMode !== 'off') {
    const withSal = stimuli.filter((s) => s.sal);
    blocks.push(H2('5. Салиентность'), ...M.salienceParagraphs(method));
    blocks.push(P(`Салиентность оценивалась для ${salMode === 'all' ? 'всех стимулов' : 'цветных стимулов (в чёрно-белой сетке все клетки и символы одинаковы)'}: оценено ${withSal.length} стимулов. ` +
      'Относительная салиентность рамки каждого целевого слова приведена в таблице stimuli_targets.csv и может использоваться как ковариата в анализе.'));
    const groups = opts.colors.filter((c) => withSal.some((s) => s.color === c)).map((c) => [c, COLOR_MODES[c].ru]);
    if (groups.length) blocks.push(M.balanceTable(groups.map((g) => g[1]), salienceBalance(withSal, (s) => s.color, groups)));
  }
  blocks.push(H2(`${salMode !== 'off' ? 6 : 5}. Яркость`), M.luminanceParagraph());
  blocks.push(H2(`${salMode !== 'off' ? 7 : 6}. Инструкция для участника`));
  if (instructionOn) {
    blocks.push(P('Инструкция предъявляется отдельным экраном (PNG того же размера и цвета, что стимулы). Тексты:'));
    for (const k of opts.orientations) blocks.push(P(`//${ORIENTATIONS[k].ru}.// ${String(texts[k]).replace(/\*\*/g, '').replace(/\n+/g, ' ')}`));
  } else blocks.push(P('Инструкции в архив не включены.'));
  blocks.push(H2(`${salMode !== 'off' ? 8 : 7}. Ответы и области интереса`),
    P('Правильные ответы приведены в файле answer_key.csv: для каждого целевого слова указана область в пикселях стимула; ответом считается щелчок мыши внутри этой области. Те же области (с оценками и характеристиками слов) содержатся в stimuli_targets.csv.'),
    M.reproducibilityParagraph(opts.seed));
  return blocks;
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
      Классический филворд: сетка букв (и цифр), в которой спрятаны целевые слова из вашего CSV. Участник не знает, какие слова искать:
      на экране написано только «Найдите слово» или «Найдите слова». Он находит слова, записанные по горизонтали или по вертикали,
      щёлкает по ним мышью и нажимает ПРОБЕЛ. По умолчанию — стимулы по 4 слова (по одному из каждой эмоциональной категории)
      для горизонтали и для вертикали; слова подбираются максимально близкими по длине, частотности и оценке.`)}

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
          hint: 'Чёрно-белая: все клетки белые. Цветная: у каждой клетки свой цвет (светлые тона одинаковой светлоты, соседние клетки не совпадают). Чёрно-белый и цветной варианты — разные стимулы: у каждого свои слова и свои буквы.' })}
        ${fld.check('vb-cat', 'Учитывать эмоциональную категорию слов', true, { hint: 'Включено: слова подбираются по четырём эмоциональным категориям. Выключено: слова берутся из всего списка без разделения на категории.' })}
        ${fld.select('vb-comp', 'Состав слов в одном стимуле', Object.entries(COMPOSITIONS).map(([k, v]) => [k, v.ru]), 'four', { hint: 'Доступно при учёте категорий. «Из четырёх категорий» — поровну из каждой (по умолчанию). «Из одной категории» — для каждой категории свои стимулы.' })}
        <div class="field"><label for="vb-k">Количество слов в одном стимуле</label>
          <input type="number" id="vb-k" value="4" min="1" max="40" step="1">
          <span class="hint" id="vb-k-hint"></span></div>
        ${fld.num('vb-per', 'Стимулов на каждое сочетание «направление × цветность»', 1, { min: 1, max: 50, hint: 'Число разных сеток для каждого сочетания. Чёрно-белый и цветной варианты одной сетки считаются разными стимулами.' })}
        ${fld.check('vb-repeat', 'Разрешить повторы слов в разных стимулах', false, { hint: 'Выключено (по умолчанию): каждое слово используется один раз за весь набор. Включено: слово может встречаться в разных стимулах, но не дважды в одном.' })}
        ${fld.checks('vb-match', 'Уравнивать слова разных категорий по', [['len', 'длине', true], ['freq', 'частотности', true], ['rate', 'оценке по своей шкале', true]], { wide: true,
          hint: 'Слова подбираются «рядами» — по одному из каждой категории, максимально близких по выбранным признакам. Длина уравнивается строго (одинаковое число букв), если слов достаточно.' })}
        ${fld.num('vb-seed', 'Номер случайного набора', 1, { hint: 'При том же номере и тех же данных получится тот же набор. Поменяйте номер, чтобы получить другой.' })}
      `)}
      ${sep()}
      ${sub('Сетка')}
      ${grid(`
        ${fld.pair('vb-cols', 'vb-rows', 'Размер сетки: столбцов × строк', 10, 10, { min: 4 })}
        ${fld.select('vb-dist', 'Чем заполнены остальные клетки (дистракторы)', Object.entries(DISTRACTORS).map(([k, v]) => [k, v.ru]), 'letters-digits')}
        ${fld.check('vb-noborder', 'Не размещать слова у внешних границ сетки', false, { hint: 'Выключено (по умолчанию): слова могут стоять у внешних границ сетки. Включено: крайние строки и столбцы заполнены только дистракторами.' })}
        ${fld.check('vb-overlap', 'Разрешить словам пересекаться (иметь общие клетки и буквы)', false, { hint: 'Выключено (по умолчанию): у слов нет общих клеток. Включено: два слова могут использовать одну и ту же клетку, если там стоит одна и та же буква.' })}
        ${fld.check('vb-touch', 'Разрешить словам касаться друг друга (стоять в соседних клетках)', false, { hint: 'Выключено (по умолчанию): между словами есть хотя бы одна свободная клетка, в том числе по диагонали. Если слова не помещаются, появится предупреждение.' })}
        ${fld.check('vb-zscale', 'Сравнивать шкалы слов в стандартизованном виде (z-оценки)', false, { hint: 'Включите, если шкалы нельзя сравнивать напрямую, например у них разный диапазон оценок.' })}
        ${fld.num('vb-margin', 'Минимальный отрыв главной шкалы от второй, баллы', 0, { min: 0, step: 0.1, hint: 'Эмоция слова — шкала с наибольшей оценкой. Если отрыв от второй шкалы меньше, слово «смешанное» и не используется. 0 — не ограничивать.' })}
      `)}
      ${sep()}
      ${sub('Внешний вид')}
      ${grid(`
        ${fld.pair('vb-w', 'vb-h', 'Размер стимула: ширина × высота, пикс.', 1920, 1080, { min: 320 })}
        ${fontField('vb-font', 'Шрифт', 'Arial, Helvetica, sans-serif')}
        ${fld.num('vb-size', 'Размер шрифта букв, пикс.', '', { min: 8, placeholder: 'авто', hint: 'Оставьте пустым — размер подберётся по размеру клетки сетки (рекомендуется).' })}
        ${fld.colors('vb-bg', 'vb-fg', 'Цвет фона / цвет текста', BG, FG)}
        ${fld.colors('vb-cellbw', 'vb-line', 'Цвет клеток в ч/б сетке / цвет линий сетки', '#ffffff', '#8a8a8a')}
        ${fld.text('vb-label1', 'Надпись над сеткой, если слово одно', 'Найдите слово', { hint: 'Какое именно слово — не указывается.' })}
        ${fld.text('vb-label2', 'Надпись над сеткой, если слов несколько', 'Найдите слова', { hint: 'Подставляется автоматически по числу слов в стимуле.' })}
      `)}
      ${sep()}
      ${sub('Салиентность')}
      <p class="muted-p"><strong>Нужно ли оценивать?</strong> Для чёрно-белой сетки — нет: все клетки и буквы одинаковы, а положение слова не меняет визуальной статистики экрана. Для цветной — да: случайные цвета клеток делают одни места заметнее других, и заметность рамки целевого слова стоит включить в анализ как ковариату. Поэтому по умолчанию оцениваются только цветные стимулы.</p>
      ${grid(`
        ${fld.select('vb-sal', 'Оценивать салиентность', [['color-only', 'Только цветные стимулы (рекомендуется)'], ['all', 'Все стимулы'], ['off', 'Не оценивать']], 'color-only')}
        ${fld.select('vb-sal-method', 'Алгоритм', Object.entries(METHOD_LABELS), 'ft')}
      `)}
      ${instructionEditorHtml('vb', { items: instrItems({ ...DEFAULTS }) })}
    `)}
    ${generateBar('vb')}`;

  bindDropzone($('#vb-dropzone'), $('#vb-file'), loadFile);
  $('#vb-template').addEventListener('click', downloadTemplate);
  $('#vb-clear').addEventListener('click', () => { state.raw = []; state.words = []; $('#vb-info').textContent = INFO_DEFAULT; invalidate(); refresh(); });
  bindFont('vb-font', () => editor.preview());
  editor = mountInstructionEditor('vb', instrItems({ ...DEFAULTS }), () => {
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
