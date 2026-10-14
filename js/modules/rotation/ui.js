/* ============================================================
   rotation/ui.js — «Плоскостное ментальное вращение · создание стимулов»
   ============================================================ */

import { $, esc, tick } from '../../common/ui.js';
import { toastError, toastSuccess } from '../../core/toast.js';
import { fld, fontField, bindFont, readFont, readInt, readNum, readStr, readCheck, readChecks, parseIntList, onAnyChange } from '../../kit/fields.js';
import { panelHead, stepTitle, card, grid, sep, sub, generateBar, alertBox } from '../../kit/panel.js';
import { instructionEditorHtml, mountInstructionEditor, drawInstructionText } from '../../kit/instr.js';
import { mountResults, metricTable } from '../../kit/results.js';
import { evaluateSalience, relativeAoiSalience, salienceBalance, METHOD_LABELS, SAL_KEYS } from '../../kit/salience.js';
import { ensureFont } from '../../kit/text.js';
import { meanLuminance } from '../../kit/luminance.js';
import { TRANSFORMS, TRANSFORM_KEYS, COLOR_MODES, COLOR_KEYS, OP_RU, OPTION_SETS, generateRotation, feasiblePresets, presetLabel, figureFeasibility } from './generator.js';
import { DEFAULT_STYLE, autoCell, checkLayout, drawRotationStimulus } from './render.js';
import { BG, FG, NEXT_LINE, START_LINE } from '../../kit/defaults.js';
import * as M from '../../kit/methods.js';

const INSTRUCTION_TEXT = (action) => [
  `Какая из четырёх предложенных ниже фигур получится, если ${action}?`,
  '',
  'Щёлкните левой кнопкой мыши по выбранному варианту ответа — фигуре с номером 1, 2, 3 или 4.',
  '',
  NEXT_LINE,
  START_LINE,
].join('\n');

let editor = null;
let lastKey = '';

function readStyle() {
  const W = readInt('rot-w', 1920, 640);
  const H = readInt('rot-h', 1080, 360);
  return {
    width: W, height: H,
    cell: readInt('rot-cell', 0, 0),
    background: readStr('rot-bg'),
    fill: readStr('rot-fill'),
    grid: readStr('rot-grid'),
    labelColor: readStr('rot-fill'),
    fontFamily: readFont('rot-font'),
  };
}

function readOptions() {
  const pieces = readStr('rot-pieces-sel') === 'custom' ? parseIntList(readStr('rot-pieces'), 1, 9) : parseIntList(readStr('rot-pieces-sel'), 1, 9);
  return {
    transforms: TRANSFORM_KEYS.filter((k) => readChecks('rot-transforms').includes(k)),
    colors: COLOR_KEYS.filter((k) => readChecks('rot-colors').includes(k)),
    perCombo: readInt('rot-per', 1, 1, 50),
    n: readInt('rot-n', 10, 5, 20),
    pieces: pieces.length ? pieces : [3, 2, 2, 1, 1, 1],
    piecesSource: readStr('rot-pieces-sel') === 'custom' ? 'свой состав' : 'готовый набор',
    allowBorder: readCheck('rot-border'),
    seed: readInt('rot-seed', 1),
  };
}

function updatePlan() {
  const o = readOptions();
  const style = readStyle();
  const total = o.transforms.length * o.colors.length * o.perCombo;
  $('#rot-plan').innerHTML = `План: <strong class="hl">${o.transforms.length}</strong> заданий × <strong class="hl">${o.colors.length}</strong> вариантов цветности × <strong class="hl">${o.perCombo}</strong> = <strong class="hl">${total}</strong> стимулов`;
  $('#rot-cell').placeholder = `авто: ${autoCell(style.width)}`;
  const cells = o.pieces.reduce((a, b) => a + b, 0);
  const issues = checkLayout({ ...DEFAULT_STYLE, ...style }, o.n);
  if (cells > o.n * o.n * 0.4) issues.push(`Закрашено ${cells} клеток из ${o.n * o.n} — фигурки могут не поместиться без касаний.`);
  if (readStr('rot-pieces-sel') === 'custom' && o.pieces.length) {
    const rate = figureFeasibility(o.pieces, o.n, o.allowBorder);
    if (rate === 0) issues.push('Выбранный состав фигурок не помещается на поле без касаний: уменьшите число или длину линий либо увеличьте поле.');
    else if (rate < 1) issues.push(`Выбранный состав помещается не всегда (удачных расстановок ${Math.round(rate * 100)}%): часть стимулов может не собраться.`);
  }
  $('#rot-feas').innerHTML = (total === 0 ? alertBox('warn', 'Отметьте хотя бы одно задание и один вариант цветности.') : '') +
    (issues.length ? alertBox('warn', `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`) : '');
  $('#rot-generate').disabled = total === 0;
}

