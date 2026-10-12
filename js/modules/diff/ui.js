/* ============================================================
   diff/ui.js — «Определение различий · создание стимулов»
   ============================================================ */

import { $, esc, tick } from '../../common/ui.js';
import { toastError, toastSuccess } from '../../core/toast.js';
import { fld, fontField, bindFont, readFont, readInt, readStr, readChecks, readCheck, parseIntList, onAnyChange } from '../../kit/fields.js';
import { panelHead, stepTitle, card, grid, sep, sub, generateBar, alertBox } from '../../kit/panel.js';
import { instructionEditorHtml, mountInstructionEditor, drawInstructionText } from '../../kit/instr.js';
import { mountResults } from '../../kit/results.js';
import { ensureFont } from '../../kit/text.js';
import { meanLuminance } from '../../kit/luminance.js';
import { OBJECT_TYPES, ARRANGEMENTS, ALPHABETS, generateDiff, gridShape, autoStep } from './generator.js';
import { DEFAULT_STYLE, drawDiffFrame } from './render.js';
import { BG, FG, NEXT_LINE, START_LINE } from '../../kit/defaults.js';
import * as M from '../../kit/methods.js';

let editor = null;

const instr = (what, one, shuffle) => [
  `Сейчас на экране появятся **${what.many}**. Запомните их.`,
  '',
  `На каждом следующем экране **${one.change}**. Найдите ${one.it} и щёлкните по ${one.itDat} левой кнопкой мыши.`,
  ...(shuffle ? [`Объекты на экране могут меняться местами, поэтому ищите не то, что стоит на другом месте, а то, что **появилось новое**.`] : []),
  '',
  'После ответа нажмите **ПРОБЕЛ** — появится следующий экран, на котором снова изменится ' + one.one + '.',
  START_LINE,
].join('\n');

