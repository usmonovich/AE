// Синхронизация прогресса между устройствами через Supabase.
// Порядок: pull (слияние серверных данных с локальными) → push (запись итогового состояния).
// Без настроенного бэкенда приложение полностью работает офлайн, а этот модуль не используется.

import type { SupabaseClient } from './supabase';
import { kv, KEYS } from './storage';
import type { Attempt, AttemptAnswer, Bookmark, ContentPack, ErrorEntry, QuestionStat, UserState } from '../domain/types';
import { attemptScore } from '../domain/test-engine';

const later = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);

export interface RemoteData {
  progress: { topic_id: string; studied_at: string | null; last_opened_at: string | null }[];
  bookmarks: { entity_type: Bookmark['type']; entity_id: string; added_at: string }[];
  attempts: {
    id: string; mode: Attempt['mode']; title: string; config: Attempt['config']; question_ids: string[]; seed: number;
    started_at: string; finished_at: string | null; deadline_at: string | null; parent_id: string | null; current_index: number;
  }[];
  answers: {
    attempt_id: string; question_id: string; status: AttemptAnswer['status']; tries: number; hint_used: boolean;
    solution_shown: boolean; correct: boolean | null; responses: AttemptAnswer['responses']; answered_at: string | null;
  }[];
  errors: { question_id: string; wrong_count: number; last_wrong_at: string; correct_streak: number }[];
  stats: { question_id: string; seen: number; correct: number; wrong: number; last_at: string }[];
}

/** Слияние: ничего не теряется — берётся объединение и более свежие значения. */
export function mergeRemote(local: UserState, r: RemoteData): UserState {
  const topicProgress = { ...local.topicProgress };
  for (const p of r.progress) {
    const cur = topicProgress[p.topic_id] ?? {};
    topicProgress[p.topic_id] = { studiedAt: later(cur.studiedAt, p.studied_at ?? undefined), lastOpenedAt: later(cur.lastOpenedAt, p.last_opened_at ?? undefined) };
  }
  const bm = new Map(local.bookmarks.map((b) => [`${b.type}:${b.id}`, b]));
  for (const b of r.bookmarks) if (!bm.has(`${b.entity_type}:${b.entity_id}`)) bm.set(`${b.entity_type}:${b.entity_id}`, { type: b.entity_type, id: b.entity_id, addedAt: b.added_at });

  const answersBy = new Map<string, Record<string, AttemptAnswer>>();
  for (const a of r.answers) {
    const m = answersBy.get(a.attempt_id) ?? {};
    m[a.question_id] = { status: a.status, tries: a.tries, hintShown: a.hint_used, solutionShown: a.solution_shown, correct: a.correct, responses: a.responses ?? [], answeredAt: a.answered_at ?? undefined };
    answersBy.set(a.attempt_id, m);
  }
  const attempts = new Map(local.attempts.map((a) => [a.id, a]));
  for (const ra of r.attempts) {
    const remote: Attempt = {
      id: ra.id, mode: ra.mode, title: ra.title, config: ra.config, questionIds: ra.question_ids, seed: ra.seed, startedAt: ra.started_at,
      finishedAt: ra.finished_at ?? undefined, deadlineAt: ra.deadline_at ?? undefined, parentId: ra.parent_id ?? undefined,
      currentIndex: ra.current_index ?? 0, answers: answersBy.get(ra.id) ?? {},
    };
    const cur = attempts.get(ra.id);
    if (!cur) attempts.set(ra.id, remote);
    else if (!cur.finishedAt && remote.finishedAt) attempts.set(ra.id, remote);
    else if (!cur.finishedAt === !remote.finishedAt && Object.keys(remote.answers).length > Object.keys(cur.answers).length) attempts.set(ra.id, remote);
  }
  const questionStats: Record<string, QuestionStat> = { ...local.questionStats };
  for (const s of r.stats) {
    const cur = questionStats[s.question_id];
    if (!cur || s.seen > cur.seen) questionStats[s.question_id] = { seen: s.seen, correct: s.correct, wrong: s.wrong, lastAt: s.last_at };
  }
  const errorQueue: Record<string, ErrorEntry> = { ...local.errorQueue };
  for (const e of r.errors) {
    const cur = errorQueue[e.question_id];
    if (!cur || e.last_wrong_at > cur.lastWrongAt) errorQueue[e.question_id] = { wrongCount: e.wrong_count, lastWrongAt: e.last_wrong_at, correctStreak: e.correct_streak };
  }
  return {
    ...local,
    topicProgress,
    bookmarks: [...bm.values()],
    attempts: [...attempts.values()].sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)),
    questionStats,
    errorQueue,
  };
}

