// Типы учебной базы и прогресса. Общие для приложения, админ-панели и инструментов импорта.

export type Status = 'draft' | 'review' | 'approved' | 'rejected';
export type SectionStatus = 'active' | 'planned';

export interface SourceRef {
  file: string; // id исходного файла
  page: string; // p14L
  fragment?: string;
}

export interface SourceFile {
  id: string;
  title: string;
  fileName: string;
  kind: string;
  pdfPages: number;
  sha256?: string;
  note?: string;
  importedAt?: string;
  /** Буква-префикс ссылок на страницы файла (a05, b157). */
  pagePrefix?: string;
  /** Метка файла в подписях страниц (необязательно): «лк» → «лк5». */
  pageLabel?: string;
}

export interface PageInfo {
  ref: string; // p14L
  file: string;
  pdfPage: number;
  side: '' | 'L' | 'R';
  image: string; // pages/p14L.webp
  date?: string;
  index: number; // порядковый номер страницы в файле (для «По порядку»)
}

export interface Section { id: string; title: string; order: number; status: SectionStatus }
export interface Subsection { id: string; sectionId: string; title: string; order: number; note?: string }
/** Источник в интернете для материала, которого нет в конспекте (добавлен по просьбе владельца). */
export interface WebRef {
  title: string; url: string;
  /** Автор или организация (для дополнительных источников предмета-учебника). */
  org?: string;
  /** Дата проверки источника (ГГГГ-ММ-ДД). */
  checked?: string;
  /** Что именно использовано, если источник доступен не целиком. */
  note?: string;
}

/** Этап подготовки темы по ТЗ: извлечено из оглавления → подготовлено → требует проверки → проверено.
 *  «Утверждено» — решение администратора по записям (status), «опубликовано» — версия на сервере. */
export type TopicStage = 'extracted' | 'prepared' | 'needs-check' | 'verified';

/** Место темы в книге-источнике (предмет-учебник, style: book). */
export interface BookRef {
  /** «Ч. 1, гл. 1 «Натуральные и целые числа», § 1.1.1». */
  place: string;
  /** Краткое описание того, что в книге по этой теме. */
  summary?: string;
}

export interface Topic {
  id: string; subsectionId: string; title: string; order: number; pages: string[]; status: Status;
  /** Тема целиком дополнена из интернета (в конспекте только заголовок или пробел). */
  web?: boolean;
  /** Номер пункта по оглавлению книги («1.1.1»). */
  num?: string;
  book?: BookRef;
  stage?: TopicStage;
  /** Почему тема требует проверки или что проверено. */
  stageNote?: string;
  /** Дата проверки источников темы. */
  sourcesChecked?: string;
}

/** Пункт оглавления книги, который ещё не наполнен: показывается в плане курса, но не как тема. */
export interface PlanItem {
  id: string;
  subsectionId: string;
  num: string;
  title: string;
  pages: string[];
  stage: TopicStage;
  note?: string;
}

export interface SymbolDef {
  key: string;
  tex: string;
  meaning: string;
  unit: string;
  src: string | null; // страница, где обозначение расшифровано; null — не расшифровано
  /** Расшифровка взята из интернета (обозначение из дополненного материала). */
  web?: boolean;
  /** Вид для студентов (без замечаний к конспекту): content/student/<предмет>.yaml. */
  student?: { meaning?: string; tex?: string };
}

export type TheoryKind = 'definition' | 'law' | 'text' | 'rule' | 'list' | 'note' | 'figure';

interface BaseEntity {
  id: string;
  topicId: string;
  sources: SourceRef[];
  sourceOrder: number; // для режима «По порядку»
  status: Status;
  errata?: string[];
  hash: string; // для защиты от дублей
  /** Есть — запись не из конспекта, а дополнена из интернета; sources тогда указывают место пробела в конспекте. */
  web?: WebRef[];
  /** Вид для студентов: исправленные тексты без упоминаний замечаний к конспекту; hide — запись не показывается.
   *  Исходные поля записи остаются как в конспекте (их видит администратор вместе с замечаниями). */
  student?: StudentView;
}

