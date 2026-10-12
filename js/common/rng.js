/* ============================================================
   rng.js — воспроизводимый генератор псевдослучайных чисел
   (mulberry32). Один seed → один и тот же набор стимулов.
   ============================================================ */

export function makeRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Целое в [0, n). */
    int: (n) => Math.floor(next() * n),
    /** Равномерное в [lo, hi). */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** Перемешивание Фишера–Йетса (возвращает новый массив). */
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/** Все перестановки массива (для 4 элементов — 24 штуки). */
export function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) out.push([x, ...p]);
  });
  return out;
}
