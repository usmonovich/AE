// Релизная учебная база для приложения в магазинах (Google Play, App Store).
//
// В опубликованной странице (артефакте) решения администратора хранятся отдельно от учебной базы
// и применяются при запуске. Установленное приложение к этой базе доступа не имеет, поэтому перед
// сборкой решения «впекаются» в пакет: в релиз попадают ТОЛЬКО утверждённые записи. Записи «на проверке»
// и отклонённые удаляются из пакета целиком — их нельзя увидеть даже через предпросмотр админ-панели.
//
// Запуск:  npx tsx tools/release-pack.ts [--subject <id>] [--overlay <путь>]   (id — из content/subjects.json)
//   --overlay — решения администратора одним из способов:
//     • папка с частями c0.json, c1.json, … (документы ae/<id>/admin/chunks базы артефакта);
//     • файл резервной копии из «Админ-панель → Публикация → Сохранить копию»;
//     • файл с самим оверлеем ({ version: 1, patches, … }).
//   По умолчанию: content/release/overlays/<предмет>/.
// Результат: content/release/<предмет>.json и сводка content/release/REPORT-<предмет>.md.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ContentIndex, emptyOverlay } from '../src/domain/content-index';
import type { AdminOverlay, ContentPack, PlanItem, Topic } from '../src/domain/types';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUBJECTS: Record<string, { pack: string; title: string }> = Object.fromEntries(
  (JSON.parse(fs.readFileSync(path.join(root, 'content/subjects.json'), 'utf8')).subjects as { id: string; title: string }[])
    .map((x) => [x.id, { pack: `content/subjects/${x.id}/pack.json`, title: x.title }]),
);
type Subject = string;

