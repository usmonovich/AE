// Статистика и прогресс. Чистые функции: состояние пользователя + учебная база → показатели.

import type { ContentIndex } from './content-index';
import { attemptScore, type Score } from './test-engine';
import type { Attempt, UserState } from './types';

export const ERROR_CLEAR_STREAK = 2; // вопрос уходит из «Повторения ошибок» после двух верных ответов подряд

export function emptyUserState(now = new Date()): UserState {
  return {
    version: 1,
    settings: { theme: 'system', fontScale: 1, showReviewContent: true },
    topicProgress: {},
    attempts: [],
    bookmarks: [],
    questionStats: {},
    errorQueue: {},
    cardMarks: {},
    updatedAt: now.toISOString(),
  };
}

/** Учитывает итог ответа в общей статистике и очереди ошибок. */
export function recordFinal(state: UserState, questionId: string, correct: boolean, now: Date): UserState {
  const at = now.toISOString();
  const prev = state.questionStats[questionId] ?? { seen: 0, correct: 0, wrong: 0, lastAt: at };
  const questionStats = {
    ...state.questionStats,
    [questionId]: { seen: prev.seen + 1, correct: prev.correct + (correct ? 1 : 0), wrong: prev.wrong + (correct ? 0 : 1), lastAt: at },
  };
  const errorQueue = { ...state.errorQueue };
  const e = errorQueue[questionId];
  if (!correct) errorQueue[questionId] = { wrongCount: (e?.wrongCount ?? 0) + 1, lastWrongAt: at, correctStreak: 0 };
  else if (e) {
    const streak = e.correctStreak + 1;
    if (streak >= ERROR_CLEAR_STREAK) delete errorQueue[questionId];
    else errorQueue[questionId] = { ...e, correctStreak: streak };
  }
  return { ...state, questionStats, errorQueue, updatedAt: at };
}

export interface Accuracy { answered: number; correct: number; percent: number | null }

function accuracyFor(state: UserState, questionIds: string[]): Accuracy {
  let answered = 0, correct = 0;
  for (const id of questionIds) {
    const s = state.questionStats[id];
    if (!s) continue;
    answered += s.seen;
    correct += s.correct;
  }
  return { answered, correct, percent: answered ? Math.round((correct / answered) * 100) : null };
}

export interface TopicProgressRow { topicId: string; title: string; studied: boolean; accuracy: Accuracy }
export interface GroupProgress { id: string; title: string; topics: number; studied: number; percent: number; accuracy: Accuracy }

export interface Overview {
  topicsTotal: number;
  topicsStudied: number;
  percentStudied: number;
  sections: (GroupProgress & { subsections: (GroupProgress & { rows: TopicProgressRow[] })[] })[];
  testsCompleted: number;
  answersCorrect: number;
  answersWrong: number;
  percentCorrect: number | null;
  history: { attempt: Attempt; score: Score }[];
  weakTopics: TopicProgressRow[];
  retries: { attempt: Attempt; parent: Attempt; delta: number }[];
  bookmarks: number;
  mistakes: number;
}

export function overview(state: UserState, index: ContentIndex): Overview {
  const qByTopic = new Map<string, string[]>();
  for (const q of index.questions) {
    const l = qByTopic.get(q.topicId) ?? [];
    l.push(q.id);
    qByTopic.set(q.topicId, l);
  }
  const rowFor = (topicId: string, title: string): TopicProgressRow => ({
    topicId, title, studied: !!state.topicProgress[topicId]?.studiedAt, accuracy: accuracyFor(state, qByTopic.get(topicId) ?? []),
  });
  const group = (id: string, title: string, rows: TopicProgressRow[]): GroupProgress => {
    const ids = rows.flatMap((r) => qByTopic.get(r.topicId) ?? []);
    const studied = rows.filter((r) => r.studied).length;
    return { id, title, topics: rows.length, studied, percent: rows.length ? Math.round((studied / rows.length) * 100) : 0, accuracy: accuracyFor(state, ids) };
  };

  const sections = index.activeSections().map((s) => {
    const subsections = index.subsectionsOf(s.id).map((ss) => {
      const rows = index.topicsOf(ss.id).map((t) => rowFor(t.id, t.title));
      return { ...group(ss.id, ss.title, rows), rows };
    });
    return { ...group(s.id, s.title, subsections.flatMap((x) => x.rows)), subsections };
  });
  const allRows = sections.flatMap((s) => s.subsections.flatMap((ss) => ss.rows));

  const finished = state.attempts.filter((a) => a.finishedAt);
  const history = finished
    .slice()
    .sort((a, b) => (b.finishedAt! < a.finishedAt! ? -1 : 1))
    .map((attempt) => ({ attempt, score: attemptScore(attempt) }));
  let answersCorrect = 0, answersWrong = 0;
  for (const h of history) {
    answersCorrect += h.score.correct;
    answersWrong += h.score.wrong + h.score.revealed;
  }
  const byId = new Map(state.attempts.map((a) => [a.id, a]));
  const retries = history
    .filter((h) => h.attempt.parentId && byId.get(h.attempt.parentId)?.finishedAt)
    .map((h) => {
      const parent = byId.get(h.attempt.parentId!)!;
      return { attempt: h.attempt, parent, delta: h.score.percent - attemptScore(parent).percent };
    });
  const weakTopics = allRows
    .filter((r) => r.accuracy.answered >= 3 && (r.accuracy.percent ?? 100) < 100)
    .sort((a, b) => (a.accuracy.percent ?? 0) - (b.accuracy.percent ?? 0))
    .slice(0, 5);
  const topicsStudied = allRows.filter((r) => r.studied).length;
  const total = answersCorrect + answersWrong;
  return {
    topicsTotal: allRows.length,
    topicsStudied,
    percentStudied: allRows.length ? Math.round((topicsStudied / allRows.length) * 100) : 0,
    sections,
    testsCompleted: finished.length,
    answersCorrect,
    answersWrong,
    percentCorrect: total ? Math.round((answersCorrect / total) * 100) : null,
    history,
    weakTopics,
    retries,
    bookmarks: state.bookmarks.length,
    mistakes: Object.keys(state.errorQueue).length,
  };
}

export interface DayPoint { date: string; total: number; correct: number; percent: number | null }

/** Динамика: доля верных ответов по дням за период (по завершённым ответам в попытках). */
export function dailySeries(state: UserState, days: number, now = new Date()): DayPoint[] {
  const out: DayPoint[] = [];
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const buckets = new Map<string, { total: number; correct: number }>();
  for (const a of state.attempts) {
    for (const ans of Object.values(a.answers)) {
      if (!ans.answeredAt || ans.correct === null) continue;
      const k = key(new Date(ans.answeredAt));
      const b = buckets.get(k) ?? { total: 0, correct: 0 };
      b.total++;
      if (ans.correct) b.correct++;
      buckets.set(k, b);
    }
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const b = buckets.get(key(d));
    out.push({ date: key(d), total: b?.total ?? 0, correct: b?.correct ?? 0, percent: b && b.total ? Math.round((b.correct / b.total) * 100) : null });
  }
  return out;
}
