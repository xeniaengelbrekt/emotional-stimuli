import { generateRotation, patternKey, applyOp, OPTION_SETS, TRANSFORM_KEYS } from '../cognitive/js/rotation/generator.js';
import { generateVerbal, findOccurrences, cleanWord } from '../cognitive/js/verbal/generator.js';
import { generateDiff } from '../cognitive/js/diff/generator.js';
import { buildRows, generateTrails, layoutTrail } from '../cognitive/js/trails/generator.js';
import { makeRng } from '../shared/js/common/rng.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

/* ---------- вращение ---------- */
{
  const r = generateRotation({ seed: 11, perCombo: 3 });
  ok(r.stimuli.length === 4 * 3 * 3, 'вращение: 4 задания × 3 цветности × 3 = 36');
  ok(generateRotation({ seed: 1 }).stimuli.length === 12, 'вращение: по умолчанию 12 стимулов');
  const names = new Set(r.stimuli.map((s) => s.name));
  ok(names.size === r.stimuli.length, 'вращение: имена уникальны');
  let good = true; let touch = false; let border = false; let layout = true;
  for (const s of r.stimuli) {
    const f = s.figure;
    const sizes = [...new Set(f.cells.map((c) => c.piece))].map((p) => f.cells.filter((c) => c.piece === p).length).sort((a, b) => b - a);
    if (sizes.join() !== '3,2,2,1,1,1') layout = false;
    for (const a of f.cells) for (const b of f.cells) if (a.piece !== b.piece && Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1) touch = true;
    if (f.cells.some((c) => c.r === 0 || c.c === 0 || c.r === f.n - 1 || c.c === f.n - 1)) border = true;
    const correct = s.options.find((o) => o.correct);
    const op = OPTION_SETS[s.transform][0];
    if (patternKey(correct.cells) !== patternKey(applyOp(f.cells, op, f.n))) good = false;
    if (new Set(s.options.map((o) => patternKey(o.cells))).size !== 4) good = false;
    if (s.options[s.correctPos - 1] !== correct) good = false;
  }
  ok(layout, 'вращение: фигурки 3,2,2,1,1,1');
  ok(!touch, 'вращение: фигурки не касаются, даже углами');
  ok(!border, 'вращение: крайние ряды пусты');
  ok(good, 'вращение: верный вариант = нужное преобразование, 4 разных варианта');
  const pos = [1, 2, 3, 4].map((p) => r.stimuli.filter((s) => s.correctPos === p).length);
  ok(Math.max(...pos) - Math.min(...pos) <= 1, `вращение: номера верных ответов поровну (${pos})`);
  // проверка самих преобразований на примере
  const c = [{ r: 0, c: 1 }];
  ok(JSON.stringify(applyOp(c, 'cw90', 3)[0]) === JSON.stringify({ r: 1, c: 2 }), 'поворот 90° по часовой: (0,1)→(1,2)');
  ok(JSON.stringify(applyOp(c, 'ccw90', 3)[0]) === JSON.stringify({ r: 1, c: 0 }), 'поворот 90° против часовой: (0,1)→(1,0)');
  ok(JSON.stringify(applyOp(c, 'mirror', 3)[0]) === JSON.stringify({ r: 0, c: 1 }) && JSON.stringify(applyOp([{ r: 0, c: 0 }], 'mirror', 3)[0]) === JSON.stringify({ r: 0, c: 2 }), 'зеркало лево↔право');
  const again = generateRotation({ seed: 11, perCombo: 3 });
  ok(again.stimuli.every((s, i) => s.name === r.stimuli[i].name && patternKey(s.figure.cells) === patternKey(r.stimuli[i].figure.cells)), 'вращение: воспроизводимо по seed');
}