export async function pull(client: SupabaseClient): Promise<RemoteData> {
  const [progress, bookmarks, attempts, answers, errors, stats] = await Promise.all([
    client.select<RemoteData['progress'][number]>('user_progress', 'select=topic_id,studied_at,last_opened_at'),
    client.select<RemoteData['bookmarks'][number]>('bookmarks', 'select=entity_type,entity_id,added_at'),
    client.select<RemoteData['attempts'][number]>('test_attempts', 'select=id,mode,title,config,question_ids,seed,started_at,finished_at,deadline_at,parent_id,current_index'),
    client.select<RemoteData['answers'][number]>('attempt_answers', 'select=attempt_id,question_id,status,tries,hint_used,solution_shown,correct,responses,answered_at'),
    client.select<RemoteData['errors'][number]>('error_review_queue', 'select=question_id,wrong_count,last_wrong_at,correct_streak'),
    client.select<RemoteData['stats'][number]>('user_question_stats', 'select=question_id,seen,correct,wrong,last_at'),
  ]);
  return { progress, bookmarks, attempts, answers, errors, stats };
}

const inList = (ids: string[]) => `(${ids.map((i) => `"${i.replace(/"/g, '')}"`).join(',')})`;

export async function push(client: SupabaseClient, s: UserState, userId: string) {
  await client.upsert('user_progress', Object.entries(s.topicProgress).map(([topic_id, p]) => ({ user_id: userId, topic_id, studied_at: p.studiedAt ?? null, last_opened_at: p.lastOpenedAt ?? null })), 'user_id,topic_id');

  await client.upsert('bookmarks', s.bookmarks.map((b) => ({ user_id: userId, entity_type: b.type, entity_id: b.id, added_at: b.addedAt })), 'user_id,entity_type,entity_id');
  const bmIds = s.bookmarks.map((b) => b.id);
  await client.remove('bookmarks', bmIds.length ? `entity_id=not.in.${inList(bmIds)}` : 'entity_id=not.is.null');

  await client.upsert('test_attempts', s.attempts.map((a) => ({
    id: a.id, user_id: userId, mode: a.mode, title: a.title, config: a.config, question_ids: a.questionIds, seed: a.seed,
    started_at: a.startedAt, finished_at: a.finishedAt ?? null, deadline_at: a.deadlineAt ?? null, parent_id: a.parentId ?? null,
    current_index: a.currentIndex, score_percent: a.finishedAt ? attemptScore(a).percent : null,
  })), 'id');
  await client.upsert('attempt_answers', s.attempts.flatMap((a) => Object.entries(a.answers).map(([question_id, x]) => ({
    attempt_id: a.id, question_id, user_id: userId, status: x.status, tries: x.tries, hint_used: x.hintShown, solution_shown: x.solutionShown,
    correct: x.correct, responses: x.responses, answered_at: x.answeredAt ?? null,
  }))), 'attempt_id,question_id');

  await client.upsert('error_review_queue', Object.entries(s.errorQueue).map(([question_id, e]) => ({ user_id: userId, question_id, wrong_count: e.wrongCount, last_wrong_at: e.lastWrongAt, correct_streak: e.correctStreak })), 'user_id,question_id');
  const errIds = Object.keys(s.errorQueue);
  await client.remove('error_review_queue', errIds.length ? `question_id=not.in.${inList(errIds)}` : 'question_id=not.is.null');

  await client.upsert('user_question_stats', Object.entries(s.questionStats).map(([question_id, x]) => ({ user_id: userId, question_id, seen: x.seen, correct: x.correct, wrong: x.wrong, last_at: x.lastAt })), 'user_id,question_id');
}

