// Система тестирования: отбор вопросов по области, типам и порядку (A «По порядку» / B «Случайный»).

import { ContentIndex } from './content-index';
import { mulberry32, shuffle, uid } from './random';
import { isFinal } from './hint-flow';
import type { Attempt, AttemptMode, Question, TestConfig } from './types';

export const defaultConfig = (topicIds: string[] = []): TestConfig => ({
  topicIds,
  count: 10,
  types: ['single', 'multiple', 'numeric', 'matching', 'sequence', 'text'],
  categories: ['theory', 'formula', 'problem'],
  order: 'source',
  pick: 'first',
  timeLimitSec: 0,
  hints: true,
  includeReview: false,
});

/** Все вопросы, подходящие под настройки, в порядке источника. */
export function availableQuestions(index: ContentIndex, cfg: TestConfig, restrictIds?: string[]): Question[] {
  const topics = new Set(cfg.topicIds);
  const restrict = restrictIds ? new Set(restrictIds) : null;
  return index.questions
    .filter((q) => (restrict ? restrict.has(q.id) : topics.has(q.topicId)))
    .filter((q) => cfg.types.includes(q.type) && cfg.categories.includes(q.category))
    .filter((q) => ContentIndex.usableQuestion(q, cfg.includeReview))
    .sort((a, b) => ContentIndex.compareKeys(index.orderKey(a), index.orderKey(b)));
}

export interface Selection {
  ids: string[];
  available: number;
  requested: number;
  notice?: string;
}

export function selectQuestions(index: ContentIndex, cfg: TestConfig, seed: number, restrictIds?: string[]): Selection {
  const avail = availableQuestions(index, cfg, restrictIds);
  const requested = cfg.count > 0 ? cfg.count : avail.length;
  const n = Math.min(requested, avail.length);
  const rnd = mulberry32(seed);
  let picked: Question[];
  if (cfg.order === 'random') {
    // Режим B: перемешивание на уровне попытки; без повторов внутри попытки.
    picked = shuffle(avail, rnd).slice(0, n);
  } else if (cfg.pick === 'random' && n < avail.length) {
    // Режим A со случайной выборкой: набор случайный, показ — строго в порядке источника.
    const chosen = new Set(shuffle(avail, rnd).slice(0, n).map((q) => q.id));
    picked = avail.filter((q) => chosen.has(q.id));
  } else {
    picked = avail.slice(0, n);
  }
  const notice =
    avail.length === 0
      ? 'По выбранным настройкам нет доступных вопросов.'
      : requested > avail.length
        ? `Запрошено ${requested}, доступно ${avail.length}. Тест будет из ${avail.length} вопросов.`
        : undefined;
  return { ids: picked.map((q) => q.id), available: avail.length, requested, notice };
}

export function createAttempt(
  index: ContentIndex,
  cfg: TestConfig,
  opts: { mode: AttemptMode; title: string; seed: number; now: Date; parentId?: string; restrictIds?: string[] },
): Attempt {
  const sel = selectQuestions(index, cfg, opts.seed, opts.restrictIds);
  return {
    id: uid('a_'),
    mode: opts.mode,
    title: opts.title,
    config: cfg,
    questionIds: sel.ids,
    seed: opts.seed,
    startedAt: opts.now.toISOString(),
    deadlineAt: cfg.timeLimitSec > 0 ? new Date(opts.now.getTime() + cfg.timeLimitSec * 1000).toISOString() : undefined,
    currentIndex: 0,
    answers: {},
    parentId: opts.parentId,
    notice: sel.notice,
  };
}

export interface Score {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  revealed: number;
  firstTry: number;
  afterHint: number;
  percent: number;
}

export function attemptScore(a: Attempt): Score {
  let answered = 0, correct = 0, wrong = 0, revealed = 0, firstTry = 0, afterHint = 0;
  for (const id of a.questionIds) {
    const ans = a.answers[id];
    if (!isFinal(ans)) continue;
    answered++;
    if (ans!.status === 'correct') {
      correct++;
      if (ans!.tries === 1) firstTry++;
      else afterHint++;
    } else if (ans!.status === 'revealed') revealed++;
    else wrong++;
  }
  const total = a.questionIds.length;
  return { total, answered, correct, wrong, revealed, firstTry, afterHint, percent: total ? Math.round((correct / total) * 100) : 0 };
}

export function isExpired(a: Attempt, now: Date): boolean {
  return !!a.deadlineAt && now.getTime() >= new Date(a.deadlineAt).getTime();
}