export interface StudentView {
  hide?: boolean;
  title?: string; body?: string; tex?: string;
  given?: string; steps?: string[]; answer?: string;
  prompt?: string; hints?: string[]; explanation?: string; reference?: string;
}

export interface Theory extends BaseEntity {
  kind: TheoryKind;
  title?: string;
  body: string; // markdown + $LaTeX$
  /** Анимированная иллюстрация к блоку (ключ в ContentPack.figures). */
  figure?: string;
}

/** Анимированная SVG-иллюстрация по рисунку конспекта (не часть исходного текста). */
export interface FigureDef {
  id: string;
  title: string;
  svg: string;
}

export interface Formula extends BaseEntity {
  title: string;
  tex: string;
  symbols: string[];
  conditions?: string;
  boxed: boolean;
  manualCheck: boolean; // формула распознана ненадёжно / контекст неясен
  /** Расшифровка обозначений текстом (предмет-учебник, style: book). */
  meaning?: string;
  /** Когда и почему применять. */
  use?: string;
  /** Преобразования формулы (выражения одной величины через другие). */
  variants?: string;
  /** Ограничения и особые случаи. */
  limits?: string;
}

export interface Example extends BaseEntity {
  title: string;
  given?: string;
  /** Что нужно найти. */
  find?: string;
  /** Выбор метода: почему решаем так. */
  method?: string;
  steps: string[];
  /** Проверка результата. */
  check?: string;
  answer?: string;
  computed?: boolean; // результат вычислен приложением, в источнике не записан
}

export type QuestionType = 'single' | 'multiple' | 'numeric' | 'matching' | 'sequence' | 'text';
export type QuestionCategory = 'theory' | 'formula' | 'problem';

export interface Option { key: string; body: string }

export interface NumericSpec {
  value: number;
  unit: string;
  tol: number; // относительный допуск
  tolAbs?: number; // абсолютный допуск (для нуля и малых чисел)
  check?: string; // независимое выражение для проверки эталона
}

export interface Solution {
  given?: string[];
  si?: string[];
  find?: string;
  formula?: string; // LaTeX
  calc?: string; // LaTeX
  /** Метод решения: почему выбран этот способ (предмет-учебник, style: book). */
  method?: string;
  /** Пошаговое решение с промежуточными вычислениями (markdown с $…$). */
  steps?: string[];
  /** Проверка результата (подстановка, оценка, ОДЗ). */
  check?: string;
  answer?: string;
}

export interface Question extends BaseEntity {
  type: QuestionType;
  category: QuestionCategory;
  prompt: string;
  options?: Option[]; // single / multiple
  answer?: string | string[]; // ключ(и) для single / multiple
  numeric?: NumericSpec;
  pairs?: [string, string][]; // matching: левая часть → правая
  sequence?: string[]; // правильный порядок
  reference?: string; // text: эталон
  criteria?: string[]; // text: критерии самопроверки
  hints: string[];
  explanation: string;
  formulaIds: string[];
  solution?: Solution;
  generated: boolean;
}

export interface Erratum {
  id: string;
  page: string;
  severity: 'error' | 'typo' | 'unclear' | 'note';
  /** К чему относится замечание: какая формула, определение, подпись. */
  target?: string;
  original: string;
  issue: string;
  /** Конкретное предложение: чем заменить или что дописать. */
  suggestion: string;
  /** Что нужно от администратора, если решение зависит от того, что было на занятии. */
  todo?: string;
  resolution?: 'open' | 'accepted' | 'kept';
}

export interface ImportReport {
  fileId: string;
  fileName: string;
  generatedAt: string;
  pdfPages: number;
  pagesProcessed: number;
  pagesUnreadable: string[];
  topics: number;
  theory: number;
  formulas: number;
  formulasManualCheck: number;
  examples: number;
  questionsInSource: number;
  questionsGenerated: number;
  recordsForReview: number;
  errata: number;
  duplicatesSkipped: number;
  /** Сколько записей дополнено из интернета (на место пробелов в этом файле). */
  addedFromWeb?: number;
  notes: string[];
}

