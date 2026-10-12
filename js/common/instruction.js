/* ============================================================
   instruction.js — экран инструкции для участника (PNG).
   Рисуется тем же размером и теми же цветами, что и стимулы,
   поэтому в эксперименте переключение не «мигает».
   ============================================================ */

export const DEFAULT_FOOTER = 'Чтобы начать, нажмите ПРОБЕЛ';

export const IMAGES_INSTRUCTION = {
  title: 'Инструкция',
  body: [
    'На экране будут появляться по четыре изображения.',
    'Рассматривайте их так, как вам удобно.',
    'Когда рассмотрите, щёлкните левой кнопкой мыши по тому изображению, которое привлекло ваше внимание больше всего.',
  ].join('\n'),
  footer: DEFAULT_FOOTER,
};

export const WORDS_INSTRUCTION = {
  title: 'Инструкция',
  body: [
    'Вверху экрана будет написано слово, которое нужно найти. Ниже расположена таблица со словами.',
    'Найдите это слово как можно быстрее.',
    'Как только найдёте, щёлкните по нему левой кнопкой мыши.',
    'Старайтесь не ошибаться.',
  ].join('\n'),
  footer: DEFAULT_FOOTER,
};

/** Чёрный или белый текст — в зависимости от яркости фона. */
export function readableTextColor(bg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg || '');
  if (!m) return '#111111';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.5 ? '#f5f5f5' : '#111111';
}

function wrap(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * opts: { width, height, background, color, fontFamily, title, body, footer }
 * Абзацы в body разделяются переводом строки. Шрифт уменьшается, если текст не помещается.
 */
export function drawInstruction(canvas, opts) {
  const { width: W, height: H, background, fontFamily, title, body, footer } = opts;
  const color = opts.color || readableTextColor(background);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const maxW = W * 0.78;
  const paragraphs = (body || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const titleSize = Math.round(H * 0.075);
  const footerSize = Math.round(H * 0.04);
  const area = H * 0.62;                                  // высота под основной текст
  let size = Math.round(H * 0.048);
  let blocks, lineH, total;
  for (; size >= 12; size -= 2) {
    ctx.font = `400 ${size}px ${fontFamily}`;
    lineH = size * 1.4;
    blocks = paragraphs.map((p) => wrap(ctx, p, maxW));
    total = blocks.reduce((s, b) => s + b.length * lineH, 0) + Math.max(0, blocks.length - 1) * size * 0.7;
    if (total <= area) break;
  }

  let y = H * 0.17;
  if (title) {
    ctx.font = `700 ${titleSize}px ${fontFamily}`;
    ctx.fillText(title, W / 2, y);
  }
  y = H * 0.30 + Math.max(0, (area - total) / 2) * 0.5;
  ctx.font = `400 ${size}px ${fontFamily}`;
  for (const b of blocks) {
    for (const line of b) { ctx.fillText(line, W / 2, y); y += lineH; }
    y += size * 0.7;
  }
  if (footer) {
    ctx.font = `500 ${footerSize}px ${fontFamily}`;
    ctx.globalAlpha = 0.8;
    ctx.fillText(footer, W / 2, H * 0.92);
    ctx.globalAlpha = 1;
  }
}