function instructionItems(keys = TRANSFORM_KEYS) {
  return keys.map((k) => ({ key: k, label: TRANSFORMS[k].ru, text: INSTRUCTION_TEXT(TRANSFORMS[k].action) }));
}

/* ---------------- состав фигурок ---------------- */

const optionTag = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

function piecesFieldHtml() {
  const presets = feasiblePresets(10, false);
  return `
    <div class="field"><label for="rot-pieces-sel">Состав фигурок (длины линий в клетках)</label>
      <div class="select-wrap"><select id="rot-pieces-sel">
        ${presets.map((p, i) => optionTag(p.join(','), presetLabel(p), i === 0)).join('')}
        ${optionTag('custom', 'Свой состав — ввести длины через запятую…', false)}
      </select></div>
      <input type="text" id="rot-pieces" value="3, 2, 2, 1, 1, 1" hidden>
      <span class="hint" id="rot-pieces-hint"></span></div>`;
}

/** Пересчитывает список готовых наборов под текущий размер поля и правило крайних рядов. */
function refreshPresets() {
  const sel = $('#rot-pieces-sel');
  const n = readInt('rot-n', 10, 5, 20);
  const border = readCheck('rot-border');
  const prev = sel.value;
  const presets = feasiblePresets(n, border);
  sel.innerHTML = presets.map((p) => optionTag(p.join(','), presetLabel(p), false)).join('') + optionTag('custom', 'Свой состав — ввести длины через запятую…', false);
  const values = [...sel.options].map((o) => o.value);
  sel.value = values.includes(prev) ? prev : (values[0] || 'custom');
  const custom = sel.value === 'custom';
  $('#rot-pieces').hidden = !custom;
  const hint = $('#rot-pieces-hint');
  if (custom) {
    const pieces = parseIntList(readStr('rot-pieces'), 1, 9);
    const rate = pieces.length ? figureFeasibility(pieces, n, border) : 0;
    hint.textContent = !pieces.length ? 'Введите длины линий, например 3, 2, 2, 1, 1, 1.'
      : rate === 1 ? 'Такой состав помещается на поле без касаний фигурок.'
      : rate > 0 ? `Такой состав помещается не всегда (удачных расстановок ${Math.round(rate * 100)}%) — стимулы могут не собраться.`
      : 'Такой состав не помещается на поле без касаний: уменьшите число или длину линий либо увеличьте поле.';
  } else {
    hint.textContent = `В списке только наборы, которые помещаются на поле ${n} × ${n} так, что фигурки нигде не касаются друг друга, даже углами` + (border ? '.' : ' (крайний ряд и столбец свободны).');
  }
}