/* ---------- филворд ---------- */
{
  const rng = makeRng(5);
  const words = [];
  const L = 'АБВГДЕЖЗИКЛМНОПРСТУФХ';
  for (const c of ['neutral', 'positive', 'sad', 'threat']) {
    for (let i = 0; i < 40; i++) {
      const len = 4 + rng.int(6);
      const w = Array.from({ length: len }, () => L[rng.int(L.length)]).join('');
      words.push({ id: c + i, word: w, len, freq: 5 + rng.next() * 300, ratings: { neutral: 1, positive: 1, sad: 1, threat: 1, [c]: 4 + rng.next() * 2 }, category: c });
    }
  }
  const r = generateVerbal(words, { seed: 3, colors: ['bw', 'color'], perCombo: 2, targetsPerStimulus: 2 });
  ok(r.stimuli.length === 2 * 4 * 2 * 2, `филворд: 2 напр. × 4 катег. × 2 × 2 цветн. = ${r.stimuli.length}`);
  ok(new Set(r.stimuli.map((s) => s.name)).size === r.stimuli.length, 'филворд: имена уникальны');
  let placedOk = true; let noExtra = true; let inGrid = true;
  for (const s of r.stimuli) {
    for (const p of s.placements) {
      const word = p.cells.map(([a, b]) => s.letters[a][b]).join('');
      if (word !== p.word) placedOk = false;
      const sameLine = p.cells.every(([a, b]) => (s.orientation === 'horizontal' ? a === p.cells[0][0] : b === p.cells[0][1]));
      if (!sameLine) placedOk = false;
      const occ = findOccurrences(s.letters, 10, 10, p.word);
      if (occ.length !== 1) noExtra = false;
    }
    if (s.letters.length !== 10 || s.letters.some((row) => row.length !== 10)) inGrid = false;
  }
  ok(placedOk, 'филворд: слова записаны в сетке в нужном направлении');
  ok(noExtra, 'филворд: нет лишних вхождений целевых слов');
  ok(inGrid, 'филворд: сетка 10×10');
  // категории и совпадение длины в ряду
  const byKey = new Map();
  for (const s of r.stimuli.filter((x) => x.color === 'bw')) {
    const k = `${s.orientation}-${s.slot}`;
    byKey.set(k, [...(byKey.get(k) || []), s.targets.map((w) => w.len).join(',')]);
  }
  ok([...byKey.values()].every((arr) => new Set(arr).size === 1), 'филворд: слова разных категорий в ряду одной длины');
  const bw = r.stimuli.find((s) => s.color === 'bw'); const col = r.stimuli.find((s) => s.color === 'color' && s.slot === bw.slot && s.orientation === bw.orientation && s.category === bw.category);
  ok(JSON.stringify(bw.letters) === JSON.stringify(col.letters), 'филворд: буквы ч/б и цветного варианта одинаковы');
  // зоны
  const one = generateVerbal(words, { seed: 9, perCombo: 9, orientations: ['horizontal'], useCategory: false });
  const zones = Array(9).fill(0);
  for (const s of one.stimuli) { const m = s.placements[0].cells[Math.floor(s.placements[0].cells.length / 2)]; zones[Math.min(2, Math.floor(m[0] / 10 * 3)) * 3 + Math.min(2, Math.floor(m[1] / 10 * 3))]++; }
  ok(Math.max(...zones) - Math.min(...zones) <= 2, `филворд: целевые слова по зонам ${zones}`);
  const nb = generateVerbal(words, { seed: 4, allowBorder: false, perCombo: 3 });
  ok(nb.stimuli.every((s) => s.placements.every((p) => p.cells.every(([a, b]) => a > 0 && b > 0 && a < 9 && b < 9))), 'филворд: без касания внешних стен');
  const lo = generateVerbal(words, { seed: 4, distractors: 'letters' });
  ok(lo.stimuli.every((s) => s.letters.every((row) => row.every((ch) => /\p{L}/u.test(ch)))), 'филворд: только буквы');
}

