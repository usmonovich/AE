// Проверки целостности учебных баз (дополняют валидатор tools/build-content.ts).
// Общие проверки идут по ВСЕМ предметам из content/subjects.json и по тестовым предметам tests/fixtures/content,
// поэтому каждый новый материал проверяется автоматически, без правки тестов.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import katex from 'katex';
import type { ContentPack } from '../../src/domain/types.ts';

interface SubjectCfg { id: string; prefix: string; icon: string; tone: string; style: string; vocab: string; title: string; short: string; emoji: string; tagline: string }
interface Registry { app: { title: string; storagePrefix: string; cloudPrefix: string }; subjects: SubjectCfg[] }

const readJson = <T,>(url: URL): T => JSON.parse(fs.readFileSync(url, 'utf8')) as T;
const REAL = new URL('../../content/', import.meta.url);
const FIXTURE = new URL('../fixtures/content/', import.meta.url);
const registry = readJson<Registry>(new URL('subjects.json', REAL));
const fixtureRegistry = readJson<Registry>(new URL('subjects.json', FIXTURE));

interface Entry { root: URL; cfg: SubjectCfg; pack: ContentPack; decisions: Record<string, { status: string; hash: string }> }
const entries: Entry[] = [
  ...registry.subjects.map((cfg) => ({ root: REAL, cfg })),
  ...fixtureRegistry.subjects.map((cfg) => ({ root: FIXTURE, cfg })),
].map(({ root, cfg }) => {
  const base = new URL(`subjects/${cfg.id}/`, root);
  const dec = new URL('review/decisions.json', base);
  return {
    root, cfg,
    pack: readJson<ContentPack>(new URL('pack.json', base)),
    decisions: fs.existsSync(dec) ? readJson<{ decisions?: Entry['decisions'] }>(dec).decisions ?? {} : {},
  };
});
const records = (p: ContentPack) => [...p.theory, ...p.formulas, ...p.examples, ...p.questions];

// ───────────── реестр предметов ─────────────

test('реестр: семь предметов AE в заданном порядке, с уникальными id и префиксами', () => {
  assert.equal(registry.app.title, 'AE');
  assert.deepEqual(registry.subjects.map((s) => s.title), [
    'Aviation Psychology and Crew Resource Management (CRM)',
    'Circuit Theory',
    'Cost Engineering',
    'Human Performance and Medicine',
    'Hydraulics and Hydraulic Systems',
    'Mathematics III',
    'Mechanics',
  ]);
  for (const reg of [registry, fixtureRegistry]) {
    const ids = reg.subjects.map((s) => s.id);
    const prefixes = reg.subjects.map((s) => s.prefix);
    assert.equal(new Set(ids).size, ids.length, 'id уникальны');
    assert.equal(new Set(prefixes).size, prefixes.length, 'префиксы уникальны');
    // префикс — первый сегмент адреса: он не должен совпадать с экранами внутри предмета
    const ROUTES = ['library', 'sub', 'topic', 'page', 'test', 'run', 'result', 'modes', 'qa', 'cards', 'mistakes', 'favorites', 'progress', 'settings', 'search', 'privacy', 'admin', 'plan'];
    for (const s of reg.subjects) {
      assert.match(s.id, /^[a-z][a-z0-9]{1,23}$/, `${s.id}: id — латиница и цифры (ключи хранилища, документы базы, сервер)`);
      assert.match(s.prefix, /^[a-z][a-z0-9]{0,7}$/, `${s.id}: префикс`);
      assert.ok(!ROUTES.includes(s.prefix), `${s.id}: префикс «${s.prefix}» совпадает с экраном приложения`);
      assert.ok(['notes', 'book'].includes(s.style), `${s.id}: style`);
      assert.ok(['materials', 'notes', 'book'].includes(s.vocab), `${s.id}: vocab`);
      assert.ok(['accent', 'ok', 'warn', 'bad'].includes(s.tone), `${s.id}: tone`);
      assert.ok(s.title && s.short && s.tagline && s.emoji, `${s.id}: подписи`);
    }
  }
});

