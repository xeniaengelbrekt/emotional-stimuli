import { generateWordStimuli, gridFor, balanceReport, checkFeasibility } from '../js/modules/words/generator.js';
import { EMOTION_KEYS } from '../js/common/emotions.js';
import { makeRng } from '../js/common/rng.js';

function synth(per, seed = 2) {
  const r = makeRng(seed); const ws = []; let n = 0;
  for (const c of EMOTION_KEYS) for (let i = 0; i < per; i++) {
    const len = 3 + r.int(9);
    ws.push({ id: 'w' + n, word: 'w' + n++, category: c, len, freq: Math.exp(r.range(-2, 5)), ratings: {} });
  }
  return ws;
}
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

console.log([20, 30, 40].map((n) => JSON.stringify(gridFor(n, 1920, 900))).join(' '));
{
  const res = generateWordStimuli(synth(200), { seed: 4 });
  ok(res.built === 24 && !res.warnings.length, `24 стимула (${res.built}) ${res.warnings}`);
  const ids = res.stimuli.flatMap((s) => [s.target, ...s.distractors].map((w) => w.id));
  ok(new Set(ids).size === ids.length, 'слова не повторяются');
  ok(res.stimuli.every((s) => 1 + s.distractors.length === s.N && s.cells.length === s.N), 'размер = N');
  ok(res.stimuli.filter((s) => s.type === 'control').every((s) => [s.target, ...s.distractors].every((w) => w.category === s.category)), 'контроль: одна категория');
  const exp = res.stimuli.filter((s) => s.type === 'experimental');
  ok(exp.every((s) => s.target.category === s.category && s.distractors.every((w) => w.category !== s.category)), 'эксперимент: дистракторы чужие');
  ok(exp.every((s) => { const c = {}; s.distractors.forEach((w) => { c[w.category] = (c[w.category] || 0) + 1; }); const v = Object.values(c); return v.length === 3 && Math.max(...v) - Math.min(...v) <= 1; }), 'дистракторы поровну по 3 категориям');
  ok(new Set(res.stimuli.map((s) => s.name)).size === 24, 'имена уникальны: ' + res.stimuli.slice(0, 2).map((s) => s.name) + ' ' + exp[0].name);
  // позиции целей: для каждого уровня разные ячейки
  for (const N of [20, 30, 40]) {
    const cells = res.stimuli.filter((s) => s.N === N).map((s) => s.targetCell);
    ok(new Set(cells).size === cells.length, `уровень ${N}: цели в разных ячейках ${cells}`);
  }
  const big = generateWordStimuli(synth(800), { seed: 4 });
  const rep = balanceReport(big.stimuli);
  ok(rep.every((r) => r.anova && r.anova.p > 0.05), 'длина/частота не различаются по категориям: ' + rep.map((r) => `${r.scope}/${r.metric}:${r.anova.p.toFixed(2)}`));
}
{
  const res = generateWordStimuli(synth(100), { seed: 4 });       // нужно 180
  ok(res.warnings.length > 0 && res.built < 24, `мало слов → предупреждение (${res.built}/24)`);
}
{
  const res = generateWordStimuli(synth(45), { seed: 4, allowRepeats: true });
  ok(res.built === 24 && !res.warnings.length, 'с повторами 45 слов в категории хватает');
}
{
  const res = generateWordStimuli(synth(200), { seed: 4, distractorMode: 'all' });
  const e = res.stimuli.find((s) => s.type === 'experimental' && s.N === 40);
  const c = {}; [e.target, ...e.distractors].forEach((w) => { c[w.category] = (c[w.category] || 0) + 1; });
  ok(res.built === 24 && Object.values(c).every((v) => v === 10), 'режим all: по 10 слов из 4 категорий ' + JSON.stringify(c));
}
{
  // словоформы одного слова («тактика — тактики») в одном стимуле не допускаются
  const r = makeRng(9); const ws = []; let n = 0;
  const L = 'абвгдежзиклмнопрстуф';
  for (const c of EMOTION_KEYS) for (let i = 0; i < 60; i++) {
    const stem = Array.from({ length: 6 }, () => L[r.int(L.length)]).join('');
    for (const end of ['а', 'ы']) ws.push({ id: 'f' + n, word: stem + end, category: c, len: 7, freq: 50, ratings: {}, n: n++ });
  }
  const res = generateWordStimuli(ws, { seed: 3, levels: [20] });
  const clash = res.stimuli.filter((st) => { const all = [st.target, ...st.distractors].map((w) => w.word.slice(0, 6)); return new Set(all).size !== all.length; });
  ok(res.built > 0 && clash.length === 0, `слова: словоформы не попадают в один стимул (стимулов ${res.built}, с конфликтами ${clash.length})`);
}
process.exit(fails ? 1 : 0);
