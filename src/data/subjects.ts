// Предметы приложения AE. Список предметов, их названия, значки и словарь интерфейса задаются в
// content/subjects.json — интерфейс от конкретного предмета не зависит. У каждого предмета своя учебная
// база (pack), свой прогресс ученика и свои решения проверки: данные предметов не смешиваются.

import config from '../../content/subjects.json';

export type SubjectId = string;
export type SubjectStyle = 'notes' | 'book';
export type SubjectTone = 'accent' | 'ok' | 'warn' | 'bad';

/** Слова интерфейса, которые зависят от источника предмета: материалы, конспект или книга. */
export interface Vocab {
  src: string; // материалы / конспект / книга
  ofSrc: string; // материалов / конспекта / книги
  inSrc: string; // в материалах / в конспекте / в книге
  toSrc: string; // к материалам / к конспекту / к книге
  fromSrc: string; // из материалов / из конспекта / из книги
  bySrc: string; // по материалам / по конспекту / по книге
  /** Название файла-источника в счётчике: [1, 2–4, 5+]. */
  file: [string, string, string];
  allSections: string;
}

export interface SubjectMeta {
  id: SubjectId;
  /** Первый сегмент адреса (#/<prefix>/…) и обязательное начало ID тем и записей предмета. */
  prefix: string;
  title: string;
  /** Короткое название для заголовков и подписей. */
  short: string;
  emoji: string;
  tagline: string;
  icon: string;
  tone: SubjectTone;
  /** notes — материалы по страницам файлов; book — учебник с оглавлением (план курса). */
  style: SubjectStyle;
  storage: { user: string; admin: string; pack?: string };
  cloud: { admin: string; user: (uid: string) => string };
  exportKind: string;
  backupKind: string;
  /** У предмета-книги весь материал составлен по открытым источникам — отдельная пометка «из интернета» не нужна. */
  webIsDefault: boolean;
  v: Vocab;
}

const VOCAB: Record<string, Omit<Vocab, 'allSections'>> = {
  materials: { src: 'материалы', ofSrc: 'материалов', inSrc: 'в материалах', toSrc: 'к материалам', fromSrc: 'из материалов', bySrc: 'по материалам', file: ['файл', 'файла', 'файлов'] },
  notes: { src: 'конспект', ofSrc: 'конспекта', inSrc: 'в конспекте', toSrc: 'к конспекту', fromSrc: 'из конспекта', bySrc: 'по конспекту', file: ['конспект', 'конспекта', 'конспектов'] },
  book: { src: 'книга', ofSrc: 'книги', inSrc: 'в книге', toSrc: 'к книге', fromSrc: 'из книги', bySrc: 'по книге', file: ['часть', 'части', 'частей'] },
};

interface SubjectConfig {
  id: string; prefix: string; emoji: string; icon: string; tone: string; title: string; short: string; tagline: string; style: string; vocab: string;
}

const app = config.app;
const sp = app.storagePrefix;
const cp = app.cloudPrefix;

function meta(c: SubjectConfig): SubjectMeta {
  const style: SubjectStyle = c.style === 'book' ? 'book' : 'notes';
  return {
    id: c.id,
    prefix: c.prefix,
    title: c.title,
    short: c.short || c.title,
    emoji: c.emoji,
    tagline: c.tagline,
    icon: c.icon,
    tone: (['accent', 'ok', 'warn', 'bad'].includes(c.tone) ? c.tone : 'accent') as SubjectTone,
    style,
    storage: { user: `${sp}.${c.id}.user.v1`, admin: `${sp}.${c.id}.admin.v1`, pack: `${sp}.${c.id}.pack.v1` },
    cloud: { admin: `${cp}/${c.id}/admin`, user: (uid) => `data/users/${uid}/${c.id}` },
    exportKind: `${sp}-${c.id}-progress`,
    backupKind: `${sp}-${c.id}-admin-backup`,
    webIsDefault: style === 'book',
    v: { ...(VOCAB[c.vocab] ?? VOCAB.materials), allSections: `Все разделы: ${c.short || c.title}` },
  };
}

export const SUBJECT_IDS: SubjectId[] = (config.subjects as SubjectConfig[]).map((s) => s.id);
export const SUBJECTS: Record<SubjectId, SubjectMeta> = Object.fromEntries((config.subjects as SubjectConfig[]).map((s) => [s.id, meta(s)]));
const byPrefix = new Map(SUBJECT_IDS.map((id) => [SUBJECTS[id].prefix, id]));
export const subjectByPrefix = (p: string): SubjectId | null => byPrefix.get(p) ?? null;
/** Предмет, которому принадлежит ID темы или записи (по префиксу «<prefix>-»). */
export const subjectOfId = (id: string): SubjectId | null => byPrefix.get(id.split('-')[0]) ?? null;
export const APP_TITLE: string = app.title;
export const APP_EYEBROW: string = app.eyebrow;
export const APP_LEAD: string = app.lead;
/** Общие для всех предметов данные: настройки (тема, размер шрифта). */
export const SHARED_KEYS = { settings: `${sp}.settings.v1`, lastSubject: `${sp}.subject.v1`, cloudSettings: (uid: string) => `data/users/${uid}/settings` };
