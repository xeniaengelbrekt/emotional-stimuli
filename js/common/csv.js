/* ============================================================
   csv.js — разбор и запись CSV/TSV.
   Разделитель определяется автоматически (`;`, `,`, TAB),
   поддерживаются кавычки и десятичная запятая («3,5»).
   ============================================================ */

export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const firstEnd = text.search(/\r?\n/);
  const first = firstEnd === -1 ? text : text.slice(0, firstEnd);
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let q = false;
  for (const ch of first) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  let sep = ',';
  let max = -1;
  for (const k of Object.keys(counts)) if (counts[k] > max) { max = counts[k]; sep = k; }

  const records = parseRecords(text, sep).filter((r) => r.some((c) => c.trim() !== ''));
  if (!records.length) return { columns: [], rows: [], separator: sep };
  const columns = records[0].map((c) => c.trim());
  const rows = records.slice(1).map((r) => {
    const o = {};
    columns.forEach((c, i) => { o[c] = (r[i] ?? '').trim(); });
    return o;
  });
  return { columns, rows, separator: sep };
}

function parseRecords(text, sep) {
  const out = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      out.push(row); row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out;
}

/** Число с точкой или запятой; пусто / не число → null. */
export function parseNum(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-zа-яё0-9]/g, '');

/** Найти колонку по списку синонимов (сравнение без регистра и пунктуации). */
export function findColumn(columns, aliases) {
  const want = aliases.map(norm);
  for (const c of columns) if (want.includes(norm(c))) return c;
  return null;
}

function esc(v) {
  const s = v == null ? '' : String(v);
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Строки-объекты → текст CSV (разделитель `;`, чтобы Excel в русской локали открывал сразу). */
export function toCSV(rows, columns, sep = ';') {
  const cols = columns || Object.keys(rows[0] || {});
  const lines = [cols.map(esc).join(sep)];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(sep));
  return lines.join('\r\n') + '\r\n';
}