const WORDS = {
  letters: { what: { many: 'буквы' }, one: { change: 'одна из букв изменится', it: 'её', itDat: 'ней', one: 'одна буква' } },
  numbers: { what: { many: 'числа' }, one: { change: 'одно из чисел изменится', it: 'его', itDat: 'нему', one: 'одно число' } },
};
const instrText = (t, shuffle) => instr(WORDS[t].what, WORDS[t].one, shuffle);
const items = (shuffle = false) => Object.keys(OBJECT_TYPES).map((k) => ({ key: k, label: OBJECT_TYPES[k].ru, text: instrText(k, shuffle) }));
let lastShuffle = false;

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
    objectTypes: [readStr('df-types') || 'letters'],
    arrangements: [readStr('df-arr') || 'grid'],
    shuffle: readCheck('df-shuffle'),
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
  const nSeries = o.counts.length;
  $('#df-plan').innerHTML = `План: <strong class="hl">${nSeries}</strong> серий (по числу объектов) × <strong class="hl">${o.frames}</strong> экранов = <strong class="hl">${nSeries * o.frames}</strong> PNG; различий в серии: <strong class="hl">${o.frames - 1}</strong>`;
  const issues = [];
  const maxN = Math.max(...o.counts);
  if (o.objectTypes.includes('numbers') && o.numMax - o.numMin + 1 < maxN + 1) issues.push(`Диапазон чисел ${o.numMin}–${o.numMax} слишком узок: для ${maxN} объектов нужно не меньше ${maxN + 1} разных чисел.`);
  if (o.objectTypes.includes('letters') && ALPHABETS[o.alphabet].letters.length < maxN + 1) issues.push(`В алфавите всего ${ALPHABETS[o.alphabet].letters.length} букв — для ${maxN} объектов мало.`);
  $('#df-feas').innerHTML = issues.length ? alertBox('warn', `<ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`) : '';
  $('#df-generate').disabled = issues.length > 0;
  $('#df-step').placeholder = 'авто';
  if (editor) {
    // слова про перемешивание подставляются в инструкцию, пока её не правили вручную
    if (lastShuffle !== o.shuffle) {
      const cur = editor.texts();
      for (const k of Object.keys(OBJECT_TYPES)) if (cur[k] === instrText(k, lastShuffle)) editor.setText(k, instrText(k, o.shuffle));
      lastShuffle = o.shuffle;
    }
    editor.preview();
  }
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
        st.seriesNo = se.number;
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
          stimulus: st.name, file: `stimuli/${st.name}.png`, series: se.number, frame: i, response_type: i === 0 ? 'none' : 'mouse_click',
          correct_response: ch ? `object ${ch.index + 1}: ${ch.from} → ${ch.to}` : '',
          aoi_x: changedBox ? changedBox.x : '', aoi_y: changedBox ? changedBox.y : '', aoi_w: changedBox ? changedBox.w : '', aoi_h: changedBox ? changedBox.h : '',
          meaning: i === 0 ? 'экран для запоминания: ответа нет (только ПРОБЕЛ для перехода)' : 'верный ответ — щелчок мыши внутри рамки изменившегося объекта (координаты в пикселях стимула), затем ПРОБЕЛ',
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
      prefix: 'df', step: 3, width: style.width, height: style.height, stimuli, title: 'Определение различий',
      filters: res.series.map((s) => [s.id, `серия ${s.number}: ${s.id}`]),
      requested: res.series.length * opts.frames, built: stimuli.length,
      pngs, answerKey: keyRows,
      manifests: [
        { file: 'stimuli.csv', rows, desc: 'По строке на экран: серия, номер кадра, роль (запомнить / найти различие), тип и расположение объектов, что изменилось, область изменившегося объекта, средняя яркость' },
        { file: 'stimuli_aoi.csv', rows: aoi, desc: 'Области интереса всех объектов на каждом экране (в пикселях стимула) с признаком изменившегося объекта' },
      ],
      methods: () => methodsDoc({ res, stimuli, opts, style, texts, instructionOn: editor.enabled() }),
      readmeIntro: 'Серии экранов «определение различий»: первый экран — запомнить объекты, на каждом следующем один объект меняется. Ответ — щелчок мыши по изменившемуся объекту, затем ПРОБЕЛ.',
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
      на него нужно щёлкнуть мышью и нажать ПРОБЕЛ. Дальше снова меняется один объект, и так до конца серии. По умолчанию в серии 6 экранов
      (5 раз нужно найти различие), серии — на 4, 6, 8 и 10 объектов, объекты — буквы, расположенные по сетке.`)}

    ${stepTitle(1, 'Что создаём')}
    ${card(grid(`
      ${fld.select('df-types', 'Из чего состоят объекты', Object.entries(OBJECT_TYPES).map(([k, v]) => [k, v.ru]), 'letters', { hint: 'Выбирается один вариант.' })}
      ${fld.select('df-arr', 'Как расположены объекты', Object.entries(ARRANGEMENTS).map(([k, v]) => [k, v.ru]), 'grid', {
        hint: 'Выбирается один вариант. По сетке — объекты ровными рядами по центру экрана. Хаотично — в случайных местах экрана, не слишком близко друг к другу; места не меняются в пределах серии (если не включено перемешивание).' })}
      ${fld.check('df-shuffle', 'Перемешивать объекты на каждом экране серии', false, { hint: 'Выключено (по умолчанию): объекты стоят на одних и тех же местах, меняется только один из них. Включено: на каждом новом экране объекты меняются местами — изменившийся объект нужно искать не по месту, а по тому, что он новый.' })}
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
        ${fld.colors('df-bg', 'df-fg', 'Цвет фона / цвет объектов', BG, FG)}
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

/* ---------------- описание для раздела «Методы» ---------------- */

