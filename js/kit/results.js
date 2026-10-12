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

const THUMB_W = 480;

/**
 * ctx: {
 *   prefix, step (номер шага), width, height, stimuli, filters?: [[key, label]],
 *   summaryHtml?, afterHtml?, warnings?: string[], built?, requested?,
 *   answerKey?: строки ключа ответов (answer_key.csv), manifests: [{ file, rows }], pngs?: [{ path, draw(canvas) }] (инструкции и т.п.),
 *   settings: object, archiveName
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
      ${ctx.answerKey ? `<button class="btn" id="${prefix}-dl-key" type="button">↓ Ключ ответов (CSV)</button>` : ''}
      <button class="btn" id="${prefix}-dl-csv" type="button">↓ Таблицы CSV</button>
      <button class="btn btn-primary" id="${prefix}-dl-zip" type="button">↓ PNG-архив (ZIP)</button>
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
    const png = async (draw) => {
      $(`#${prefix}-zip-text`).textContent = `Отрисовка PNG: ${++i} из ${total}`;
      await tick();
      draw(canvas, 1);
      const blob = await canvasToBlob(canvas);
      return new Uint8Array(await blob.arrayBuffer());
    };
    for (const p of ctx.pngs || []) entries.push({ name: p.path, data: await png(p.draw) });
    for (const st of ctx.stimuli) entries.push({ name: `stimuli/${st.name}.png`, data: await png(st.draw) });
    if (ctx.answerKey) entries.push({ name: 'answer_key.csv', data: enc.encode('\ufeff' + toCSV(ctx.answerKey)) });
    for (const m of ctx.manifests) entries.push({ name: m.file, data: enc.encode('﻿' + toCSV(m.rows, m.columns)) });
    entries.push({ name: 'settings.json', data: enc.encode(JSON.stringify({ generated: new Date().toISOString(), ...ctx.settings }, null, 2)) });
    downloadBlob(new Blob([buildZip(entries)], { type: 'application/zip' }), `${ctx.archiveName}_${stamp()}.zip`);
    toastSuccess(`Архив готов: ${ctx.stimuli.length} стимулов + инструкции и таблицы`);
  } catch (e) {
    toastError(`Не удалось собрать архив: ${e.message}`);
  } finally {
    busy.hidden = true;
    btn.disabled = false;
  }
}

/** Таблица «показатель × группа» со средним ± SD. rows: [{label, cells:[{mean,sd,n}], extra?}] */
export function metricTable(headers, rows) {
  const fmt = (v) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(3));
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Показатель</th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}${rows.some((r) => r.extra != null) ? '<th>ANOVA</th>' : ''}</tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td>${r.cells.map((c) => `<td class="num">${fmt(c.mean)} <span class="muted">± ${fmt(c.sd)}</span> <span class="muted">(n=${c.n})</span></td>`).join('')}${r.extra != null ? `<td class="num ${r.extraBad ? 'bad-cell' : 'ok-cell'}">${r.extra}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
