// Шаг 2 импорта: распознавание рукописных страниц vision-моделью Claude → транскрипт content/subjects/<предмет>/transcript/*.md.
// ВНИМАНИЕ: в среде разработки не запускался (нет ключа API). Перед массовым запуском проверьте на 2–3 страницах.
// Использование: ANTHROPIC_API_KEY=... node tools/import/transcribe.mjs content/subjects/<предмет>/pages/ocr > content/subjects/<предмет>/transcript/new-file.md
// Ключ используется только на вашем компьютере и никогда не попадает в приложение.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const key = process.env.ANTHROPIC_API_KEY;
const model = process.env.MODEL ?? 'claude-sonnet-5-5';
const maxPages = Number(process.env.MAX_PAGES ?? 500);
if (!dir || !key) { console.error('Нужны: папка с изображениями и ANTHROPIC_API_KEY'); process.exit(1); }

const PROMPT = `Это фотография страницы учебного материала (конспект, лекция или слайд). Перепиши её содержимое ДОСЛОВНО, на языке оригинала.
Правила: формулы — в LaTeX внутри $...$; формулы в рамке помечай «(в рамке)»; рисунки описывай в квадратных скобках;
неразборчивое помечай [?]; ничего не добавляй от себя и не исправляй ошибки автора — если видишь вероятную ошибку,
добавь отдельную строку «⚠ ВОЗМОЖНАЯ ОШИБКА: …». Даты лекций сохраняй.`;

const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort().slice(0, maxPages);
for (const f of files) {
  const ref = path.parse(f).name;
  const data = fs.readFileSync(path.join(dir, f)).toString('base64');
  const media = f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: media, data } }, { type: 'text', text: PROMPT }] }] }),
  });
  if (!res.ok) { console.error(`${ref}: ошибка ${res.status} ${await res.text()}`); console.log(`## ${ref}\n- [НЕ РАСПОЗНАНО: ошибка API ${res.status}]\n`); continue; }
  const json = await res.json();
  console.log(`## ${ref}\n${json.content.map((c) => c.text ?? '').join('\n')}\n`);
  console.error(`${ref}: готово`);
}