test('реестр: значки предметов есть в наборе иконок', () => {
  const icons = fs.readFileSync(new URL('../../src/ui/components/Icon.tsx', import.meta.url), 'utf8');
  for (const s of [...registry.subjects, ...fixtureRegistry.subjects]) assert.match(icons, new RegExp(`^\\s+${s.icon}: '`, 'm'), `${s.id}: нет иконки ${s.icon}`);
});

test('реестр: список встроенных учебных баз совпадает с реестром (npm run content:build)', () => {
  const gen = fs.readFileSync(new URL('../../src/data/packs.generated.ts', import.meta.url), 'utf8');
  const listed = [...gen.matchAll(/^ {2}"([a-z0-9]+)": /gm)].map((m) => m[1]);
  assert.deepEqual(listed, registry.subjects.map((s) => s.id));
  const fx = fs.readFileSync(new URL('packs.generated.ts', FIXTURE), 'utf8');
  assert.deepEqual([...fx.matchAll(/^ {2}"([a-z0-9]+)": /gm)].map((m) => m[1]), fixtureRegistry.subjects.map((s) => s.id));
});

test('у каждого предмета реестра есть исходники, журнал и отчёт', () => {
  for (const s of registry.subjects) {
    assert.ok(fs.existsSync(new URL(`subjects/${s.id}/src/00-structure.yaml`, REAL)), `${s.id}: 00-structure.yaml`);
    assert.ok(fs.existsSync(new URL(`../../docs/subjects/${s.id}.md`, import.meta.url)), `${s.id}: журнал docs/subjects/${s.id}.md`);
    assert.ok(fs.existsSync(new URL(`../../docs/subjects/${s.id}-report.md`, import.meta.url)), `${s.id}: отчёт импорта`);
  }
});

// ───────────── учебные базы (все предметы) ─────────────

test('учебная база: course.id совпадает с предметом, все ID с префиксом предмета', () => {
  for (const { cfg, pack } of entries) {
    assert.equal(pack.course.id, cfg.id);
    const pre = `${cfg.prefix}-`;
    for (const x of [...pack.sections, ...pack.subsections, ...pack.topics, ...records(pack), ...pack.errata]) assert.ok(x.id.startsWith(pre), `${cfg.id}: ${x.id}`);
  }
});

test('у каждой записи есть ссылка на существующую страницу источника', () => {
  for (const { cfg, pack } of entries) {
    const refs = new Set(pack.pages.map((p) => p.ref));
    for (const e of records(pack)) {
      assert.ok(e.sources.length > 0, `${cfg.id}/${e.id}`);
      for (const s of e.sources) assert.ok(refs.has(s.page), `${cfg.id}/${e.id} → ${s.page}`);
    }
  }
});

test('страницы материалов: изображения в content/subjects/<id>/pages или список pages.txt', () => {
  for (const { root, cfg, pack } of entries) {
    if (cfg.style === 'book') { assert.ok(pack.pages.every((p) => p.image === ''), `${cfg.id}: страницы книги без изображений`); continue; }
    for (const p of pack.pages) assert.equal(p.image, `pages/${cfg.id}/${p.image.split('/').pop()}`, `${cfg.id}: ${p.image}`);
    const dir = new URL(`subjects/${cfg.id}/pages/`, root);
    if (!pack.pages.length) continue;
    const photos = fs.readdirSync(dir).filter((f) => /\.(webp|jpe?g|png)$/i.test(f));
    if (photos.length) for (const p of pack.pages) assert.ok(photos.includes(p.image.split('/').pop()!), `${cfg.id}: нет файла ${p.image}`);
    else {
      const listed = fs.readFileSync(new URL('pages.txt', dir), 'utf8').split(/\r?\n/).filter(Boolean);
      assert.deepEqual(pack.pages.map((p) => p.image.split('/').pop()).sort(), [...listed].sort(), `${cfg.id}: pages.txt`);
    }
  }
});

