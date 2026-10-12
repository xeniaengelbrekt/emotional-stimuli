// Скачивает структуру публичных форм Яндекс Форм (вопросы и ссылки на картинки) в JSON.
// Использование: node tools/fetch_form_structures.mjs <папка_вывода> <url> [<url> …]
import { chromium } from 'playwright';
import fs from 'fs';
const [out, ...urls] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch();
for (const url of urls) {
  const p = await (await b.newContext()).newPage();
  let body = null;
  p.on('response', async (r) => { if (/getSurvey/.test(r.url())) body = await r.text(); });
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(1500);
  if (!body) { console.log('НЕТ ДАННЫХ', url); continue; }
  const d = JSON.parse(body);
  fs.writeFileSync(`${out}/${d.id}.json`, body);
  console.log(d.name, d.id);
  await p.close();
}
await b.close();
