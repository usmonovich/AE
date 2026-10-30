// Действия администратора в локальном режиме: правки хранятся оверлеем поверх встроенного пакета.
// При подключённом Supabase «Опубликовать» отправляет итоговый пакет на сервер (см. sync.ts).

import { adminStore, getIndex, pack, subject } from './store';
import { SUBJECTS } from './subjects';
import { ContentIndex } from '../domain/content-index';
import { contentHash } from '../domain/hash';
import { checkAdminPin } from './admin-pin';
import { uid } from '../domain/random';
import type { AdminOverlay, ContentPack, Question, Section, Status, Subsection, Topic, UploadedFileRecord } from '../domain/types';

const nowIso = () => new Date().toISOString();

function upd(fn: (o: AdminOverlay) => AdminOverlay) {
  adminStore.update(fn);
}
export function log(level: 'info' | 'warn' | 'error', message: string) {
  upd((o) => ({ ...o, log: [{ at: nowIso(), level, message }, ...o.log].slice(0, 300) }));
}

// ───── PIN ─────
async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// PIN один — владельца: хранится только хеш (src/data/admin-pin.ts), задать свой PIN в приложении нельзя.
export async function verifyPin(pin: string): Promise<boolean> {
  try {
    return await checkAdminPin(pin);
  } catch {
    return false;
  }
}

// ───── статусы и правки ─────
// К каждому решению привязан хеш содержимого записи (baseHash). Если запись в учебной базе потом
// изменится (например, исправлен текст вопроса), решение перестаёт действовать и запись снова
// попадает в очередь проверки — непроверенный текст не может «унаследовать» утверждение.
const baseHashes: Record<string, Map<string, string>> = {};
function baseHashOf(id: string): string | undefined {
  const m = (baseHashes[subject] ??= new Map([...pack.theory, ...pack.formulas, ...pack.examples, ...pack.questions].map((e) => [e.id, e.hash])));
  return m.get(id);
}
const withBase = (id: string, p: Record<string, unknown>) => {
  const h = baseHashOf(id);
  return h ? { ...p, baseHash: h } : p;
};

export function setStatus(ids: string[], status: Status) {
  if (!ids.length) return;
  upd((o) => {
    const patches = { ...o.patches };
    for (const id of ids) patches[id] = withBase(id, { ...patches[id], status });
    return { ...o, patches };
  });
  const verb = { approved: 'Утверждено', rejected: 'Отклонено', review: 'Возвращено на проверку', draft: 'Черновик' }[status];
  log('info', `${verb}: ${ids.length} зап.`);
}

export function patchEntity(id: string, fields: Record<string, unknown>) {
  upd((o) => ({ ...o, patches: { ...o.patches, [id]: withBase(id, { ...o.patches[id], ...fields }) } }));
  log('info', `Изменена запись ${id}`);
}

export function revertEntity(id: string) {
  upd((o) => {
    const patches = { ...o.patches };
    delete patches[id];
    return { ...o, patches };
  });
  log('info', `Правки записи ${id} отменены`);
}

export function setPreviewReview(on: boolean) {
  upd((o) => ({ ...o, previewReview: on }));
}

export function resolveErratum(id: string, resolution: 'open' | 'accepted' | 'kept') {
  upd((o) => ({ ...o, errataResolutions: { ...o.errataResolutions, [id]: resolution } }));
  log('info', `Замечание ${id}: ${resolution === 'accepted' ? 'исправление принято' : resolution === 'kept' ? 'оставлен оригинал' : 'открыто'}`);
}

