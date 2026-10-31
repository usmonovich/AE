// Сборка и проверка учебной базы одного предмета:
//   content/subjects/<id>/src/*.yaml → content/subjects/<id>/pack.json + docs/subjects/<id>-report.md.
// Запуск: npx tsx tools/build-content.ts --subject <id> [--strict]   (id — из content/subjects.json)
//         npm run content:build                                     — все предметы (tools/content-all.mjs)
// Каждый запуск также обновляет src/data/packs.generated.ts — список встроенных учебных баз.
// AE_CONTENT=<папка> — собрать другую папку с учебными базами (тестовые предметы tests/fixtures/content):
//   тогда отчёт пишется в <папка>/subjects/<id>/REPORT.md, список баз — в <папка>/packs.generated.ts.
// Проверки: уникальность ID, ссылки на страницы-источники, рендер каждой формулы KaTeX,
// обозначения формул в словаре, корректность ответов по типу вопроса, независимый пересчёт
// числовых ответов (поле check), дубли по хешу содержимого.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import katex from 'katex';
import { normalizeLatex, normalizeMarkdownMath, extractMath } from '../src/domain/latex.ts';
import { contentHash, cyrb53 } from '../src/domain/hash.ts';
import { fileURLToPath } from 'node:url';
import type {
  ContentPack, Erratum, Example, FigureDef, Formula, ImportReport, Option, PageInfo, PlanItem, Question, QuestionCategory,
  QuestionType, Section, SourceRef, Subsection, SymbolDef, Theory, Topic, TopicStage, WebRef,
} from '../src/domain/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
interface SubjectCfg { id: string; prefix: string; title: string; short?: string; style: string }
const DEFAULT_CONTENT = path.join(ROOT, 'content');
const CONTENT = process.env.AE_CONTENT ? path.resolve(process.env.AE_CONTENT) : DEFAULT_CONTENT;
const FIXTURE = CONTENT !== DEFAULT_CONTENT;
const SUBJECTS_CFG = JSON.parse(fs.readFileSync(path.join(CONTENT, 'subjects.json'), 'utf8')) as { subjects: SubjectCfg[] };
const argSubject = process.argv.includes('--subject') ? process.argv[process.argv.indexOf('--subject') + 1] : '';
const SUBJ = SUBJECTS_CFG.subjects.find((x) => x.id === argSubject);
if (!SUBJ) {
  console.error(`Укажите предмет: --subject ${SUBJECTS_CFG.subjects.map((x) => x.id).join('|')}`);
  process.exit(1);
}
// BOOK — предмет-учебник с оглавлением (план курса, печатные страницы без изображений, обязательные источники).
const BOOK = SUBJ.style === 'book';
const ID_PREFIX = `${SUBJ.prefix}-`;
const BASE = path.join(CONTENT, 'subjects', SUBJ.id);
const SRC_DIR = path.join(BASE, 'src');
const PAGES_DIR = path.join(BASE, 'pages');
const OUT = path.join(BASE, 'pack.json');
const REPORT_MD = FIXTURE ? path.join(BASE, 'REPORT.md') : path.join(ROOT, 'docs/subjects', `${SUBJ.id}-report.md`);
writePacksModule();
// Решения проверки, перенесённые из админ-панели (артефакт или приложение): id → {status, hash}.
const DECISIONS = path.join(BASE, 'review/decisions.json');
const FIG_DIR = path.join(BASE, 'figures');
const STAGES: TopicStage[] = ['extracted', 'prepared', 'needs-check', 'verified'];

const errors: string[] = [];
const warnings: string[] = [];
const err = (m: string) => errors.push(m);
const warn = (m: string) => warnings.push(m);

