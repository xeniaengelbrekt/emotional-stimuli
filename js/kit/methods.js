/* ============================================================
   methods.js — общие «кирпичики» для документа «Описание для раздела
   Методы» (Word): заголовки, таблицы параметров, типовые абзацы.
   Каждая методика собирает свой документ из этих блоков.
   ============================================================ */

import { SAL_NAMES, METHOD_LABELS } from './salience.js';
import { meanOf, sdOf } from '../core/stats.js';

export const APP_NAME = 'Генератор стимулов';
export const APP_VERSION = '1.0';

export const H1 = (text) => ({ t: 'h1', text });
export const H2 = (text) => ({ t: 'h2', text });
export const H3 = (text) => ({ t: 'h3', text });
export const P = (text) => ({ t: 'p', text });
export const UL = (items) => ({ t: 'ul', items });
export const TABLE = (header, rows, widths) => ({ t: 'table', header, rows, widths });
export const BR = () => ({ t: 'pagebreak' });

/** Таблица «Параметр — значение — пояснение». rows: [[параметр, значение, пояснение?]] */
export const paramTable = (rows) => TABLE(
  rows.some((r) => r[2]) ? ['Параметр', 'Значение', 'Пояснение'] : ['Параметр', 'Значение'],
  rows.map((r) => (rows.some((x) => x[2]) ? [r[0], String(r[1]), r[2] || ''] : [r[0], String(r[1])])),
  rows.some((r) => r[2]) ? [3, 2, 4] : [3, 2],
);

export const yesNo = (v) => (v ? 'да' : 'нет');
export const px = (v) => `${v} пикс.`;
export const colorText = (hex) => `${colorName(hex)} (${hex})`;

/** Грубое название цвета для текста; код всегда указывается рядом. */
export function colorName(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 'цвет';
  const n = parseInt(m[1], 16);
  const r = n >> 16; const g = (n >> 8) & 255; const b = n & 255;
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
  if (mx - mn < 18) {
    if (mx < 40) return 'чёрный';
    if (mx > 235) return 'белый';
    return mx > 150 ? 'светло-серый' : 'серый';
  }
  if (r >= g && r >= b) return g > b + 40 ? 'оранжево-жёлтый' : 'красный';
  if (g >= r && g >= b) return 'зелёный';
  return 'синий';
}

export const mean2 = (arr) => (arr.length ? meanOf(arr) : NaN);
export const f2 = (v, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d).replace('.', ','));

/** Описание стимульных экранов (размер, цвета) — общая для всех методик часть. */
export function screenRows(style, extra = []) {
  return [
    ['Размер стимула', `${style.width} × ${style.height} пикс.`, 'Размер каждого PNG-файла'],
    ['Цвет фона', colorText(style.background)],
    ...extra,
  ];
}

export function salienceParagraphs(method, metricsUsed = ['mean', 'entropy', 'center_bias', 'spread_pct']) {
  const names = metricsUsed.map((k) => SAL_NAMES[k] || k).join('; ');
  return [
    P(`Низкоуровневая салиентность каждого стимула оценивалась алгоритмом «${METHOD_LABELS[method] || method}». ` +
      'Для цветных искусственных и фотографических сцен применяется метод Frequency-Tuned (Achanta et al., 2009): карта строится как евклидово расстояние в цветовом пространстве CIE Lab ' +
      'между средним вектором изображения и изображением, сглаженным биномиальным ядром 5 × 5. Расчёт выполняется на рабочей копии с длинной стороной 256 пикс. с сохранением пропорций; ' +
      'значения нормируются до диапазона 0–1 с обрезкой по 99,9-му перцентилю.'),
    P(`По карте вычислялись показатели: ${names}. Средняя салиентность — среднее значение нормированной карты; энтропия — энтропия Шеннона гистограммы значений (64 интервала), бит; ` +
      'смещение к центру — отношение средней салиентности внутри центрального эллипса (полуоси 0,7 половины ширины и высоты кадра) к средней вне него; ' +
      'доля площади с высокой салиентностью — процент пикселей со значением выше 0,5. Относительная салиентность области интереса — среднее значение карты внутри области, делённое на среднее по всей карте (1 — как в среднем по экрану).'),
  ];
}

export function luminanceParagraph() {
  return P('Для контроля освещённости экрана (существенной при регистрации диаметра зрачка) для каждого стимула рассчитана средняя относительная яркость кадра по значениям sRGB ' +
    '(коэффициенты Rec. 709: 0,2126 R + 0,7152 G + 0,0722 B; шкала 0–1). Значения приведены в таблице stimuli.csv архива (столбец mean_luminance).');
}

export function reproducibilityParagraph(seed, extra = '') {
  return P(`Стимулы созданы в веб-приложении «${APP_NAME}» (версия ${APP_VERSION}), все вычисления выполнены локально в браузере. ` +
    `Набор воспроизводится полностью при тех же исходных данных и параметрах и номере случайного набора ${seed} (все параметры сохранены в файле settings.json архива).${extra ? ' ' + extra : ''}`);
}

/** Таблица «показатель × условие»: среднее ± SD (n) и ANOVA — из строк salienceBalance/metricTable. */
export function balanceTable(headers, rows) {
  const cell = (c) => `${f2(c.mean, 3)} ± ${f2(c.sd, 3)} (n = ${c.n})`;
  const hasExtra = rows.some((r) => r.extra != null);
  return TABLE(['Показатель', ...headers, ...(hasExtra ? ['ANOVA'] : [])],
    rows.map((r) => [r.label, ...r.cells.map(cell), ...(hasExtra ? [r.extra ?? '—'] : [])]));
}

/** Сводка по распределению (например, число стимулов по условиям). */
export function countTable(header, rows) {
  return TABLE(header, rows.map((r) => r.map(String)));
}

export const stats = { meanOf, sdOf };