export function initRotation() {
  $('#mode-rot').innerHTML = `
    ${panelHead('01', 'Плоскостное ментальное вращение · создание стимулов', `
      На экране — фигура-задание (поле 10×10 с шестью «фигурками» из закрашенных клеток) и четыре варианта ответа с номерами 1–4.
      Нужно выбрать, какая из фигур получится, если фигуру-задание повернуть на 90° по часовой стрелке, на 90° против часовой стрелки,
      на 180° или отразить зеркально относительно вертикальной оси (лево↔право). Ответ — щелчок мыши по выбранному варианту, затем ПРОБЕЛ для перехода к следующему заданию.`)}

    ${stepTitle(1, 'Что создаём')}
    ${card(grid(`
      ${fld.checks('rot-transforms', 'Задания (как повернуть или отразить фигуру-задание)',
        TRANSFORM_KEYS.map((k) => [k, TRANSFORMS[k].ru, true]), { wide: true,
          hint: 'По умолчанию — все четыре задания. Для каждого задания в архив попадёт своя инструкция.' })}
      ${fld.checks('rot-colors', 'Цветность (можно выбрать несколько)',
        COLOR_KEYS.map((k) => [k, COLOR_MODES[k].ru, true]), { wide: true,
          hint: 'Чёрно-белый: все закрашенные клетки одного серого цвета. «Каждый квадратик своего цвета»: у каждой клетки свой цвет. «Каждая фигурка своего цвета»: клетки одной фигурки (линии из 1–3 клеток) одного цвета, у разных фигурок — разные. Цвета подобраны одинаковой светлоты.' })}
      ${fld.num('rot-per', 'Стимулов на каждое сочетание «задание × цветность»', 1, { min: 1, max: 50 })}
      ${fld.num('rot-seed', 'Номер случайного набора', 1, { hint: 'При том же номере и тех же настройках получится тот же набор. Поменяйте номер, чтобы получить другой.' })}
    `))}

    ${stepTitle(2, 'Параметры')}
    ${card(`
      ${grid(`
        ${fld.pair('rot-w', 'rot-h', 'Размер стимула: ширина × высота, пикс.', 1920, 1080, { min: 320 })}
        ${fld.num('rot-n', 'Размер поля, клеток (поле квадратное)', 10, { min: 5, max: 20, hint: 'По умолчанию 10 × 10.' })}
        ${fld.num('rot-cell', 'Размер клетки, пикс.', '', { min: 4, placeholder: 'авто', hint: 'Оставьте пустым — размер подберётся по ширине стимула (поле-задание сверху и ряд вариантов ниже).' })}
        ${piecesFieldHtml()}
        ${fld.check('rot-border', 'Разрешить фигуркам занимать крайние ряды и столбцы поля', false, { hint: 'Выключено (по умолчанию): крайний ряд поля всегда пустой.' })}
        ${fontField('rot-font', 'Шрифт номеров вариантов', 'Arial, Helvetica, sans-serif')}
        ${fld.colors('rot-bg', 'rot-fill', 'Цвет фона / цвет закрашенных клеток и номеров', BG, FG)}
        ${fld.color('rot-grid', 'Цвет линий сетки', '#b7b7b7')}
      `)}
      ${sep()}
      ${sub('Салиентность')}
      <p class="muted-p">Для каждого стимула считается карта салиентности (метрики mean, entropy, center bias, spread %), а также заметность фигуры-задания, верного варианта и неверных вариантов относительно остального экрана. Так видно, не выделяется ли верный ответ сам по себе, и одинаковы ли стимулы с разной цветностью.</p>
      ${grid(`
        ${fld.check('rot-sal-on', 'Оценивать салиентность', true)}
        ${fld.select('rot-sal-method', 'Алгоритм', Object.entries(METHOD_LABELS), 'ft', { hint: 'Для искусственных цветных стимулов подходит FT (учитывает цвет в пространстве Lab) — используется по умолчанию.' })}
      `)}
      ${instructionEditorHtml('rot', { items: instructionItems() })}
    `)}

    ${generateBar('rot')}`;

  bindFont('rot-font', () => editor.preview());
  editor = mountInstructionEditor('rot', instructionItems(), () => {
    const s = readStyle();
    return { width: s.width, height: s.height, background: s.background, color: '#000000', fontFamily: s.fontFamily };
  });
  onAnyChange($('#mode-rot'), (el) => {
    if (el.id.startsWith('rot-ins')) return;
    if (['rot-n', 'rot-border', 'rot-pieces-sel', 'rot-pieces'].includes(el.id)) refreshPresets();
    updatePlan(); editor.preview(); invalidate();
  });
  refreshPresets();
  $('#rot-generate').addEventListener('click', generate);
  ensureFont(DEFAULT_STYLE.fontFamily).then(() => editor.preview());
  updatePlan();
}

function invalidate() {
  const box = $('#rot-results');
  if (!box.hidden) { box.hidden = true; box.innerHTML = ''; }
}

const busy = (on, text) => { $('#rot-busy').hidden = !on; if (text) $('#rot-busy-text').textContent = text; };

