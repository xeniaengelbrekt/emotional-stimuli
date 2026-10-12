/* ============================================================
   emotions.js — эмоциональные категории и их определение
   по средним оценкам массовой валидации.
   ============================================================ */

export const EMOTIONS = [
  { key: 'neutral',  ru: 'Нейтральность', short: 'neu', slug: 'neutral',  color: '#9fb3c8' },
  { key: 'positive', ru: 'Позитивность',  short: 'pos', slug: 'positive', color: '#f2d16b' },
  { key: 'sad',      ru: 'Грусть',        short: 'sad', slug: 'sad',      color: '#6aa7ff' },
  { key: 'threat',   ru: 'Угроза',        short: 'thr', slug: 'threat',   color: '#ff6b6b' },
];
export const EMOTION_KEYS = EMOTIONS.map((e) => e.key);
export const EMOTION_BY_KEY = Object.fromEntries(EMOTIONS.map((e) => [e.key, e]));

/** Синонимы названий шкал в заголовках CSV. */
export const EMOTION_ALIASES = {
  neutral:  ['neutral', 'neutrality', 'нейтральность', 'нейтр', 'нейтральный'],
  positive: ['positive', 'positivity', 'pos', 'позитивность', 'позитив', 'позитивный'],
  sad:      ['sad', 'sadness', 'грусть', 'грустный', 'печаль'],
  threat:   ['threat', 'threatening', 'угроза', 'угрожающий'],
};

/**
 * Определяет эмоциональную категорию как шкалу с максимальной оценкой.
 * margin — минимальный отрыв лидера от второй шкалы (в единицах оценки);
 * если отрыв меньше, категория не назначается (null) — изображение/слово
 * слишком «смешанное» для чистых условий.
 * zStats — { key: {mean, sd} }: если задано, сравниваются z-оценки шкал
 * (нужно, когда шкалы несопоставимы по диапазону).
 */
export function classifyEmotion(ratings, { margin = 0, zStats = null } = {}) {
  const vals = EMOTION_KEYS.map((k) => {
    const v = ratings[k];
    if (v == null || !Number.isFinite(v)) return null;
    if (zStats && zStats[k] && zStats[k].sd > 0) return (v - zStats[k].mean) / zStats[k].sd;
    return v;
  });
  if (vals.some((v) => v == null)) return null;
  const order = vals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  if (order[0][0] - order[1][0] < margin || order[0][0] === order[1][0]) return null;
  return EMOTION_KEYS[order[0][1]];
}

/** mean / sd каждой шкалы по списку объектов с полем ratings. */
export function scaleStats(items) {
  const out = {};
  for (const k of EMOTION_KEYS) {
    const v = items.map((it) => it.ratings[k]).filter((x) => x != null && Number.isFinite(x));
    const m = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
    const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : 0;
    out[k] = { mean: m, sd };
  }
  return out;
}

/** Эмоция по тексту («угроза», «грустная», «sad», «positive» …) — когда оценок нет и категория задана прямо. */
const EMOTION_WORDS = {
  neutral:  ['neutral', 'neutrality', 'нейтральность', 'нейтральный', 'нейтральная', 'нейтральное', 'нейтр', 'neu'],
  positive: ['positive', 'positivity', 'pos', 'позитивность', 'позитивный', 'позитивная', 'позитивное', 'позитив', 'положительная', 'положительный'],
  sad:      ['sad', 'sadness', 'грусть', 'грустный', 'грустная', 'грустное', 'печаль', 'печальная'],
  threat:   ['threat', 'threatening', 'danger', 'угроза', 'угрожающий', 'угрожающая', 'опасность', 'опасная', 'thr'],
};
const normWord = (s) => String(s ?? '').toLowerCase().replace(/[^a-zа-яё]/g, '');
export function parseEmotion(text) {
  const t = normWord(text);
  if (!t) return null;
  for (const k of EMOTION_KEYS) if (EMOTION_WORDS[k].some((a) => normWord(a) === t)) return k;
  return null;
}
/** Эмоция по слову в имени файла: `animals_sad_01.jpg`, `угроза-люди 3.png`. */
export function emotionFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '');
  for (const tok of base.split(/[_\-\s.0-9]+/).filter(Boolean)) { const e = parseEmotion(tok); if (e) return e; }
  return null;
}
