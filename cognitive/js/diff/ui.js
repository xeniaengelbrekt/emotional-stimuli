/* ============================================================
   diff/ui.js — «Определение различий · создание стимулов»
   ============================================================ */

import { $, esc, tick } from '../../../js/common/ui.js';
import { toastError, toastSuccess } from '../../../js/core/toast.js';
import { fld, fontField, bindFont, readFont, readInt, readStr, readChecks, parseIntList, onAnyChange } from '../kit/fields.js';
import { panelHead, stepTitle, card, grid, sep, sub, generateBar, alertBox } from '../kit/panel.js';
import { instructionEditorHtml, mountInstructionEditor, drawInstructionText } from '../kit/instr.js';
import { mountResults } from '../kit/results.js';
import { ensureFont } from '../kit/text.js';
import { meanLuminance } from '../kit/luminance.js';
import { OBJECT_TYPES, ARRANGEMENTS, ALPHABETS, generateDiff } from './generator.js';
import { DEFAULT_STYLE, drawDiffFrame } from './render.js';

let editor = null;

const INSTR = {
  letters: [
    'Сейчас на экране появятся **буквы**. Запомните их.',
    '',
    'На каждом следующем экране **одна из букв изменится**. Найдите её и щёлкните по ней левой кнопкой мыши.',
    'Затем появится следующий экран, на котором снова изменится одна буква.',
    '',
    'Старайтесь не ошибаться.',
    '',
    'Чтобы начать, нажмите ПРОБЕЛ.',
  ].join('\n'),
  numbers: [
    'Сейчас на экране появятся **числа**. Запомните их.',
    '',
    'На каждом следующем экране **одно из чисел изменится**. Найдите его и щёлкните по нему левой кнопкой мыши.',
    'Затем появится следующий экран, на котором снова изменится одно число.',
    '',
    'Старайтесь не ошибаться.',
    '',
    'Чтобы начать, нажмите ПРОБЕЛ.',
  ].join('\n'),
};
const items = () => Object.keys(OBJECT_TYPES).map((k) => ({ key: k, label: OBJECT_TYPES[k].ru, text: INSTR[k] }));

function readStyle() {
  return {
    width: readInt('df-w', 1920, 640), height: readInt('df-h', 1080, 360),
    background: readStr('df-bg'), color: readStr('df-fg'),
    fontFamily: readFont('df-font'), fontSize: readInt('df-size', 90, 10),
  };
}

function readOptions() {
  const counts = [...new Set(parseIntList(readStr('df-counts'), 2, 60))];
  const s = readStyle();
  return {
    objectTypes: Object.keys(OBJECT_TYPES).filter((k) => readChecks('df-types').includes(k)),
    arrangements: Object.keys(ARRANGEMENTS).filter((k) => readChecks('df-arr').includes(k)),
    counts: counts.length ? counts : [4, 6, 8, 10],
    frames: readInt('df-frames', 6, 2, 30),
    alphabet: readStr('df-alpha'),
    numMin: readInt('df-nmin', 1), numMax: readInt('df-nmax', 99),
    width: s.width, height: s.height, fontSize: s.fontSize,
    step: readInt('df-step', 0, 0),
    seed: readInt('df-seed', 1),
  };
}

function update() {
  const o = readOptions();
  const nSeries = o.objectTypes.length * o.arrangements.length * o.counts.length;
  $('#df-plan').innerHTML = `План: <strong class="hl">${nSeries}</strong> серий × <strong class="hl">${o.frames}</strong> экранов = <strong class="hl">${nSeries * o.frames}</strong> PNG; различий в серии: <strong class="hl">${o.frames - 1}</strong>`;
  const issues = [];
  if (!o.objectTypes.length) issues.push('Отметьте, из чего состоят объекты: буквы и/или числа.');
  if (!o.arrangements.length) issues.push('Отметьте хотя бы один способ расположения.');
  const maxN = Math.max(...o.counts);
  if (o.objectTypes.includes('numbers') && o.numMax - o.numMin + 1 < maxN + 1) issues.push(`Диапазон чисел ${o.numMin}–${o.numMax} слишком узок: для ${maxN} объектов нужно не меньше ${maxN + 1} разных чисел.`);
  if (o.objectTypes.includes('letters') && ALPHABETS[o.alphabet].letters.length < maxN + 1) issues.push(`В алфавите всего ${ALPHABETS[o.alphabet].letters.length} букв — для ${maxN} объектов мало.`);
  $('#df-feas').innerHTML = issues.length ? alertBox('warn', `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`) : '';
  $('#df-generate').disabled = issues.length > 0;
  $('#df-step').placeholder = 'авто';
  editor?.preview();
}

