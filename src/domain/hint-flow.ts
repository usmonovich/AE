// Алгоритм ответа на вопрос (п. 7 ТЗ):
//   верно            → «верно» + объяснение;
//   неверно (1-й раз) → подсказка из источника + повторная попытка;
//   неверно (2-й раз) → правильный ответ + полный разбор;
//   «Показать решение» → полный разбор сразу.
// Текстовый ответ: сверка с эталоном, затем самооценка.
// В режиме экзамена подсказки выключены: одна попытка.

import type { AttemptAnswer, Response } from './types';

export type FlowEvent =
  | { type: 'submit'; response: Response; correct: boolean | null; hintsEnabled: boolean; at: string }
  | { type: 'selfAssess'; correct: boolean; at: string }
  | { type: 'reveal'; at: string };

export const emptyAnswer = (): AttemptAnswer => ({
  status: 'unanswered',
  tries: 0,
  hintShown: false,
  solutionShown: false,
  responses: [],
  correct: null,
});

export const isFinal = (a: AttemptAnswer | undefined): boolean =>
  !!a && (a.status === 'correct' || a.status === 'wrong' || a.status === 'revealed');

export function applyEvent(a: AttemptAnswer, ev: FlowEvent): AttemptAnswer {
  if (isFinal(a)) return a;
  switch (ev.type) {
    case 'submit': {
      if (a.status === 'selfcheck') return a;
      const tries = a.tries + 1;
      const responses = [...a.responses, ev.response];
      if (ev.correct === null) return { ...a, tries, responses, status: 'selfcheck' };
      if (ev.correct) return { ...a, tries, responses, status: 'correct', correct: true, answeredAt: ev.at };
      if (ev.hintsEnabled && a.tries === 0) return { ...a, tries, responses, status: 'hint', hintShown: true };
      return { ...a, tries, responses, status: 'wrong', correct: false, answeredAt: ev.at };
    }
    case 'selfAssess': {
      if (a.status !== 'selfcheck') return a;
      const last = a.responses[a.responses.length - 1];
      const responses = last && last.type === 'text' ? [...a.responses.slice(0, -1), { ...last, selfAssessed: ev.correct }] : a.responses;
      return { ...a, responses, status: ev.correct ? 'correct' : 'wrong', correct: ev.correct, answeredAt: ev.at };
    }
    case 'reveal':
      return { ...a, status: 'revealed', solutionShown: true, correct: false, answeredAt: ev.at };
  }
}
