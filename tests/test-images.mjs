import { generateImageStimuli, checkFeasibility, GROUP_KEYS, POSITIONS, parseGroup, groupFromFilename, balanceReport } from '../js/images/generator.js';
import { EMOTION_KEYS } from '../js/common/emotions.js';
import { makeRng } from '../js/common/rng.js';

function synth(perCell, seed = 5) {
  const r = makeRng(seed); const items = [];
  for (const g of GROUP_KEYS) for (const c of EMOTION_KEYS) for (let i = 0; i < perCell; i++)
    items.push({ id: `${g}_${c}_${i}`, name: `${g}_${c}_${i}.jpg`, group: g, category: c,
      sal: { mean: r.range(0.2, 0.5), entropy: r.range(4, 5.5), center_bias: r.range(0.8, 1.6), spread_pct: r.range(5, 30) } });
  return items;
}
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

// 1. По умолчанию: 16 контрольных + 16 экспериментальных, без повторов
{
  const items = synth(8);
  const res = generateImageStimuli(items, { seed: 3 });
  ok(res.built === 32 && res.warnings.length === 0, `32 стимула без предупреждений (${res.built}, ${res.warnings})`);
  const ids = res.stimuli.flatMap((s) => s.layout.map((c) => c.itemId));
  ok(new Set(ids).size === ids.length, 'изображения не повторяются');
  ok(res.stimuli.filter((s) => s.type === 'control').every((s) => new Set(s.layout.map((c) => c.category)).size === 1), 'контрольные: одна категория');
  ok(res.stimuli.filter((s) => s.type === 'experimental').every((s) => new Set(s.layout.map((c) => c.category)).size === 4), 'эксперим.: 4 категории');
  ok(res.stimuli.every((s) => s.items.every((it) => it.group === s.group)), 'внутри стимула одна группа');
  // баланс позиций
  const cnt = Object.fromEntries(EMOTION_KEYS.map((c) => [c, [0, 0, 0, 0]]));
  for (const s of res.stimuli.filter((x) => x.type === 'experimental')) for (const c of s.layout) cnt[c.category][POSITIONS.indexOf(c.pos)]++;
  const flat = Object.values(cnt).flat();
  ok(Math.max(...flat) - Math.min(...flat) <= 1, `позиции сбалансированы ${JSON.stringify(cnt)}`);
  for (const g of GROUP_KEYS) {
    const lay = res.stimuli.filter((s) => s.type === 'experimental' && s.group === g).map((s) => s.layout.map((c) => c.category + c.pos).sort().join());
    ok(new Set(lay).size === lay.length, `${g}: раскладки не повторяются`);
  }
  const names = res.stimuli.map((s) => s.name);
  ok(new Set(names).size === names.length && names.every((n) => /^[A-Za-z0-9_-]+$/.test(n)), 'имена уникальны и латиницей');
  console.log(names.slice(0, 3), names.slice(-2));
}
// 2. Без повторов не хватает → предупреждение
{
  const items = synth(5);       // нужно 4*1+4 = 8 на ячейку
  ok(!checkFeasibility(items, {}).ok, 'checkFeasibility ругается');
  const res = generateImageStimuli(items, { seed: 1 });
  ok(res.warnings.length > 0 && res.built < res.requested, `предупреждение и частичный результат (${res.built}/${res.requested})`);
}
// 3. С повторами хватает и 4 в ячейке
{
  const items = synth(4);
  const res = generateImageStimuli(items, { seed: 1, allowRepeats: true });
  ok(res.built === 32 && res.warnings.length === 0, `повторы разрешены: ${res.built} стимулов`);
  const used = new Map();
  for (const s of res.stimuli) for (const c of s.layout) used.set(c.itemId, (used.get(c.itemId) || 0) + 1);
  ok(Math.max(...used.values()) <= 3, `повторы равномерны (max ${Math.max(...used.values())})`);
}
// 4. Воспроизводимость и баланс салиентности
{
  const a = generateImageStimuli(synth(12), { seed: 9 }), b = generateImageStimuli(synth(12), { seed: 9 });
  ok(JSON.stringify(a.stimuli.map((s) => s.layout)) === JSON.stringify(b.stimuli.map((s) => s.layout)), 'seed воспроизводим');
  const rep = balanceReport(a.stimuli);
  ok(rep.every((r) => r.anova && r.anova.p > 0.05), 'категории не различаются по салиентности: ' + rep.map((r) => r.anova.p.toFixed(2)));
}
ok(parseGroup('Группа людей') === 'people' && groupFromFilename('animals_03.jpg') === 'animals' && groupFromFilename('Предметы 12.png') === 'objects', 'parseGroup');
process.exit(fails ? 1 : 0);