// ───── структура ─────
export function renameNode(id: string, title: string) {
  patchEntity(id, { title: title.trim() });
}
export function setSectionStatus(id: string, status: Section['status']) {
  patchEntity(id, { status });
}
export function moveTopic(topicId: string, subsectionId: string) {
  patchEntity(topicId, { subsectionId });
}
/** Перемещает элемент на одну позицию среди соседей, меняя местами значения order. */
export function reorder(kind: 'topic' | 'subsection', id: string, dir: -1 | 1) {
  const idx = getIndex();
  const list: (Topic | Subsection)[] =
    kind === 'topic'
      ? idx.topics.filter((t) => t.subsectionId === idx.topic(id)?.subsectionId)
      : idx.subsections.filter((s) => s.sectionId === idx.subsection(id)?.sectionId);
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  upd((o) => ({ ...o, patches: { ...o.patches, [a.id]: { ...o.patches[a.id], order: b.order }, [b.id]: { ...o.patches[b.id], order: a.order } } }));
}
export function addSubsection(sectionId: string, title: string) {
  const idx = getIndex();
  const order = Math.max(-1, ...idx.subsections.map((s) => s.order)) + 1;
  const s: Subsection = { id: uid('sub_'), sectionId, title: title.trim(), order };
  upd((o) => ({ ...o, added: { ...o.added, subsections: [...o.added.subsections, s] } }));
  log('info', `Добавлен подраздел «${s.title}»`);
  return s;
}
export function addTopic(subsectionId: string, title: string) {
  const idx = getIndex();
  const order = Math.max(-1, ...idx.topics.map((t) => t.order)) + 1;
  const t: Topic = { id: uid('topic_'), subsectionId, title: title.trim(), order, pages: [], status: 'review' };
  upd((o) => ({ ...o, added: { ...o.added, topics: [...o.added.topics, t] } }));
  log('info', `Добавлена тема «${t.title}»`);
  return t;
}