test('у каждого вопроса есть подсказка, объяснение, порядок и пометка происхождения', () => {
  for (const { cfg, pack } of entries)
    for (const q of pack.questions) {
      assert.ok(q.hints.length >= 1 && q.hints[0].length > 5, `${cfg.id}/${q.id}: подсказка`);
      assert.ok(q.explanation.length > 3, `${cfg.id}/${q.id}: объяснение`);
      assert.equal(typeof q.sourceOrder, 'number');
      assert.equal(typeof q.generated, 'boolean', `${cfg.id}/${q.id}: пометка «составлено» / «из материалов»`);
    }
});

test('утверждено только то, что утвердил администратор, и только неизменённое после проверки', () => {
  for (const { cfg, pack, decisions } of entries)
    for (const e of records(pack)) {
      const d = decisions[e.id];
      if (d && d.hash === e.hash) assert.equal(e.status, d.status, `${cfg.id}/${e.id}`);
      else assert.equal(e.status, 'review', `${cfg.id}/${e.id}: без решения администратора — статус review`);
    }
});

test('все записи уникальны (ID и хеш содержимого вопросов), в том числе между предметами', () => {
  const all = entries.flatMap(({ pack }) => records(pack).map((e) => e.id));
  assert.equal(new Set(all).size, all.length);
  for (const { cfg, pack } of entries) {
    const hashes = pack.questions.map((q) => q.hash);
    assert.equal(new Set(hashes).size, hashes.length, cfg.id);
  }
});

test('ссылки вопросов на формулы указывают на существующие формулы', () => {
  for (const { cfg, pack } of entries) {
    const f = new Set(pack.formulas.map((x) => x.id));
    for (const q of pack.questions) for (const id of q.formulaIds) assert.ok(f.has(id), `${cfg.id}/${q.id} → ${id}`);
  }
});

test('все формулы рендерятся KaTeX без ошибок', () => {
  for (const { pack } of entries) for (const f of pack.formulas) katex.renderToString(f.tex, { throwOnError: true, displayMode: true });
});

test('числовые эталоны совпадают с независимым пересчётом', () => {
  for (const { cfg, pack } of entries)
    for (const q of pack.questions.filter((x) => x.type === 'numeric')) {
      assert.ok(q.numeric?.check, `${cfg.id}/${q.id}: нет check`);
      const v = Number(new Function(`return (${q.numeric!.check})`)());
      assert.ok(Math.abs(v - q.numeric!.value) <= Math.max(Math.abs(v) * 0.005, q.numeric!.tolAbs ?? 1e-9), `${cfg.id}/${q.id}: ${q.numeric!.value} vs ${v}`);
    }
});

test('замечания к источнику: к чему, оригинал, что не так и конкретное предложение', () => {
  for (const { cfg, pack } of entries) {
    const refs = new Set(pack.pages.map((p) => p.ref));
    for (const e of pack.errata) {
      assert.ok(e.target && e.original && e.issue && e.suggestion, `${cfg.id}/${e.id}`);
      assert.doesNotMatch(e.suggestion, /^(Проверить|Уточнить)[^.]*\.?$/, `${e.id}: предложение должно говорить, чем заменить или что дописать`);
      assert.ok(refs.has(e.page), e.id);
    }
  }
});

test('отчёты импорта (по файлу) соответствуют фактическим числам', () => {
  for (const { cfg, pack } of entries) {
    if (cfg.style === 'book') continue;
    assert.equal(pack.reports.length, pack.sourceFiles.length, cfg.id);
    const sum = (k: 'questionsGenerated' | 'questionsInSource' | 'formulas' | 'theory' | 'examples') => pack.reports.reduce((a, r) => a + r[k], 0);
    assert.equal(sum('questionsGenerated') + sum('questionsInSource'), pack.questions.length, cfg.id);
    assert.equal(sum('questionsInSource'), pack.questions.filter((q) => !q.generated).length, `${cfg.id}: задания из источника`);
    assert.equal(sum('formulas'), pack.formulas.length, cfg.id);
    assert.equal(sum('theory'), pack.theory.length, cfg.id);
  }
});

