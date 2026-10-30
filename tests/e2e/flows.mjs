// E2E-сценарии в настоящем Chromium (Playwright) на тестовых предметах tests/fixtures/content:
// «Предмет А» (#/ta/…, материалы по страницам файлов) и «Предмет Б» (#/tb/…, учебник с оглавлением).
// Запуск: npm run build:test && (node tools/serve.mjs &) && node tests/e2e/flows.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const BASE = process.env.BASE ?? 'http://localhost:4173/';
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
const go = async (h) => { await page.goto(BASE + '#/ta/' + h); await page.waitForTimeout(250); };
const goB = async (h) => { await page.goto(BASE + '#/tb/' + h); await page.waitForTimeout(250); };
const TOTAL_A = 14; // вопросов в предмете А

await step('Стартовый экран AE: предметы из реестра, переход в каждый и обратно', async () => {
  await page.goto(BASE + '#/');
  await page.waitForTimeout(300);
  assert.ok(await page.getByRole('heading', { name: 'AE' }).isVisible());
  assert.equal(await page.locator('.subject-card').count(), 2);
  assert.equal(await page.locator('.tabbar').count(), 0, 'на стартовом экране нет вкладок предмета');
  await page.locator('.subject-alpha').click();
  await page.waitForTimeout(250);
  assert.ok(page.url().endsWith('#/ta'), page.url());
  assert.ok(await page.getByRole('heading', { name: 'Тестовый предмет А' }).isVisible());
  await page.getByText('Предметы').first().click();
  await page.waitForTimeout(250);
  await page.locator('.subject-beta').click();
  await page.waitForTimeout(250);
  assert.ok(page.url().endsWith('#/tb'), page.url());
  assert.ok(await page.getByRole('heading', { name: 'Тестовый предмет Б' }).isVisible());
  assert.equal(await page.title(), 'AE');
});
await step('Адрес без префикса предмета открывает стартовый экран', async () => {
  await page.goto(BASE + '#/topic/ta-speed');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.subject-card').count(), 2);
});

