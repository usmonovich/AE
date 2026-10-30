// E2E: настоящий реестр предметов content/subjects.json (сборка npm run build:test:subjects).
// Проверяет, что каждый предмет из реестра есть на стартовом экране, открывается по своему адресу
// и честно показывает своё состояние (пустой предмет — «курс готовится»), без ошибок и горизонтальной прокрутки.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:4173/';
const cfg = JSON.parse(fs.readFileSync(new URL('../../content/subjects.json', import.meta.url), 'utf8'));
const packs = Object.fromEntries(cfg.subjects.map((s) => [s.id, JSON.parse(fs.readFileSync(new URL(`../../content/subjects/${s.id}/pack.json`, import.meta.url), 'utf8'))]));
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await step(`Стартовый экран: ${cfg.subjects.length} предметов в порядке реестра`, async () => {
  await page.goto(BASE + '#/'); await page.waitForTimeout(300);
  assert.ok(await page.getByRole('heading', { name: cfg.app.title }).isVisible());
  const titles = await page.locator('.subject-card .subject-text b').allInnerTexts();
  assert.deepEqual(titles, cfg.subjects.map((s) => s.title));
  assert.equal(await page.title(), cfg.app.title);
});
for (const s of cfg.subjects) {
  const empty = packs[s.id].topics.length === 0;
  await step(`${s.emoji} ${s.short}: карточка, адрес #/${s.prefix}, ${empty ? '«курс готовится»' : 'темы'}`, async () => {
    await page.goto(BASE + '#/'); await page.waitForTimeout(200);
    const card = page.locator(`.subject-${s.id}`);
    if (empty) assert.match(await card.innerText(), /курс готовится/);
    await card.click(); await page.waitForTimeout(250);
    assert.ok(page.url().endsWith(`#/${s.prefix}`), page.url());
    assert.ok(await page.getByRole('heading', { name: s.title }).isVisible());
    if (empty) assert.ok(await page.getByText(/Курс готовится: материалы по предмету ещё не добавлены/).isVisible());
    await page.goto(`${BASE}#/${s.prefix}/library`); await page.waitForTimeout(200);
    await page.goto(`${BASE}#/${s.prefix}/settings`); await page.waitForTimeout(200);
    assert.ok(await page.getByText(`Сейчас открыт предмет «${s.title}»`).isVisible());
  });
}
await step('Нет горизонтальной прокрутки на 320/360/768 px', async () => {
  for (const w of [320, 360, 768]) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const h of ['', ...cfg.subjects.flatMap((s) => [s.prefix, `${s.prefix}/library`, `${s.prefix}/test`, `${s.prefix}/admin`])]) {
      await page.goto(`${BASE}#/${h}`); await page.waitForTimeout(150);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 1, `${w}px #/${h}: +${over}px`);
    }
  }
});
await step('Нет ошибок JavaScript', async () => { assert.deepEqual(errors, []); });

await browser.close();
for (const r of results) console.log(r.join(' | '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} пройдено`);
process.exit(failed ? 1 : 0);
