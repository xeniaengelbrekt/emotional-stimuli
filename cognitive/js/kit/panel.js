/* ============================================================
   panel.js — каркас панели модуля (заголовок, шаги, карточка настроек)
   ============================================================ */

export const panelHead = (num, title, desc) => `
  <header class="panel-header">
    <h2 class="panel-title"><span class="panel-num">${num}</span>${title}</h2>
    <p class="panel-desc">${desc}</p>
  </header>`;

export const stepTitle = (n, text) => `<h3 class="step-title"><span class="step-num">${n}</span>${text}</h3>`;

export const card = (inner) => `<div class="params-card">${inner}</div>`;
export const grid = (inner) => `<div class="form-grid">${inner}</div>`;
export const sep = () => '<div class="form-sep"></div>';
export const sub = (t) => `<h4 class="params-sub">${t}</h4>`;

export const generateBar = (prefix) => `
  <div class="toolbar tool-gap">
    <span class="toolbar-info" id="${prefix}-plan"></span>
    <span class="toolbar-spacer"></span>
    <button class="btn btn-primary" id="${prefix}-generate" type="button">◎ Сформировать стимулы</button>
  </div>
  <div class="busy-bar tool-gap" id="${prefix}-busy" hidden><span class="busy-spinner"></span><span id="${prefix}-busy-text"></span></div>
  <div id="${prefix}-feas"></div>
  <div id="${prefix}-results" hidden></div>`;

export const alertBox = (cls, html) => `<div class="alert ${cls}">${html}</div>`;
