/* ============================================================
   fields.js — сборка форм настроек из коротких описаний.
   Каждая функция возвращает HTML-строку; значения читаются
   через read-функции по id поля.
   ============================================================ */

import { $, $$, esc } from '../../../shared/js/common/ui.js';
import { parseNum } from '../../../shared/js/common/csv.js';

const hintHtml = (h) => (h ? `<span class="hint">${h}</span>` : '');
const wideCls = (o) => (o && o.wide ? ' wide' : '');

export const fld = {
  num: (id, label, value, o = {}) => `
    <div class="field${wideCls(o)}"><label for="${id}">${label}</label>
      <input type="number" id="${id}" value="${value ?? ''}"${o.min != null ? ` min="${o.min}"` : ''}${o.max != null ? ` max="${o.max}"` : ''} step="${o.step ?? 1}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}>
      ${hintHtml(o.hint)}</div>`,

  text: (id, label, value, o = {}) => `
    <div class="field${wideCls(o)}"><label for="${id}">${label}</label>
      <input type="text" id="${id}" value="${esc(value)}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}>
      ${hintHtml(o.hint)}</div>`,

  area: (id, label, value, o = {}) => `
    <div class="field${wideCls(o)}"><label for="${id}">${label}</label>
      <textarea id="${id}" rows="${o.rows ?? 4}">${esc(value)}</textarea>
      ${hintHtml(o.hint)}</div>`,

  select: (id, label, options, value, o = {}) => `
    <div class="field${wideCls(o)}"><label for="${id}">${label}</label>
      <div class="select-wrap"><select id="${id}">
        ${options.map(([v, t]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}
      </select></div>${hintHtml(o.hint)}</div>`,

  /** Одиночный флажок с пояснением под ним. */
  check: (id, label, checked, o = {}) => `
    <div class="field wide"><label class="check"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}>
      <span>${label}${o.hint ? `<em>${o.hint}</em>` : ''}</span></label></div>`,

  /** Группа флажков (множественный выбор): options = [[value, label, checked?]]. */
  checks: (id, label, options, o = {}) => `
    <div class="field${wideCls(o)}"><label>${label}</label>
      <div class="check-row" id="${id}">
        ${options.map(([v, t, c]) => `<label class="check"><input type="checkbox" value="${esc(v)}"${c ? ' checked' : ''}><span>${t}</span></label>`).join('')}
      </div>${hintHtml(o.hint)}</div>`,

  pair: (idA, idB, label, a, b, o = {}) => `
    <div class="field${wideCls(o)}"><label for="${idA}">${label}</label>
      <div class="pair"><input type="number" id="${idA}" value="${a}" min="${o.min ?? 1}" step="1"><span>${o.sep ?? '×'}</span><input type="number" id="${idB}" value="${b}" min="${o.min ?? 1}" step="1"></div>
      ${hintHtml(o.hint)}</div>`,

  colors: (idA, idB, label, a, b, o = {}) => `
    <div class="field${wideCls(o)}"><label for="${idA}">${label}</label>
      <div class="pair"><input type="color" id="${idA}" value="${a}"><span>/</span><input type="color" id="${idB}" value="${b}"></div>
      ${hintHtml(o.hint)}</div>`,

  color: (id, label, value, o = {}) => `
    <div class="field${wideCls(o)}"><label for="${id}">${label}</label>
      <input type="color" id="${id}" value="${value}">${hintHtml(o.hint)}</div>`,
};

export const FONTS = [
  ['Montserrat, Arial, sans-serif', 'Montserrat'],
  ['Arial, Helvetica, sans-serif', 'Arial'],
  ['Verdana, Geneva, sans-serif', 'Verdana'],
  ['Tahoma, Geneva, sans-serif', 'Tahoma'],
  ['Calibri, Carlito, sans-serif', 'Calibri'],
  ["'Times New Roman', Times, serif", 'Times New Roman'],
  ['Georgia, serif', 'Georgia'],
  ["'Courier New', monospace", 'Courier New (моноширинный)'],
  ['custom', 'Другой шрифт — ввести название…'],
];

/** Поле выбора шрифта (в т. ч. своего). Читается через readFont(id). */
export function fontField(id, label, def = 'Arial, Helvetica, sans-serif', o = {}) {
  return `
    <div class="field${wideCls(o)}"><label for="${id}">${label}</label>
      <div class="select-wrap"><select id="${id}">
        ${FONTS.map(([v, t]) => `<option value="${esc(v)}"${v === def ? ' selected' : ''}>${esc(t)}</option>`).join('')}
      </select></div>
      <input type="text" id="${id}-custom" placeholder="Название шрифта, например PT Sans" hidden>
      ${hintHtml(o.hint || 'Шрифт должен быть установлен на компьютере, на котором вы формируете стимулы: картинки рисуются с его помощью.')}</div>`;
}

export function bindFont(id, onChange) {
  const sel = $(`#${id}`);
  const custom = $(`#${id}-custom`);
  sel.addEventListener('change', () => { custom.hidden = sel.value !== 'custom'; onChange?.(); });
  custom.addEventListener('change', () => onChange?.());
}

export function readFont(id) {
  const v = $(`#${id}`).value;
  if (v !== 'custom') return v;
  const name = $(`#${id}-custom`).value.trim().replace(/['"]/g, '');
  return name ? `'${name}', Arial, sans-serif` : 'Arial, Helvetica, sans-serif';
}

/* ---------- чтение значений ---------- */

export const readNum = (id, dflt) => {
  const el = $(`#${id}`);
  const v = el ? parseNum(el.value) : null;
  return v == null ? dflt : v;
};
export const readInt = (id, dflt, lo = -Infinity, hi = Infinity) =>
  Math.min(hi, Math.max(lo, Math.round(readNum(id, dflt))));
export const readStr = (id) => ($(`#${id}`)?.value ?? '');
export const readCheck = (id) => !!$(`#${id}`)?.checked;
export const readChecks = (id) => $$(`#${id} input:checked`).map((i) => i.value);

/** «3, 2, 2» / «3;2 2» → [3, 2, 2] (только целые из диапазона). */
export function parseIntList(s, lo = 1, hi = 1e6) {
  return String(s).split(/[,;\s]+/).map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= lo && x <= hi);
}

/** Подписывает все поля внутри контейнера: при изменении вызывает cb(el). */
export function onAnyChange(root, cb) {
  $$('input, select, textarea', root).forEach((el) => {
    el.addEventListener(el.type === 'text' || el.tagName === 'TEXTAREA' || el.type === 'number' ? 'input' : 'change', () => cb(el));
  });
}
