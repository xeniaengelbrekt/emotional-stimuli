/* ============================================================
   results.js — общий блок «Результат»: галерея стимулов,
   просмотр, ZIP-архив (PNG + таблицы + инструкции + настройки).
   Стимул: { name, filter?, tag?, badges?, infoHtml?, draw(canvas, scale) }.
   ============================================================ */

import { $, $$, esc, tick, downloadBlob, downloadText, canvasToBlob, openViewer } from '../common/ui.js';
import { toCSV } from '../common/csv.js';
import { buildZip } from '../common/zip.js';
import { toastError, toastSuccess } from '../core/toast.js';
import { stamp } from './text.js';
import { buildDocx } from './docx.js';

const THUMB_W = 480;

/**
 * ctx: {
 *   prefix, step (номер шага), width, height, stimuli, filters?: [[key, label]],
 *   summaryHtml?, afterHtml?, warnings?: string[], built?, requested?,
 *   answerKey?: строки ключа ответов (answer_key.csv), manifests: [{ file, rows, columns?, desc? }],
 *   pngs?: [{ path, draw(canvas), desc? }] (инструкции и т.п.),
 *   methods?: () => блоки Word (см. docx.js) — описание для раздела «Методы»,
 *   readmeIntro?: string, settings: object, archiveName
 * }
 */
