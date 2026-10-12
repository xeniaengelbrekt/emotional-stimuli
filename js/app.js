/* ============================================================
   app.js — главная, навигация, справка, запуск модулей
   ============================================================ */

import { $, $$ } from './common/ui.js';
import { initImagesGenerator } from './modules/images/ui.js';
import { initWordsGenerator } from './modules/words/ui.js';
import { initRotation } from './modules/rotation/ui.js';
import { initVerbal } from './modules/verbal/ui.js';
import { initDiff } from './modules/diff/ui.js';
import { initTrails } from './modules/trails/ui.js';
import { initAnalysis } from './analysis.js';
import { HELP, HELP_TABS, HELP_FOR_PAGE } from './help.js';

const METHODS = [
  { id: 'img', num: '01', title: 'Эмоционально окрашенные изображения' },
  { id: 'word', num: '02', title: 'Поиск эмоционально окрашенных слов' },
  { id: 'rot', num: '03', title: 'Плоскостное ментальное вращение' },
  { id: 'verbal', num: '04', title: 'Вербальное мышление (филворд)' },
  { id: 'diff', num: '05', title: 'Определение различий' },
  { id: 'trails', num: '06', title: 'Траектории' },
];
const PANELS = ['home', ...METHODS.flatMap((m) => [m.id, `${m.id}-an`])];

function renderHome() {
  $('#homeMethods').innerHTML = METHODS.map((m) => `
    <section class="method-block">
      <h3 class="method-title"><span class="method-num">${m.num}</span>${m.title}</h3>
      <div class="method-tiles">
        <a class="method-tile" href="#${m.id}">
          <span class="method-tile-name">Создание стимулов</span>
          <span class="method-tile-arrow">→</span>
        </a>
        <a class="method-tile method-tile-dev" href="#${m.id}-an">
          <span class="method-tile-name">Анализ движений глаз</span>
          <span class="dev-badge">в разработке</span>
        </a>
      </div>
    </section>`).join('');
}

function route() {
  const id = location.hash.replace('#', '');
  const key = PANELS.includes(id) ? id : 'home';
  $$('.mode-panel').forEach((p) => p.classList.toggle('active', p.id === `mode-${key}`));
  document.body.classList.toggle('on-home', key === 'home');
  $('#homeBtn').hidden = key === 'home';
  window.scrollTo({ top: 0 });
}

function initHelp() {
  const modal = $('#helpModal');
  $('#helpNav').innerHTML = HELP_TABS.map(([id, t]) => `<button class="modal-tab" data-help="${id}" type="button">${t}</button>`).join('');
  const show = (id) => {
    $$('.modal-tab', modal).forEach((t) => t.classList.toggle('active', t.dataset.help === id));
    $('#helpBody').innerHTML = `<div class="help-section active">${HELP[id]}</div>`;
    $('#helpBody').scrollTop = 0;
  };
  $('#helpBtn').addEventListener('click', () => { modal.hidden = false; show(HELP_FOR_PAGE[location.hash.replace('#', '')] || 'h-start'); });
  $$('[data-close]', modal).forEach((el) => el.addEventListener('click', () => { modal.hidden = true; }));
  $('#helpNav').addEventListener('click', (e) => { const b = e.target.closest('.modal-tab'); if (b) show(b.dataset.help); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });
}

window.addEventListener('hashchange', route);
renderHome();
initImagesGenerator();
initWordsGenerator();
initRotation();
initVerbal();
initDiff();
initTrails();
initAnalysis();
initHelp();
route();
