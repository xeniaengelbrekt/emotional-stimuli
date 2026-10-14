import { generateRotation, describeOptions, summarizeOptions, OPTION_LOGIC, patternKey, applyOp, OPTION_SETS, TRANSFORM_KEYS } from '../js/modules/rotation/generator.js';
import { generateVerbal, findOccurrences, cleanWord } from '../js/modules/verbal/generator.js';
import { generateDiff } from '../js/modules/diff/generator.js';
import { buildRows, generateTrails, layoutTrail } from '../js/modules/trails/generator.js';
import { makeRng } from '../js/common/rng.js';

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
    for (let i = 0; i < 80; i++) {
      const len = 4 + rng.int(6);
      const w = Array.from({ length: len }, () => L[rng.int(L.length)]).join('');
      words.push({ id: c + i, word: w, len, freq: 5 + rng.next() * 300, ratings: { neutral: 1, positive: 1, sad: 1, threat: 1, [c]: 4 + rng.next() * 2 }, category: c });
    }
  }
  const catOf = new Map(words.map((w) => [cleanWord(w.word), w.category]));
  const check = (r, rows = 10, cols = 10) => {
    let placedOk = true; let noExtra = true; let inGrid = true;
    for (const s of r.stimuli) {
      for (const p of s.placements) {
        const word = p.cells.map(([a, b]) => s.letters[a][b]).join('');
        if (word !== p.word) placedOk = false;
        const sameLine = p.cells.every(([a, b]) => (s.orientation === 'horizontal' ? a === p.cells[0][0] : b === p.cells[0][1]));
        if (!sameLine) placedOk = false;
        if (findOccurrences(s.letters, rows, cols, p.word).length !== 1) noExtra = false;
      }
      if (s.letters.length !== rows || s.letters.some((row) => row.length !== cols)) inGrid = false;
    }
    return { placedOk, noExtra, inGrid };
  };
  const touching = (s) => {
    const owner = new Map();
    s.placements.forEach((p, i) => p.cells.forEach(([a, b]) => owner.set(`${a},${b}`, [...(owner.get(`${a},${b}`) || []), i])));
    for (const [k, v] of owner) { const [a, b] = k.split(',').map(Number); for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) { const o = owner.get(`${a + da},${b + db}`); if (o && o.some((x) => !v.includes(x))) return true; } }
    return false;
  };

  // по умолчанию: 4 слова из четырёх категорий, 2 направления, ч/б → 2 стимула
  const d = generateVerbal(words, { seed: 3 });
  ok(d.stimuli.length === 2 && d.stimuli.every((s) => s.targets.length === 4), `филворд по умолчанию: 2 стимула по 4 слова (${d.stimuli.length})`);
  ok(d.stimuli.every((s) => new Set(s.targets.map((w) => w.category)).size === 4), 'филворд: по умолчанию 4 слова из 4 разных категорий');
  const c1 = check(d); ok(c1.placedOk && c1.noExtra && c1.inGrid, 'филворд: слова на месте, нет лишних вхождений, сетка 10×10');
  ok(d.stimuli.every((s) => !touching(s)), 'филворд: по умолчанию слова не касаются и не пересекаются');
  // цветность в названии комбинации: 2 цветности удваивают стимулы
  const r = generateVerbal(words, { seed: 3, colors: ['bw', 'color'], perCombo: 2 });
  ok(r.stimuli.length === 2 * 2 * 2, `филворд: направл. × цветн. × 2 = ${r.stimuli.length}`);
  ok(new Set(r.stimuli.map((s) => s.name)).size === r.stimuli.length, 'филворд: имена уникальны');
  const bwS = r.stimuli.filter((x) => x.color === 'bw'); const colS = r.stimuli.filter((x) => x.color === 'color');
  ok(bwS.length === 4 && colS.length === 4, 'филворд: ч/б и цветных стимулов поровну');
  const wordsOf = (arr) => arr.flatMap((x) => x.targets.map((w) => w.id));
  const bwW = wordsOf(bwS); const colW = wordsOf(colS);
  ok(new Set([...bwW, ...colW]).size === bwW.length + colW.length, 'филворд: слова ч/б и цветных стимулов не повторяются (разные стимулы)');
  ok(new Set(r.stimuli.map((x) => JSON.stringify(x.letters))).size === r.stimuli.length, 'филворд: все сетки (ч/б и цветные) разные');
  // 8 слов: по 2 из каждой категории; число не кратное 4 округляется вверх с предупреждением
  const e8 = generateVerbal(words, { seed: 2, targetsPerStimulus: 8, orientations: ['horizontal'], allowTouch: true });
  ok(e8.stimuli[0].targets.length === 8 && [...new Set(e8.stimuli[0].targets.map((w) => w.category))].every((c) => e8.stimuli[0].targets.filter((w) => w.category === c).length === 2), 'филворд: 8 слов — по 2 из каждой категории');
  const e6 = generateVerbal(words, { seed: 2, targetsPerStimulus: 6, orientations: ['horizontal'], allowTouch: true });
  ok(e6.stimuli[0].targets.length === 8 && e6.warnings.some((w) => w.includes('кратно 4')), 'филворд: 6 слов → 8 с предупреждением о кратности 4');
  // одна категория: любое число слов, отдельные стимулы для категорий
  const one = generateVerbal(words, { seed: 5, composition: 'one', targetsPerStimulus: 3, orientations: ['horizontal'], perCombo: 2 });
  ok(one.stimuli.length === 4 * 2 && one.stimuli.every((s) => s.targets.length === 3 && new Set(s.targets.map((w) => w.category)).size === 1 && s.targets[0].category === s.category), 'филворд: из одной категории — 4 категории × 2 стимула по 3 слова');
  // без категорий
  const nc = generateVerbal(words, { seed: 5, useCategory: false, targetsPerStimulus: 3, orientations: ['vertical'] });
  ok(nc.stimuli.length === 1 && nc.stimuli[0].targets.length === 3, 'филворд: без учёта категорий — любое число слов');
  // повторы слов
  const used = (rr) => rr.stimuli.flatMap((s) => s.targets.map((w) => w.id));
  const small = words.filter((w) => w.id.endsWith('0') || w.id.endsWith('1') || w.id.endsWith('2'));      // по ~6 слов в категории (id вида c0, c10, c20…)
  const noRep = generateVerbal(words, { seed: 6, perCombo: 90, orientations: ['horizontal'] });
  ok(new Set(used(noRep)).size === used(noRep).length, 'филворд: без повторов все слова разные');
  ok(noRep.stimuli.length < 90 && noRep.warnings.some((w) => w.includes('Слов не хватает')), `филворд: без повторов слов не хватает → предупреждение (${noRep.stimuli.length} из 90)`);
  const rep = generateVerbal(words, { seed: 6, perCombo: 30, orientations: ['horizontal'], allowRepeats: true });
  ok(rep.stimuli.length === 30 && rep.stimuli.every((s) => new Set(s.targets.map((w) => w.id)).size === s.targets.length), 'филворд: с повторами — 30 стимулов, внутри стимула слова разные');
  // пересечения и касания
  const touch = generateVerbal(words, { seed: 8, perCombo: 4, orientations: ['horizontal'], allowTouch: true, allowOverlap: false });
  ok(touch.stimuli.length === 4 && check(touch).placedOk && check(touch).noExtra, 'филворд: касание разрешено — стимулы собраны');
  const ov = generateVerbal(words, { seed: 8, perCombo: 6, orientations: ['vertical'], allowTouch: true, allowOverlap: true });
  ok(check(ov).placedOk && check(ov).noExtra, 'филворд: пересечение разрешено — слова на месте, лишних вхождений нет');
  // слова не помещаются → предупреждение, а не ошибка
  const tight = generateVerbal(words, { seed: 1, rows: 6, cols: 6, targetsPerStimulus: 8, orientations: ['horizontal'] });
  ok(tight.stimuli.length === 0 && tight.warnings.some((w) => w.includes('не помещаются') || w.includes('Не удалось')), 'филворд: не помещаются в сетку 6×6 → предупреждение');
  // зоны
  const zonesRun = generateVerbal(words, { seed: 9, perCombo: 9, orientations: ['horizontal'], useCategory: false, targetsPerStimulus: 1, allowRepeats: true });
  const zones = Array(9).fill(0);
  for (const s of zonesRun.stimuli) { const m = s.placements[0].cells[Math.floor(s.placements[0].cells.length / 2)]; zones[Math.min(2, Math.floor(m[0] / 10 * 3)) * 3 + Math.min(2, Math.floor(m[1] / 10 * 3))]++; }
  ok(Math.max(...zones) - Math.min(...zones) <= 2, `филворд: целевые слова по зонам ${zones}`);
  const nb = generateVerbal(words, { seed: 4, allowBorder: false, perCombo: 3 });
  ok(nb.stimuli.every((s) => s.placements.every((p) => p.cells.every(([a, b]) => a > 0 && b > 0 && a < 9 && b < 9))), 'филворд: без касания внешних стен');
  const lo = generateVerbal(words, { seed: 4, distractors: 'letters' });
  ok(lo.stimuli.every((s) => s.letters.every((row) => row.every((ch) => /\p{L}/u.test(ch)))), 'филворд: только буквы');
  void catOf; void small;
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


