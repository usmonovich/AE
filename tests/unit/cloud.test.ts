// Сохранение в базе артефакта: части большого документа, синхронизация хранилищ,
// и защита решений проверки от изменения записи после утверждения.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ChunkedDoc, syncStore } from '../../src/data/artifact-cloud.ts';
import { createStore } from '../../src/data/store.ts';
import { ContentIndex, emptyOverlay } from '../../src/domain/content-index.ts';
import type { ContentPack } from '../../src/domain/types.ts';

const pack: ContentPack = JSON.parse(fs.readFileSync(new URL('../fixtures/content/subjects/alpha/pack.json', import.meta.url), 'utf8'));

/** База в памяти с тем же поведением, что у базы артефакта: get/set/delete/onSnapshot. */
function fakeDb() {
  const docs = new Map<string, Record<string, unknown>>();
  const subs = new Map<string, Set<(s: unknown) => void>>();
  let writes = 0;
  const snap = (p: string) => ({ exists: docs.has(p), data: () => docs.get(p) });
  const db = {
    doc: (p: string) => ({
      get: async () => snap(p),
      set: async (d: Record<string, unknown>) => {
        writes++;
        docs.set(p, JSON.parse(JSON.stringify(d)));
        for (const f of subs.get(p) ?? []) f(snap(p));
      },
      delete: async () => { docs.delete(p); },
      onSnapshot: (next: (s: unknown) => void) => {
        if (!subs.has(p)) subs.set(p, new Set());
        subs.get(p)!.add(next);
        return () => subs.get(p)!.delete(next);
      },
    }),
  };
  return { db, docs, writes: () => writes };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('большое значение делится на части и читается обратно без потерь', async () => {
  const { db, docs } = fakeDb();
  const doc = new ChunkedDoc(db as never, 'ae/alpha/admin');
  // решения по каждому вопросу, размноженные до размера нескольких частей
  const value = { patches: Object.fromEntries(Array.from({ length: 60 }, (_, k) => pack.questions.map((q) => [`${q.id}-${k}`, { status: 'approved', baseHash: q.hash, note: 'проверено — кириллица' }])).flat()) };
  const json = JSON.stringify(value);
  assert.ok(json.length > 40_000, 'значение должно быть больше одной части');
  await doc.write(json, 123);
  const n = (docs.get('ae/alpha/admin') as { n: number }).n;
  assert.ok(n >= 2);
  for (const [, d] of docs) assert.ok(JSON.stringify(d).length < 256 * 1024 / 2, 'каждый документ меньше лимита 256 КиБ с запасом');
  const back = await new ChunkedDoc(db as never, 'ae/alpha/admin').read();
  assert.deepEqual(back?.value, value);
  assert.equal(back?.time, 123);
});

test('при повторной записи отправляются только изменившиеся части; лишние удаляются', async () => {
  const { db, docs, writes } = fakeDb();
  const doc = new ChunkedDoc(db as never, 'x/y');
  const big = 'а'.repeat(100_000);
  await doc.write(JSON.stringify({ s: big }), 1);
  const w1 = writes();
  await doc.write(JSON.stringify({ s: big.slice(0, 99_999) + 'б' }), 2);
  assert.equal(writes() - w1, 2, 'одна часть + заголовок');
  await doc.write(JSON.stringify({ s: 'коротко' }), 3);
  assert.equal((docs.get('x/y') as { n: number }).n, 1);
  assert.ok(!docs.has('x/y/chunks/c2'), 'лишние части удалены');
});

test('части, не совпадающие с заголовком (запись ещё идёт), не читаются как готовые', async () => {
  const { db, docs } = fakeDb();
  const doc = new ChunkedDoc(db as never, 'a/b');
  await doc.write(JSON.stringify({ k: 'v'.repeat(50_000) }), 1);
  docs.set('a/b/chunks/c1', { s: 'испорчено' });
  await assert.rejects(new ChunkedDoc(db as never, 'a/b').read());
});

test('новое устройство с пустой памятью получает решения из базы; изменения уходят в базу', async () => {
  const { db } = fakeDb();
  const migrate = (r: unknown) => (r && typeof r === 'object' ? (r as { n: number }) : null);
  // устройство 1 — сделало решения и отправило
  const s1 = createStore('test.cloud.1', () => ({ n: 0 }), migrate);
  await syncStore(s1, new ChunkedDoc(db as never, 'ae/alpha/admin'), { writable: true });
  s1.set({ n: 42 });
  await tick(700);
  // устройство 2 — память пустая (как в мобильном приложении после повторного входа)
  const s2 = createStore('test.cloud.2', () => ({ n: 0 }), migrate);
  await syncStore(s2, new ChunkedDoc(db as never, 'ae/alpha/admin'), { writable: true });
  assert.equal(s2.get().n, 42);
  // и видит последующие изменения первого устройства
  s1.set({ n: 43 });
  await tick(1200);
  assert.equal(s2.get().n, 43);
});

test('без права записи изменения в базу не уходят', async () => {
  const { db, docs } = fakeDb();
  const s = createStore('test.cloud.3', () => ({ n: 0 }), (r) => r as { n: number });
  await syncStore(s, new ChunkedDoc(db as never, 'ae/alpha/admin'), { writable: false });
  s.set({ n: 5 });
  await tick(700);
  assert.equal(docs.size, 0);
});

test('решение проверки снимается, если запись изменилась после утверждения', () => {
  const q = pack.questions[0];
  const ok = emptyOverlay();
  ok.patches[q.id] = { status: 'approved', baseHash: q.hash };
  const idx1 = new ContentIndex(pack, ok);
  assert.equal(idx1.questions.find((x) => x.id === q.id)!.status, 'approved');
  assert.equal(idx1.staleDecisions().length, 0);
  assert.ok(!('baseHash' in idx1.questions.find((x) => x.id === q.id)!), 'служебное поле не попадает в запись');

  const stale = emptyOverlay();
  stale.patches[q.id] = { status: 'approved', baseHash: 'другой-хеш' };
  const idx2 = new ContentIndex(pack, stale);
  assert.equal(idx2.questions.find((x) => x.id === q.id)!.status, 'review');
  assert.deepEqual(idx2.staleDecisions(), [q.id]);
});
