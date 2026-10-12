/* ============================================================
   trails/ui.js — «Траектории · создание стимулов».
   Общие настройки → таблица стимулов → у каждой строки свои
   параметры, а любой столбец можно применить ко всем сразу.
   ============================================================ */

import { $, $$, esc, tick } from '../../../js/common/ui.js';
import { toastError, toastSuccess, toastInfo } from '../../../js/core/toast.js';
import { fld, fontField, bindFont, readFont, readInt, readNum, readStr, readChecks, parseIntList, onAnyChange } from '../kit/fields.js';
import { panelHead, stepTitle, card, grid, sep, sub, generateBar, alertBox } from '../kit/panel.js';
import { instructionEditorHtml, mountInstructionEditor, drawInstructionText } from '../kit/instr.js';
import { mountResults } from '../kit/results.js';
import { ensureFont } from '../kit/text.js';
import { DIRECTIONS, ARRANGEMENTS, SPACINGS, DISTRACTOR_KINDS, DEFAULTS, blankRow, buildRows, generateTrails, recommendedFont, distractorLabel } from './generator.js';
import { DEFAULT_STYLE, drawTrailStimulus, fontSizeOf } from './render.js';

const state = { rows: [] };
let editor = null;

const SENTENCE = {
  none: '',
  recolor: 'Числа другого цвета пропускайте: на них смотреть не нужно.',
  letter: 'Если вместо числа встретится буква — не смотрите на неё и переходите к следующему числу.',
  square: 'Если вместо числа встретится квадрат — не смотрите на него и переходите к следующему числу.',
  triangle: 'Если вместо числа встретится треугольник — не смотрите на него и переходите к следующему числу.',
};
const DIR_LINE = {
  ascending: 'Проследите взглядом числа **по возрастанию**: от 1 до {n}.',
  descending: 'Проследите взглядом числа **по убыванию**: от {n} до 1.',
};
const instrText = (dir, kind) => [
  DIR_LINE[dir],
  'Не называйте числа вслух и ничего не нажимайте — только смотрите.',
  ...(SENTENCE[kind] ? [SENTENCE[kind]] : []),
  '',
  'Когда закончите, нажмите ПРОБЕЛ.',
  '',
  'Чтобы начать, нажмите ПРОБЕЛ.',
].join('\n');
const RATING_TEXT = [
  'Оцените, насколько хорошо вам удалось проследить числа.',
  '',
  'Нажмите на клавиатуре цифру от **1** до **5**:',
  '**1** — совсем не удалось      **5** — удалось полностью',
].join('\n');

const keyOf = (dir, kind) => `${dir}__${kind}`;
function allItems() {
  const items = [];
  for (const d of Object.keys(DIRECTIONS)) for (const k of Object.keys(DISTRACTOR_KINDS)) {
    items.push({ key: keyOf(d, k), label: `${DIRECTIONS[d].ru} · ${DISTRACTOR_KINDS[k].ru}`, text: instrText(d, k) });
  }
  items.push({ key: 'rating', label: 'Экран оценки (шкала 1–5)', text: RATING_TEXT });
  return items;
}

function readStyle() {
  return {
    width: readInt('tr-w', 1920, 640), height: readInt('tr-h', 1080, 360),
    background: readStr('tr-bg'), color: readStr('tr-fg'), distractorColor: readStr('tr-dcol'),
    fontFamily: readFont('tr-font'),
    zigzag: readInt('tr-zz', 22, 0, 45) / 100,
    spread: readInt('tr-spread', 40, 0, 80) / 100,
  };
}

function readGlobal() {
  return {
    n: readInt('tr-n', 15, 3, 120), rows: readInt('tr-rows', 3, 1, 12),
    directions: Object.keys(DIRECTIONS).filter((k) => readChecks('tr-dirs').includes(k)),
    arrangements: Object.keys(ARRANGEMENTS).filter((k) => readChecks('tr-arr').includes(k)),
    distractors: Object.keys(DISTRACTOR_KINDS).filter((k) => readChecks('tr-dist').includes(k)),
    letters: [...new Set(readStr('tr-letters').split(/[\s,;]+/).map((x) => x.trim().slice(0, 1).toLocaleUpperCase('ru')).filter(Boolean))],
    dCount: readInt('tr-dcount', 1, 1, 10),
    spacings: Object.keys(SPACINGS).filter((k) => readChecks('tr-spacing').includes(k)),
    perVariant: readInt('tr-per', 1, 1, 20),
    seed: readInt('tr-seed', 1),
  };
}

/* ---------------- таблица стимулов ---------------- */