/* ---------- различия: перемешивание ---------- */
{
  const r = generateDiff({ seed: 5, shuffle: true, counts: [6], objectTypes: ['letters'], arrangements: ['random'], frames: 8 });
  let good = true; let moved = false;
  for (const s of r.series) {
    s.frames.forEach((fr, i) => {
      if (new Set(fr.values).size !== s.N) good = false;
      if (i > 0) {
        const prev = s.frames[i - 1].values;
        const newOnes = fr.values.filter((v) => !prev.includes(v));
        if (newOnes.length !== 1 || fr.values[fr.changed] !== newOnes[0]) good = false;
        if (fr.values.some((v, k) => prev[k] !== v && prev.includes(v))) moved = true;
        if (new Set(fr.values.filter((v) => prev.includes(v))).size !== s.N - 1) good = false;
      }
    });
  }
  ok(good, 'различия с перемешиванием: на каждом экране ровно один новый объект, и changed указывает на него');
  ok(moved, 'различия с перемешиванием: старые объекты меняются местами');
  const plain = generateDiff({ seed: 5, counts: [6], objectTypes: ['letters'], arrangements: ['grid'] });
  ok(plain.series[0].frames.every((fr, i, a) => i === 0 || fr.values.every((v, k) => k === fr.changed || v === a[i - 1].values[k])), 'различия без перемешивания: места объектов не меняются');
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

{
  const base = { n: 15, rows: 3, arrangement: 'straight', distractor: 'none', spacing: 'fixed', dCount: 0 };
  const rowsY = (l) => [1, 2, 3].map((r) => l.items.find((i) => i.row === r).y);
  const auto = layoutTrail(base, { width: 1920, height: 1080 }, makeRng(1));
  const manual = layoutTrail({ ...base, rowStep: 150 }, { width: 1920, height: 1080 }, makeRng(1));
  const ya = rowsY(auto); const ym = rowsY(manual);
  ok(Math.abs((ya[1] - ya[0]) - 1080 * 0.64 / 3) < 1e-6, 'траектории: автоматическое расстояние между строками = высота рабочей области / число строк');
  ok(Math.abs((ym[1] - ym[0]) - 150) < 1e-6 && Math.abs((ym[2] - ym[1]) - 150) < 1e-6, 'траектории: расстояние между строками задаётся в пикселях');
  ok(Math.abs((ym[0] + ym[2]) / 2 - 1080 * 0.5) < 1e-6, 'траектории: блок строк центрируется по экрану');
  ok(manual.rowStep === 150 && buildRows({ rowStep: 120 }).every((r) => r.rowStep === 120), 'траектории: rowStep передаётся из общих настроек');
}

{
  const r = generateRotation({ seed: 1, perCombo: 1 });
  ok(new Set(r.stimuli.map((x) => patternKey(x.figure.cells))).size === r.stimuli.length, 'вращение: у ч/б и цветных вариантов (и всех заданий) разные фигуры');
}

{
  const r = generateRotation({ seed: 2, perCombo: 2 });
  const rowsAll = r.stimuli.flatMap(describeOptions);
  ok(rowsAll.length === r.stimuli.length * 4 && r.stimuli.every((st) => describeOptions(st).filter((x) => x.is_correct === 1).length === 1), 'вращение: для каждого стимула описано 4 варианта, верный один');
  ok(rowsAll.every((x) => x.error_logic && x.cells_shared_with_correct >= 0) && rowsAll.filter((x) => x.is_correct).every((x) => x.cells_shared_with_correct === x.n_cells), 'вращение: у каждого варианта есть описание логики; верный совпадает с собой');
  const sm = summarizeOptions(r.stimuli);
  ok(sm.length === 16 && sm.every((x) => OPTION_LOGIC[`${x.task}:${x.operation}`]), 'вращение: сводка — 4 задания × 4 типа вариантов');
}

process.exit(fails ? 1 : 0);
