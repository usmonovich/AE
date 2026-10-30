// E2E: приложение открыто как артефакт claude.ai, память браузера при каждом входе пустая
// (так ведёт себя мобильное приложение Claude). Решения проверки и прогресс должны сохраняться
// в базе артефакта. База и пользователь имитируются: тот же интерфейс, что у window.claude.use().
// Работает на тестовых предметах tests/fixtures/content: «Предмет А» (#/ta/…) и «Предмет Б» (#/tb/…).
// Запуск: npm run build:test && (node tools/serve.mjs &) && node tests/e2e/cloud.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE ?? 'http://localhost:4173/';
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); }
}

// Общая «база артефакта» на стороне теста — переживает перезагрузки и разные устройства.
const docs = new Map();

/** Имитация window.claude: db (get/set/delete/onSnapshot через опрос) и user. */
function runtimeScript({ uid, owner }) {
  // память браузера пустая при каждом входе
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* */ }
  const call = (op, path, data) => window.__dbCall(op, path, data ? JSON.stringify(data) : null).then((r) => (r ? JSON.parse(r) : null));
  const snap = (d) => ({ exists: !!d, data: () => d ?? undefined, metadata: { fromCache: false, hasPendingWrites: false } });
  const db = Object.freeze({
    doc: (path) => ({
      path,
      get: async () => snap(await call('get', path)),
      set: async (d) => { await call('set', path, d); },
      delete: async () => { await call('delete', path); },
      onSnapshot: (next) => {
        let last = '';
        const t = setInterval(async () => { const d = await call('get', path); const s = JSON.stringify(d); if (s !== last) { last = s; next(snap(d)); } }, 300);
        return () => clearInterval(t);
      },
    }),
  });
  const user = Object.freeze({ id: async () => uid, isOwner: async () => owner, canEdit: async () => owner });
  window.claude = Object.freeze({ use: async (name) => (name === 'db' ? db : name === 'user' ? user : null) });
}