test('разделы: у активного раздела есть темы, пустых подразделов нет (кроме плана учебника)', () => {
  for (const { cfg, pack } of entries) {
    for (const s of pack.sections) {
      const subs = pack.subsections.filter((x) => x.sectionId === s.id);
      const topics = pack.topics.filter((t) => subs.some((x) => x.id === t.subsectionId));
      if (s.status === 'active') assert.ok(topics.length > 0 || cfg.style === 'book', `${cfg.id}: раздел ${s.id} без тем`);
      else assert.equal(topics.length, 0, `${cfg.id}: запланированный раздел ${s.id} не должен иметь тем`);
    }
    if (cfg.style !== 'book') for (const sub of pack.subsections) assert.ok(pack.topics.some((t) => t.subsectionId === sub.id), `${cfg.id}: пустой подраздел ${sub.id}`);
  }
});

test('анимированные рисунки безопасны и привязаны к блокам теории', () => {
  for (const { cfg, pack } of entries) {
    const figs = pack.figures ?? {};
    const used = new Set(pack.theory.map((t) => t.figure).filter(Boolean));
    for (const [id, f] of Object.entries(figs)) {
      assert.ok(used.has(id), `${cfg.id}: рисунок ${id} не используется`);
      assert.ok(f.title.length > 10, `${id}: нет описания`);
      assert.doesNotMatch(f.svg, /<script|\son[a-z]+\s*=|javascript:|<foreignObject|<image/i, id);
      assert.match(f.svg, /<animate/, `${id}: нет анимации`);
      for (const m of f.svg.matchAll(/\sid="([^"]+)"/g)) assert.ok(m[1].startsWith(`${id}-`), `${id}: id ${m[1]}`);
    }
    for (const t of pack.theory) if (t.figure) assert.ok(figs[t.figure], `${t.id} → ${t.figure}`);
  }
});

test('дополнения из интернета: помечены, со ссылками https и местом в источнике', () => {
  for (const { cfg, pack, decisions } of entries) {
    const refs = new Set(pack.pages.map((p) => p.ref));
    const all = records(pack);
    for (const e of all.filter((x) => x.web)) {
      for (const r of e.web!) {
        assert.match(r.url, /^https:\/\/[^\s]+$/, `${cfg.id}/${e.id}: ${r.url}`);
        assert.ok(r.title.length > 3, e.id);
      }
      assert.ok(e.sources.length > 0 && e.sources.every((s) => refs.has(s.page)), `${e.id}: место в источнике`);
      assert.equal(e.status, decisions[e.id]?.status ?? 'review', `${e.id}: без решения владельца — на проверке`);
    }
    for (const t of pack.topics.filter((x) => x.web)) {
      const rec = all.filter((e) => e.topicId === t.id);
      assert.ok(rec.length > 0 && rec.every((e) => e.web), `${cfg.id}: у темы «из интернета» ${t.id} все записи из интернета`);
    }
  }
});

test('пустой предмет — честно пустой: без тем, записей и вопросов', () => {
  for (const { cfg, pack } of entries.filter((e) => e.root === REAL && e.pack.topics.length === 0)) {
    assert.equal(records(pack).length, 0, cfg.id);
    assert.equal(pack.sections.length + pack.subsections.length, 0, `${cfg.id}: разделы появляются только вместе с материалами`);
  }
});

// ───────────── тестовые предметы ─────────────

test('тестовые предметы покрывают все типы вопросов, вид для студентов, рисунок, замечание и план учебника', () => {
  const a = entries.find((e) => e.root === FIXTURE && e.cfg.id === 'alpha')!.pack;
  const b = entries.find((e) => e.root === FIXTURE && e.cfg.id === 'beta')!.pack;
  assert.deepEqual([...new Set(a.questions.map((q) => q.type))].sort(), ['matching', 'multiple', 'numeric', 'sequence', 'single', 'text']);
  assert.equal(a.questions.length, 14);
  assert.ok(a.questions.some((q) => !q.generated), 'есть задание «из материалов» (fromSource)');
  assert.equal(a.errata.length, 1);
  assert.ok(a.theory.some((t) => t.student), 'есть запись с видом для студентов');
  assert.equal(Object.keys(a.figures ?? {}).length, 1);
  assert.equal(b.plan!.length, 2, 'в плане учебника — два ненаполненных пункта');
  assert.ok(b.topics.every((t) => t.num && t.book?.place));
});