export interface ContentPack {
  schema: 1;
  version: string;
  builtAt: string;
  course: { id: string; title: string; owner: string; language: string };
  sourceFiles: SourceFile[];
  pages: PageInfo[];
  sections: Section[];
  subsections: Subsection[];
  topics: Topic[];
  symbols: Record<string, SymbolDef>;
  theory: Theory[];
  formulas: Formula[];
  examples: Example[];
  questions: Question[];
  errata: Erratum[];
  reports: ImportReport[];
  figures?: Record<string, FigureDef>;
  /** План курса по оглавлению книги (предмет-учебник, style: book): пункты, ещё не ставшие темами. */
  plan?: PlanItem[];
}

// ───────────────────────── Прогресс и тесты ─────────────────────────

export type OrderMode = 'source' | 'random';
export type PickMode = 'first' | 'random';
export type AttemptMode = 'test' | 'exam' | 'mistakes' | 'favorites' | 'formulas' | 'problems' | 'review';

export interface TestConfig {
  topicIds: string[];
  count: number;
  types: QuestionType[];
  categories: QuestionCategory[];
  order: OrderMode;
  pick: PickMode; // для «По порядку»: первые N или случайные N, показанные по порядку
  timeLimitSec: number; // 0 — без ограничения
  hints: boolean; // в экзамене выключены
  includeReview: boolean; // предпросмотр непроверенных вопросов (только для администратора)
}

export type AnswerStatus = 'unanswered' | 'hint' | 'correct' | 'wrong' | 'revealed' | 'selfcheck';

export type Response =
  | { type: 'single'; key: string }
  | { type: 'multiple'; keys: string[] }
  | { type: 'numeric'; raw: string }
  | { type: 'matching'; map: Record<string, string> }
  | { type: 'sequence'; order: string[] }
  | { type: 'text'; text: string; selfAssessed?: boolean };

export interface AttemptAnswer {
  status: AnswerStatus;
  tries: number;
  hintShown: boolean;
  solutionShown: boolean;
  responses: Response[];
  correct: boolean | null;
  answeredAt?: string;
}

export interface Attempt {
  id: string;
  mode: AttemptMode;
  title: string;
  config: TestConfig;
  questionIds: string[];
  seed: number;
  startedAt: string;
  finishedAt?: string;
  deadlineAt?: string;
  currentIndex: number;
  answers: Record<string, AttemptAnswer>;
  parentId?: string; // повторная попытка
  notice?: string; // предупреждение (например, доступно меньше вопросов)
}

export interface Bookmark { type: 'question' | 'formula' | 'topic'; id: string; addedAt: string }

export interface QuestionStat { seen: number; correct: number; wrong: number; lastAt: string }
export interface ErrorEntry { wrongCount: number; lastWrongAt: string; correctStreak: number }

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  fontScale: number;
  showReviewContent: boolean; // показывать теорию/формулы со статусом «на проверке»
}

export interface UserState {
  version: 1;
  settings: Settings;
  topicProgress: Record<string, { studiedAt?: string; lastOpenedAt?: string }>;
  lastTopicId?: string;
  attempts: Attempt[];
  bookmarks: Bookmark[];
  questionStats: Record<string, QuestionStat>;
  errorQueue: Record<string, ErrorEntry>;
  cardMarks: Record<string, 'know' | 'learn'>;
  updatedAt: string;
}

// ───────────────────────── Админ-оверлей ─────────────────────────
// В локальном режиме правки администратора хранятся поверх встроенного пакета.

export interface AdminLogEntry { at: string; level: 'info' | 'warn' | 'error'; message: string }

export interface UploadedFileRecord {
  id: string;
  fileName: string;
  sha256: string;
  size: number;
  kind: string;
  pages: number | null;
  uploadedAt: string;
  status: 'registered' | 'duplicate' | 'rejected';
  note: string;
}

export interface AdminOverlay {
  version: 1;
  pinHash?: string;
  patches: Record<string, Record<string, unknown>>; // id → изменённые поля
  added: { sections: Section[]; subsections: Subsection[]; topics: Topic[]; questions: Question[] };
  errataResolutions: Record<string, 'open' | 'accepted' | 'kept'>;
  publishedVersion?: string;
  publishedAt?: string;
  uploads: UploadedFileRecord[];
  log: AdminLogEntry[];
  previewReview: boolean; // разрешить себе тесты по непроверенным вопросам
}
