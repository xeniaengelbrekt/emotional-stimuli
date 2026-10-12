/* ============================================================
   instr.js — инструкция для участника (PNG) и её редактор.
   Текст: абзацы с новой строки, **жирный** — двойными звёздочками.
   Рисуется тем же размером и цветами, что и стимулы.
   ============================================================ */

import { $, $$, esc } from '../common/ui.js';
import { readableTextColor } from '../common/instruction.js';
import { measureText } from './text.js';

/** «Привет **мир**» → [{t:'Привет ', b:false}, {t:'мир', b:true}] */
export function parseRich(par) {
  const out = [];
  par.split('**').forEach((chunk, i) => { if (chunk) out.push({ t: chunk, b: i % 2 === 1 }); });
  return out;
}

const fontOf = (size, bold, family) => `${bold ? 700 : 400} ${size}px ${family}`;

/** Перенос строк с учётом смешанного начертания. Возвращает массив строк из слов {t,b,w}. */
function wrapRich(tokens, size, family, maxW) {
  const words = [];
  for (const tk of tokens) {
    tk.t.split(/(\s+)/).forEach((part) => { if (part !== '') words.push({ t: part, b: tk.b }); });
  }
  const lines = [];
  let line = [];
  let w = 0;
  for (const wd of words) {
    const ww = measureText(wd.t, fontOf(size, wd.b, family));
    const isSpace = /^\s+$/.test(wd.t);
    if (!isSpace && w + ww > maxW && line.length) {
      while (line.length && /^\s+$/.test(line[line.length - 1].t)) line.pop();
      lines.push(line); line = []; w = 0;
    }
    if (isSpace && !line.length) continue;
    line.push({ ...wd, w: ww });
    w += ww;
  }
  while (line.length && /^\s+$/.test(line[line.length - 1].t)) line.pop();
  if (line.length) lines.push(line);
  return lines;
}

/**
 * opts: { width, height, background, color, fontFamily, text, scale=1, sizeRatio=0.034 }
 * Пустая строка в тексте — вертикальный просвет. Шрифт уменьшается, если текст не помещается.
 */
export function drawInstructionText(canvas, opts) {
  const { width: W, height: H, background, fontFamily, text } = opts;
  const scale = opts.scale ?? 1;
  const color = opts.color || readableTextColor(background);
  canvas.width = Math.max(1, Math.round(W * scale));
  canvas.height = Math.max(1, Math.round(H * scale));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const maxW = W * 0.72;
  const maxH = H * 0.8;
  const paragraphs = String(text || '').split(/\r?\n/).map((p) => p.trim());
  let size = Math.round(H * (opts.sizeRatio ?? 0.034));
  let blocks; let lineH; let total;
  for (; size >= 10; size -= 2) {
    lineH = size * 1.32;
    blocks = paragraphs.map((p) => (p ? wrapRich(parseRich(p), size, fontFamily, maxW) : null));
    total = blocks.reduce((s, b) => s + (b ? b.length * lineH : lineH), 0);
    if (total <= maxH) break;
  }
  let y = (H - total) / 2 + size;
  for (const b of blocks) {
    if (!b) { y += lineH; continue; }
    for (const line of b) {
      const lw = line.reduce((s, x) => s + x.w, 0);
      let x = (W - lw) / 2;
      for (const wd of line) {
        ctx.font = fontOf(size, wd.b, fontFamily);
        ctx.fillText(wd.t, x, y);
        x += wd.w;
      }
      y += lineH;
    }
  }
}

/**
 * Редактор инструкции: флажок «добавить в архив», выбор экрана (если их несколько),
 * текст и предпросмотр. items = [{ key, label, text }].
 * getStyle() → { width, height, background, color?, fontFamily }.
 */
export function instructionEditorHtml(prefix, { items, title = 'Инструкция для участника', lead }) {
  return `
    <div class="form-sep"></div>
    <h4 class="params-sub">${title}</h4>
    <p class="muted-p">${lead || 'Каждая инструкция сохраняется в архив отдельной картинкой <code>instruction_….png</code> того же размера, что и стимулы. Покажите её перед началом эксперимента. Проверьте, что текст соответствует вашей процедуре: что именно должен делать участник и какими клавишами.'}</p>
    <div class="form-grid">
      <div class="field wide"><label class="check"><input type="checkbox" id="${prefix}-ins-on" checked><span>Добавить инструкции в архив</span></label></div>
      ${items.length > 1 ? `<div class="field"><label for="${prefix}-ins-pick">Какую инструкцию редактировать</label>
        <div class="select-wrap"><select id="${prefix}-ins-pick">${items.map((it) => `<option value="${esc(it.key)}">${esc(it.label)}</option>`).join('')}</select></div></div>` : ''}
      <div class="field wide"><label for="${prefix}-ins-text">Текст инструкции (каждый абзац с новой строки, **жирный** — в двойных звёздочках)</label>
        <textarea id="${prefix}-ins-text" rows="7"></textarea></div>
    </div>
    <div class="instr-preview"><canvas id="${prefix}-ins-canvas"></canvas></div>`;
}

export function mountInstructionEditor(prefix, items, getStyle) {
  const texts = new Map(items.map((it) => [it.key, it.text]));
  const defaults = new Map(items.map((it) => [it.key, it.text]));
  let current = items[0].key;
  const area = () => $(`#${prefix}-ins-text`);
  const pick = () => $(`#${prefix}-ins-pick`);

  const preview = () => {
    const st = getStyle();
    const k = 960 / st.width;
    drawInstructionText($(`#${prefix}-ins-canvas`), { ...st, text: texts.get(current), scale: k });
  };
  area().value = texts.get(current);
  area().addEventListener('input', () => { texts.set(current, area().value); preview(); });
  pick()?.addEventListener('change', () => { current = pick().value; area().value = texts.get(current); preview(); });

  return {
    preview,
    enabled: () => $(`#${prefix}-ins-on`).checked,
    /** Актуальные тексты по ключам. */
    texts: () => Object.fromEntries(texts),
    /** Заменить тексты (когда меняется набор экранов). */
    setItems(newItems) {
      for (const it of newItems) { if (!texts.has(it.key)) texts.set(it.key, it.text); defaults.set(it.key, it.text); }
      const sel = pick();
      if (sel) {
        sel.innerHTML = newItems.map((it) => `<option value="${esc(it.key)}">${esc(it.label)}</option>`).join('');
        if (!newItems.some((it) => it.key === current)) current = newItems[0].key;
        sel.value = current;
      } else if (!newItems.some((it) => it.key === current)) current = newItems[0].key;
      area().value = texts.get(current) ?? '';
      preview();
    },
    /** Вернуть исходный текст выбранной инструкции. */
    reset() { texts.set(current, defaults.get(current)); area().value = texts.get(current); preview(); },
  };
}
