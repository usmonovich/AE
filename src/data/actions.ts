// Действия пользователя. Все изменения прогресса проходят через эти функции.

import { userStore, getIndex, settingsStore, subject } from './store';
import { SUBJECTS } from './subjects';
import { applyEvent, emptyAnswer, isFinal, type FlowEvent } from '../domain/hint-flow';
import { checkResponse } from '../domain/answer-check';
import { createAttempt, isExpired } from '../domain/test-engine';
import { recordFinal, emptyUserState } from '../domain/progress';
import { newSeed } from '../domain/random';
import type { Attempt, AttemptMode, Bookmark, Question, Response, Settings, TestConfig, UserState } from '../domain/types';

const nowIso = () => new Date().toISOString();
const touch = (s: UserState): UserState => ({ ...s, updatedAt: nowIso() });

// ───── обучение ─────
export function openTopic(topicId: string) {
  userStore.update((s) =>
    touch({ ...s, lastTopicId: topicId, topicProgress: { ...s.topicProgress, [topicId]: { ...s.topicProgress[topicId], lastOpenedAt: nowIso() } } }),
  );
}
export function setStudied(topicId: string, studied: boolean) {
  userStore.update((s) =>
    touch({ ...s, topicProgress: { ...s.topicProgress, [topicId]: { ...s.topicProgress[topicId], studiedAt: studied ? nowIso() : undefined } } }),
  );
}
export function isBookmarked(s: UserState, type: Bookmark['type'], id: string) {
  return s.bookmarks.some((b) => b.type === type && b.id === id);
}
export function toggleBookmark(type: Bookmark['type'], id: string) {
  userStore.update((s) =>
    touch({
      ...s,
      bookmarks: isBookmarked(s, type, id) ? s.bookmarks.filter((b) => !(b.type === type && b.id === id)) : [...s.bookmarks, { type, id, addedAt: nowIso() }],
    }),
  );
}
export function markCard(id: string, mark: 'know' | 'learn') {
  userStore.update((s) => touch({ ...s, cardMarks: { ...s.cardMarks, [id]: mark } }));
}
export function setSettings(patch: Partial<Settings>) {
  settingsStore.update((s) => touch({ ...s, settings: { ...s.settings, ...patch } }));
}

// ───── тесты ─────
export function startAttempt(cfg: TestConfig, mode: AttemptMode, title: string, opts: { parentId?: string; restrictIds?: string[] } = {}): Attempt {
  const attempt = createAttempt(getIndex(), cfg, { mode, title, seed: newSeed(), now: new Date(), ...opts });
  userStore.update((s) => {
    // незавершённые попытки того же режима закрываем, чтобы не копить «висящие»
    const attempts = s.attempts.filter((a) => a.finishedAt || a.mode !== mode);
    return touch({ ...s, attempts: [...attempts, attempt].slice(-200) });
  });
  return attempt;
}

export function getAttempt(id: string): Attempt | undefined {
  return userStore.get().attempts.find((a) => a.id === id);
}

function patchAttempt(id: string, fn: (a: Attempt) => Attempt) {
  userStore.update((s) => touch({ ...s, attempts: s.attempts.map((a) => (a.id === id ? fn(a) : a)) }));
}

/** Применяет событие ответа; при финальном статусе учитывает его в статистике и очереди ошибок. */
export function answerEvent(attemptId: string, q: Question, ev: Omit<FlowEvent, 'at'> & { at?: string }) {
  const at = ev.at ?? nowIso();
  const a = getAttempt(attemptId);
  if (!a || a.finishedAt) return;
  const prev = a.answers[q.id] ?? emptyAnswer();
  const next = applyEvent(prev, { ...ev, at } as FlowEvent);
  if (next === prev) return;
  patchAttempt(attemptId, (x) => ({ ...x, answers: { ...x.answers, [q.id]: next } }));
  if (!isFinal(prev) && isFinal(next)) userStore.update((s) => recordFinal(s, q.id, next.correct === true, new Date(at)));
}

export function submitAnswer(attemptId: string, q: Question, response: Response) {
  const a = getAttempt(attemptId);
  if (!a) return;
  answerEvent(attemptId, q, { type: 'submit', response, correct: checkResponse(q, response), hintsEnabled: a.config.hints });
}

export function goTo(attemptId: string, index: number) {
  patchAttempt(attemptId, (a) => ({ ...a, currentIndex: Math.max(0, Math.min(index, a.questionIds.length - 1)) }));
}

/** Завершение попытки. Неотвеченные вопросы считаются пропущенными (не верными). */
export function finishAttempt(attemptId: string) {
  const a = getAttempt(attemptId);
  if (!a || a.finishedAt) return;
  const at = nowIso();
  patchAttempt(attemptId, (x) => ({ ...x, finishedAt: at }));
}

export function checkDeadline(attemptId: string): boolean {
  const a = getAttempt(attemptId);
  if (a && !a.finishedAt && isExpired(a, new Date())) {
    finishAttempt(attemptId);
    return true;
  }
  return false;
}

export function deleteAttempt(attemptId: string) {
  userStore.update((s) => touch({ ...s, attempts: s.attempts.filter((a) => a.id !== attemptId) }));
}

// ───── данные ─────
export function resetProgress() {
  const settings = userStore.get().settings;
  userStore.set({ ...emptyUserState(), settings });
  userStore.flush();
}

export function exportProgress(): string {
  return JSON.stringify({ kind: SUBJECTS[subject].exportKind, exportedAt: nowIso(), state: userStore.get() }, null, 1);
}

export function importProgress(text: string): { ok: boolean; message: string } {
  try {
    const data = JSON.parse(text);
    const st = data?.state as UserState | undefined;
    if (data?.kind !== SUBJECTS[subject].exportKind || !st || st.version !== 1) {
      const other = Object.values(SUBJECTS).find((m) => m.exportKind === data?.kind);
      return { ok: false, message: other ? `Это файл прогресса по предмету «${other.title}» — откройте этот предмет и импортируйте там.` : 'Это не файл прогресса приложения.' };
    }
    userStore.set({ ...emptyUserState(), ...st, settings: { ...emptyUserState().settings, ...st.settings } });
    userStore.flush();
    return { ok: true, message: `Прогресс восстановлен: ${st.attempts.length} попыток, ${Object.keys(st.topicProgress).length} тем.` };
  } catch {
    return { ok: false, message: 'Файл повреждён или имеет неверный формат.' };
  }
}