// ───────────── загрузка ─────────────
type Y = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.yaml')).sort();
const docs: Record<string, Y> = {};
for (const f of files) {
  try {
    docs[f] = yaml.load(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
  } catch (e) {
    err(`${f}: ошибка YAML — ${(e as Error).message}`);
  }
}
if (errors.length) finish();

const structure = docs['00-structure.yaml'];
if (!structure) {
  err(`${path.relative(ROOT, SRC_DIR)}: нет 00-structure.yaml`);
  finish();
}
for (const k of ['sourceFiles', 'sections', 'subsections', 'errata']) structure[k] ??= [];
structure.symbols ??= {};
if (structure.course?.id !== SUBJ.id) err(`00-structure.yaml: course.id должен быть «${SUBJ.id}»`);
// Дополнительные словари, даты и замечания из файлов подразделов объединяются со структурой.
for (const [f, d] of Object.entries<Y>(docs)) {
  if (f === '00-structure.yaml' || !d) continue;
  for (const [k, v] of Object.entries<Y>(d.symbols ?? {})) {
    if (structure.symbols[k]) err(`${f}: обозначение ${k} уже определено`);
    structure.symbols[k] = v;
  }
  structure.errata.push(...(d.errata ?? []));
  Object.assign((structure.pageDates ??= {}), d.pageDates ?? {});
}
const sourceFilesSrc: Y[] = structure.sourceFiles;
for (const sf of sourceFilesSrc) if (!/^[a-z]$/.test(String(sf.pagePrefix ?? ''))) err(`${sf.id}: pagePrefix — одна латинская буква (a, b, …)`);
if (new Set(sourceFilesSrc.map((sf) => sf.pagePrefix)).size < sourceFilesSrc.filter((sf) => !sf.bookPages).length) warn('у нескольких файлов один pagePrefix — их страницы не различить');
if (!BOOK && sourceFilesSrc.length > 1 && sourceFilesSrc.some((sf) => !sf.pageLabel)) warn('файлов-источников несколько: задайте каждому pageLabel, иначе страницы разных файлов подписываются одинаково');
const fileByPrefix = new Map<string, Y>(sourceFilesSrc.map((s) => [s.pagePrefix, s]));

// ───────────── страницы-источники ─────────────
// Материалы (notes): изображения content/subjects/<id>/pages/<ref>.webp. Учебник (book): печатные страницы (b005 …)
// без изображений — книга защищена авторским правом, в приложении хранится только ссылка на страницу.
const PAGE_RE = /^([a-z])(\d{2,3})([LR]?)\.webp$/;
const bookPages = (): PageInfo[] =>
  sourceFilesSrc.flatMap((sf: Y) => {
    const [a, b] = sf.bookPages as [number, number];
    if (!(a > 0 && b >= a)) err(`${sf.id}: нужен bookPages: [первая, последняя] печатная страница`);
    const out: PageInfo[] = [];
    for (let n = a; n <= b; n++) out.push({ ref: `b${String(n).padStart(3, '0')}`, file: sf.id, pdfPage: n - Number(sf.pdfOffset ?? 0), side: '', image: '', index: 0 });
    return out;
  });
// Изображения страниц есть только у владельца; в публичном репозитории вместо них — список файлов pages.txt.
const pageFiles = (): string[] => {
  if (!fs.existsSync(PAGES_DIR)) return [];
  const photos = fs.readdirSync(PAGES_DIR).filter((f) => PAGE_RE.test(f));
  const listFile = path.join(PAGES_DIR, 'pages.txt');
  if (photos.length || !fs.existsSync(listFile)) return photos;
  return fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((f) => PAGE_RE.test(f));
};
const pages: PageInfo[] = BOOK ? bookPages() : pageFiles()
  .map((f) => {
    const m = PAGE_RE.exec(f)!;
    const file = fileByPrefix.get(m[1]);
    if (!file) err(`Страница ${f}: нет исходного файла с префиксом «${m[1]}»`);
    return { ref: `${m[1]}${m[2]}${m[3]}`, file: file?.id ?? '?', pdfPage: Number(m[2]), side: m[3] as PageInfo['side'], image: `pages/${SUBJ.id}/${f}`, index: 0 };
  })
  .sort((a, b) => sourceFilesSrc.findIndex((s) => s.id === a.file) - sourceFilesSrc.findIndex((s) => s.id === b.file) || a.pdfPage - b.pdfPage || a.side.localeCompare(b.side));
pages.forEach((p, i) => {
  p.index = i;
  const d = structure.pageDates?.[p.ref];
  if (d) p.date = String(d);
});
const pageIndex = new Map(pages.map((p) => [p.ref, p.index]));
const pageFile = new Map(pages.map((p) => [p.ref, p.file]));

function refs(src: unknown, where: string): SourceRef[] {
  const list = Array.isArray(src) ? src : src ? [src] : [];
  if (!list.length) err(`${where}: нет ссылки на источник`);
  return list.map((p) => {
    const page = String(p);
    if (!pageIndex.has(page)) err(`${where}: страница ${page} не существует`);
    return { file: pageFile.get(page) ?? '?', page };
  });
}
const firstPageIdx = (r: SourceRef[]) => Math.min(...r.map((x) => pageIndex.get(x.page) ?? 9999));

// ───────────── KaTeX ─────────────
let katexChecks = 0;
function checkTex(tex: string, where: string, display = false) {
  katexChecks++;
  try {
    katex.renderToString(tex, {
      throwOnError: true,
      displayMode: display,
      strict: (code: string, msg: string) => {
        warn(`${where}: KaTeX ${code}: ${msg}`);
        return 'ignore';
      },
    });
  } catch (e) {
    err(`${where}: формула не рендерится: ${(e as Error).message}\n    ${tex}`);
  }
}
function md(text: unknown, where: string): string {
  if (text == null) return '';
  const s = normalizeMarkdownMath(String(text).trim());
  // интерфейс понимает только **жирный**; одиночные звёздочки (курсив) показались бы как есть
  if (/(^|[^*\\$])\*[^*\s][^*\n]*?\*(?!\*)/.test(s.replace(/\$[^$]*\$/g, ''))) warn(`${where}: одиночные * (курсив) не поддерживаются — уберите или замените на **жирный**`);
  for (const m of extractMath(s)) checkTex(m, where);
  return s;
}
function texField(t: unknown, where: string): string {
  const s = normalizeLatex(String(t ?? '').trim());
  if (!s) err(`${where}: пустая формула`);
  else checkTex(s, where, true);
  return s;
}

// ───────────── структура ─────────────
const sections: Section[] = structure.sections.map((s: Y, i: number) => ({ id: s.id, title: s.title, order: i, status: s.status }));
const subsections: Subsection[] = structure.subsections.map((s: Y, i: number) => ({ id: s.id, sectionId: s.sectionId, title: s.title, order: i, note: s.note }));
// разделы, подразделы и замечания лежат в общих таблицах сервера — их ID тоже с префиксом предмета
for (const x of [...structure.sections, ...structure.subsections, ...structure.errata] as Y[])
  if (!String(x.id).startsWith(ID_PREFIX)) err(`00-structure.yaml: ID «${x.id}» должен начинаться с «${ID_PREFIX}»`);
for (const x of structure.subsections as Y[]) if (!structure.sections.some((s: Y) => s.id === x.sectionId)) err(`подраздел ${x.id}: раздел ${x.sectionId} не найден`);

const symbols: Record<string, SymbolDef> = {};
for (const [key, v] of Object.entries<Y>(structure.symbols)) {
  const tex = normalizeLatex(String(v.tex));
  checkTex(tex, `symbol ${key}`);
  if (v.src !== null && !pageIndex.has(String(v.src))) err(`symbol ${key}: страница ${v.src} не существует`);
  symbols[key] = { key, tex, meaning: md(v.meaning, `symbol ${key}`), unit: String(v.unit ?? ''), src: v.src === null ? null : String(v.src), ...(v.web === true ? { web: true } : {}) };
}

const errata: Erratum[] = structure.errata.map((e: Y) => {
  if (!pageIndex.has(e.page)) err(`errata ${e.id}: страница ${e.page} не существует`);
  if (!e.target) warn(`errata ${e.id}: не указано, к чему относится замечание (поле target)`);
  if (!e.suggestion) warn(`errata ${e.id}: нет предложения (поле suggestion)`);
  return {
    id: e.id, page: e.page, severity: e.severity,
    ...(e.target ? { target: md(e.target, `errata ${e.id}`) } : {}),
    original: md(e.original, `errata ${e.id}`), issue: md(e.issue, `errata ${e.id}`), suggestion: md(e.suggestion, `errata ${e.id}`),
    ...(e.todo ? { todo: md(e.todo, `errata ${e.id}`) } : {}),
    resolution: 'open',
  };
});
const errataIds = new Set(errata.map((e) => e.id));
const usedErrata = new Set<string>();
function errataRefs(list: unknown, where: string): string[] | undefined {
  if (!list) return undefined;
  const arr = (list as string[]).map(String);
  for (const id of arr) {
    if (!errataIds.has(id)) err(`${where}: замечание ${id} не найдено`);
    usedErrata.add(id);
  }
  return arr;
}

// ───────────── анимированные иллюстрации ─────────────
// Каждый файл content/figures/<id>.svg — самостоятельный SVG с анимацией SMIL.
// Проверки безопасности: без скриптов, обработчиков событий, внешних ссылок и foreignObject;
// все id внутри файла начинаются с «<id>-», чтобы рисунки на одном экране не конфликтовали.
const figures: Record<string, FigureDef> = {};
const FIG_FORBIDDEN: [RegExp, string][] = [
  [/<script/i, 'скрипт'], [/\son[a-z]+\s*=/i, 'обработчик события'], [/javascript:/i, 'javascript:'],
  [/<foreignObject/i, 'foreignObject'], [/(?:xlink:)?href\s*=\s*["'](?!#)/i, 'внешняя ссылка'], [/url\(\s*["']?(?!#)/i, 'внешний url()'],
  [/<image/i, 'растровое изображение'], [/<!ENTITY|<!DOCTYPE/i, 'DTD'],
];
if (fs.existsSync(FIG_DIR)) {
  for (const f of fs.readdirSync(FIG_DIR).filter((x) => x.endsWith('.svg')).sort()) {
    const id = f.slice(0, -4);
    const w = `figure ${f}`;
    const raw = fs.readFileSync(path.join(FIG_DIR, f), 'utf8');
    for (const [re, what] of FIG_FORBIDDEN) if (re.test(raw)) err(`${w}: запрещено — ${what}`);
    if (!/^\s*<svg[\s>]/.test(raw)) err(`${w}: файл должен начинаться с <svg>`);
    if (!/viewBox="[\d.\s-]+"/.test(raw)) err(`${w}: нет viewBox`);
    if (/\swidth="\d|\sheight="\d/.test(raw.slice(0, raw.indexOf('>')))) err(`${w}: у корневого <svg> не должно быть width/height — рисунок тянется по ширине`);
    for (const m of raw.matchAll(/\sid="([^"]+)"/g)) if (!m[1].startsWith(`${id}-`)) err(`${w}: id «${m[1]}» должен начинаться с «${id}-»`);
    const title = /<title>([^<]+)<\/title>/.exec(raw)?.[1]?.trim().replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    if (!title) err(`${w}: нет <title> (описание для экранного диктора)`);
    if (!/<animate|<animateTransform|<animateMotion|<set\s/.test(raw)) warn(`${w}: нет анимации`);
    const svg = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
    figures[id] = { id, title: title ?? id, svg };
  }
}
const usedFigures = new Set<string>();

// ───────────── дополнения из интернета ─────────────
// Запись с полем web — не из конспекта: её добавили по просьбе владельца на место пробела.
// src у неё — место пробела в конспекте, web — список источников (заголовок + https-ссылка).
function webRefs(list: unknown, where: string): WebRef[] | undefined {
  if (list == null) return undefined;
  if (!Array.isArray(list) || !list.length) { err(`${where}: web — пустой список источников`); return undefined; }
  return list.map((r: Y, k: number) => {
    const title = String(r?.title ?? '').trim();
    const url = String(r?.url ?? '').trim();
    if (!title) err(`${where}: web[${k}] без названия`);
    if (!/^https:\/\/[^\s"'<>]+$/.test(url)) err(`${where}: web[${k}] — нужна ссылка https://`);
    const extra: Partial<WebRef> = {};
    if (r?.org) extra.org = String(r.org);
    if (r?.checked) {
      extra.checked = String(r.checked);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(extra.checked)) err(`${where}: web[${k}].checked — дата ГГГГ-ММ-ДД`);
    } else if (BOOK) err(`${where}: web[${k}] — у источника нужна дата проверки (checked)`);
    if (r?.note) extra.note = String(r.note);
    return { title, url, ...extra };
  });
}
let webCount = 0;
const withWeb = (web: WebRef[] | undefined) => (web ? (webCount++, { web }) : {});

function buildSolution(s: Y, w: string) {
  return {
    given: s.given, si: s.si, find: s.find,
    formula: s.formula ? texField(s.formula, `${w}/sol.formula`) : undefined,
    calc: s.calc ? texField(s.calc, `${w}/sol.calc`) : undefined,
    ...(s.method ? { method: md(s.method, `${w}/sol.method`) } : {}),
    ...(s.steps ? { steps: (s.steps as string[]).map((st, k) => md(st, `${w}/sol.step${k + 1}`)) } : {}),
    ...(s.check ? { check: md(s.check, `${w}/sol.check`) } : {}),
    answer: s.answer,
  };
}

// ───────────── темы и записи ─────────────
const topics: Topic[] = [];
const theory: Theory[] = [];
const formulas: Formula[] = [];
const examples: Example[] = [];
const questions: Question[] = [];
const ids = new Set<string>();
// ID тем и записей начинаются с префикса предмета: прогресс в общих таблицах сервера не смешивается между предметами.
const addId = (id: string, where: string) => {
  if (!String(id).startsWith(ID_PREFIX)) err(`${where}: ID «${id}» должен начинаться с «${ID_PREFIX}»`);
  if (ids.has(id)) err(`${where}: повторяющийся id ${id}`);
  ids.add(id);
};

const QTYPES: QuestionType[] = ['single', 'multiple', 'numeric', 'matching', 'sequence', 'text'];
const QCATS: QuestionCategory[] = ['theory', 'formula', 'problem'];
const KEYS = 'abcdefgh';

for (const f of files.filter((x) => x !== '00-structure.yaml')) {
  const doc = docs[f];
  const sub = subsections.find((s) => s.id === doc.subsection);
  if (!sub) {
    err(`${f}: подраздел ${doc.subsection} не найден`);
    continue;
  }
  for (const t of doc.topics as Y[]) {
    const tw = `${f}/${t.id}`;
    addId(t.id, tw);
    for (const p of t.pages) if (!pageIndex.has(p)) err(`${tw}: страница ${p} не существует`);
    const topicWeb = webRefs(t.web, tw);
    const mathMeta: Partial<Topic> = {};
    if (BOOK) {
      if (!t.num || !t.book?.place) err(`${tw}: у темы учебника нужны num и book.place (место в книге)`);
      if (!STAGES.includes(t.stage)) err(`${tw}: этап stage должен быть одним из ${STAGES.join(', ')}`);
      if (!t.sourcesChecked) err(`${tw}: нет даты проверки источников (sourcesChecked)`);
      Object.assign(mathMeta, { num: String(t.num), book: { place: String(t.book.place), ...(t.book.summary ? { summary: md(t.book.summary, tw) } : {}) }, stage: t.stage, ...(t.stageNote ? { stageNote: String(t.stageNote) } : {}), sourcesChecked: String(t.sourcesChecked) });
    }
    // тема может указать свой подраздел (несколько коротких подразделов в одном файле)
    const tSub = t.subsection ? subsections.find((s) => s.id === t.subsection) : sub;
    if (!tSub) err(`${tw}: подраздел ${t.subsection} не найден`);
    topics.push({ id: t.id, subsectionId: (tSub ?? sub).id, title: t.title, order: topics.length, pages: t.pages, status: 'review', ...(topicWeb ? { web: true } : {}), ...mathMeta });
    // у записей темы «из интернета» по умолчанию те же источники, что у темы
    const recWeb = (x: Y, w: string) => (x.web === false ? undefined : webRefs(x.web, w) ?? topicWeb);

    (t.theory ?? []).forEach((x: Y, i: number) => {
      const id = x.id ?? `${t.id}-t${i + 1}`;
      const w = `${tw}/${id}`;
      addId(id, w);
      const sources = refs(x.src, w);
      const body = md(x.body, w);
      let figure: string | undefined;
      if (x.fig) {
        figure = String(x.fig);
        if (!figures[figure]) err(`${w}: рисунок ${figure} не найден в content/figures`);
        usedFigures.add(figure);
      }
      theory.push({
        id, topicId: t.id, kind: x.kind, title: x.title, body, sources,
        sourceOrder: firstPageIdx(sources) * 1000 + i, status: 'review', errata: errataRefs(x.errata, w),
        // рисунок входит в хеш: изменённая анимация снова требует проверки
        hash: figure ? contentHash(x.title, body, cyrb53(figures[figure]?.svg ?? '')) : contentHash(x.title, body),
        ...(figure ? { figure } : {}),
        ...withWeb(recWeb(x, w)),
      });
    });

    const topicFormulaIds: string[] = [];
    (t.formulas ?? []).forEach((x: Y, i: number) => {
      const id = x.id ?? `${t.id}-f${i + 1}`;
      const w = `${tw}/${id}`;
      addId(id, w);
      topicFormulaIds.push(id);
      const sources = refs(x.src, w);
      for (const s of x.sym ?? []) if (!symbols[s]) err(`${w}: обозначение ${s} отсутствует в словаре`);
      const tex = texField(x.tex, w);
      const extra: Partial<Formula> = {};
      for (const k of ['meaning', 'use', 'variants', 'limits'] as const) if (x[k]) extra[k] = md(x[k], `${w}/${k}`);
      if (BOOK && (!extra.meaning || !extra.use)) err(`${w}: у формулы учебника нужны meaning (обозначения) и use (когда применять)`);
      formulas.push({
        id, topicId: t.id, title: x.title, tex, symbols: x.sym ?? [], conditions: x.cond ? md(x.cond, w) : undefined,
        boxed: !!x.boxed, manualCheck: !!x.manual, sources, sourceOrder: firstPageIdx(sources) * 1000 + i,
        status: 'review', errata: errataRefs(x.errata, w),
        // без пояснений хеш — только формула; у учебника в хеш входят и пояснения
        hash: Object.keys(extra).length || (BOOK && x.cond) ? contentHash(tex, JSON.stringify([x.cond ?? '', extra])) : contentHash(tex),
        ...extra,
        ...withWeb(recWeb(x, w)),
      });
    });

    (t.examples ?? []).forEach((x: Y, i: number) => {
      const id = x.id ?? `${t.id}-e${i + 1}`;
      const w = `${tw}/${id}`;
      addId(id, w);
      const sources = refs(x.src, w);
      const steps = (x.steps ?? []).map((s: string, k: number) => md(s, `${w}/step${k + 1}`));
      examples.push({
        id, topicId: t.id, title: x.title, given: x.given ? md(x.given, w) : undefined, steps,
        ...(x.find ? { find: md(x.find, w) } : {}), ...(x.method ? { method: md(x.method, w) } : {}), ...(x.check ? { check: md(x.check, w) } : {}),
        answer: x.answer ? md(x.answer, w) : undefined, computed: !!x.computed, sources,
        sourceOrder: firstPageIdx(sources) * 1000 + i, status: 'review', errata: errataRefs(x.errata, w),
        // поля find/method/check — у разобранных примеров учебника; без них хеш не меняется
        hash: x.find || x.method || x.check ? contentHash(x.title, steps.join(' '), [x.find, x.method, x.check, x.answer].join('|')) : contentHash(x.title, steps.join(' ')),
        ...withWeb(recWeb(x, w)),
      });
    });

    (t.questions ?? []).forEach((x: Y, i: number) => {
      const id = x.id ?? `${t.id}-q${i + 1}`;
      const w = `${tw}/${id}`;
      addId(id, w);
      if (!QTYPES.includes(x.type)) err(`${w}: неизвестный тип ${x.type}`);
      if (!QCATS.includes(x.cat)) err(`${w}: неизвестная категория ${x.cat}`);
      const sources = refs(x.src, w);
      if (!x.hint) err(`${w}: нет подсказки`);
      if (!x.explain) err(`${w}: нет объяснения`);
      const prompt = md(x.q, w);
      const q: Question = {
        id, topicId: t.id, type: x.type, category: x.cat, prompt,
        hints: [md(x.hint, `${w}/hint`)], explanation: md(x.explain, `${w}/explain`),
        formulaIds: (x.f ?? []).map((n: number | string) => {
          if (typeof n === 'string') return n;
          const fid = topicFormulaIds[n - 1];
          if (!fid) err(`${w}: ссылка на формулу №${n} вне диапазона`);
          return fid;
        }),
        sources, sourceOrder: firstPageIdx(sources) * 1000 + i, status: 'review',
        // fromSource: true — задание взято из материалов владельца; остальные составлены по материалам
        generated: x.fromSource !== true,
        hash: '',
        ...withWeb(recWeb(x, w)),
      };
      if (x.type === 'single' || x.type === 'multiple') {
        const opts: Option[] = (x.opts ?? []).map((o: string, k: number) => ({ key: KEYS[k], body: md(o, `${w}/opt${k}`) }));
        if (opts.length < 2) err(`${w}: меньше двух вариантов`);
        const keys = new Set(opts.map((o) => o.key));
        const ans = x.type === 'single' ? [String(x.ans)] : (x.ans as string[]).map(String);
        for (const a of ans) if (!keys.has(a)) err(`${w}: ответ ${a} не среди вариантов`);
        if (x.type === 'single' && Array.isArray(x.ans)) err(`${w}: у single должен быть один ответ`);
        if (x.type === 'multiple' && ans.length < 2) warn(`${w}: multiple с одним правильным ответом`);
        const bodies = opts.map((o) => o.body);
        if (new Set(bodies).size !== bodies.length) err(`${w}: одинаковые варианты ответа`);
        q.options = opts;
        q.answer = x.type === 'single' ? ans[0] : ans;
      } else if (x.type === 'numeric') {
        const n = x.num;
        if (!n || typeof n.value !== 'number') err(`${w}: нет числового ответа`);
        else {
          q.numeric = { value: n.value, unit: String(n.unit ?? ''), tol: n.tol ?? 0.02, tolAbs: n.tolAbs, check: n.check };
          if (n.check) {
            let computed: number;
            try {
              computed = Number(new Function(`return (${n.check});`)());
            } catch (e) {
              err(`${w}: выражение check не вычисляется: ${(e as Error).message}`);
              computed = NaN;
            }
            const tolerance = Math.max(Math.abs(computed) * 0.005, n.tolAbs ?? 1e-9);
            if (!Number.isFinite(computed) || Math.abs(computed - n.value) > tolerance)
              err(`${w}: эталон ${n.value} не совпадает с пересчётом ${computed}`);
          } else warn(`${w}: нет независимой проверки check`);
        }
        if (x.sol) {
          q.solution = buildSolution(x.sol, w);
        } else if (x.cat === 'problem') warn(`${w}: расчётная задача без пошагового решения`);
      } else if (x.type === 'matching') {
        const pairs = (x.pairs ?? []).map((p: [string, string], k: number) => [md(p[0], `${w}/pair${k}L`), md(p[1], `${w}/pair${k}R`)] as [string, string]);
        if (pairs.length < 2) err(`${w}: меньше двух пар`);
        if (new Set(pairs.map((p: [string, string]) => p[1])).size !== pairs.length) err(`${w}: повторяются правые части`);
        q.pairs = pairs;
      } else if (x.type === 'sequence') {
        const seq = (x.seq ?? []).map((s: string, k: number) => md(s, `${w}/seq${k}`));
        if (seq.length < 3) err(`${w}: последовательность короче трёх`);
        q.sequence = seq;
      } else if (x.type === 'text') {
        if (!x.ref) err(`${w}: нет эталонного ответа`);
        q.reference = md(x.ref, `${w}/ref`);
        q.criteria = (x.criteria ?? []).map((c: string) => md(c, `${w}/criteria`));
      }
      // пошаговое решение может быть и у задачи с выбором ответа
      if (x.sol && !q.solution) q.solution = buildSolution(x.sol, w);
      if (BOOK && x.cat === 'problem' && !q.solution) err(`${w}: у задачи учебника нужно пошаговое решение (sol)`);
      q.hash = contentHash(q.type, prompt, JSON.stringify(q.options?.map((o) => o.body) ?? q.pairs ?? q.sequence ?? q.numeric?.value ?? ''));
      questions.push(q);
    });
  }
}

// ───────────── вид для студентов ─────────────
// content/subjects/<id>/student.yaml: тексты записей без замечаний к источнику (исходные записи не меняются).
// Текст для студентов входит в хеш: изменённая запись снова требует утверждения.
const STUDENT_FILE = path.join(BASE, 'student.yaml');
const studentStats = { records: 0, hidden: 0, symbols: 0 };
if (fs.existsSync(STUDENT_FILE)) {
  let sv: Y = {};
  try {
    sv = yaml.load(fs.readFileSync(STUDENT_FILE, 'utf8')) ?? {};
  } catch (e) {
    err(`${path.basename(STUDENT_FILE)}: ошибка YAML — ${(e as Error).message}`);
  }
  const ALLOWED: Record<string, string[]> = {
    theory: ['title', 'body', 'hide'],
    formulas: ['title', 'tex'],
    examples: ['title', 'given', 'steps', 'answer'],
    questions: ['prompt', 'hints', 'explanation', 'reference'],
  };
  const byId = new Map<string, [string, Theory | Formula | Example | Question]>();
  for (const [kind, list] of [['theory', theory], ['formulas', formulas], ['examples', examples], ['questions', questions]] as const)
    for (const e of list as (Theory | Formula | Example | Question)[]) byId.set(e.id, [kind, e]);
  for (const [id, o] of Object.entries<Y>(sv.records ?? {})) {
    const w = `student/${id}`;
    const hit = byId.get(id);
    if (!hit) { err(`${w}: запись не найдена`); continue; }
    const [kind, e] = hit;
    const st: Record<string, unknown> = {};
    for (const [k, v] of Object.entries<Y>(o ?? {})) {
      if (!ALLOWED[kind].includes(k)) { err(`${w}: поле ${k} нельзя переопределить у записи типа ${kind}`); continue; }
      if (k === 'hide') { if (v === true) st.hide = true; continue; }
      if (k === 'tex') st.tex = texField(v, `${w}/tex`);
      else if (k === 'steps' || k === 'hints') st[k] = (Array.isArray(v) ? v : [v]).map((x: unknown, i: number) => md(x, `${w}/${k}${i + 1}`));
      else if (k === 'title') st.title = String(v);
      else st[k] = md(v, `${w}/${k}`);
    }
    if (!Object.keys(st).length) { warn(`${w}: пустое переопределение`); continue; }
    (e as { student?: Record<string, unknown> }).student = st;
    e.hash = contentHash(e.hash, JSON.stringify(st));
    studentStats.records++;
    if (st.hide) studentStats.hidden++;
  }
  for (const [key, o] of Object.entries<Y>(sv.symbols ?? {})) {
    const w = `student/symbol ${key}`;
    if (!symbols[key]) { err(`${w}: обозначение не найдено`); continue; }
    const st: { meaning?: string; tex?: string } = {};
    if (o?.meaning) st.meaning = md(o.meaning, w);
    if (o?.tex) st.tex = texField(o.tex, w);
    symbols[key].student = st;
    studentStats.symbols++;
  }
}

// ───────────── решения проверки ─────────────
// Решение применяется, только если запись не менялась после проверки (совпадает хеш содержимого).
const decided = { approved: 0, rejected: 0, other: 0, stale: [] as string[] };
if (fs.existsSync(DECISIONS)) {
  const file = JSON.parse(fs.readFileSync(DECISIONS, 'utf8')) as { decisions?: Record<string, { status: string; hash: string }> };
  const byId = new Map<string, Theory | Formula | Example | Question>([...theory, ...formulas, ...examples, ...questions].map((e) => [e.id, e]));
  for (const [id, d] of Object.entries(file.decisions ?? {})) {
    const e = byId.get(id);
    if (!e || d.hash !== e.hash) { decided.stale.push(id); continue; }
    if (!['approved', 'rejected', 'review', 'draft'].includes(d.status)) { err(`decisions.json: ${id} — неизвестный статус ${d.status}`); continue; }
    e.status = d.status as Question['status'];
    if (d.status === 'approved') decided.approved++;
    else if (d.status === 'rejected') decided.rejected++;
    else decided.other++;
  }
}

// ───────────── дубли ─────────────
let duplicates = 0;
const seen = new Map<string, string>();
for (const q of questions) {
  const prev = seen.get(q.hash);
  if (prev) {
    duplicates++;
    err(`Дубль вопроса: ${q.id} совпадает с ${prev}`);
  } else seen.set(q.hash, q.id);
}
for (const id of errataIds) if (!usedErrata.has(id)) {
  // замечание может относиться к странице без отдельной записи — это допустимо
}

for (const id of Object.keys(figures)) if (!usedFigures.has(id)) warn(`Рисунок ${id} нигде не используется`);

// ───────────── охват страниц ─────────────
const covered = new Set<string>();
for (const coll of [theory, formulas, examples, questions]) for (const e of coll) for (const s of e.sources) covered.add(s.page);
for (const t of topics) for (const p of t.pages) covered.add(p);
const uncovered = pages.filter((p) => !covered.has(p.ref)).map((p) => p.ref);
// Учебник наполняется по порядку тем, поэтому страницы без записей — это ещё не наполненная часть курса.
if (uncovered.length && !BOOK) warn(`Страницы без записей: ${uncovered.join(', ')}`);

// ───────────── план курса по оглавлению книги (учебник) ─────────────
const plan: PlanItem[] = [];
if (BOOK) {
  const topicNums = new Set(topics.map((t) => t.num));
  for (const p of (structure.plan ?? []) as Y[]) {
    const w = `plan ${p.num}`;
    const sub = subsections.find((s) => s.id === p.subsectionId);
    if (!sub) err(`${w}: подраздел ${p.subsectionId} не найден`);
    if (!STAGES.includes(p.stage ?? 'extracted')) err(`${w}: неизвестный этап ${p.stage}`);
    for (const pg of p.pages ?? []) if (!pageIndex.has(pg)) err(`${w}: страница ${pg} не существует`);
    if (topicNums.has(String(p.num))) continue; // пункт уже наполнен — показывается как тема
    plan.push({ id: `plan-${p.num}`, subsectionId: p.subsectionId, num: String(p.num), title: String(p.title), pages: (p.pages ?? []).map(String), stage: p.stage ?? 'extracted', ...(p.note ? { note: String(p.note) } : {}) });
  }
  // каждая тема должна быть пунктом оглавления — так не появляются темы «от себя»
  const planNums = new Set(((structure.plan ?? []) as Y[]).map((p) => String(p.num)));
  for (const t of topics) if (!planNums.has(String(t.num))) err(`${t.id}: пункта ${t.num} нет в оглавлении (plan)`);
}

// ───────────── отчёты по каждому файлу ─────────────
const generatedAt = new Date().toISOString();
// запись относится к файлу своего первого источника (иначе запись со ссылками на два конспекта считалась бы дважды)
const inFile = (fid: string) => (e: { sources: SourceRef[] }) => e.sources[0]?.file === fid;
const reports: ImportReport[] = sourceFilesSrc.map((sf) => {
  const filePages = pages.filter((p) => p.file === sf.id).map((p) => p.ref);
  const th = theory.filter(inFile(sf.id)), fo = formulas.filter(inFile(sf.id)), ex = examples.filter(inFile(sf.id)), qs = questions.filter(inFile(sf.id));
  const tp = topics.filter((t) => t.pages.some((p) => filePages.includes(p)));
  return {
    fileId: sf.id, fileName: sf.fileName, generatedAt, pdfPages: sf.pdfPages, pagesProcessed: filePages.length, pagesUnreadable: [],
    topics: tp.length, theory: th.length, formulas: fo.length, formulasManualCheck: fo.filter((f) => f.manualCheck || f.errata?.length).length,
    examples: ex.length, questionsInSource: qs.filter((q) => !q.generated).length, questionsGenerated: qs.filter((q) => q.generated).length, recordsForReview: th.length + fo.length + ex.length + qs.length,
    addedFromWeb: [...th, ...fo, ...ex, ...qs].filter((e) => e.web).length,
    errata: errata.filter((e) => filePages.includes(e.page)).length, duplicatesSkipped: duplicates,
    notes: (sf.notes ?? []) as string[],
  };
});

const pack: ContentPack = {
  schema: 1,
  version: `1.0.${Math.floor(Date.now() / 1000)}`,
  builtAt: new Date().toISOString(),
  course: structure.course,
  // pagePrefix и pageLabel остаются в пакете: по ним интерфейс подписывает страницы (src/domain/page-label.ts)
  sourceFiles: sourceFilesSrc.map((sf) => { const { notes: _n, ...rest } = sf; return { ...rest, importedAt: generatedAt }; }),
  pages,
  sections,
  subsections,
  topics,
  symbols,
  theory,
  formulas,
  examples,
  questions,
  errata,
  reports,
  figures,
  ...(BOOK ? { plan } : {}),
};

finish();

function finish(): never {
  const strict = process.argv.includes('--strict');
  for (const w of warnings) console.warn('⚠', w);
  for (const e of errors) console.error('✖', e);
  if (errors.length || (strict && warnings.length)) {
    console.error(`\nСборка остановлена: ошибок ${errors.length}, предупреждений ${warnings.length}.`);
    process.exit(1);
  }
  // стабильная версия: не меняем version, если содержимое не изменилось
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const strip = (p: Y) => JSON.stringify({ ...p, version: '', builtAt: '', reports: p.reports.map((r: Y) => ({ ...r, generatedAt: '' })), sourceFiles: p.sourceFiles.map((s: Y) => ({ ...s, importedAt: '' })) });
  if (prev && strip(prev) === strip(pack)) {
    console.log('Содержимое не изменилось — pack.json оставлен без изменений.');
  } else {
    fs.writeFileSync(OUT, JSON.stringify(pack));
    writeReport();
  }
  const byType = questions.reduce<Record<string, number>>((a, q) => ((a[q.type] = (a[q.type] ?? 0) + 1), a), {});
  console.log(
    `OK: страниц ${pages.length}, тем ${topics.length}, теория ${theory.length}, формул ${formulas.length}, примеров ${examples.length}, ` +
      `вопросов ${questions.length} ${JSON.stringify(byType)}, замечаний ${errata.length}, из интернета ${webCount}, рисунков ${Object.keys(figures).length}, проверок KaTeX ${katexChecks}, предупреждений ${warnings.length}.`,
  );
  if (studentStats.records || studentStats.symbols) console.log(`Вид для студентов: записей ${studentStats.records} (из них скрыто ${studentStats.hidden}), обозначений ${studentStats.symbols}.`);
  if (fs.existsSync(DECISIONS))
    console.log(`Решения проверки: утверждено ${decided.approved}, отклонено ${decided.rejected}, другое ${decided.other}; устарело (запись изменилась) ${decided.stale.length}.`);
  process.exit(0);
}

function writeReport() {
  const sev: Record<string, string> = { error: 'ошибка', typo: 'описка', unclear: 'неясно', note: 'замечание' };
  const byType = (qs: Question[], t: string) => qs.filter((q) => q.type === t).length;
  const parts = reports.map((r) => {
    const filePages = new Set(pages.filter((p) => p.file === r.fileId).map((p) => p.ref));
    const qs = questions.filter(inFile(r.fileId));
    const bySub = subsections
      .map((s) => {
        const ts = topics.filter((t) => t.subsectionId === s.id && t.pages.some((p) => filePages.has(p)));
        if (!ts.length) return '';
        const tIds = new Set(ts.map((t) => t.id));
        return `| ${s.title} | ${ts.length} | ${theory.filter((x) => tIds.has(x.topicId)).length} | ${formulas.filter((x) => tIds.has(x.topicId)).length} | ${examples.filter((x) => tIds.has(x.topicId)).length} | ${questions.filter((x) => tIds.has(x.topicId)).length} |`;
      })
      .filter(Boolean);
    const er = errata.filter((e) => filePages.has(e.page));
    return `# Отчёт об импорте: ${r.fileName}

| Показатель | Значение |
|---|---|
| Листов PDF | ${r.pdfPages} |
| Обработано страниц | ${r.pagesProcessed} |
| Страниц, которые не удалось прочитать | ${r.pagesUnreadable.length} |
| Тем | ${r.topics} |
| Блоков теории | ${r.theory} |
| Формул | ${r.formulas} (из них требуют ручной проверки: ${r.formulasManualCheck}) |
| Разобранных примеров (задач) из источника | ${r.examples} |
| Заданий из источника (fromSource) | ${r.questionsInSource} |
| Составлено вопросов по материалам | ${r.questionsGenerated} |
| Записей на проверке | ${r.recordsForReview} |
| Замечаний к источнику | ${r.errata} |
| Дополнено из интернета на место пробелов (по вашей просьбе, на проверке) | ${r.addedFromWeb ?? 0} |

Вопросы по типам: один ответ — ${byType(qs, 'single')}, несколько ответов — ${byType(qs, 'multiple')}, числовой — ${byType(qs, 'numeric')}, соответствие — ${byType(qs, 'matching')}, последовательность — ${byType(qs, 'sequence')}, текстовый — ${byType(qs, 'text')}.

| Подраздел | Тем | Теория | Формул | Примеров | Вопросов |
|---|---|---|---|---|---|
${bySub.join('\n')}

${r.notes.map((n) => `- ${n}`).join('\n')}
- Все записи имеют статус **«на проверке»**; вопросы попадут в тесты только после утверждения в админ-панели.

## Замечания к источнику (оригинал сохранён)

| № | Стр. | Тип | К чему | Как в источнике | Что не так | Предложение | Что нужно от вас |
|---|---|---|---|---|---|---|---|
${er.map((e) => `| ${e.id} | ${e.page} | ${sev[e.severity]} | ${e.target ?? ''} | ${e.original} | ${e.issue} | ${e.suggestion} | ${e.todo ?? ''} |`).join('\n')}
`;
  });
  if (BOOK) return writeBookReport();
  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  const intro = `# ${SUBJ!.title}: отчёт об импорте материалов\n\nСформировано автоматически инструментом \`tools/build-content.ts --subject ${SUBJ!.id}\` (${generatedAt.slice(0, 10)}). Каждый числовой ответ с полем check пересчитан независимым выражением, каждая формула проверена рендером KaTeX (${katexChecks} проверок).\n\n`;
  const empty = '**Материалы ещё не добавлены.** Предмет есть в приложении и показывается со статусом «курс готовится».\n';
  fs.writeFileSync(REPORT_MD, intro + (parts.length ? parts.join('\n\n').replace(/^# /gm, '## ') : empty));
}

/** Отчёт по учебнику: полный план курса по оглавлению книги и состояние каждой темы. */
function writeBookReport() {
  const stageRu: Record<string, string> = { extracted: 'извлечено', prepared: 'подготовлено', 'needs-check': 'требует проверки', verified: 'проверено' };
  const planAll = (structure.plan ?? []) as Y[];
  const filled = new Map(topics.map((t) => [t.num, t]));
  const lines: string[] = [];
  for (const sec of sections) {
    const subs = subsections.filter((s) => s.sectionId === sec.id);
    if (!subs.length) continue;
    lines.push(`\n## ${sec.title}\n`);
    for (const sub of subs) {
      lines.push(`\n### ${sub.title}\n\n| № | Пункт оглавления | Стр. книги | Этап | Теория | Формул | Примеров | Вопросов |\n|---|---|---|---|---|---|---|---|`);
      for (const p of planAll.filter((x) => x.subsectionId === sub.id)) {
        const t = filled.get(String(p.num));
        const c = (arr: { topicId: string }[]) => (t ? arr.filter((x) => x.topicId === t.id).length : 0);
        const pg = ((t?.pages ?? p.pages ?? []) as string[]).map((r) => String(Number(r.slice(1)))).join(', ');
        lines.push(`| ${p.num} | ${t ? t.title : p.title} | ${pg} | ${stageRu[t?.stage ?? p.stage ?? 'extracted']} | ${c(theory)} | ${c(formulas)} | ${c(examples)} | ${c(questions)} |`);
      }
    }
  }
  const done = topics.length;
  const next = planAll.find((p) => !filled.has(String(p.num)));
  const head = `# ${SUBJ!.title}: план курса по книге и состояние наполнения

Сформировано автоматически инструментом \`tools/build-content.ts --subject ${SUBJ!.id}\` (${generatedAt.slice(0, 10)}).

Источник порядка тем — оглавление книги «${structure.course.book ?? ''}». Пунктов оглавления: ${planAll.length}; наполнено тем: ${done}; осталось: ${planAll.length - done}.
Записей: теория ${theory.length}, формул ${formulas.length}, разобранных примеров ${examples.length}, вопросов и задач ${questions.length}; проверок KaTeX ${katexChecks}.
Все записи имеют статус «на проверке» и попадут в тесты только после утверждения в админ-панели.

**Где продолжить:** ${next ? `следующий пункт по порядку книги — ${next.num} «${next.title}» (с. ${(next.pages ?? []).map((r: string) => Number(r.slice(1))).join(', ')}).` : 'все пункты оглавления наполнены.'}

Этапы: **извлечено** — пункт взят из оглавления, содержания ещё нет; **подготовлено** — теория, формулы, примеры и задачи написаны;
**требует проверки** — есть сомнение или расхождение источников; **проверено** — все ответы пересчитаны независимо, формулы проверены рендером и контрольными примерами.
«Утверждено» ставит администратор по каждой записи, «опубликовано» — версия на сервере.
`;
  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  fs.writeFileSync(REPORT_MD, head + lines.join('\n') + '\n');
}

/** src/data/packs.generated.ts — статические импорты учебных баз всех предметов из content/subjects.json.
 *  Предмет без собранной базы получает пустую заготовку (её создаёт npm run content:build). */
function writePacksModule() {
  const list = SUBJECTS_CFG.subjects;
  const out = FIXTURE ? path.join(CONTENT, 'packs.generated.ts') : path.join(ROOT, 'src/data/packs.generated.ts');
  const rel = (id: string) => path.relative(path.dirname(out), path.join(CONTENT, 'subjects', id, 'pack.json')).split(path.sep).join('/');
  const ident = (id: string) => `pack_${id.replace(/[^a-z0-9]/gi, '_')}`;
  const text = `// Создано tools/build-content.ts по ${path.relative(ROOT, path.join(CONTENT, 'subjects.json')).split(path.sep).join('/')} — не редактировать вручную.
${list.map((x) => `import ${ident(x.id)} from '${rel(x.id).startsWith('.') ? '' : './'}${rel(x.id)}';`).join('\n')}

export const PACKS: Record<string, unknown> = {
${list.map((x) => `  ${JSON.stringify(x.id)}: ${ident(x.id)},`).join('\n')}
};
`;
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) fs.writeFileSync(out, text);
}