/* ---------- различия ---------- */
{
  const r = generateDiff({ seed: 3, objectTypes: ['letters', 'numbers'], arrangements: ['grid', 'random'] });
  ok(r.series.length === 2 * 2 * 4, `различия: серий ${r.series.length}`);
  let good = true; let uniq = true; let seq = true; let dist = true;
  for (const s of r.series) {
    if (s.frames.length !== 6) good = false;
    s.frames.forEach((fr, i) => {
      if (new Set(fr.values).size !== s.N) uniq = false;
      if (i > 0) {
        const diffIdx = fr.values.map((v, k) => (v !== s.frames[i - 1].values[k] ? k : -1)).filter((k) => k >= 0);
        if (diffIdx.length !== 1 || diffIdx[0] !== fr.changed) good = false;
        if (i > 1 && fr.changed === s.frames[i - 1].changed) seq = false;
      }
    });
    for (let a = 0; a < s.N; a++) for (let b = a + 1; b < s.N; b++) if (Math.hypot(s.positions[a].x - s.positions[b].x, s.positions[a].y - s.positions[b].y) < 100) dist = false;
  }
  ok(good, 'различия: на каждом следующем кадре меняется ровно один объект');
  ok(uniq, 'различия: объекты на экране не повторяются');
  ok(seq, 'различия: подряд не меняется один и тот же объект');
  ok(dist, 'различия: объекты не налезают друг на друга');
  const names = new Set(r.series.flatMap((s) => s.stimuli.map((x) => x.name)));
  ok(names.size === r.series.length * 6, 'различия: имена уникальны');
  const g = r.series.find((s) => s.arrangement === 'grid' && s.N === 6);
  ok(new Set(g.positions.map((p) => Math.round(p.y))).size === 2, 'различия: 6 объектов по сетке — 2 строки');
}

/* ---------- траектории ---------- */
{
  const rows = buildRows({});
  ok(rows.length === 16, 'траектории: по умолчанию 16 стимулов (с фиксированным и разным расстоянием)');
  const st = generateTrails(rows, { width: 1920, height: 1080, seed: 1 });
  ok(new Set(st.map((s) => s.name)).size === 16, 'траектории: имена уникальны');
  let good = true;
  for (const s of st) {
    const items = s.layout.items;
    if (items.length !== 15 || s.layout.rows !== 3) good = false;
    const d = items.filter((i) => i.isDistractor);
    if (s.spec.distractor === 'none' ? d.length !== 0 : d.length !== 1) good = false;
    if (d.some((i) => i.value === 1 || i.value === 15)) good = false;
    if (d.some((i) => i.kind !== 'letter' || i.text !== 'А')) good = false;
    if (new Set(items.map((i) => i.row)).size !== 3) good = false;
    const ys = [...new Set(items.filter((i) => i.row === 1).map((i) => Math.round(i.y)))];
    if (s.spec.arrangement === 'straight' ? ys.length !== 1 : ys.length !== 2) good = false;
  }
  ok(good, 'траектории: 15 чисел в 3 строки, дистрактор не вместо 1 и 15, прямая/зигзаг');
  const a = st.find((s) => s.spec.arrangement === 'straight' && s.spec.direction === 'ascending' && s.spec.distractor === 'none' && s.spec.spacing === 'fixed');
  const b = st.find((s) => s.spec.arrangement === 'straight' && s.spec.direction === 'descending' && s.spec.distractor === 'none' && s.spec.spacing === 'fixed');
  ok(JSON.stringify(a.layout.items) === JSON.stringify(b.layout.items), 'траектории: направление не меняет расположение чисел');
  const v = layoutTrail({ n: 15, rows: 3, arrangement: 'straight', distractor: 'none', spacing: 'varied', dCount: 0 }, { width: 1920, height: 1080, spread: 0.4 }, makeRng(2));
  const xs = v.items.filter((i) => i.row === 1).map((i) => i.x).sort((p, q) => p - q);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  ok(Math.max(...gaps) - Math.min(...gaps) > 30, 'траектории: «разное» расстояние действительно неравномерное');
  const rec = layoutTrail({ n: 15, rows: 3, arrangement: 'straight', distractor: 'recolor', spacing: 'fixed', dCount: 2 }, { width: 1920, height: 1080 }, makeRng(3));
  ok(rec.items.filter((i) => i.kind === 'recolored').length === 2 && rec.items.every((i) => i.text !== ''), 'траектории: число другого цвета остаётся числом');
}

process.exit(fails ? 1 : 0);