async function generate() {
  const opts = readOptions();
  const style = { ...DEFAULT_STYLE, ...readStyle() };
  const salOn = readCheck('rot-sal-on');
  const method = readStr('rot-sal-method');
  const btn = $('#rot-generate');
  btn.disabled = true;
  busy(true, 'Подбор фигур…');
  try {
    await ensureFont(style.fontFamily);
    await tick();
    const res = generateRotation(opts);
    const stimuli = res.stimuli.map((st) => {
      const obj = {
        ...st,
        filter: st.transform,
        tag: COLOR_MODES[st.color].short,
        draw: (canvas, scale) => drawRotationStimulus(canvas, st, style, scale),
      };
      obj.aoi = drawRotationStimulus(document.createElement('canvas'), st, style, 0.05);
      return obj;
    });
    if (salOn) {
      let i = 0;
      for (const st of stimuli) {
        busy(true, `Оценка салиентности (${method.toUpperCase()}): ${++i} из ${stimuli.length}`);
        await tick();
        const ev = evaluateSalience(st, style.width, style.height, method);
        st.sal = ev.metrics;
        const rel = (r) => relativeAoiSalience(ev.map, r, style.width, style.height);
        st.rel = { task: rel(st.aoi.task), options: st.aoi.options.map(rel) };
      }
    }
    for (const st of stimuli) {
      st.badges = `<span>ответ: <strong class="hl">${st.correctPos}</strong></span><span>${esc(COLOR_MODES[st.color].short)}</span>`;
      st.infoHtml = `<p class="muted-p">Задание: <strong class="hl">${esc(TRANSFORMS[st.transform].ru.toLowerCase())}</strong>. Верный ответ: <strong class="hl">${st.correctPos}</strong>.
        Варианты: ${st.options.map((o) => `${o.pos} — ${esc(OP_RU[o.op])}${o.correct ? ' (верный)' : ''}`).join('; ')}.</p>`;
    }
    showResults(res, stimuli, opts, style, salOn, method);
    toastSuccess(`Собрано стимулов: ${stimuli.length}`);
  } catch (e) {
    console.error(e);
    toastError(`Не удалось сформировать стимулы: ${e.message}`, 7000);
  } finally {
    busy(false);
    btn.disabled = false;
  }
}

const f3 = (v) => (v == null || !Number.isFinite(v) ? '' : Number(v.toFixed(3)));