export function mountResults(box, ctx) {
  const { prefix, stimuli } = ctx;
  box.hidden = false;
  const filters = ctx.filters ? [['all', 'Все'], ...ctx.filters] : null;
  const warnings = ctx.warnings || [];
  box.innerHTML = `
    <h3 class="step-title"><span class="step-num">${ctx.step ?? 3}</span>Результат</h3>
    ${warnings.length ? `<div class="alert warn"><strong>Предупреждения</strong><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <div class="alert ${ctx.requested != null && ctx.built < ctx.requested ? 'warn' : 'ok'}">
      Собрано стимулов: <strong>${stimuli.length}</strong>${ctx.requested != null ? ` из ${ctx.requested}` : ''}.
      ${ctx.pngs?.length ? `Инструкции и служебные экраны: ${ctx.pngs.length} PNG.` : ''}
      ${ctx.resultNote || ''}
    </div>
    <div class="toolbar tool-gap">
      ${filters ? `<div class="subtab-bar flush" id="${prefix}-filter">
        ${filters.map(([k, t], i) => `<button class="subtab${i === 0 ? ' active' : ''}" data-f="${esc(k)}" type="button">${esc(t)}</button>`).join('')}
      </div>` : ''}
      <span class="toolbar-spacer"></span>
      ${ctx.methods ? `<button class="btn" id="${prefix}-dl-methods" type="button">↓ Методы (Word)</button>` : ''}
      ${ctx.answerKey ? `<button class="btn" id="${prefix}-dl-key" type="button">↓ Ключ ответов (CSV)</button>` : ''}
      <button class="btn" id="${prefix}-dl-csv" type="button">↓ Таблицы CSV</button>
      <button class="btn btn-primary" id="${prefix}-dl-zip" type="button">↓ Архив (ZIP)</button>
    </div>
    <div class="archive-options">
      <span class="archive-title">В архив добавить:</span>
      ${ctx.methods ? `<label class="check"><input type="checkbox" id="${prefix}-opt-methods" checked><span>описание стимулов для раздела «Методы» (Word, <code>methods_description.docx</code>)</span></label>` : ''}
      ${ctx.answerKey ? `<label class="check"><input type="checkbox" id="${prefix}-opt-key" checked><span>правильные ответы (<code>answer_key.csv</code>)</span></label>` : ''}
      ${ctx.photoStimuli ? `<label class="check-inline">Формат стимулов:
        <span class="select-wrap select-inline"><select id="${prefix}-fmt">
          <option value="jpg95" selected>JPEG, качество 95 — примерно в 5 раз легче, без видимых потерь (рекомендуется)</option>
          <option value="jpg98">JPEG, качество 98 — ещё ближе к оригиналу, примерно в 3 раза легче</option>
          <option value="png">PNG — без потерь, но тяжёлые файлы</option>
        </select></span></label>` : ''}
      <span class="archive-note">Таблицы со стимулами, зонами интереса, салиентностью, яркостью, настройки и README добавляются всегда.</span>
    </div>
    <div class="busy-bar tool-gap" id="${prefix}-zip-busy" hidden><span class="busy-spinner"></span><span id="${prefix}-zip-text"></span></div>
    <div class="result-grid stim-grid" id="${prefix}-gallery"></div>
    ${ctx.pngs?.length ? `<h4 class="sub-heading">Инструкции и служебные экраны в архиве</h4><div class="result-grid stim-grid" id="${prefix}-extras"></div>` : ''}
    ${ctx.summaryHtml || ''}`;

  const gallery = $(`#${prefix}-gallery`);
  const renderGallery = (f) => {
    gallery.innerHTML = '';
    const s = THUMB_W / ctx.width;
    for (const st of stimuli.filter((x) => f === 'all' || x.filter === f)) {
      const card = document.createElement('div');
      card.className = 'result-card stim-card';
      card.innerHTML = `
        <div class="result-thumb stim-thumb">${st.tag ? `<span class="result-tag">${esc(st.tag)}</span>` : ''}</div>
        <div class="result-body">
          <div class="result-name">${esc(st.name)}</div>
          ${st.badges ? `<div class="result-stats">${st.badges}</div>` : ''}
        </div>`;
      const canvas = document.createElement('canvas');
      st.draw(canvas, s);
      card.querySelector('.stim-thumb').prepend(canvas);
      card.addEventListener('click', () => openViewer({
        title: st.name,
        info: st.infoHtml || '',
        canvasFactory: () => { const c = document.createElement('canvas'); st.draw(c, 1); return c; },
      }));
      gallery.appendChild(card);
    }
  };
  renderGallery('all');
  $$(`#${prefix}-filter .subtab`).forEach((b) => b.addEventListener('click', () => {
    $$(`#${prefix}-filter .subtab`).forEach((x) => x.classList.toggle('active', x === b));
    renderGallery(b.dataset.f);
  }));

  if (ctx.pngs?.length) {
    const ex = $(`#${prefix}-extras`);
    const s = THUMB_W / ctx.width;
    for (const p of ctx.pngs) {
      const card = document.createElement('div');
      card.className = 'result-card stim-card';
      card.innerHTML = `<div class="result-thumb stim-thumb"></div><div class="result-body"><div class="result-name">${esc(p.path)}</div></div>`;
      const c = document.createElement('canvas');
      p.draw(c, s);
      card.querySelector('.stim-thumb').prepend(c);
      card.addEventListener('click', () => openViewer({
        title: p.path, info: '',
        canvasFactory: () => { const cc = document.createElement('canvas'); p.draw(cc, 1); return cc; },
      }));
      ex.appendChild(card);
    }
  }

  $(`#${prefix}-dl-csv`).addEventListener('click', () => {
    ctx.manifests.forEach((m, i) => setTimeout(() => downloadText(toCSV(m.rows, m.columns), m.file), i * 300));
  });
  $(`#${prefix}-dl-key`)?.addEventListener('click', () => downloadText(toCSV(ctx.answerKey), 'answer_key.csv'));
  $(`#${prefix}-dl-methods`)?.addEventListener('click', () => {
    downloadBlob(new Blob([buildDocx(ctx.methods())], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'methods_description.docx');
  });
  $(`#${prefix}-dl-zip`).addEventListener('click', () => downloadArchive(ctx));
}

async function downloadArchive(ctx) {
  const { prefix } = ctx;
  const busy = $(`#${prefix}-zip-busy`);
  const btn = $(`#${prefix}-dl-zip`);
  busy.hidden = false;
  btn.disabled = true;
  try {
    const enc = new TextEncoder();
    const entries = [];
    const canvas = document.createElement('canvas');
    const total = ctx.stimuli.length + (ctx.pngs?.length || 0);
    let i = 0;
    const fmt = ctx.photoStimuli ? ($(`#${prefix}-fmt`)?.value || 'jpg95') : 'png';
    const stimExt = fmt === 'png' ? 'png' : 'jpg';
    const stimQuality = fmt === 'jpg98' ? 0.98 : 0.95;
    const render = async (draw, asStimulus) => {
      $(`#${prefix}-zip-text`).textContent = `Отрисовка изображений: ${++i} из ${total}`;
      await tick();
      draw(canvas, 1);
      const blob = asStimulus && stimExt === 'jpg' ? await canvasToBlob(canvas, 'image/jpeg', stimQuality) : await canvasToBlob(canvas);
      return new Uint8Array(await blob.arrayBuffer());
    };
    const png = (draw) => render(draw, false);
    const addMethods = !!ctx.methods && $(`#${prefix}-opt-methods`)?.checked;
    const addKey = !!ctx.answerKey && $(`#${prefix}-opt-key`)?.checked;
    const files = [];            // [путь, описание] для README
    for (const p of ctx.pngs || []) { entries.push({ name: p.path, data: await png(p.draw) }); files.push([p.path, p.desc || 'Экран для участника (PNG того же размера, что стимулы)']); }
    for (const st of ctx.stimuli) entries.push({ name: `stimuli/${st.name}.${stimExt}`, data: await render(st.draw, true) });
    files.push([`stimuli/*.${stimExt}`, `Стимулы (${ctx.stimuli.length} шт., ${stimExt === 'png' ? 'PNG без потерь' : `JPEG, качество ${Math.round(stimQuality * 100)}, стандартное цветовое прореживание 4:2:0`}). Имя файла составлено из характеристик стимула и уникально`]);
    if (addKey) { entries.push({ name: 'answer_key.csv', data: enc.encode('\ufeff' + toCSV(ctx.answerKey)) }); files.push(['answer_key.csv', 'Правильные ответы по каждому стимулу']); }
    for (const m of ctx.manifests) { entries.push({ name: m.file, data: enc.encode('\ufeff' + toCSV(m.rows, m.columns)) }); files.push([m.file, m.desc || 'Таблица']); }
    entries.push({ name: 'settings.json', data: enc.encode(JSON.stringify({ generated: new Date().toISOString(), ...ctx.settings, ...(ctx.photoStimuli ? { stimulusFormat: fmt } : {}) }, null, 2)) });
    files.push(['settings.json', 'Все параметры генерации и номер случайного набора: по ним набор воспроизводится точно']);
    if (addMethods) { entries.push({ name: 'methods_description.docx', data: buildDocx(ctx.methods()) }); files.push(['methods_description.docx', 'Описание стимулов и процедуры их создания для раздела «Методы» (Word)']); }
    entries.unshift({ name: 'README.txt', data: enc.encode('\ufeff' + readmeText(ctx, files)) });
    downloadBlob(new Blob([buildZip(entries)], { type: 'application/zip' }), `${ctx.archiveName}_${stamp()}.zip`);
    toastSuccess(`Архив готов: ${ctx.stimuli.length} стимулов + инструкции, таблицы и описание`);
  } catch (e) {
    toastError(`Не удалось собрать архив: ${e.message}`);
  } finally {
    busy.hidden = true;
    btn.disabled = false;
  }
}

/** Текст README.txt: что лежит в архиве. */
export function readmeText(ctx, files) {
  const lines = [
    `АРХИВ СТИМУЛОВ — ${ctx.title || ctx.archiveName}`,
    `Создан: ${new Date().toLocaleString('ru-RU')}`,
    ctx.readmeIntro || '',
    '',
    'ЧТО В АРХИВЕ',
    ...files.map(([f, d]) => `  ${f}\n      ${d}`),
    '',
    'КАК СВЯЗАНЫ ТАБЛИЦЫ',
    '  Во всех таблицах стимул обозначен столбцом «stimulus» — это имя файла стимула без расширения.',
    '  Координаты (x, y, w, h) — в пикселях стимула: x, y — левый верхний угол области, w — ширина, h — высота.',
    '  Таблицы в CSV: разделитель «;», десятичная запятая допустима, кодировка UTF-8; открываются в Excel двойным щелчком.',
    '',
    'ВОСПРОИЗВОДИМОСТЬ',
    '  Файл settings.json содержит все параметры и номер случайного набора. С теми же данными и параметрами получится тот же набор.',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** Таблица «показатель × группа» со средним ± SD. rows: [{label, cells:[{mean,sd,n}], extra?}] */
export function metricTable(headers, rows) {
  const fmt = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(3));
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Показатель</th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}${rows.some((r) => r.extra != null) ? '<th>ANOVA</th>' : ''}</tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td>${r.cells.map((c) => `<td class="num">${fmt(c.mean)} <span class="muted">± ${fmt(c.sd)}</span> <span class="muted">(n=${c.n})</span></td>`).join('')}${r.extra != null ? `<td class="num ${r.extraBad ? 'bad-cell' : 'ok-cell'}">${r.extra}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
