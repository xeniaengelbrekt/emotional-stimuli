/* ============================================================
   rotation/ui.js — «Плоскостное ментальное вращение · создание стимулов»
   ============================================================ */

import { $, esc, tick } from '../../../shared/js/common/ui.js';
import { toastError, toastSuccess } from '../../../shared/js/core/toast.js';
import { fld, fontField, bindFont, readFont, readInt, readNum, readStr, readCheck, readChecks, parseIntList, onAnyChange } from '../kit/fields.js';
import { panelHead, stepTitle, card, grid, sep, sub, generateBar, alertBox } from '../kit/panel.js';
import { instructionEditorHtml, mountInstructionEditor, drawInstructionText } from '../kit/instr.js';
import { mountResults, metricTable } from '../kit/results.js';
import { evaluateSalience, relativeAoiSalience, salienceBalance, METHOD_LABELS, SAL_KEYS } from '../kit/salience.js';
import { ensureFont } from '../kit/text.js';
import { meanLuminance } from '../kit/luminance.js';
import { TRANSFORMS, TRANSFORM_KEYS, COLOR_MODES, COLOR_KEYS, OP_RU, generateRotation } from './generator.js';
import { DEFAULT_STYLE, autoCell, checkLayout, drawRotationStimulus, drawFixation } from './render.js';

const INSTRUCTION_TEXT = (action) => [
  `Какая из четырех предложенных ниже фигур получится, если ${action}?`,
  '',
  'Введите номер ответа при помощи клавиатуры.',
  'Если правильного ответа нет - нажмите ноль.',
  'Если Вы не можете решить задание - нажмите Enter.',
  '',
  'Затем перейдите к следующему заданию, нажав пробел.',
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
  const pieces = parseIntList(readStr('rot-pieces'), 1, 9);
  return {
    transforms: TRANSFORM_KEYS.filter((k) => readChecks('rot-transforms').includes(k)),
    colors: COLOR_KEYS.filter((k) => readChecks('rot-colors').includes(k)),
    perCombo: readInt('rot-per', 1, 1, 50),
    n: readInt('rot-n', 10, 5, 20),
    pieces: pieces.length ? pieces : [3, 2, 2, 1, 1, 1],
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
  $('#rot-feas').innerHTML = (total === 0 ? alertBox('warn', 'Отметьте хотя бы одно задание и один вариант цветности.') : '') +
    (issues.length ? alertBox('warn', `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`) : '');
  $('#rot-generate').disabled = total === 0;
}

function instructionItems(keys = TRANSFORM_KEYS) {
  return keys.map((k) => ({ key: k, label: TRANSFORMS[k].ru, text: INSTRUCTION_TEXT(TRANSFORMS[k].action) }));
}

export function initRotation() {
  $('#mode-rot').innerHTML = `
    ${panelHead('01', 'Плоскостное ментальное вращение · создание стимулов', `
      На экране — фигура-задание (поле 10×10 с шестью «фигурками» из закрашенных клеток) и четыре варианта ответа с номерами 1–4.
      Нужно выбрать, какая из фигур получится, если фигуру-задание повернуть на 90° по часовой стрелке, на 90° против часовой стрелки,
      на 180° или отразить зеркально. Ответ — цифра на клавиатуре.`)}

    ${stepTitle(1, 'Что создаём')}
    ${card(grid(`
      ${fld.checks('rot-transforms', 'Задания (как повернуть или отразить фигуру-задание)',
        TRANSFORM_KEYS.map((k) => [k, TRANSFORMS[k].ru, true]), { wide: true,
          hint: 'По умолчанию — все четыре задания, как в исходной методике. Для каждого задания в архив попадёт своя инструкция.' })}
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
        ${fld.num('rot-n', 'Размер поля, клеток (поле квадратное)', 10, { min: 5, max: 20, hint: 'В исходной методике — 10 × 10.' })}
        ${fld.num('rot-cell', 'Размер клетки, пикс.', '', { min: 4, placeholder: 'авто', hint: 'Оставьте пустым — размер подберётся по ширине стимула, как в исходной раскладке (поля сверху и ряд вариантов ниже).' })}
        ${fld.text('rot-pieces', 'Состав фигурок: длины линий через запятую', '3, 2, 2, 1, 1, 1', { hint: 'По умолчанию — одна линия из 3 клеток, две из 2 и три одиночные клетки (всего 10 закрашенных). Линии идут по горизонтали или вертикали и нигде не касаются друг друга, даже углами.' })}
        ${fld.check('rot-border', 'Разрешить фигуркам занимать крайние ряды и столбцы поля', false, { hint: 'В исходной методике крайний ряд поля всегда пустой — выключено.' })}
        ${fontField('rot-font', 'Шрифт номеров вариантов', 'Montserrat, Arial, sans-serif')}
        ${fld.colors('rot-bg', 'rot-fill', 'Цвет фона / цвет закрашенных клеток и номеров', '#ffffff', '#666666')}
        ${fld.color('rot-grid', 'Цвет линий сетки', '#b7b7b7')}
        ${fld.check('rot-fix', 'Добавить в архив экран с фиксационным крестом (fixation.png)', true, { hint: 'В исходной презентации перед каждым заданием показывается крест «+» в левом верхнем углу.' })}
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
    updatePlan(); editor.preview(); invalidate();
  });
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
  const keyRows = stimuli.map((st) => ({
    stimulus: st.name, file: `stimuli/${st.name}.png`, task: st.transform, color_mode: st.color,
    response_type: 'key', correct_response: st.correctPos,
    correct_operation: st.options[st.correctPos - 1].op,
    accepted_responses: '1 2 3 4 0 Enter', meaning: 'верный ответ — номер варианта 1–4; клавиши 0 и Enter означают «верного нет» и «не могу решить» (ошибка/пропуск)',
    option_1: st.options[0].op, option_2: st.options[1].op, option_3: st.options[2].op, option_4: st.options[3].op,
  }));
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
  if (readCheck('rot-fix')) pngs.push({ path: 'fixation.png', draw: (c, s = 1) => drawFixation(c, style, s) });

  mountResults($('#rot-results'), {
    prefix: 'rot', step: 3, width: W, height: H, stimuli,
    filters: opts.transforms.map((k) => [k, TRANSFORMS[k].short]),
    requested: res.requested, built: stimuli.length,
    summaryHtml: summary, pngs,
    answerKey: keyRows,
    manifests: [{ file: 'stimuli.csv', rows }, { file: 'stimuli_aoi.csv', rows: aoiRows }],
    archiveName: 'mental_rotation_stimuli',
    settings: { experiment: 'planar-mental-rotation', options: opts, style, saliency: salOn ? method : null, instructions: editor.enabled() ? items : null },
  });
  $('#rot-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