export function readOverlay(p: string): AdminOverlay {
  const stat = fs.statSync(p);
  let data: unknown;
  if (stat.isDirectory()) {
    const parts = fs.readdirSync(p).filter((f) => /^c\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
    if (!parts.length) throw new Error(`${p}: нет файлов c0.json, c1.json, …`);
    parts.forEach((f, i) => { if (f !== `c${i}.json`) throw new Error(`${p}: пропущена часть c${i}.json`); });
    const text = parts.map((f) => {
      const d = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8'));
      return typeof d.s === 'string' ? d.s : (d.data?.s as string);
    }).join('');
    data = JSON.parse(text);
  } else {
    data = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  const o = (data as { overlay?: AdminOverlay }).overlay ?? (data as AdminOverlay);
  if (o?.version !== 1 || typeof o.patches !== 'object') throw new Error(`${p}: это не решения администратора (нет version: 1 и patches)`);
  return { ...emptyOverlay(), ...o, added: { ...emptyOverlay().added, ...(o.added ?? {}) } };
}

export interface ReleaseStats {
  kept: Record<string, number>;
  dropped: Record<string, { review: number; rejected: number }>;
  stale: string[];
  topicsKept: number;
  topicsDropped: string[];
  danglingFormulaRefs: number;
}

/** Пакет только из утверждённых записей. Чистая функция: используется и инструментом, и тестами. */
export function buildReleasePack(pack: ContentPack, overlay: AdminOverlay): { pack: ContentPack; stats: ReleaseStats } {
  const idx = new ContentIndex(pack, overlay);
  const stats: ReleaseStats = { kept: {}, dropped: {}, stale: idx.staleDecisions(), topicsKept: 0, topicsDropped: [], danglingFormulaRefs: 0 };
  // замечания к конспекту и исходные тексты — только для админ-панели: в релиз не попадают
  const clean = <T extends { errata?: string[]; student?: unknown }>(x: T): T => {
    const { errata: _e, student: _s, ...rest } = x;
    void _e; void _s;
    return rest as T;
  };
  const keep = <T extends { status: string; errata?: string[]; student?: unknown }>(kind: string, list: T[]): T[] => {
    const out = list.filter((x) => x.status === 'approved').map(clean);
    stats.kept[kind] = out.length;
    stats.dropped[kind] = {
      review: list.filter((x) => x.status === 'review' || x.status === 'draft').length,
      rejected: list.filter((x) => x.status === 'rejected').length,
    };
    return out;
  };
  const theory = keep('theory', idx.theory);
  const formulas = keep('formulas', idx.formulas);
  const examples = keep('examples', idx.examples);
  const formulaIds = new Set(formulas.map((f) => f.id));
  const questions = keep('questions', idx.questions).map((q) => {
    const refs = q.formulaIds.filter((id) => formulaIds.has(id));
    stats.danglingFormulaRefs += q.formulaIds.length - refs.length;
    return refs.length === q.formulaIds.length ? q : { ...q, formulaIds: refs };
  });

  const used = new Set([...theory, ...formulas, ...examples, ...questions].map((r) => r.topicId));
  const topics: Topic[] = [];
  const plan: PlanItem[] = [...(pack.plan ?? [])];
  for (const t of idx.topics) {
    if (t.status === 'rejected') { stats.topicsDropped.push(t.id); continue; }
    if (used.has(t.id)) { topics.push(t); continue; }
    stats.topicsDropped.push(t.id);
    // у учебника (style: book) пункт книги остаётся в плане курса («готовится»), чтобы порядок книги не терялся
    if (t.num) plan.push({ id: t.id, subsectionId: t.subsectionId, num: t.num, title: t.title, pages: t.pages, stage: 'prepared' });
  }
  stats.topicsKept = topics.length;

  const out: ContentPack = {
    ...pack,
    version: overlay.publishedVersion ?? pack.version,
    sections: idx.sections,
    subsections: idx.subsections,
    topics,
    theory,
    formulas,
    examples,
    questions,
    errata: [],
    // обозначения — в виде для студентов
    symbols: Object.fromEntries(Object.keys(pack.symbols).map((k) => {
      const { student: _st, ...sym } = idx.symbol(k)!;
      void _st;
      return [k, sym];
    })),
  };
  if (pack.plan || plan.length) out.plan = plan;
  return { pack: out, stats };
}

function report(subject: Subject, overlayPath: string | null, s: ReleaseStats): string {
  const kinds = ['theory', 'formulas', 'examples', 'questions'];
  const names: Record<string, string> = { theory: 'Теория', formulas: 'Формулы', examples: 'Примеры', questions: 'Задания' };
  const rows = kinds.map((k) => `| ${names[k]} | ${s.kept[k]} | ${s.dropped[k].review} | ${s.dropped[k].rejected} |`).join('\n');
  return `# Релизная учебная база: ${SUBJECTS[subject].title}

Сформировано \`tools/release-pack.ts\` (${new Date().toISOString().slice(0, 10)}). Решения администратора: ${overlayPath ? `\`${path.relative(root, overlayPath) || overlayPath}\`` : 'нет (учебная база предмета пока пустая)'}.
В релиз входят только утверждённые записи; записи на проверке и отклонённые в пакет не попадают.

| Записи | В релизе (утверждено) | Не вошло: на проверке | Не вошло: отклонено |
|---|---|---|---|
${rows}

Тем в релизе: ${s.topicsKept}; без утверждённых записей (не показываются): ${s.topicsDropped.length}.
Устаревших решений (запись изменилась после проверки — снова на проверке): ${s.stale.length}${s.stale.length ? ` — ${s.stale.slice(0, 20).join(', ')}${s.stale.length > 20 ? ', …' : ''}` : ''}.
Ссылок заданий на неутверждённые формулы убрано: ${s.danglingFormulaRefs}.
`;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const only = opt('--subject') as Subject | undefined;
  if (only && !(only in SUBJECTS)) throw new Error(`--subject: ${Object.keys(SUBJECTS).join(' | ')}`);
  const outDir = path.join(root, 'content/release');
  fs.mkdirSync(outDir, { recursive: true });
  for (const subject of (only ? [only] : Object.keys(SUBJECTS)) as Subject[]) {
    const raw = fs.readFileSync(path.join(root, SUBJECTS[subject].pack));
    const pack: ContentPack = JSON.parse(raw.toString('utf8'));
    let overlayPath: string | null = path.resolve(opt('--overlay') ?? path.join(outDir, 'overlays', subject));
    if (!fs.existsSync(overlayPath)) {
      // без решений администратора релиз возможен только для пустой учебной базы — иначе это забытая выгрузка
      const records = pack.theory.length + pack.formulas.length + pack.examples.length + pack.questions.length;
      if (records) throw new Error(`${subject}: нет решений администратора (${overlayPath}) — выгрузите их из админ-панели`);
      overlayPath = null;
    }
    const { pack: rel, stats } = buildReleasePack(pack, overlayPath ? readOverlay(overlayPath) : emptyOverlay());
    fs.writeFileSync(path.join(outDir, `${subject}.json`), JSON.stringify(rel));
    fs.writeFileSync(path.join(outDir, `${subject}.meta.json`), JSON.stringify({
      sourcePack: SUBJECTS[subject].pack,
      sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'),
      overlay: overlayPath ? path.relative(root, overlayPath).split(path.sep).join('/') : null,
      createdAt: new Date().toISOString(),
      kept: stats.kept,
    }, null, 2) + '\n');
    const md = report(subject, overlayPath, stats);
    fs.writeFileSync(path.join(outDir, `REPORT-${subject}.md`), md);
    console.log(md);
  }
}

// запуск как программы (а не импорт из тестов); сравнение по имени файла надёжно и в Windows
if (/[\\/]tools[\\/]release-pack\.ts$/.test(process.argv[1] ?? '')) main();
