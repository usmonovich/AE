import type { Question, Response } from './types';

const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+',
};

/**
 * Разбор числа, введённого студентом. Понимает запятую и точку, пробелы между разрядами,
 * знак «−», экспоненту в формах 1e-6, 1·10^-6, 1*10^(-6), 1×10⁻⁶, 10^5.
 * Возвращает NaN, если ввод не является числом.
 */
export function parseNumber(raw: string): number {
  let s = raw.trim();
  if (!s) return NaN;
  s = s.replace(/[    ]/g, '');
  s = s.replace(/[−–—]/g, '-');
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => '^' + [...m].map((c) => SUPERSCRIPT[c]).join(''));
  s = s.replace(/,/g, '.');
  // «10^5» без множителя
  let m = /^([+-]?)10\^\(?([+-]?\d+)\)?$/.exec(s);
  if (m) return Number(`${m[1]}1e${m[2]}`);
  // a·10^b, a*10^b, a×10^b, a x 10^b
  m = /^([+-]?\d*\.?\d+)[·*×xх]10\^\(?([+-]?\d+)\)?$/i.exec(s);
  if (m) return Number(`${m[1]}e${m[2]}`);
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return Number(s);
  return NaN;
}

export function numericMatches(value: number, expected: number, tol: number, tolAbs?: number): boolean {
  if (!Number.isFinite(value)) return false;
  const allowed = Math.max(Math.abs(expected) * tol, tolAbs ?? 0, 1e-12);
  return Math.abs(value - expected) <= allowed;
}

/**
 * Проверка ответа. Возвращает true/false, либо null, если автоматическая проверка невозможна
 * (текстовый ответ до самопроверки по эталону).
 */
export function checkResponse(q: Question, r: Response): boolean | null {
  switch (q.type) {
    case 'single':
      return r.type === 'single' && r.key === q.answer;
    case 'multiple': {
      if (r.type !== 'multiple') return false;
      const want = new Set(q.answer as string[]);
      const got = new Set(r.keys);
      return want.size === got.size && [...want].every((k) => got.has(k));
    }
    case 'numeric':
      if (r.type !== 'numeric' || !q.numeric) return false;
      return numericMatches(parseNumber(r.raw), q.numeric.value, q.numeric.tol, q.numeric.tolAbs);
    case 'matching': {
      if (r.type !== 'matching' || !q.pairs) return false;
      return q.pairs.every((_, i) => r.map[String(i)] === String(i));
    }
    case 'sequence': {
      if (r.type !== 'sequence' || !q.sequence) return false;
      return r.order.length === q.sequence.length && r.order.every((k, i) => k === String(i));
    }
    case 'text':
      if (r.type !== 'text') return false;
      return typeof r.selfAssessed === 'boolean' ? r.selfAssessed : null;
  }
}

/** Ответ полностью заполнен и его можно отправить на проверку. */
export function isComplete(q: Question, r: Response | null): boolean {
  if (!r) return false;
  switch (r.type) {
    case 'single': return !!r.key;
    case 'multiple': return r.keys.length > 0;
    case 'numeric': return !Number.isNaN(parseNumber(r.raw));
    case 'matching': return !!q.pairs && q.pairs.every((_, i) => r.map[String(i)] != null && r.map[String(i)] !== '');
    case 'sequence': return !!q.sequence && r.order.length === q.sequence.length;
    case 'text': return r.text.trim().length > 0;
  }
}