// ───── дубликаты ─────
export function duplicateGroups(): Question[][] {
  const idx = getIndex();
  const groups = new Map<string, Question[]>();
  for (const q of idx.questions) {
    if (q.status === 'rejected') continue;
    const h = contentHash(q.type, q.prompt);
    groups.set(h, [...(groups.get(h) ?? []), q]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

// ───── экспорт / импорт ─────
export function buildMergedPack(): ContentPack {
  const idx = getIndex();
  const o = adminStore.get();
  return {
    ...pack,
    version: o.publishedVersion ?? pack.version,
    builtAt: nowIso(),
    sections: idx.sections,
    subsections: idx.subsections,
    topics: idx.topics,
    theory: idx.theory,
    formulas: idx.formulas,
    examples: idx.examples,
    questions: idx.questions,
    errata: idx.errata,
  };
}

export function publish(): string {
  const parts = (pack.version.split('.').map(Number) as number[]).concat([0, 0, 0]);
  const prev = adminStore.get().publishedVersion;
  const base = prev ? prev.split('.').map(Number) : parts;
  const version = `${base[0]}.${base[1]}.${(base[2] ?? 0) + 1}`;
  upd((o) => ({ ...o, publishedVersion: version, publishedAt: nowIso() }));
  log('info', `Опубликована версия учебной базы ${version}`);
  return version;
}

export interface ImportResult { ok: boolean; added: number; duplicates: number; message: string }

/** Импорт пакета: новые вопросы добавляются со статусом «на проверке», дубли пропускаются. */
export function importPack(text: string): ImportResult {
  let data: ContentPack;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, added: 0, duplicates: 0, message: 'Файл не является JSON.' };
  }
  if (data?.schema !== 1 || !Array.isArray(data.questions)) return { ok: false, added: 0, duplicates: 0, message: 'Это не пакет учебной базы (нет schema: 1).' };
  const idx = getIndex();
  const known = new Set(idx.questions.map((q) => contentHash(q.type, q.prompt)));
  const knownIds = new Set(idx.questions.map((q) => q.id));
  const topics = new Set(idx.topics.map((t) => t.id));
  let added = 0, duplicates = 0, skipped = 0;
  const fresh: Question[] = [];
  for (const q of data.questions) {
    const h = contentHash(q.type, q.prompt);
    if (known.has(h) || knownIds.has(q.id)) {
      duplicates++;
      continue;
    }
    if (!topics.has(q.topicId)) {
      skipped++;
      continue;
    }
    known.add(h);
    fresh.push({ ...q, status: 'review' });
    added++;
  }
  upd((o) => ({ ...o, added: { ...o.added, questions: [...o.added.questions, ...fresh] } }));
  const message = `Добавлено вопросов: ${added}; дублей пропущено: ${duplicates}${skipped ? `; без известной темы: ${skipped}` : ''}.`;
  log(added ? 'info' : 'warn', `Импорт пакета: ${message}`);
  return { ok: true, added, duplicates, message };
}

/** У каждого предмета свой вид резервной копии (SUBJECTS[id].backupKind). */
const backupKind = () => SUBJECTS[subject].backupKind;
export function exportBackup(): string {
  return JSON.stringify({ kind: backupKind(), exportedAt: nowIso(), overlay: adminStore.get() });
}
export function restoreBackup(text: string): { ok: boolean; message: string } {
  try {
    const d = JSON.parse(text);
    if (d?.kind !== backupKind() || d.overlay?.version !== 1) return { ok: false, message: d?.kind?.endsWith('admin-backup') ? 'Это резервная копия админ-панели другого предмета.' : 'Это не резервная копия админ-панели.' };
    adminStore.set(d.overlay);
    adminStore.flush();
    log('info', 'Восстановлено из резервной копии');
    return { ok: true, message: 'Правки восстановлены из резервной копии.' };
  } catch {
    return { ok: false, message: 'Файл повреждён.' };
  }
}

// ───── загрузка файлов ─────
const MAX_SIZE = 100 * 1024 * 1024;

function detectKind(bytes: Uint8Array, name: string): string {
  const hex = [...bytes.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.startsWith('25504446')) return 'pdf';
  if (hex.startsWith('ffd8ff')) return 'jpeg';
  if (hex.startsWith('89504e47')) return 'png';
  if (hex.startsWith('504b0304')) {
    const ext = name.toLowerCase().split('.').pop();
    return ext === 'docx' || ext === 'pptx' || ext === 'xlsx' ? ext : 'zip';
  }
  if (hex.startsWith('52494646')) return 'webp';
  return 'unknown';
}
function countPdfPages(bytes: Uint8Array): number | null {
  // Грубая оценка без библиотеки: число объектов /Type /Page (без /Pages).
  const text = new TextDecoder('latin1').decode(bytes);
  const m = text.match(/\/Type\s*\/Page(?!s)/g);
  return m ? m.length : null;
}

export async function registerUpload(file: File): Promise<UploadedFileRecord> {
  const base = { id: uid('f_'), fileName: file.name, size: file.size, uploadedAt: nowIso() };
  if (file.size === 0) {
    const r: UploadedFileRecord = { ...base, sha256: '', kind: 'empty', pages: null, status: 'rejected', note: 'Файл пустой.' };
    pushUpload(r);
    return r;
  }
  if (file.size > MAX_SIZE) {
    const r: UploadedFileRecord = { ...base, sha256: '', kind: 'large', pages: null, status: 'rejected', note: 'Файл больше 100 МБ — разделите его на части.' };
    pushUpload(r);
    return r;
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(buf);
  const kind = detectKind(buf, file.name);
  const pages = kind === 'pdf' ? countPdfPages(buf) : kind === 'jpeg' || kind === 'png' || kind === 'webp' ? 1 : null;
  const o = adminStore.get();
  const dupOf = pack.sourceFiles.find((s) => s.sha256 === sha256)?.fileName ?? o.uploads.find((u) => u.sha256 === sha256 && u.status === 'registered')?.fileName;
  let r: UploadedFileRecord;
  if (kind === 'unknown') r = { ...base, sha256, kind, pages, status: 'rejected', note: 'Неизвестный формат. Поддерживаются PDF, DOCX, PPTX, JPEG, PNG, WEBP.' };
  else if (kind === 'pdf' && pages === 0) r = { ...base, sha256, kind, pages, status: 'rejected', note: 'PDF повреждён: страницы не найдены.' };
  else if (dupOf) r = { ...base, sha256, kind, pages, status: 'duplicate', note: `Этот файл уже загружен («${dupOf}»). Повторная обработка не создаст дублей.` };
  else r = { ...base, sha256, kind, pages, status: 'registered', note: 'Файл принят. Распознавание выполняется на сервере или инструментом импорта (см. инструкцию).' };
  pushUpload(r);
  return r;
}
function pushUpload(r: UploadedFileRecord) {
  upd((o) => ({ ...o, uploads: [r, ...o.uploads].slice(0, 100) }));
  log(r.status === 'registered' ? 'info' : 'warn', `Загрузка «${r.fileName}»: ${r.note}`);
}

export const statusLabel: Record<Status, string> = { draft: 'черновик', review: 'на проверке', approved: 'утверждено', rejected: 'отклонено' };
export { ContentIndex };
