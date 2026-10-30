// Вид для студентов: ни одной пометки о замечаниях к источнику; админ-панель — только по PIN владельца.
// Проверяется на всех предметах и на тестовом предмете А (у него есть замечание и исправленный текст).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ContentIndex, emptyOverlay } from '../../src/domain/content-index.ts';
import { buildReleasePack } from '../../tools/release-pack.ts';
import { checkAdminPin, ADMIN_PIN_SPEC } from '../../src/data/admin-pin.ts';
import { pinSpec } from '../../tools/admin-pin.mjs';
import type { ContentPack } from '../../src/domain/types.ts';

const readPack = (u: string): ContentPack => JSON.parse(fs.readFileSync(new URL(u, import.meta.url), 'utf8'));
const pack = readPack('../fixtures/content/subjects/alpha/pack.json');
const registry = JSON.parse(fs.readFileSync(new URL('../../content/subjects.json', import.meta.url), 'utf8')) as { subjects: { id: string }[] };
const allPacks = [pack, ...registry.subjects.map((s) => readPack(`../../content/subjects/${s.id}/pack.json`))];
const errIdRe = (p: ContentPack) => (p.errata.length ? new RegExp(`\\b(${p.errata.map((e) => e.id).join('|')})\\b`) : /(?!)/);
const ERR_ID = errIdRe(pack);
const REMARK = /замечани|в тетради|читается неуверенно|запись не (закончена|заполнена)|не расшифрован/i;
const visibleText = (x: object) => {
  const { id: _i, topicId: _t, sources: _s, hash: _h, errata: _e, student: _st, web: _w, formulaIds: _f, symbols: _sy, figure: _fg, ...rest } = x as Record<string, unknown>;
  void _i; void _t; void _s; void _h; void _e; void _st; void _w; void _f; void _sy; void _fg;
  return JSON.stringify(rest);
};

test('вид для студентов: ни в одном предмете нет номеров и упоминаний замечаний к источнику', () => {
  const bad: string[] = [];
  for (const p of allPacks) {
    const idx = new ContentIndex(p, emptyOverlay());
    const errId = errIdRe(p);
    for (const e of [...idx.theory, ...idx.formulas, ...idx.examples, ...idx.questions]) {
      const t = visibleText(e);
      if (errId.test(t) || REMARK.test(t)) bad.push(`${e.id}: ${t.match(new RegExp(`.{0,40}(${errId.source}|${REMARK.source}).{0,40}`, 'i'))?.[0]}`);
    }
    for (const k of Object.keys(p.symbols)) {
      const s = idx.symbol(k)!;
      if (errId.test(s.meaning) || REMARK.test(s.meaning)) bad.push(`symbol ${k}: ${s.meaning}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('вид для студентов: исходные записи не изменены, скрытые служебные заметки не показываются, тексты входят в хеш', () => {
  const idx = new ContentIndex(pack, emptyOverlay());
  const withStudent = [...pack.theory, ...pack.formulas, ...pack.examples, ...pack.questions].filter((e) => e.student);
  assert.ok(withStudent.length >= 1, `записей с видом для студентов: ${withStudent.length}`);
  for (const e of withStudent) {
    const shown = [...idx.theory, ...idx.formulas, ...idx.examples, ...idx.questions].find((x) => x.id === e.id);
    if (e.student!.hide) { assert.equal(shown, undefined, `${e.id} скрыта`); continue; }
    assert.ok(shown, e.id);
    for (const [k, v] of Object.entries(e.student!)) assert.deepEqual((shown as unknown as Record<string, unknown>)[k], v, `${e.id}.${k}`);
    assert.deepEqual(idx.original(e.id), e, `${e.id}: исходная запись доступна админ-панели`);
  }
  // запись «как в источнике» сохранена: замечание ta-e1 — в исходном тексте, исправление — в виде для студентов
  const t2 = pack.theory.find((x) => x.id === 'ta-speed-t2')!;
  assert.match(t2.body, /перемещение/);
  assert.match(t2.student!.body!, /длина траектории/);
  // старое решение «утверждено» к изменённой записи не применяется — её нужно проверить снова
  const ov = { ...emptyOverlay(), patches: { 'ta-speed-t2': { status: 'approved', baseHash: 'хеш-до-изменения' } } };
  assert.equal(new ContentIndex(pack, ov).theory.find((x) => x.id === 'ta-speed-t2')!.status, 'review');
});

test('релизная база: без замечаний, исходных текстов и скрытых заметок', () => {
  // администратор утвердил всё
  const overlay = emptyOverlay();
  for (const e of [...pack.theory, ...pack.formulas, ...pack.examples, ...pack.questions]) overlay.patches[e.id] = { status: 'approved', baseHash: e.hash };
  const { pack: rel } = buildReleasePack(pack, overlay);
  assert.ok(rel.theory.some((t) => t.id === 'ta-speed-t2' && /длина траектории/.test(t.body)), 'в релизе — исправленный текст');
  assert.deepEqual(rel.errata, []);
  for (const e of [...rel.theory, ...rel.formulas, ...rel.examples, ...rel.questions]) {
    assert.ok(!('errata' in e) && !('student' in e), e.id);
    assert.ok(!ERR_ID.test(JSON.stringify(e)), `${e.id}: номер замечания в релизе`);
  }
  for (const s of Object.values(rel.symbols)) assert.ok(!('student' in s) && !ERR_ID.test(s.meaning), s.key);
});

test('PIN администратора: только хеш PBKDF2, проверка верного и неверного PIN', async () => {
  // хеш PIN владельца не хранится в коде: его подставляет сборка из .admin-pin (файл вне репозитория)
  assert.equal(ADMIN_PIN_SPEC, '', 'без сборщика PIN не задан');
  assert.equal(await checkAdminPin('1234'), false, 'без PIN владельца вход невозможен');
  for (const f of ['../../src/data/admin-pin.ts', '../../src/admin/admin.tsx', '../../tools/build.mjs'])
    assert.ok(!/pbkdf2-sha256:\d+:[0-9a-f]{32}/.test(fs.readFileSync(new URL(f, import.meta.url), 'utf8')), `${f}: хеш PIN не в коде`);
  const pinFile = new URL('../../.admin-pin', import.meta.url);
  if (fs.existsSync(pinFile)) assert.match(fs.readFileSync(pinFile, 'utf8').trim(), /^pbkdf2-sha256:\d{6,}:[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.match(fs.readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8'), /^\.admin-pin$/m, '.admin-pin не попадает в репозиторий');
  const spec = pinSpec('1234');
  assert.equal(await checkAdminPin('1234', spec), true);
  assert.equal(await checkAdminPin('1235', spec), false);
  assert.equal(await checkAdminPin('', spec), false);
  assert.equal(await checkAdminPin('1234', 'sha256:abc'), false, 'неизвестный формат не принимается');
  // в коде больше нет установки своего PIN
  const actions = fs.readFileSync(new URL('../../src/data/admin-actions.ts', import.meta.url), 'utf8');
  assert.ok(!/export (async )?function setPin/.test(actions));
  const admin = fs.readFileSync(new URL('../../src/admin/admin.tsx', import.meta.url), 'utf8');
  assert.ok(!/Создайте PIN|pin2/.test(admin), 'экрана создания PIN нет');
});