function methodsDoc({ res, stimuli, opts, style, texts, instructionOn }) {
  const { H1, H2, P, TABLE, paramTable } = M;
  const type = opts.objectTypes[0]; const arr = opts.arrangements[0];
  const step = opts.step > 0 ? opts.step : autoStep({ ...opts, width: style.width, height: style.height, fontSize: style.fontSize });
  const blocks = [
    H1('Определение различий: описание стимулов'),
    P(`Набор содержит ${res.series.length} ${M.plural(res.series.length, 'серию', 'серии', 'серий')} по ${opts.frames} ${M.plural(opts.frames, 'экрану', 'экрана', 'экранов')} (${stimuli.length} PNG). На первом экране серии показаны ${type === 'letters' ? 'буквы' : 'числа'} (число объектов — ${opts.counts.join(', ')} в разных сериях), которые участник должен запомнить. ` +
      `На каждом из следующих ${opts.frames - 1} экранов один объект заменяется другим${opts.shuffle ? ', при этом все объекты на каждом экране меняются местами' : ', остальные объекты остаются на своих местах'}. ` +
      'Участник должен найти изменившийся объект и щёлкнуть по нему левой кнопкой мыши, после чего нажимает клавишу ПРОБЕЛ для перехода к следующему экрану.'),
    H2('1. Параметры стимулов'),
    paramTable([
      ['Размер стимула', `${style.width} × ${style.height} пикс.`],
      ['Цвет фона', M.colorText(style.background)],
      ['Цвет объектов', M.colorText(style.color)],
      ['Шрифт (жирное начертание)', style.fontFamily.split(',')[0].replace(/'/g, '')],
      ['Размер шрифта объектов', `${style.fontSize} пикс.`],
      ['Тип объектов', OBJECT_TYPES[type].ru, type === 'letters' ? `алфавит: ${ALPHABETS[opts.alphabet].ru} (${ALPHABETS[opts.alphabet].letters.length} букв, без легко спутываемых)` : `диапазон чисел: от ${opts.numMin} до ${opts.numMax}`],
      ['Расположение объектов', ARRANGEMENTS[arr].ru, arr === 'grid' ? `шаг сетки ${step} пикс.${opts.step > 0 ? '' : ' (подобран автоматически)'}` : 'случайные места, не слишком близко друг к другу и к краям экрана'],
      ['Число объектов в сериях', opts.counts.join(', ')],
      ['Экранов в серии', `${opts.frames} (1 для запоминания + ${opts.frames - 1} с изменением)`],
      ['Перемешивание объектов на каждом экране', M.yesNo(opts.shuffle)],
      ['Номер случайного набора', opts.seed],
    ]),
    H2('2. Построение серий'),
    P('Объекты в серии всегда различны (повторов нет). Места объектов задаются один раз и в пределах серии не меняются' + (opts.shuffle ? ', но на каждом экране объекты случайно переставляются между местами' : '') + '. ' +
      'Изменяемый объект выбирается так, чтобы один и тот же объект не менялся два раза подряд, а все объекты менялись по кругу, пока не будут использованы все. ' +
      'Новое значение выбирается из значений, которых на экране ещё нет.'),
    ...(arr === 'grid' ? [P('Расположение по сетке: число столбцов и строк подбирается как можно ближе к пропорциям экрана (отношение 1,5), последняя неполная строка центрируется.')] : []),
    H2('3. Состав набора'),
    TABLE(['Серия', 'Объектов', 'Экранов', 'Изменённые объекты (номер на экране)'], res.series.map((s) => [String(s.number), String(s.N), String(s.frames.length), s.changes.map((c) => c.index + 1).join(', ')]), [1, 1, 1, 5]),
    P('Перечень экранов (имя файла, серия, роль):'),
    TABLE(['Имя файла', 'Серия', 'Кадр', 'Роль'], stimuli.map((st) => [`${st.name}.png`, String(st.seriesNo), st.name.match(/_f(\d+)-/)[1], st.name.endsWith('memorize') ? 'запомнить' : 'найти различие']), [6, 1.5, 1.5, 3]),
    H2('4. Яркость'), M.luminanceParagraph(),
    H2('5. Инструкция для участника'),
  ];
  if (instructionOn) {
    blocks.push(P('Инструкция предъявляется отдельным экраном (PNG того же размера и цвета, что стимулы):'));
    blocks.push(P(String(texts[type]).replace(/\*\*/g, '').replace(/\n+/g, ' ')));
  } else blocks.push(P('Инструкция в архив не включена.'));
  blocks.push(H2('6. Ответы и области интереса'),
    P('Правильные ответы приведены в файле answer_key.csv: для каждого экрана (кроме первого) указан изменившийся объект и его область в пикселях стимула; ответом считается щелчок мыши внутри этой области. Файл stimuli_aoi.csv содержит области всех объектов на каждом экране.'),
    M.reproducibilityParagraph(opts.seed));
  return blocks;
}