/** Строки сервера, относящиеся к одному предмету: ID тем и вопросов у предметов не пересекаются
 *  (у каждого предмета свой префикс ID «<prefix>-»), поэтому предмет определяется по ID. */
export function filterRemote(r: RemoteData, owns: (id: string) => boolean): RemoteData {
  const attempts = r.attempts.filter((a) => a.question_ids.some(owns) || (a.question_ids.length === 0 && (a.config?.topicIds ?? []).some(owns)));
  const aIds = new Set(attempts.map((a) => a.id));
  return {
    progress: r.progress.filter((p) => owns(p.topic_id)),
    bookmarks: r.bookmarks.filter((b) => owns(b.entity_id)),
    attempts,
    answers: r.answers.filter((a) => aIds.has(a.attempt_id)),
    errors: r.errors.filter((e) => owns(e.question_id)),
    stats: r.stats.filter((s) => owns(s.question_id)),
  };
}

/** Состояния предметов на сервере лежат в одних таблицах: отправляем их объединение, чтобы удаление
 *  закладок и очереди ошибок одного предмета не стёрло строки другого. */
export function combineStates(states: UserState[]): UserState {
  const [first, ...rest] = states;
  return rest.reduce<UserState>((acc, s) => ({
    ...acc,
    topicProgress: { ...acc.topicProgress, ...s.topicProgress },
    bookmarks: [...acc.bookmarks, ...s.bookmarks],
    attempts: [...acc.attempts, ...s.attempts],
    errorQueue: { ...acc.errorQueue, ...s.errorQueue },
    questionStats: { ...acc.questionStats, ...s.questionStats },
  }), first);
}

export interface SyncTarget { get: () => UserState; set: (s: UserState) => void; owns: (id: string) => boolean }

export async function syncNow(client: SupabaseClient, targets: SyncTarget[]): Promise<string> {
  const session = client.session();
  if (!session) throw new Error('Войдите в аккаунт, чтобы синхронизировать прогресс.');
  const remote = await pull(client);
  const merged = targets.map((t) => {
    const m = mergeRemote(t.get(), filterRemote(remote, t.owns));
    t.set(m);
    return m;
  });
  await push(client, combineStates(merged), session.user.id);
  const at = new Date().toISOString();
  kv.set(KEYS.syncMeta, JSON.stringify({ lastSyncAt: at }));
  return at;
}

export function lastSyncAt(): string | null {
  try {
    return JSON.parse(kv.get(KEYS.syncMeta) ?? 'null')?.lastSyncAt ?? null;
  } catch {
    return null;
  }
}

// ───── учебная база с сервера ─────
/** Загружает опубликованную версию учебной базы предмета; возвращает true, если она новее текущей.
 *  subject — id предмета из content/subjects.json, cacheKey — SUBJECTS[id].storage.pack. */
export async function fetchPublishedPack(client: SupabaseClient, currentBuiltAt: string, subject: string, cacheKey: string): Promise<boolean> {
  const rows = await client.select<{ version: string; pack: ContentPack; published_at: string }>('content_versions', `select=version,pack,published_at&subject=eq.${encodeURIComponent(subject)}&order=published_at.desc&limit=1`);
  const row = rows[0];
  if (!row || !row.pack || row.pack.builtAt <= currentBuiltAt) return false;
  kv.set(cacheKey, JSON.stringify(row.pack));
  return true;
}
