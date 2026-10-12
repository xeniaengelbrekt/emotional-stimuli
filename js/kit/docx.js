/* ============================================================
   docx.js — минимальный генератор Word-документа (.docx) без зависимостей.
   Документ = ZIP из XML-файлов (используем наш buildZip, метод STORE).

   Блоки (spec):
     { t: 'h1' | 'h2' | 'h3', text }
     { t: 'p', text }                 — абзац; **жирный**, //курсив//
     { t: 'ul', items: [text] }       — маркированный список
     { t: 'table', header: [..], rows: [[..]], widths?: [доли] }
     { t: 'pagebreak' }
   ============================================================ */

import { buildZip } from '../common/zip.js';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  // символы, недопустимые в XML 1.0
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** «обычный **жирный** и //курсив//» → <w:r>…</w:r> */
export function runsXml(text, base = '') {
  const parts = String(text ?? '').split(/(\*\*|\/\/)/);
  let bold = false; let ital = false;
  let out = '';
  for (const p of parts) {
    if (p === '**') { bold = !bold; continue; }
    if (p === '//') { ital = !ital; continue; }
    if (p === '') continue;
    const rpr = `${base}${bold ? '<w:b/>' : ''}${ital ? '<w:i/>' : ''}`;
    // переводы строк внутри текста → w:br
    const segs = p.split('\n');
    segs.forEach((seg, i) => {
      out += `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEsc(seg)}</w:t></w:r>`;
    });
  }
  return out || '<w:r><w:t></w:t></w:r>';
}

const para = (text, style, extra = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${runsXml(text)}</w:p>`;

function tableXml(b) {
  const cols = b.header ? b.header.length : (b.rows[0] || []).length;
  const total = 9638; // ширина области текста A4 с полями 2 см, twips
  const shares = b.widths && b.widths.length === cols ? b.widths : Array(cols).fill(1 / cols);
  const sum = shares.reduce((a, c) => a + c, 0);
  const widths = shares.map((s) => Math.round((s / sum) * total));
  const cell = (txt, w, head) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E6E6"/>' : ''}</w:tcPr>` +
    `<w:p><w:pPr><w:pStyle w:val="TableText"/></w:pPr>${runsXml(txt, head ? '<w:b/>' : '')}</w:p></w:tc>`;
  const rows = [];
  if (b.header) rows.push(`<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.header.map((h, i) => cell(h, widths[i], true)).join('')}</w:tr>`);
  for (const r of b.rows) rows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cell(c, widths[i], false)).join('')}</w:tr>`);
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${total}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p>`;
}

export function documentXml(blocks) {
  let body = '';
  for (const b of blocks) {
    if (b.t === 'h1') body += para(b.text, 'Heading1');
    else if (b.t === 'h2') body += para(b.text, 'Heading2');
    else if (b.t === 'h3') body += para(b.text, 'Heading3');
    else if (b.t === 'p') body += para(b.text, 'Normal');
    else if (b.t === 'ul') for (const it of b.items) body += para(it, 'ListBullet', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    else if (b.t === 'table') body += tableXml(b);
    else if (b.t === 'pagebreak') body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
}

const FONT = 'Times New Roman';
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="both"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="808080"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="567" w:hanging="283"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;

/** Возвращает Uint8Array с .docx. */
export function buildDocx(blocks) {
  const enc = new TextEncoder();
  const f = (name, text) => ({ name, data: enc.encode(text) });
  return buildZip([
    f('[Content_Types].xml', contentTypes),
    f('_rels/.rels', rootRels),
    f('word/document.xml', documentXml(blocks)),
    f('word/styles.xml', stylesXml),
    f('word/numbering.xml', numberingXml),
    f('word/_rels/document.xml.rels', docRels),
  ]);
}