await step('Главная: обязательные пункты меню', async () => {
  await go('');
  for (const t of [/(Начать|Продолжить) обучение/, 'Все разделы: Предмет А', 'Тестирование', 'Повторение ошибок', 'Избранное', 'Мой прогресс', 'Настройки'])
    assert.ok(await page.getByText(t, { exact: false }).first().isVisible(), t);
  assert.match(await page.locator('.hero .eyebrow').innerText(), /1 файл · 3 страницы · 2 раздела/i);
});
await step('Просмотр разделов и всех тем', async () => {
  await go('library');
  assert.equal(await page.locator('a.row').count(), 2);
  let total = 0;
  for (const s of ['ta-motion', 'ta-units']) { await go('sub/' + s); total += await page.locator('ol.topics li').count(); }
  assert.equal(total, 3);
  await go('library');
  const titles = await page.locator('section.block h2').allInnerTexts();
  assert.ok(titles.indexOf('Кинематика') >= 0 && titles.indexOf('Кинематика') < titles.indexOf('Единицы измерения'), titles.join(' | '));
});
await step('Тема: теория, анимация, формулы с расшифровкой, источник открывает страницу', async () => {
  await go('topic/ta-speed');
  assert.ok(await page.getByText('Скорость равномерного движения — путь').isVisible());
  assert.ok(await page.locator('.anim-figure svg, figure svg').first().isVisible(), 'анимация показана');
  // запись с замечанием: студент видит исправленный текст без пометок
  assert.ok(await page.getByText('Путь — длина траектории, по которой двигалось тело.').isVisible());
  assert.equal(await page.getByText(/Замечание|Исправление/).count(), 0, 'замечаний в виде для студентов нет');
  await page.getByRole('tab', { name: /Формулы/ }).click();
  assert.ok(await page.locator('.formula .katex').count() >= 3);
  await page.locator('.source-chip').first().click();
  await page.waitForTimeout(300);
  assert.match(page.url(), /#\/ta\/page\/a01/);
  await page.waitForTimeout(500);
  assert.ok(await page.getByText(/изображения страниц материалов не публикуются/).isVisible(), 'вместо изображения — пояснение');
});
await step('Отметка «изучено» сохраняется после перезагрузки', async () => {
  await go('topic/ta-accel');
  await page.getByRole('button', { name: /Отметить тему как изученную/ }).click();
  await page.waitForTimeout(400);
  await page.reload(); await page.waitForTimeout(300);
  assert.ok(await page.getByRole('button', { name: /Изучено — снять отметку/ }).isVisible());
});
await step('Без утверждения вопросов тест недоступен', async () => {
  await go('test');
  assert.ok(await page.locator('#start-test').isDisabled());
});
await step('Админ: вход по PIN владельца (свой PIN задать нельзя) и массовое утверждение вопросов', async () => {
  await go('admin');
  assert.equal(await page.locator('#pin2').count(), 0, 'экрана создания PIN нет');
  await page.fill('#pin', '0000');
  await page.click('#pin-submit'); await page.waitForTimeout(1200);
  assert.match(await page.locator('.notice').last().innerText(), /Неверный PIN/);
  await page.fill('#pin', '1234');
  await page.click('#pin-submit'); await page.waitForSelector('#pin', { state: 'detached', timeout: 10000 });
  await go('admin/review');
  for (let i = 0; i < 40; i++) {
    const more = page.getByRole('button', { name: /Показать ещё/ });
    if (await more.count()) await more.click(); else break;
  }
  await page.check('#rq-all');
  await page.click('#bulk-approve');
  await page.getByRole('dialog').getByRole('button', { name: 'Утвердить' }).click();
  await page.waitForTimeout(300);
  await go('admin');
  const txt = await page.locator('.stat-grid').innerText();
  assert.match(txt, new RegExp(`${TOTAL_A}\\s*/${TOTAL_A}`));
});
await step('Админ: замечание к источнику видно только в админ-панели', async () => {
  await go('admin/errata');
  assert.ok(await page.getByText('ta-e1').first().isVisible());
  assert.ok(await page.getByText('путь — длина траектории').first().isVisible());
});
await step('Режим «По порядку»: первый вопрос курса — первый вопрос материалов', async () => {
  await go('test');
  await page.locator('label:has(#order-source)').click();
  await page.click('#start-test'); await page.waitForTimeout(300);
  assert.match(await page.locator('.qprompt').innerText(), /скоростью равномерного движения/i);
});
await step('Неверный ответ → подсказка → повтор → разбор; «Показать решение»', async () => {
  await go('test/topic/ta-speed');
  await page.click('#start-test'); await page.waitForTimeout(300);
  const wrong = page.locator('.option').filter({ hasNotText: 'Путь, пройденный за единицу времени' }).first();
  await wrong.click(); await page.click('#submit-answer');
  assert.ok(await page.locator('.hintbox').isVisible(), 'подсказка показана');
  await wrong.click(); await page.click('#submit-answer');
  assert.ok(await page.locator('.verdict.bad').isVisible());
  assert.ok(await page.getByText('Объяснение ответа').isVisible());
  await page.click('#next-question');
  await page.fill('input[inputmode=decimal]', '48');
  await page.click('#submit-answer');
  assert.ok(await page.locator('.verdict.ok').isVisible());
  assert.ok(await page.getByText('Подстановка и вычисление').isVisible());
  await page.click('#next-question');
  await page.getByRole('button', { name: 'Показать решение' }).click();
  assert.ok(await page.getByText('Решение показано').isVisible());
});
await step('Результаты и очередь ошибок', async () => {
  await page.getByRole('button', { name: /Завершить тест/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Завершить' }).click();
  await page.waitForTimeout(300);
  assert.match(page.url(), /#\/ta\/result\//);
  assert.ok(await page.locator('.score').isVisible());
  await go('mistakes');
  assert.ok((await page.locator('.list li').count()) >= 1);
});
await step('Режим «Случайный»: разные попытки — разный порядок', async () => {
  const firstOf = async () => { await go('test/sub/ta-motion'); await page.locator('label:has(#order-random)').click(); await page.click('#start-test'); await page.waitForTimeout(250); return page.locator('.qprompt').innerText(); };
  const seen = new Set();
  for (let i = 0; i < 6; i++) seen.add(await firstOf());
  assert.ok(seen.size >= 2, 'порядок меняется между попытками');
});
await step('Выбор количества: запрошено больше, чем есть — предупреждение', async () => {
  await go('test/topic/ta-speed');
  await page.fill('#q-count', '50');
  assert.ok(await page.getByText(/Запрошено 50, доступно 7/).first().isVisible());
});
await step('Экзамен: таймер, без подсказок', async () => {
  await go('test/exam'); await page.click('#start-test'); await page.waitForTimeout(300);
  assert.ok(await page.locator('.timer').isVisible());
  assert.equal(await page.getByRole('button', { name: 'Показать решение' }).count(), 0);
});
await step('Работа без интернета после загрузки', async () => {
  await go('topic/ta-accel');
  await ctx.setOffline(true);
  await page.getByRole('tab', { name: /Формулы/ }).click();
  assert.ok(await page.locator('.formula').count() > 0);
  await go('progress');
  assert.ok(await page.getByText('Доля верных ответов по дням').isVisible());
  await ctx.setOffline(false);
});
await step('Тёмная тема и крупный шрифт применяются', async () => {
  await go('settings');
  await page.getByRole('tab', { name: 'Тёмная' }).click();
  await page.getByRole('tab', { name: 'Крупный', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.notEqual(bg, 'rgb(245, 247, 251)');
  await page.waitForTimeout(400);
  const shared = await page.evaluate(() => JSON.parse(localStorage.getItem('ae.settings.v1')));
  assert.equal(shared.settings.theme, 'dark', 'настройки — в общем хранилище ae.settings.v1');
});
await step('Сброс прогресса только после подтверждения', async () => {
  await page.getByRole('button', { name: 'Сбросить прогресс' }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Сбросить' });
  assert.ok(await confirm.isDisabled(), 'без ввода слова кнопка заблокирована');
  await page.fill('#confirm-input', 'СБРОС'); await confirm.click(); await page.waitForTimeout(300);
  await go('progress');
  assert.match(await page.locator('.stat-grid').innerText(), /Пройдено тестов\s*0|0\s*Пройдено тестов/);
});
await step('Учебник: план курса по книге, пункты в порядке оглавления', async () => {
  await goB('library');
  assert.ok(await page.getByRole('heading', { name: 'План курса по книге' }).isVisible());
  assert.match(await page.locator('.block-head .muted').last().innerText(), /наполнено 1 из 3/);
  await goB('sub/tb-1-1');
  assert.equal(await page.locator('ol.topics li').count(), 1);
  assert.match(await page.locator('ol.topics li').first().innerText(), /1\.1\.1/);
  assert.equal(await page.locator('.plan-item').count(), 1, 'ненаполненный пункт 1.1.2 показан как «готовится»');
});
await step('Учебник: тема — место в книге, таблица, формулы «когда применять», пример с проверкой', async () => {
  await goB('topic/tb-1-1-1');
  assert.ok(await page.getByText(/Моя книга: Ч\. 1, 1\.1/).first().isVisible());
  assert.ok(await page.locator('.rich-table table').first().isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'настройки общие для предметов');
  await page.getByRole('tab', { name: /Формулы/ }).click();
  assert.ok(await page.getByText('Когда применять:').first().isVisible());
  assert.ok(await page.getByText('Обозначения:').first().isVisible());
  await page.getByRole('tab', { name: /Примеры/ }).click();
  assert.ok(await page.getByText('Проверка:').first().isVisible());
  assert.ok(await page.getByText('Метод:').first().isVisible());
  await page.locator('.book-chip').first().click();
  await page.waitForTimeout(300);
  assert.match(page.url(), /#\/tb\/page\/b003/);
  assert.equal(await page.locator('.page-frame img').count(), 0, 'страницы книги не встраиваются');
  assert.ok(await page.getByText(/авторским правом/).isVisible());
});
await step('Учебник: раздельные решения проверки и прогресс, общий вход в админ-панель', async () => {
  await goB('admin');
  assert.ok(await page.getByRole('heading', { name: /Админ-панель · Предмет Б/ }).isVisible(), 'PIN уже введён — повторно не нужен');
  await goB('admin/review');
  for (let i = 0; i < 50; i++) { const more = page.getByRole('button', { name: /Показать ещё/ }); if (await more.count()) await more.click(); else break; }
  await page.check('#rq-all');
  await page.click('#bulk-approve');
  await page.getByRole('dialog').getByRole('button', { name: 'Утвердить' }).click();
  await page.waitForTimeout(300);
  await goB('admin');
  assert.match(await page.locator('.stat-grid').innerText(), /3\s*\/3/, 'все вопросы предмета Б утверждены');
  await go('admin');
  assert.match(await page.locator('.stat-grid').innerText(), new RegExp(`${TOTAL_A}\\s*/${TOTAL_A}`), 'решения предмета А не изменились');
  await goB('topic/tb-1-1-1');
  await page.getByRole('button', { name: /Отметить тему как изученную/ }).click();
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({ b: JSON.parse(localStorage.getItem('ae.beta.user.v1')), a: JSON.parse(localStorage.getItem('ae.alpha.user.v1')) }));
  assert.ok(st.b.topicProgress['tb-1-1-1'].studiedAt, 'прогресс предмета Б сохранён');
  assert.ok(!Object.keys(st.a.topicProgress).some((k) => k.startsWith('tb-')), 'в прогрессе предмета А нет тем предмета Б');
  await page.goto(BASE + '#/'); await page.waitForTimeout(300);
  assert.match(await page.locator('.subject-beta').innerText(), /изучено 1/);
});
await step('Учебник: тест — неверный ответ → подсказка → повтор → пошаговое решение', async () => {
  await goB('test/topic/tb-1-1-1');
  await page.locator('label:has(#order-source)').click();
  await page.click('#start-test'); await page.waitForTimeout(300);
  assert.match(await page.locator('.qprompt').innerText(), /25/);
  await page.fill('input[inputmode=decimal]', '5'); await page.click('#submit-answer');
  assert.ok(await page.locator('.hintbox').isVisible(), 'сначала подсказка, а не решение');
  await page.fill('input[inputmode=decimal]', '7'); await page.click('#submit-answer');
  assert.ok(await page.locator('.verdict.bad').isVisible());
  assert.ok(await page.getByText('Метод:').first().isVisible());
  assert.ok(await page.locator('.solution ol.steps li').count() >= 2);
  await page.click('#next-question');
  await page.fill('input[inputmode=decimal]', '133'); await page.click('#submit-answer');
  assert.ok(await page.locator('.verdict.ok').isVisible());
});
await step('Нет горизонтальной прокрутки на 320/360/768 px', async () => {
  for (const w of [320, 360, 768]) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const [pre, h] of [['tb', ''], ['tb', 'library'], ['tb', 'topic/tb-1-1-1'], ['tb', 'topic/tb-1-1-1/formulas'], ['ta', ''], ['ta', 'topic/ta-speed/formulas'], ['ta', 'admin/review'], ['ta', 'progress']]) {
      await page.goto(`${BASE}#/${pre}/${h}`); await page.waitForTimeout(200);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 1, `${w}px #/${pre}/${h}: +${over}px`);
    }
    await page.goto(BASE + '#/'); await page.waitForTimeout(200);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1, `${w}px стартовый экран`);
  }
  await page.setViewportSize({ width: 360, height: 780 });
});
await step('Поиск по формулам и темам', async () => {
  await go('search'); await page.fill('#search-input', 'ускорен'); await page.waitForTimeout(200);
  assert.ok(await page.getByText(/Темы · /).isVisible());
});
await step('Нет ошибок JavaScript', async () => { assert.deepEqual(errors, []); });

await browser.close();
for (const r of results) console.log(r.join(' | '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} пройдено`);
process.exit(failed ? 1 : 0);
