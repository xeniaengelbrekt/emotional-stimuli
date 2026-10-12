/* ============================================================
   app.js — навигация, справка, запуск модулей
   ============================================================ */

import { $, $$ } from './common/ui.js';
import { initRotation } from './modules/rotation/ui.js';
import { initVerbal } from './modules/verbal/ui.js';
import { initDiff } from './modules/diff/ui.js';
import { initTrails } from './modules/trails/ui.js';
import { initAnalysis } from './analysis-cognitive.js';
import { HELP, HELP_TABS } from './help-cognitive.js';

const PANELS = ['home', 'rot', 'verbal', 'diff', 'trails', 'analysis'];

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
  };
  const current = () => ({ rot: 'h-rot', verbal: 'h-verbal', diff: 'h-diff', trails: 'h-trails', analysis: 'h-out' }[location.hash.replace('#', '')] || 'h-rot');
  $('#helpBtn').addEventListener('click', () => { modal.hidden = false; show(current()); });
  $$('[data-close]', modal).forEach((el) => el.addEventListener('click', () => { modal.hidden = true; }));
  $$('.modal-tab', modal).forEach((t) => t.addEventListener('click', () => show(t.dataset.help)));
  $('#helpNav').addEventListener('click', (e) => { const b = e.target.closest('.modal-tab'); if (b) show(b.dataset.help); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });
}

window.addEventListener('hashchange', route);
initRotation();
initVerbal();
initDiff();
initTrails();
initAnalysis();
initHelp();
route();
