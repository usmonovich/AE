// Эффективная учебная база: встроенный пакет + правки администратора (оверлей).
// Все экраны работают только через этот индекс.

import type {
  AdminOverlay, ContentPack, Erratum, Example, Formula, PageInfo, Question, Section, Status, Subsection, SymbolDef, Theory, Topic,
} from './types';

export type ContentEntity = Theory | Formula | Example | Question;
export type EntityKind = 'theory' | 'formula' | 'example' | 'question';

export const emptyOverlay = (): AdminOverlay => ({
  version: 1,
  patches: {},
  added: { sections: [], subsections: [], topics: [], questions: [] },
  errataResolutions: {},
  uploads: [],
  log: [],
  previewReview: false,
});

/** Записи, решение по которым устарело: запись в базе изменилась после проверки. */
const staleIds = new WeakMap<AdminOverlay['patches'], Set<string>>();

function applyPatch<T extends { id: string }>(e: T, patches: AdminOverlay['patches']): T {
  const p = patches[e.id];
  if (!p) return e;
  const { baseHash, ...fields } = p as { baseHash?: string } & Record<string, unknown>;
  const hash = (e as { hash?: string }).hash;
  if (baseHash && hash && baseHash !== hash) {
    let set = staleIds.get(patches);
    if (!set) staleIds.set(patches, (set = new Set()));
    set.add(e.id);
    return e; // запись изменилась — решение и правки не применяются, нужна повторная проверка
  }
  return { ...e, ...fields } as T;
}

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

/** Вид для студентов: исправленные тексты без упоминаний замечаний (поле student). Исходная запись — в pack. */
function studentView<T extends ContentEntity>(e: T): T {
  const st = e.student;
  if (!st) return e;
  const { hide: _hide, ...fields } = st;
  void _hide;
  return { ...e, ...fields } as T;
}
const shown = (e: ContentEntity) => !e.student?.hide;

export class ContentIndex {
  readonly pack: ContentPack;
  readonly overlay: AdminOverlay;
  readonly sections: Section[];
  readonly subsections: Subsection[];
  readonly topics: Topic[];
  readonly theory: Theory[];
  readonly formulas: Formula[];
  readonly examples: Example[];
  readonly questions: Question[];
  readonly errata: Erratum[];
  private readonly entityById = new Map<string, ContentEntity>();
  private readonly kindById = new Map<string, EntityKind>();
  private readonly topicById = new Map<string, Topic>();
  private readonly subById = new Map<string, Subsection>();
  private readonly secById = new Map<string, Section>();
  private readonly pageByRef = new Map<string, PageInfo>();

  constructor(pack: ContentPack, overlay: AdminOverlay = emptyOverlay()) {
    this.pack = pack;
    this.overlay = overlay;
    const P = overlay.patches;
    this.sections = [...pack.sections, ...overlay.added.sections].map((x) => applyPatch(x, P)).sort(byOrder);
    this.subsections = [...pack.subsections, ...overlay.added.subsections].map((x) => applyPatch(x, P)).sort(byOrder);
    this.topics = [...pack.topics, ...overlay.added.topics].map((x) => applyPatch(x, P)).sort(byOrder);
    // сначала вид для студентов (он и проверяется администратором), затем правки и решения админ-панели
    this.theory = pack.theory.filter(shown).map((x) => applyPatch(studentView(x), P));
    this.formulas = pack.formulas.filter(shown).map((x) => applyPatch(studentView(x), P));
    this.examples = pack.examples.filter(shown).map((x) => applyPatch(studentView(x), P));
    this.questions = [...pack.questions.filter(shown), ...overlay.added.questions].map((x) => applyPatch(studentView(x), P));
    this.errata = pack.errata.map((e) => ({ ...e, resolution: overlay.errataResolutions[e.id] ?? e.resolution ?? 'open' }));
    for (const s of this.sections) this.secById.set(s.id, s);
    for (const s of this.subsections) this.subById.set(s.id, s);
    for (const t of this.topics) this.topicById.set(t.id, t);
    for (const p of pack.pages) this.pageByRef.set(p.ref, p);
    const reg = (list: ContentEntity[], kind: EntityKind) => list.forEach((e) => (this.entityById.set(e.id, e), this.kindById.set(e.id, kind)));
    reg(this.theory, 'theory');
    reg(this.formulas, 'formula');
    reg(this.examples, 'example');
    reg(this.questions, 'question');
  }

  /** ID записей, у которых решение проверки устарело (запись изменилась после проверки). */
  staleDecisions(): string[] { return [...(staleIds.get(this.overlay.patches) ?? [])]; }

