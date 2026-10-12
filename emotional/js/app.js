/* ============================================================
   app.js — навигация, справка, запуск модулей
   ============================================================ */

import { $, $$ } from '../../shared/js/common/ui.js';
import { initImagesGenerator } from './images/ui.js';
import { initWordsGenerator } from './words/ui.js';
import { initAnalysisStubs } from './analysis-stub.js';
import { HELP, HELP_TABS } from './help.js';

const PANELS = ['home', 'img-gen', 'img-an', 'word-gen', 'word-an'];

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
  $('#helpNav').innerHTML = HELP_TABS.map(([id, label]) => `<button class="modal-tab" data-help="${id}" type="button">${label}</button>`).join('');
  const show = (id) => {
    $$('.modal-tab', modal).forEach((t) => t.classList.toggle('active', t.dataset.help === id));
    $('#helpBody').innerHTML = `<div class="help-section active">${HELP[id]}</div>`;
    $('#helpBody').scrollTop = 0;
  };
  $('#helpBtn').addEventListener('click', () => { modal.hidden = false; show('h-img'); });
  $$('[data-close]', modal).forEach((el) => el.addEventListener('click', () => { modal.hidden = true; }));
  $$('.modal-tab', modal).forEach((t) => t.addEventListener('click', () => show(t.dataset.help)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });
}

window.addEventListener('hashchange', route);
initImagesGenerator();
initWordsGenerator();
initAnalysisStubs();
initHelp();
route();