const browser = await chromium.launch();
async function device({ uid, owner }) {
  const ctx = await browser.newContext({ viewport: { width: 380, height: 800 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.exposeFunction('__dbCall', async (op, path, data) => {
    // правило артефакта: общие документы ae/… пишет только владелец; личное — только сам человек
    if (op === 'set' || op === 'delete') {
      if (path.startsWith('ae/') && !owner) throw Object.assign(new Error('denied'), { code: 'invalid_argument' });
      if (path.startsWith('data/users/') && !path.startsWith(`data/users/${uid}/`)) throw Object.assign(new Error('denied'), { code: 'invalid_argument' });
    }
    if (op === 'get') {
      if (path.startsWith('data/users/') && !path.startsWith(`data/users/${uid}/`)) return null;
      return docs.has(path) ? JSON.stringify(docs.get(path)) : null;
    }
    if (op === 'set') docs.set(path, JSON.parse(data));
    if (op === 'delete') docs.delete(path);
    return null;
  });
  await ctx.addInitScript(runtimeScript, { uid, owner });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const go = async (h) => { await page.goto(BASE + '#/' + h); await page.waitForSelector('#main:not([aria-busy])', { timeout: 15000 }); await page.waitForTimeout(300); };
  return { ctx, page, go, errors };
}
const approvedText = async (page) => (await page.locator('.stat-grid').innerText()).replace(/\s+/g, ' ');

// ── телефон владельца ──
const phone = await device({ uid: 'u-owner', owner: true });
const A = 14; // вопросов в предмете А
const MOTION = 12; // из них в подразделе «Скорость и ускорение»
const pin = async (page) => {
  if (await page.locator('#pin').count()) { await page.fill('#pin', '1234'); await page.click('#pin-submit'); await page.waitForSelector('#pin', { state: 'detached', timeout: 10000 }); }
};
const bulkApprove = async (page) => {
  await page.check('#rq-all');
  await page.click('#bulk-approve');
  await page.getByRole('dialog').getByRole('button', { name: 'Утвердить' }).click();
  await page.waitForTimeout(1500);
};
const shared = (prefix) => JSON.stringify([...docs].filter(([k]) => k === prefix || k.startsWith(prefix + '/')));

await step('Владелец: входит по своему PIN и утверждает вопросы подраздела — статус «сохранено в базе»', async () => {
  const { page, go } = phone;
  await go('ta/admin');
  assert.equal(await page.locator('#pin2').count(), 0, 'создать свой PIN нельзя — только ввести PIN владельца');
  await pin(page);
  await go('ta/admin/review');
  await page.selectOption('#rq-sub', 'ta-motion');
  await bulkApprove(page);
  const st = await page.locator('#save-state-admin').innerText();
  assert.match(st, /сохранены в базе артефакта/, st);
  assert.ok(docs.has('ae/alpha/admin'), 'общий документ решений предмета создан');
  assert.ok(!shared('ae').includes('pinHash'), 'PIN не попадает в общие документы');
});

await step('Повторный вход с пустой памятью: решения на месте, PIN не нужно создавать заново', async () => {
  const { page, go } = phone;
  await page.reload(); // init-скрипт снова очищает localStorage и sessionStorage
  await go('ta/admin');
  assert.equal(await page.locator('#pin2').count(), 0, 'должен спрашивать существующий PIN, а не создавать новый');
  await pin(page);
  assert.match(await approvedText(page), new RegExp(`${MOTION}\\s*/\\s*${A}`));
});

await step('Прогресс ученика и общие настройки сохраняются после повторного входа', async () => {
  const { page, go } = phone;
  await go('ta/topic/ta-accel');
  await page.getByRole('button', { name: /Отметить тему как изученную/ }).click();
  await go('ta/settings');
  await page.getByRole('tab', { name: 'Тёмная' }).click();
  await page.waitForTimeout(1500);
  await page.reload();
  await go('ta/topic/ta-accel');
  assert.ok(await page.getByRole('button', { name: /Изучено — снять отметку/ }).isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.ok(docs.has('data/users/u-owner/alpha') && docs.has('data/users/u-owner/settings'));
});

// ── другое устройство того же владельца ──
const laptop = await device({ uid: 'u-owner', owner: true });
await step('Другое устройство владельца видит те же решения, прогресс и настройки', async () => {
  const { page, go } = laptop;
  await go('ta/admin');
  await pin(page);
  assert.match(await approvedText(page), new RegExp(`${MOTION}\\s*/\\s*${A}`));
  await go('ta/topic/ta-accel');
  assert.ok(await page.getByRole('button', { name: /Изучено — снять отметку/ }).isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
});

await step('Изменение на одном устройстве появляется на другом без перезагрузки', async () => {
  await laptop.go('ta/admin/review');
  await bulkApprove(laptop.page);
  await phone.go('ta/admin');
  await pin(phone.page);
  await phone.page.waitForTimeout(1500);
  assert.match(await approvedText(phone.page), new RegExp(`${A}\\s*/\\s*${A}`));
});

await step('Предмет Б: решения и прогресс — в своих документах (ae/beta/admin, data/users/<id>/beta), предмет А не затронут', async () => {
  const { page } = phone;
  const alphaAdminBefore = shared('ae/alpha/admin');
  const alphaUserBefore = JSON.stringify(docs.get('data/users/u-owner/alpha'));
  await page.goto(BASE + '#/tb/admin/review'); await page.waitForSelector('#main:not([aria-busy])'); await page.waitForTimeout(300);
  await pin(page);
  await bulkApprove(page);
  await page.goto(BASE + '#/tb/topic/tb-1-1-1'); await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Отметить тему как изученную/ }).click();
  await page.waitForTimeout(1500);
  assert.ok(docs.has('ae/beta/admin'), 'решения предмета Б — в общем документе ae/beta/admin');
  assert.ok(docs.has('data/users/u-owner/beta'), 'прогресс предмета Б — в личном документе');
  assert.equal(shared('ae/alpha/admin'), alphaAdminBefore, 'решения предмета А не изменились');
  assert.equal(JSON.stringify(docs.get('data/users/u-owner/alpha')), alphaUserBefore, 'прогресс предмета А не изменился');
  // новый вход с пустой памятью: предмет Б восстановлен из базы
  await page.reload(); await page.waitForSelector('#main:not([aria-busy])'); await page.waitForTimeout(300);
  await page.goto(BASE + '#/tb/topic/tb-1-1-1'); await page.waitForTimeout(400);
  assert.ok(await page.getByRole('button', { name: /Изучено — снять отметку/ }).isVisible());
  await page.goto(BASE + '#/tb/admin'); await page.waitForTimeout(400);
  await pin(page);
  assert.match(await approvedText(page), /3\s*\/\s*3/);
});

// ── одногруппник, которому открыли артефакт ──
const guest = await device({ uid: 'u-guest', owner: false });
await step('Не владелец видит утверждённые вопросы, но не может менять общую базу', async () => {
  const { page, go } = guest;
  await go('ta/test');
  assert.ok(!(await page.locator('#start-test').isDisabled()), 'тест доступен по утверждённым вопросам');
  assert.notEqual(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'настройки владельца гостю не передаются');
  await go('ta/admin');
  assert.equal(await page.locator('#pin2').count(), 0, 'свой PIN задать нельзя');
  await page.fill('#pin', '5555');
  await page.click('#pin-submit'); await page.waitForTimeout(1500);
  assert.match(await page.locator('.notice').last().innerText(), /Неверный PIN/);
  // даже зная PIN, не владелец артефакта не может изменить общую базу
  await pin(page);
  await go('ta/admin/review');
  await page.getByRole('tab', { name: /Теория/ }).click();
  const before = shared('ae/alpha/admin');
  await bulkApprove(page);
  assert.equal(shared('ae/alpha/admin'), before, 'общая база не изменилась');
  assert.match(await page.locator('#save-state-admin').innerText(), /только владелец/);
});

await step('Нет ошибок JavaScript', async () => {
  const all = [...phone.errors, ...laptop.errors, ...guest.errors];
  assert.equal(all.length, 0, all.join('; '));
});

await browser.close();
for (const r of results) console.log(r.join(' | '));
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - fails}/${results.length} пройдено`);
process.exit(fails ? 1 : 0);