function showResults(res, stimuli, opts, style, salOn, method) {
  const W = style.width; const H = style.height;
  const rows = stimuli.map((st) => {
    const r = {
      stimulus: st.name, task: st.transform, color_mode: st.color, correct_answer: st.correctPos,
      option_1: st.options[0].op, option_2: st.options[1].op, option_3: st.options[2].op, option_4: st.options[3].op,
      mean_luminance: meanLuminance(st, W),
      n_filled_cells: st.figure.cells.length, n_figures: st.figure.pieces.length, field_cells: opts.n, width: W, height: H,
    };
    if (st.sal) {
      for (const k of SAL_KEYS) r[`salience_${k}`] = st.sal[k];
      r.salience_rel_task = f3(st.rel.task);
      r.salience_rel_correct = f3(st.rel.options[st.correctPos - 1]);
      const dis = st.rel.options.filter((_, i) => i !== st.correctPos - 1);
      r.salience_rel_distractors_mean = f3(dis.reduce((a, b) => a + b, 0) / dis.length);
    }
    return r;
  });
  const aoiRows = [];
  for (const st of stimuli) {
    aoiRows.push({ stimulus: st.name, region: 'task', option: '', operation: '', is_correct: '', x: st.aoi.task.x, y: st.aoi.task.y, w: st.aoi.task.w, h: st.aoi.task.h, salience_rel: st.rel ? f3(st.rel.task) : '' });
    st.aoi.options.forEach((o, i) => aoiRows.push({
      stimulus: st.name, region: 'option', option: o.pos, operation: o.op, is_correct: o.correct ? 1 : 0, x: o.x, y: o.y, w: o.w, h: o.h, salience_rel: st.rel ? f3(st.rel.options[i]) : '',
    }));
  }

  const pos = [1, 2, 3, 4].map((p) => stimuli.filter((s) => s.correctPos === p).length);
  const keyRows = stimuli.map((st) => {
    const a = st.aoi.options[st.correctPos - 1];
    return {
      stimulus: st.name, file: `stimuli/${st.name}.png`, task: st.transform, color_mode: st.color,
      response_type: 'mouse_click', correct_response: st.correctPos,
      correct_operation: st.options[st.correctPos - 1].op,
      correct_area_x: a.x, correct_area_y: a.y, correct_area_w: a.w, correct_area_h: a.h,
      meaning: 'верный ответ — щелчок мыши внутри поля варианта с номером correct_response (координаты поля в пикселях стимула)',
      option_1: st.options[0].op, option_2: st.options[1].op, option_3: st.options[2].op, option_4: st.options[3].op,
    };
  });
  let summary = `
    <h4 class="sub-heading">Номера верных ответов</h4>
    <p class="muted-p">Сколько раз верным был вариант 1, 2, 3, 4 — номера распределены поровну (с точностью до одного).</p>
    <div class="data-table-wrap narrow"><table class="data-table"><thead><tr><th>Вариант</th><th>1</th><th>2</th><th>3</th><th>4</th></tr></thead><tbody><tr><td>Верный ответ</td>${pos.map((n) => `<td class="num">${n}</td>`).join('')}</tr></tbody></table></div>`;
  if (salOn) {
    const colorGroups = opts.colors.map((c) => [c, COLOR_MODES[c].ru]);
    const trGroups = opts.transforms.map((t) => [t, TRANSFORMS[t].ru]);
    const relC = stimuli.map((s) => s.rel.options[s.correctPos - 1]);
    const relD = stimuli.flatMap((s) => s.rel.options.filter((_, i) => i !== s.correctPos - 1));
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    summary += `
      <h4 class="sub-heading">Салиентность (${esc(METHOD_LABELS[method])}) по цветности</h4>
      <p class="muted-p">Среднее ± SD по стимулам и однофакторный ANOVA: p &gt; .05 — условия по этой метрике не различаются. Если различаются — цветность влияет не только на «цветность», но и на общую заметность экрана; это стоит учесть в анализе.</p>
      ${metricTable(colorGroups.map((g) => g[1]), salienceBalance(stimuli, (s) => s.color, colorGroups))}
      <h4 class="sub-heading">Салиентность по заданиям</h4>
      ${metricTable(trGroups.map((g) => g[1]), salienceBalance(stimuli, (s) => s.transform, trGroups))}
      <h4 class="sub-heading">Не выделяется ли верный ответ</h4>
      <p class="muted-p">Средняя салиентность поля относительно среднего по экрану (1 — как в среднем). Если верный вариант заметно выше неверных, на него будут смотреть чаще независимо от решения задачи.</p>
      <div class="data-table-wrap narrow"><table class="data-table"><thead><tr><th>Область</th><th>Относительная салиентность (среднее)</th></tr></thead><tbody>
        <tr><td>Фигура-задание</td><td class="num">${avg(stimuli.map((s) => s.rel.task)).toFixed(3)}</td></tr>
        <tr><td>Верный вариант</td><td class="num">${avg(relC).toFixed(3)}</td></tr>
        <tr><td>Неверные варианты</td><td class="num">${avg(relD).toFixed(3)}</td></tr></tbody></table></div>`;
  }

  const items = editor.texts();
  const pngs = [];
  if (editor.enabled()) {
    for (const k of opts.transforms) {
      pngs.push({ path: `instruction_${TRANSFORMS[k].short}.png`, draw: (c, s = 1) => drawInstructionText(c, { width: W, height: H, background: style.background, color: '#000000', fontFamily: style.fontFamily, text: items[k], scale: s }) });
    }
  }

  mountResults($('#rot-results'), {
    prefix: 'rot', step: 3, width: W, height: H, stimuli, title: 'Плоскостное ментальное вращение',
    filters: opts.transforms.map((k) => [k, TRANSFORMS[k].short]),
    requested: res.requested, built: stimuli.length,
    summaryHtml: summary, pngs,
    answerKey: keyRows,
    manifests: [
      { file: 'stimuli.csv', rows, desc: 'По строке на стимул: задание, цветность, номер верного ответа, операции вариантов, число клеток и фигурок, средняя яркость, салиентность (если оценивалась)' },
      { file: 'stimuli_aoi.csv', rows: aoiRows, desc: 'Области интереса в пикселях стимула: фигура-задание и четыре варианта (с признаком верного и относительной салиентностью)' },
    ],
    methods: () => methodsDoc({ res, stimuli, opts, style, salOn, method, items: editor.texts(), instructionOn: editor.enabled(), pos }),
    readmeIntro: 'Стимулы плоскостного ментального вращения: фигура-задание и четыре варианта ответа. Ответ — щелчок мыши по выбранному варианту, переход к следующему заданию — ПРОБЕЛ.',
    archiveName: 'mental_rotation_stimuli',
    settings: { experiment: 'planar-mental-rotation', options: opts, style, saliency: salOn ? method : null, instructions: editor.enabled() ? items : null },
  });
  $('#rot-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- описание для раздела «Методы» ---------------- */

function methodsDoc({ res, stimuli, opts, style, salOn, method, items, instructionOn, pos }) {
  const { H1, H2, P, UL, TABLE, paramTable } = M;
  const cells = opts.pieces.reduce((a, b) => a + b, 0);
  const cellPx = style.cell > 0 ? style.cell : autoCell(style.width);
  const rel = (s) => s.rel;
  const blocks = [
    H1('Плоскостное ментальное вращение: описание стимулов'),
    P(`Набор содержит ${M.nStim(stimuli.length)} (запрошено ${res.requested}). Каждый стимул — одно экранное задание на плоскостное ментальное вращение: ` +
      `вверху расположена фигура-задание (квадратное поле ${opts.n} × ${opts.n} клеток, в котором закрашены клетки «фигурок»), ниже в один ряд — четыре варианта ответа, пронумерованные от 1 до 4. ` +
      'Участник должен определить, какая из четырёх фигур получится, если фигуру-задание повернуть на 90° по часовой стрелке, повернуть на 90° против часовой стрелки, повернуть на 180° или отразить зеркально относительно вертикальной оси, т. е. поменять местами левую и правую стороны (в зависимости от задания). ' +
      'Ответ даётся щелчком левой кнопки мыши по выбранному варианту; к следующему заданию участник переходит нажатием клавиши ПРОБЕЛ.'),
    H2('1. Параметры стимулов'),
    paramTable([
      ['Размер стимула', `${style.width} × ${style.height} пикс.`, 'Размер каждого PNG-файла'],
      ['Цвет фона', M.colorText(style.background)],
      ['Цвет закрашенных клеток и номеров вариантов (чёрно-белый вариант)', M.colorText(style.fill)],
      ['Цвет линий сетки', M.colorText(style.grid)],
      ['Шрифт номеров вариантов', style.fontFamily.split(',')[0].replace(/'/g, '')],
      ['Размер поля', `${opts.n} × ${opts.n} клеток`],
      ['Размер клетки', `${cellPx} пикс.${style.cell > 0 ? '' : ' (подобран автоматически по ширине стимула)'}`],
      ['Состав фигурок (длины линий в клетках)', opts.pieces.join(' + '), `${opts.pieces.length} фигурок, всего ${cells} закрашенных клеток; источник: ${opts.piecesSource}`],
      ['Крайние ряды и столбцы поля', opts.allowBorder ? 'могут быть заняты' : 'всегда свободны'],
      ['Задания', opts.transforms.map((k) => TRANSFORMS[k].ru).join('; ')],
      ['Варианты цветности', opts.colors.map((k) => COLOR_MODES[k].ru).join('; ')],
      ['Стимулов на каждое сочетание «задание × цветность»', opts.perCombo],
      ['Номер случайного набора', opts.seed],
    ]),
    H2('2. Построение стимулов'),
    P(`Фигура-задание строится из линий заданной длины (${opts.pieces.join(', ')} клеток), каждая линия ориентирована горизонтально или вертикально. Линии размещаются случайно так, чтобы нигде не касаться друг друга, в том числе углами` +
      `${opts.allowBorder ? '' : ', и не занимали крайние ряды и столбцы поля'}. Фигуры, при преобразованиях которых получаются совпадающие варианты (симметричные), отбрасываются, поэтому все четыре варианта ответа и фигура-задание попарно различны.`),
    P('Четыре варианта получены из фигуры-задания следующими операциями (для каждого задания первый в списке — верный вариант; порядок вариантов на экране случаен):'),
    TABLE(['Задание', 'Верный вариант', 'Неверные варианты'], opts.transforms.map((k) => {
      const set = OPTION_SETS[k];
      return [TRANSFORMS[k].ru, OP_RU[set[0]], set.slice(1).map((o) => OP_RU[o]).join('; ')];
    })),
    P('Номер, под которым расположен верный вариант, распределён по стимулам равномерно (с точностью до одного стимула): ' +
      `вариант 1 — ${pos[0]}, вариант 2 — ${pos[1]}, вариант 3 — ${pos[2]}, вариант 4 — ${pos[3]} стимулов.`),
    P(`Цветность. «${COLOR_MODES.bw.ru}»: все закрашенные клетки одного цвета. ${opts.colors.includes('square') ? `«${COLOR_MODES.square.ru}»: у каждой закрашенной клетки свой цвет. ` : ''}` +
      `${opts.colors.includes('figure') ? `«${COLOR_MODES.figure.ru}»: клетки одной линии одного цвета, у разных линий разные цвета. ` : ''}` +
      'Цвета выбраны одинаковой воспринимаемой светлоты (цветовое пространство OKLCH, светлота 0,62, насыщенность 0,14, тона равномерно по кругу), чтобы различия между цветами не создавали различий в заметности. ' +
      'Цвет клетки сохраняется при любом преобразовании: клетка с одним и тем же цветом присутствует во всех вариантах.'),
    H2('3. Состав набора'),
    TABLE(['Задание', ...opts.colors.map((k) => COLOR_MODES[k].ru), 'Всего'],
      opts.transforms.map((t) => [TRANSFORMS[t].ru, ...opts.colors.map((c) => stimuli.filter((s) => s.transform === t && s.color === c).length), stimuli.filter((s) => s.transform === t).length])),
    P('Полный перечень стимулов (в таблице: имя файла, задание, цветность, номер верного ответа):'),
    TABLE(['Имя файла', 'Задание', 'Цветность', 'Верный ответ'], stimuli.map((s) => [`${s.name}.png`, TRANSFORMS[s.transform].short, COLOR_MODES[s.color].short, s.correctPos]), [5, 2, 2, 1.5]),
  ];
  if (salOn) {
    const colorGroups = opts.colors.map((c) => [c, COLOR_MODES[c].ru]);
    const trGroups = opts.transforms.map((t) => [t, TRANSFORMS[t].ru]);
    blocks.push(H2('4. Салиентность'), ...M.salienceParagraphs(method));
    blocks.push(P('Сравнение салиентности стимулов по цветности (среднее ± стандартное отклонение, n — число стимулов; однофакторный дисперсионный анализ):'));
    blocks.push(M.balanceTable(colorGroups.map((g) => g[1]), salienceBalance(stimuli, (s) => s.color, colorGroups)));
    blocks.push(P('Сравнение по заданиям:'));
    blocks.push(M.balanceTable(trGroups.map((g) => g[1]), salienceBalance(stimuli, (s) => s.transform, trGroups)));
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    const relC = stimuli.map((s) => rel(s).options[s.correctPos - 1]);
    const relD = stimuli.flatMap((s) => rel(s).options.filter((_, i) => i !== s.correctPos - 1));
    blocks.push(P('Относительная салиентность областей интереса (среднее по стимулам; 1 — как в среднем по экрану). Если верный вариант заметнее неверных, на него будут смотреть чаще независимо от решения задачи:'));
    blocks.push(TABLE(['Область интереса', 'Относительная салиентность'], [
      ['Фигура-задание', M.f2(avg(stimuli.map((s) => rel(s).task)), 3)],
      ['Верный вариант', M.f2(avg(relC), 3)],
      ['Неверные варианты', M.f2(avg(relD), 3)],
    ]));
  }
  blocks.push(H2(salOn ? '5. Яркость' : '4. Яркость'), M.luminanceParagraph());
  const lumGroups = opts.colors.map((c) => {
    const v = stimuli.filter((s) => s.color === c).map((s) => meanLuminance(s, style.width));
    return [COLOR_MODES[c].ru, M.f2(M.stats.meanOf(v), 4), M.f2(M.stats.sdOf(v), 4), v.length];
  });
  blocks.push(TABLE(['Цветность', 'Средняя яркость', 'SD', 'n'], lumGroups));
  blocks.push(H2(salOn ? '6. Инструкция для участника' : '5. Инструкция для участника'));
  if (instructionOn) {
    blocks.push(P('Для каждого задания подготовлена инструкция (PNG того же размера и цвета, что стимулы). Тексты:'));
    for (const k of opts.transforms) blocks.push(P(`//${TRANSFORMS[k].ru}.// ${String(items[k]).replace(/\*\*/g, '').replace(/\n+/g, ' ')}`));
  } else blocks.push(P('Инструкции в архив не включены.'));
  blocks.push(H2(salOn ? '7. Ответы и области интереса' : '6. Ответы и области интереса'),
    P('Правильные ответы приведены в файле answer_key.csv: для каждого стимула указан номер верного варианта, операция, которой он получен, и координаты поля верного варианта в пикселях стимула (ответом считается щелчок мыши внутри этого поля). ' +
      'Файл stimuli_aoi.csv содержит координаты областей интереса: фигура-задание и четыре варианта.'),
    M.reproducibilityParagraph(opts.seed));
  return blocks;
}