function invalidate() {
  const box = $('#df-results');
  if (!box.hidden) { box.hidden = true; box.innerHTML = ''; }
}

const busy = (on, text) => { $('#df-busy').hidden = !on; if (text) $('#df-busy-text').textContent = text; };

async function generate() {
  const opts = readOptions();
  const style = { ...DEFAULT_STYLE, ...readStyle() };
  const btn = $('#df-generate');
  btn.disabled = true;
  busy(true, 'Построение серий…');
  try {
    await ensureFont(style.fontFamily);
    await tick();
    const res = generateDiff(opts);
    const stimuli = [];
    const rows = []; const aoi = []; const keyRows = [];
    for (const se of res.series) {
      se.frames.forEach((fr, i) => {
        const st = se.stimuli[i];
        st.draw = (canvas, scale) => drawDiffFrame(canvas, se, i, style, scale);
        st.filter = se.id;
        st.tag = i === 0 ? 'запомнить' : `различие ${i}`;
        st.boxes = drawDiffFrame(document.createElement('canvas'), se, i, style, 0.05);
        const ch = se.changes[i - 1];
        const changedBox = ch ? st.boxes[ch.index] : null;
        st.badges = `<span>серия ${se.number}</span><span>кадр ${i + 1} из ${se.frames.length}</span>`;
        st.infoHtml = ch
          ? `<p class="muted-p">Изменилось: <strong class="hl">${esc(ch.from)} → ${esc(ch.to)}</strong> (объект ${ch.index + 1}${changedBox.row ? `, строка ${changedBox.row}, столбец ${changedBox.col}` : ''}). Нужно нажать на него.</p>`
          : '<p class="muted-p">Первый экран серии: объекты нужно запомнить.</p>';
        stimuli.push(st);
        rows.push({
          stimulus: st.name, series: se.number, frame: i, role: i === 0 ? 'memorize' : 'change',
          object_type: se.type, arrangement: se.arrangement, n_objects: se.N, series_length: se.frames.length,
          changed_object: ch ? ch.index + 1 : '', changed_from: ch ? ch.from : '', changed_to: ch ? ch.to : '',
          aoi_x: changedBox ? changedBox.x : '', aoi_y: changedBox ? changedBox.y : '', aoi_w: changedBox ? changedBox.w : '', aoi_h: changedBox ? changedBox.h : '',
          width: style.width, height: style.height, font_px: style.fontSize, mean_luminance: meanLuminance(st, style.width),
        });
        keyRows.push({
          stimulus: st.name, file: `stimuli/${st.name}.png`, series: se.number, frame: i, response_type: i === 0 ? 'none' : 'click',
          correct_response: ch ? `object ${ch.index + 1}: ${ch.from} → ${ch.to}` : '',
          aoi_x: changedBox ? changedBox.x : '', aoi_y: changedBox ? changedBox.y : '', aoi_w: changedBox ? changedBox.w : '', aoi_h: changedBox ? changedBox.h : '',
          meaning: i === 0 ? 'экран для запоминания: ответа нет' : 'щелчок внутри рамки изменившегося объекта — верный ответ',
        });
        st.boxes.forEach((b) => aoi.push({
          stimulus: st.name, series: se.number, frame: i, object: b.index + 1, value: b.text, row: b.row ?? '', col: b.col ?? '',
          x: b.x, y: b.y, w: b.w, h: b.h, is_changed: ch && ch.index === b.index ? 1 : 0,
        }));
      });
    }
    const texts = editor.texts();
    const pngs = editor.enabled() ? opts.objectTypes.map((t) => ({
      path: `instruction_${OBJECT_TYPES[t].short}.png`,
      draw: (c, s = 1) => drawInstructionText(c, { width: style.width, height: style.height, background: style.background, color: style.color, fontFamily: style.fontFamily, text: texts[t], scale: s }),
    })) : [];
    mountResults($('#df-results'), {
      prefix: 'df', step: 3, width: style.width, height: style.height, stimuli,
      filters: res.series.map((s) => [s.id, `серия ${s.number}: ${s.id}`]),
      requested: res.series.length * opts.frames, built: stimuli.length,
      pngs, answerKey: keyRows, manifests: [{ file: 'stimuli.csv', rows }, { file: 'stimuli_aoi.csv', rows: aoi }],
      archiveName: 'change_detection_stimuli',
      settings: { experiment: 'change-detection', options: opts, style, instructions: editor.enabled() ? texts : null },
      resultNote: `Серий: ${res.series.length}.`,
    });
    $('#df-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toastSuccess(`Собрано экранов: ${stimuli.length}`);
  } catch (e) {
    console.error(e);
    toastError(`Не удалось сформировать стимулы: ${e.message}`, 7000);
  } finally {
    busy(false);
    btn.disabled = false;
    update();
  }
}

export function initDiff() {
  $('#mode-diff').innerHTML = `
    ${panelHead('03', 'Определение различий · создание стимулов', `
      Серия экранов. На первом экране показано N объектов — их нужно запомнить. На следующем экране один объект меняется —
      на него нужно нажать. Дальше снова меняется один объект, и так до конца серии. По умолчанию в серии 6 экранов
      (5 раз нужно найти различие), серии — на 4, 6, 8 и 10 объектов, объекты — буквы, расположенные по сетке.`)}

    ${stepTitle(1, 'Что создаём')}
    ${card(grid(`
      ${fld.checks('df-types', 'Из чего состоят объекты (для каждого отмеченного создаются свои серии)', [['letters', 'Буквы', true], ['numbers', 'Числа', false]], { wide: true })}
      ${fld.checks('df-arr', 'Как расположены объекты (для каждого отмеченного создаются свои серии)', Object.entries(ARRANGEMENTS).map(([k, v]) => [k, v.ru, k === 'grid']), { wide: true,
        hint: 'По сетке — объекты ровными рядами по центру экрана. Хаотично — в случайных местах экрана, не слишком близко друг к другу; места не меняются в пределах серии.' })}
      ${fld.text('df-counts', 'Сколько всего объектов на экране: по серии на каждое число (через запятую)', '4, 6, 8, 10')}
      ${fld.num('df-frames', 'Экранов в серии (первый — запомнить; различий искать на один меньше)', 6, { min: 2, max: 30, hint: 'По умолчанию 6: один экран для запоминания и 5 экранов, на каждом из которых нужно найти изменившийся объект.' })}
      ${fld.select('df-alpha', 'Алфавит для букв', Object.entries(ALPHABETS).map(([k, v]) => [k, v.ru]), 'ru', { hint: 'Из алфавита исключены буквы, которые легко спутать: для русского — Ё, Й, Щ, Ъ, Ы, Ь; для латинского — I, O, Q.' })}
      ${fld.pair('df-nmin', 'df-nmax', 'Диапазон чисел: от и до', 1, 99, { sep: '—', min: -999 })}
      ${fld.num('df-seed', 'Номер случайного набора', 1, { hint: 'При том же номере и тех же настройках получится тот же набор. Поменяйте номер, чтобы получить другой.' })}
    `))}

    ${stepTitle(2, 'Параметры')}
    ${card(`
      ${grid(`
        ${fld.pair('df-w', 'df-h', 'Размер стимула: ширина × высота, пикс.', 1920, 1080, { min: 320 })}
        ${fontField('df-font', 'Шрифт объектов', 'Arial, Helvetica, sans-serif')}
        ${fld.num('df-size', 'Размер шрифта объектов, пикс.', 90, { min: 10, hint: 'Рекомендуется 80–110 пикс. для экрана 1920×1080: объекты хорошо различимы и не сливаются.' })}
        ${fld.num('df-step', 'Шаг сетки, пикс.', '', { min: 0, placeholder: 'авто', hint: 'Расстояние между центрами соседних объектов при расположении по сетке. Пусто — подберётся по размеру шрифта и экрану.' })}
        ${fld.colors('df-bg', 'df-fg', 'Цвет фона / цвет объектов', '#d9d9d9', '#111111')}
      `)}
      ${instructionEditorHtml('df', { items: items() })}
    `)}
    ${generateBar('df')}`;

  bindFont('df-font', () => editor.preview());
  editor = mountInstructionEditor('df', items(), () => {
    const s = readStyle();
    return { width: s.width, height: s.height, background: s.background, color: s.color, fontFamily: s.fontFamily };
  });
  onAnyChange($('#mode-diff'), (el) => { if (el.id.startsWith('df-ins')) return; invalidate(); update(); });
  $('#df-generate').addEventListener('click', generate);
  update();
}