const COLS = [
  { key: 'n', label: 'Чисел', type: 'num', min: 3, max: 120 },
  { key: 'rows', label: 'Строк', type: 'num', min: 1, max: 12 },
  { key: 'arrangement', label: 'Расположение', type: 'sel', opts: ARRANGEMENTS },
  { key: 'direction', label: 'Направление', type: 'sel', opts: DIRECTIONS },
  { key: 'distractor', label: 'Дистрактор', type: 'sel', opts: DISTRACTOR_KINDS },
  { key: 'letter', label: 'Буква', type: 'txt' },
  { key: 'dCount', label: 'Сколько', type: 'num', min: 0, max: 10 },
  { key: 'spacing', label: 'Расстояние', type: 'sel', opts: SPACINGS },
  { key: 'fontSize', label: 'Шрифт, пикс. (0 — авто)', type: 'num', min: 0, max: 400 },
];

const optionsHtml = (opts, v) => Object.entries(opts).map(([k, o]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(o.ru)}</option>`).join('');
const control = (c, v, attrs) => {
  if (c.type === 'sel') return `<div class="select-wrap"><select ${attrs}>${optionsHtml(c.opts, v)}</select></div>`;
  if (c.type === 'txt') return `<input type="text" class="t-letter" maxlength="1" value="${esc(v)}" ${attrs}>`;
  return `<input type="number" min="${c.min}" max="${c.max}" step="1" value="${v}" ${attrs}>`;
};
const parseVal = (c, raw) => (c.type === 'num' ? Math.min(c.max, Math.max(c.min, Math.round(Number(raw) || 0))) : c.type === 'txt' ? String(raw).slice(0, 1).toLocaleUpperCase('ru') : raw);

function renderTable() {
  const head = `<thead><tr><th>№</th>${COLS.map((c) => `<th>${c.label}</th>`).join('')}<th></th></tr>
    <tr class="apply-row"><td class="muted">всем</td>${COLS.map((c) => `<td>${control(c, blankRow()[c.key], `data-apply="${c.key}"`)}<br><button class="btn btn-ghost btn-small" type="button" data-apply-btn="${c.key}">⇊ применить</button></td>`).join('')}<td></td></tr></thead>`;
  const body = state.rows.map((r, i) => `<tr data-i="${i}"><td class="num">${i + 1}</td>${COLS.map((c) => `<td>${control(c, r[c.key], `data-k="${c.key}"`)}</td>`).join('')}
    <td><div class="row-actions"><button class="icon-btn" type="button" data-dup="${i}" title="Дублировать">⧉</button><button class="icon-btn danger" type="button" data-del="${i}" title="Удалить">×</button></div></td></tr>`).join('');
  $('#tr-table').innerHTML = head + `<tbody>${body}</tbody>`;
  updatePlan();
}

function bindTable() {
  const t = $('#tr-table');
  t.addEventListener('input', (e) => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    const i = Number(el.closest('tr').dataset.i);
    const c = COLS.find((x) => x.key === el.dataset.k);
    state.rows[i][c.key] = c.type === 'num' && el.value === '' ? state.rows[i][c.key] : parseVal(c, el.value);
    invalidate(); updatePlan();
  });
  t.addEventListener('change', (e) => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    const i = Number(el.closest('tr').dataset.i);
    const c = COLS.find((x) => x.key === el.dataset.k);
    state.rows[i][c.key] = parseVal(c, el.value);
    if (c.key === 'distractor' && state.rows[i].distractor !== 'none' && !state.rows[i].dCount) state.rows[i].dCount = 1;
    if (c.key === 'distractor' && state.rows[i].distractor === 'none') state.rows[i].dCount = 0;
    renderTable(); invalidate();
  });
  t.addEventListener('click', (e) => {
    const apply = e.target.closest('[data-apply-btn]');
    if (apply) {
      const c = COLS.find((x) => x.key === apply.dataset.applyBtn);
      const el = t.querySelector(`[data-apply="${c.key}"]`);
      const v = parseVal(c, el.value);
      state.rows.forEach((r) => { r[c.key] = v; if (c.key === 'distractor') r.dCount = v === 'none' ? 0 : Math.max(1, r.dCount); });
      renderTable(); invalidate();
      toastInfo(`«${c.label}» применено ко всем стимулам`);
      return;
    }
    const dup = e.target.closest('[data-dup]');
    if (dup) { const i = Number(dup.dataset.dup); state.rows.splice(i + 1, 0, { ...state.rows[i] }); renderTable(); invalidate(); return; }
    const del = e.target.closest('[data-del]');
    if (del) { state.rows.splice(Number(del.dataset.del), 1); renderTable(); invalidate(); }
  });
}

function rebuildRows(announce = false) {
  const g = readGlobal();
  state.rows = buildRows(g);
  renderTable(); invalidate();
  if (announce) toastSuccess(`Таблица создана: ${state.rows.length} стимулов`);
}

/* ---------------- проверки и план ---------------- */

function updatePlan() {
  const style = readStyle();
  $('#tr-plan').innerHTML = `Стимулов: <strong class="hl">${state.rows.length}</strong>`;
  const issues = [];
  if (!state.rows.length) issues.push('Таблица пуста: отметьте варианты в общих настройках и нажмите «Создать таблицу по общим настройкам» либо добавьте стимул вручную.');
  state.rows.forEach((r, i) => {
    const font = fontSizeOf(style, r);
    const cols = Math.ceil(r.n / r.rows);
    const slotW = (style.width * 0.84) / cols;
    const slotH = (style.height * 0.64) / r.rows;
    if (font * 1.25 > slotH * (r.arrangement === 'zigzag' ? 1 - 2 * style.zigzag * 0.6 : 1) + 1) issues.push(`Стимул ${i + 1}: шрифт ${font} пикс. слишком крупный для ${r.rows} строк${r.arrangement === 'zigzag' ? ' с зигзагом' : ''}.`);
    if (r.spacing === 'varied' && slotW * (1 - style.spread) < font * (String(r.n).length * 0.62 + 0.3)) issues.push(`Стимул ${i + 1}: при разных расстояниях числа могут сблизиться вплотную — уменьшите шрифт или разброс расстояний.`);
    if (r.rows > r.n) issues.push(`Стимул ${i + 1}: строк больше, чем чисел.`);
    if (r.distractor !== 'none' && r.dCount > r.n - 2) issues.push(`Стимул ${i + 1}: дистракторов слишком много (не должны заменять 1 и ${r.n}).`);
    if (r.distractor === 'letter' && !r.letter) issues.push(`Стимул ${i + 1}: не указана буква-дистрактор.`);
  });
  $('#tr-feas').innerHTML = issues.length ? alertBox('warn', `<ul>${issues.slice(0, 12).map((x) => `<li>${esc(x)}</li>`).join('')}${issues.length > 12 ? `<li>…и ещё ${issues.length - 12}</li>` : ''}</ul>`) : '';
  $('#tr-generate').disabled = !state.rows.length;
  const rec = recommendedFont(style.width, style.height, readInt('tr-n', 15, 3, 120), readInt('tr-rows', 3, 1, 12));
  $('#tr-font-hint').textContent = `Для ${readInt('tr-n', 15)} чисел в ${readInt('tr-rows', 3)} строки рекомендуется около ${rec} пикс.; в таблице у стимула размер можно задать отдельно (0 — подобрать автоматически).`;
  editor?.preview();
}

function invalidate() {
  const box = $('#tr-results');
  if (!box.hidden) { box.hidden = true; box.innerHTML = ''; }
}

const busy = (on, text) => { $('#tr-busy').hidden = !on; if (text) $('#tr-busy-text').textContent = text; };

/* ---------------- генерация ---------------- */

async function generate() {
  const style = { ...DEFAULT_STYLE, ...readStyle() };
  const seed = readInt('tr-seed', 1);
  const btn = $('#tr-generate');
  btn.disabled = true;
  busy(true, 'Построение стимулов…');
  try {
    await ensureFont(style.fontFamily);
    await tick();
    const stimuli = generateTrails(state.rows, { width: style.width, height: style.height, zigzag: style.zigzag, spread: style.spread, seed });
    const rows = []; const aoi = [];
    for (const st of stimuli) {
      const sp = st.spec;
      st.draw = (canvas, scale) => drawTrailStimulus(canvas, st, style, scale);
      const info = drawTrailStimulus(document.createElement('canvas'), st, style, 0.05);
      st.boxes = info.boxes; st.font = info.font;
      st.filter = sp.direction;
      st.tag = `${DIRECTIONS[sp.direction].short} · ${ARRANGEMENTS[sp.arrangement].short}`;
      st.badges = `<span>${sp.n} чисел, ${sp.rows} стр.</span><span>${esc(distractorLabel(sp))}</span>`;
      st.infoHtml = `<p class="muted-p">${esc(DIRECTIONS[sp.direction].ru)}; ${esc(ARRANGEMENTS[sp.arrangement].ru.toLowerCase())}; расстояния: ${esc(SPACINGS[sp.spacing].ru.toLowerCase())}; дистрактор: ${esc(DISTRACTOR_KINDS[sp.distractor].ru.toLowerCase())}${sp.distractor !== 'none' ? ` (${sp.dCount})` : ''}.
        ${st.layout.items.filter((i) => i.isDistractor).length ? `Дистрактор вместо числа: ${st.layout.items.filter((i) => i.isDistractor).map((i) => i.value).join(', ')}.` : ''}</p>`;
      rows.push({
        stimulus: st.name, arrangement: sp.arrangement, direction: sp.direction, spacing: sp.spacing,
        n_numbers: sp.n, n_rows: sp.rows, n_cols: st.layout.cols,
        distractor: sp.distractor, distractor_letter: sp.distractor === 'letter' ? sp.letter : '', n_distractors: st.layout.items.filter((i) => i.isDistractor).length,
        distractor_positions: st.layout.items.filter((i) => i.isDistractor).map((i) => i.value).join(' '),
        font_px: st.font, width: style.width, height: style.height,
      });
      for (const b of st.boxes) aoi.push({
        stimulus: st.name, order: b.order + 1, kind: b.kind, text: b.text, number: b.kind === 'number' || b.kind === 'recolored' ? b.value : '',
        is_distractor: b.isDistractor ? 1 : 0, row: b.row, col: b.col, x: b.x, y: b.y, w: b.w, h: b.h,
      });
    }
    const texts = editor.texts();
    const pngs = [];
    if (editor.enabled()) {
      const seen = new Set();
      for (const st of stimuli) {
        const sp = st.spec;
        const file = `instruction_${DIRECTIONS[sp.direction].short}_${sp.distractor}_n${sp.n}.png`;
        if (seen.has(file)) continue;
        seen.add(file);
        const text = (texts[keyOf(sp.direction, sp.distractor)] ?? '').replaceAll('{n}', sp.n);
        pngs.push({ path: file, draw: (c, s = 1) => drawInstructionText(c, { width: style.width, height: style.height, background: style.background, color: style.color, fontFamily: style.fontFamily, text, scale: s }) });
      }
      pngs.push({ path: 'rating_scale.png', draw: (c, s = 1) => drawInstructionText(c, { width: style.width, height: style.height, background: style.background, color: style.color, fontFamily: style.fontFamily, text: texts.rating, scale: s }) });
    }
    mountResults($('#tr-results'), {
      prefix: 'tr', step: 4, width: style.width, height: style.height, stimuli,
      filters: Object.keys(DIRECTIONS).filter((d) => stimuli.some((s) => s.spec.direction === d)).map((d) => [d, DIRECTIONS[d].short]),
      requested: state.rows.length, built: stimuli.length, pngs,
      manifests: [{ file: 'stimuli.csv', rows }, { file: 'stimuli_aoi.csv', rows: aoi }],
      archiveName: 'trails_stimuli',
      settings: { experiment: 'trails-king-devick', global: readGlobal(), rows: state.rows, style, instructions: editor.enabled() ? texts : null },
    });
    $('#tr-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toastSuccess(`Собрано стимулов: ${stimuli.length}`);
  } catch (e) {
    console.error(e);
    toastError(`Не удалось сформировать стимулы: ${e.message}`, 7000);
  } finally {
    busy(false);
    btn.disabled = false;
    updatePlan();
  }
}

/* ---------------- инициализация ---------------- */

export function initTrails() {
  $('#mode-trails').innerHTML = `
    ${panelHead('04', 'Траектории · создание стимулов', `
      Числа от 1 до N расставлены в несколько строк. Участник прослеживает их взглядом по возрастанию или по убыванию —
      не называя вслух и ничего не нажимая, — а затем оценивает по шкале от 1 до 5, насколько хорошо справился (цифра на клавиатуре).
      Основной показатель — движения глаз. По умолчанию: 15 чисел в 3 строки; меняются расположение (прямая / зигзаг),
      направление (возрастание / убывание), дистрактор (нет / буква «А» вместо одного из чисел) и расстояние между числами (фиксированное / разное) — 16 стимулов.`)}

    ${stepTitle(1, 'Общие настройки')}
    ${card(`
      ${grid(`
        ${fld.num('tr-n', 'Сколько всего чисел', 15, { min: 3, max: 120 })}
        ${fld.num('tr-rows', 'В скольких строках', 3, { min: 1, max: 12 })}
        ${fld.checks('tr-dirs', 'Что должен прослеживать участник (по инструкции)', Object.entries(DIRECTIONS).map(([k, v]) => [k, v.ru, true]), { wide: true,
          hint: 'Направление влияет только на инструкцию, расположение чисел на экране остаётся прежним. Для каждого отмеченного варианта создаются свои стимулы.' })}
        ${fld.checks('tr-arr', 'Расположение чисел', Object.entries(ARRANGEMENTS).map(([k, v]) => [k, v.ru, true]), { wide: true,
          hint: 'Числа всегда идут слева направо по строкам. По прямой — каждая строка ровная. По зигзагу — числа ряда чередуются выше и ниже линии строки.' })}
        ${fld.checks('tr-dist', 'Дистракторы (если отмечено несколько видов — стимулы для каждого)', Object.entries(DISTRACTOR_KINDS).map(([k, v]) => [k, v.ru, k === 'none' || k === 'letter']), { wide: true,
          hint: 'Дистрактор заменяет число (но не 1 и не последнее число); по инструкции на него смотреть нельзя. «Число другого цвета» — число остаётся на месте, но окрашено иначе.' })}
        ${fld.text('tr-letters', 'Буквы для дистрактора «Буква» (через запятую; для каждой — свои стимулы)', 'А', { hint: 'По умолчанию — одна буква «А».' })}
        ${fld.num('tr-dcount', 'Сколько дистракторов в одном стимуле', 1, { min: 1, max: 10 })}
        ${fld.checks('tr-spacing', 'Расстояние между числами', Object.entries(SPACINGS).map(([k, v]) => [k, v.ru, true]), { wide: true,
          hint: 'Фиксированное — числа через равные промежутки. Разное — промежутки неравномерные (степень задаётся в «Параметрах внешнего вида»).' })}
        ${fld.num('tr-per', 'Стимулов на каждый вариант', 1, { min: 1, max: 20 })}
        ${fld.num('tr-seed', 'Номер случайного набора', 1, { hint: 'При том же номере и тех же настройках получится тот же набор (положение дистракторов, неравномерные промежутки).' })}
      `)}
      <div class="toolbar tool-gap"><button class="btn" id="tr-rebuild" type="button">↻ Создать таблицу по общим настройкам</button>
        <span class="toolbar-info">Заменяет таблицу ниже — ручные правки строк будут потеряны.</span></div>
    `)}

    ${stepTitle(2, 'Стимулы: настройка каждого')}
    <p class="muted-p">Каждая строка — один стимул со своими параметрами. Чтобы применить значение ко всем стимулам, выберите его в верхней строке «всем» и нажмите «применить». Строки можно дублировать и удалять.</p>
    <div class="data-table-wrap trail-table-wrap"><table class="data-table trail-table" id="tr-table"></table></div>

    ${stepTitle(3, 'Параметры внешнего вида и инструкции')}
    ${card(`
      ${grid(`
        ${fld.pair('tr-w', 'tr-h', 'Размер стимула: ширина × высота, пикс.', 1920, 1080, { min: 320 })}
        ${fontField('tr-font', 'Шрифт чисел', 'Arial, Helvetica, sans-serif')}
        <div class="field wide"><span class="hint" id="tr-font-hint"></span></div>
        ${fld.colors('tr-bg', 'tr-fg', 'Цвет фона / цвет чисел', '#d9d9d9', '#111111')}
        ${fld.color('tr-dcol', 'Цвет «числа другого цвета»', '#d62728')}
        ${fld.num('tr-zz', 'Размах зигзага, % высоты строки', 22, { min: 0, max: 45 })}
        ${fld.num('tr-spread', 'Разброс расстояний (для «разного расстояния»), %', 40, { min: 0, max: 80, hint: '0 — как при фиксированном; чем больше, тем неравномернее промежутки.' })}
      `)}
      ${instructionEditorHtml('tr', { items: allItems(), lead: 'Для каждого сочетания «направление × дистрактор» в архив попадает своя инструкция (<code>instruction_….png</code>), а также экран оценки <code>rating_scale.png</code>. Проверьте, что порядок экранов и клавиши соответствуют вашей процедуре. {n} в тексте заменяется числом чисел в стимуле.' })}
    `)}
    ${generateBar('tr')}`;

  bindFont('tr-font', () => editor.preview());
  editor = mountInstructionEditor('tr', allItems(), () => {
    const s = readStyle();
    return { width: s.width, height: s.height, background: s.background, color: s.color, fontFamily: s.fontFamily };
  });
  bindTable();
  $('#tr-rebuild').addEventListener('click', () => rebuildRows(true));
  onAnyChange($('#mode-trails'), (el) => {
    if (el.id.startsWith('tr-ins') || el.closest('#tr-table')) return;
    if (el.id.startsWith('tr-') && !['tr-n', 'tr-rows'].includes(el.id)) invalidate();
    updatePlan();
  });
  $('#tr-generate').addEventListener('click', generate);
  rebuildRows(false);
}