  // ───── структура ─────
  section(id: string) { return this.secById.get(id); }
  subsection(id: string) { return this.subById.get(id); }
  topic(id: string) { return this.topicById.get(id); }
  page(ref: string) { return this.pageByRef.get(ref); }
  symbol(key: string): SymbolDef | undefined {
    const s = this.pack.symbols[key];
    return s?.student ? { ...s, ...s.student } : s;
  }
  /** Запись как в конспекте (до вида для студентов) — для админ-панели. */
  original(id: string): ContentEntity | undefined {
    return [...this.pack.theory, ...this.pack.formulas, ...this.pack.examples, ...this.pack.questions].find((e) => e.id === id);
  }
  entity(id: string) { return this.entityById.get(id); }
  kindOf(id: string) { return this.kindById.get(id); }
  erratum(id: string) { return this.errata.find((e) => e.id === id); }

  /** Разделы, у которых есть хотя бы одна тема (пустые разделы студенту не показываются). */
  activeSections(): Section[] {
    return this.sections.filter((s) => s.status === 'active' && this.topicsOfSection(s.id).length > 0);
  }
  subsectionsOf(sectionId: string): Subsection[] {
    return this.subsections.filter((s) => s.sectionId === sectionId && this.topicsOf(s.id).length > 0);
  }
  topicsOf(subsectionId: string): Topic[] {
    return this.topics.filter((t) => t.subsectionId === subsectionId && t.status !== 'rejected');
  }
  topicsOfSection(sectionId: string): Topic[] {
    const subs = new Set(this.subsections.filter((s) => s.sectionId === sectionId).map((s) => s.id));
    return this.topics.filter((t) => subs.has(t.subsectionId) && t.status !== 'rejected');
  }
  allVisibleTopics(): Topic[] {
    return this.activeSections().flatMap((s) => this.subsectionsOf(s.id).flatMap((ss) => this.topicsOf(ss.id)));
  }
  path(topicId: string) {
    const topic = this.topic(topicId);
    const subsection = topic && this.subsection(topic.subsectionId);
    const section = subsection && this.section(subsection.sectionId);
    return { topic, subsection, section };
  }
  /** Соседние темы для навигации «назад/вперёд». */
  neighbours(topicId: string): { prev?: Topic; next?: Topic } {
    const all = this.allVisibleTopics();
    const i = all.findIndex((t) => t.id === topicId);
    return { prev: i > 0 ? all[i - 1] : undefined, next: i >= 0 ? all[i + 1] : undefined };
  }

  // ───── видимость ─────
  static visible(status: Status, showReview: boolean): boolean {
    return status === 'approved' || (showReview && status === 'review');
  }
  static usableQuestion(q: Question, includeReview: boolean): boolean {
    return q.status === 'approved' || (includeReview && q.status === 'review');
  }

  theoryOf(topicId: string, showReview: boolean) {
    return this.theory.filter((x) => x.topicId === topicId && ContentIndex.visible(x.status, showReview)).sort((a, b) => a.sourceOrder - b.sourceOrder);
  }
  formulasOf(topicId: string, showReview: boolean) {
    return this.formulas.filter((x) => x.topicId === topicId && ContentIndex.visible(x.status, showReview)).sort((a, b) => a.sourceOrder - b.sourceOrder);
  }
  examplesOf(topicId: string, showReview: boolean) {
    return this.examples.filter((x) => x.topicId === topicId && ContentIndex.visible(x.status, showReview)).sort((a, b) => a.sourceOrder - b.sourceOrder);
  }
  questionsOf(topicId: string, includeReview: boolean) {
    return this.questions.filter((q) => q.topicId === topicId && ContentIndex.usableQuestion(q, includeReview)).sort((a, b) => a.sourceOrder - b.sourceOrder);
  }

  /** Ключ сортировки «По порядку»: раздел → подраздел → тема → порядок в источнике. */
  orderKey(q: Question): number[] {
    const { topic, subsection, section } = this.path(q.topicId);
    return [section?.order ?? 999, subsection?.order ?? 999, topic?.order ?? 999, q.sourceOrder];
  }
  static compareKeys(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d) return d;
    }
    return 0;
  }

  counts() {
    const all = [...this.theory, ...this.formulas, ...this.examples, ...this.questions];
    const by = (s: Status) => all.filter((e) => e.status === s).length;
    return {
      review: by('review'),
      approved: by('approved'),
      rejected: by('rejected'),
      questionsApproved: this.questions.filter((q) => q.status === 'approved').length,
      questionsReview: this.questions.filter((q) => q.status === 'review').length,
      total: all.length,
    };
  }
}
