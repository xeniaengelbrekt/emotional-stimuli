/* ============================================================
   words/render.js — отрисовка стимула «найдите слово».
   Верх: инструкция. Ниже: сетка слов, в которой каждое слово
   смещено от центра ячейки случайно (но воспроизводимо), так что
   расположение выглядит «вразброс», а не таблицей.
   ============================================================ */

export const DEFAULT_LAYOUT = {
  width: 1920,
  height: 1080,
  background: '#d9d9d9',
  color: '#111111',
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 40,               // максимальный размер, px; при необходимости уменьшается, чтобы слова влезли
  instruction: 'Найдите слово: {word}',
  instructionScale: 1.35,     // размер инструкции относительно слов
  topBand: 0.16,              // доля высоты под инструкцию
  marginX: 80,
  marginBottom: 60,
  jitter: 0.7,                // 0 — строгая сетка, 1 — максимум свободы внутри ячейки
  textCase: 'asis',           // asis | lower | upper
};

export const applyCase = (w, mode) =>
  mode === 'upper' ? w.toLocaleUpperCase('ru') : mode === 'lower' ? w.toLocaleLowerCase('ru') : w;

const fontStr = (L, size, weight = 400) => `${weight} ${size}px ${L.fontFamily}`;

/** Область под сетку слов. */
export function gridArea(layout) {
  const L = { ...DEFAULT_LAYOUT, ...layout };
  const y = Math.round(L.height * L.topBand);
  return { x: L.marginX, y, w: L.width - 2 * L.marginX, h: L.height - y - L.marginBottom };
}

/**
 * Единый размер шрифта для каждого уровня сложности: максимальный из ≤ fontSize,
 * при котором самое длинное слово всех стимулов уровня влезает в ячейку.
 * measure(text, fontCss) → ширина в px.
 */
export function fitFontSizes(stimuli, layout, measure) {
  const L = { ...DEFAULT_LAYOUT, ...layout };
  const area = gridArea(L);
  const sizes = {};
  for (const st of stimuli) {
    const cellW = area.w / st.grid.cols;
    const cellH = area.h / st.grid.rows;
    let size = sizes[st.N] ?? L.fontSize;
    for (const c of st.cells) {
      const text = applyCase(c.item.word, L.textCase);
      const w = measure(text, fontStr(L, size));
      const maxW = cellW * 0.92;
      if (w > maxW) size = Math.floor(size * maxW / w);
    }
    sizes[st.N] = Math.max(8, Math.min(size, Math.floor(cellH * 0.6)));
  }
  return sizes;
}

/**
 * Рисует стимул, возвращает рамки слов (зоны интереса):
 * [{ word, isTarget, cell, row, col, x, y, w, h }].
 */
export function drawWordStimulus(canvas, stimulus, layout, fontSize) {
  const L = { ...DEFAULT_LAYOUT, ...layout };
  canvas.width = L.width;
  canvas.height = L.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = L.background;
  ctx.fillRect(0, 0, L.width, L.height);
  ctx.fillStyle = L.color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // инструкция
  const size = fontSize ?? L.fontSize;
  const instrSize = Math.round(L.fontSize * L.instructionScale);
  const target = applyCase(stimulus.target.word, L.textCase);
  const [pre, post] = L.instruction.split('{word}');
  const parts = [[pre ?? '', 400], [target, 700], [post ?? '', 400]];
  let total = 0;
  const widths = parts.map(([t, wt]) => {
    ctx.font = fontStr(L, instrSize, wt);
    const w = ctx.measureText(t).width;
    total += w;
    return w;
  });
  let x = (L.width - total) / 2;
  const baseY = Math.round(L.height * L.topBand * 0.5 + instrSize * 0.35);
  parts.forEach(([t, wt], i) => {
    ctx.font = fontStr(L, instrSize, wt);
    ctx.fillText(t, x, baseY);
    x += widths[i];
  });

  // сетка слов
  const area = gridArea(L);
  const cellW = area.w / stimulus.grid.cols;
  const cellH = area.h / stimulus.grid.rows;
  ctx.font = fontStr(L, size);
  const boxes = [];
  for (const c of stimulus.cells) {
    const row = Math.floor(c.cell / stimulus.grid.cols);
    const col = c.cell % stimulus.grid.cols;
    const text = applyCase(c.item.word, L.textCase);
    const m = ctx.measureText(text);
    const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
    const w = m.width, h = asc + desc;
    const freeX = Math.max(0, (cellW - w) / 2 - 4);
    const freeY = Math.max(0, (cellH - h) / 2 - 4);
    const cx = area.x + (col + 0.5) * cellW + c.jx * freeX * L.jitter;
    const cy = area.y + (row + 0.5) * cellH + c.jy * freeY * L.jitter;
    const left = cx - w / 2;
    const base = cy + (asc - desc) / 2;
    ctx.fillText(text, left, base);
    boxes.push({
      word: c.item.word, isTarget: c.isTarget, cell: c.cell, row: row + 1, col: col + 1,
      x: Math.round(left), y: Math.round(base - asc), w: Math.round(w), h: Math.round(h),
    });
  }
  return boxes;
}
