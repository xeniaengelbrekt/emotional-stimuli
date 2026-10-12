/* ============================================================
   ui.js — мелкие помощники для работы с DOM и файлами
   ============================================================ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Пауза, чтобы браузер успел перерисовать интерфейс в долгих циклах. */
export const tick = () => new Promise((r) => setTimeout(r, 0));

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text, filename, mime = 'text/csv') {
  // BOM — чтобы Excel правильно открыл кириллицу
  downloadBlob(new Blob(['﻿', text], { type: `${mime};charset=utf-8` }), filename);
}

export const canvasToBlob = (canvas, type = 'image/png') =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type));

export const readText = (file) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result));
  fr.onerror = () => rej(fr.error);
  fr.readAsText(file, 'utf-8');
});

/** Dropzone: клик, drag&drop; onFiles(File[]) */
export function bindDropzone(zone, input, onFiles) {
  const pick = () => input.click();
  zone.addEventListener('click', (e) => { if (e.target.closest('button') || e.target === zone || zone.contains(e.target)) pick(); });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
}

/** Окно просмотра стимула (используется обеими методиками). */
export function openViewer({ title, canvasFactory, info }) {
  const root = document.createElement('div');
  root.className = 'modal';
  root.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-window viewer-window" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h2 class="modal-title">${esc(title)}</h2>
        <button class="modal-close" type="button" aria-label="Закрыть">×</button>
      </header>
      <div class="modal-body viewer-body"><div class="viewer-canvas"></div><div class="viewer-info">${info || ''}</div></div>
    </div>`;
  document.body.appendChild(root);
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('.modal-backdrop').addEventListener('click', close);
  root.querySelector('.modal-close').addEventListener('click', close);
  const canvas = canvasFactory();
  root.querySelector('.viewer-canvas').appendChild(canvas);
  return root;
}

/**
 * Средняя яркость картинки (0–255, по формуле Rec. 601 из sRGB-значений).
 * Нужна для анализа зрачка: зрачок реагирует на свет сильнее, чем на эмоции.
 */
export function meanLuminance(canvas) {
  const w = 96, h = Math.max(1, Math.round(96 * canvas.height / canvas.width));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return Math.round((s / (d.length / 4)) * 10) / 10;
}

export const fmt = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));
