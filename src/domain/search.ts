// Поиск по темам, теории, формулам и вопросам.

import { ContentIndex } from './content-index';

const GREEK: Record<string, string> = {
  upsilon: 'υ', nu: 'ν', omega: 'ω', varphi: 'φ', phi: 'φ', alpha: 'α', beta: 'β', gamma: 'γ', rho: 'ρ', mu: 'μ',
  eta: 'η', pi: 'π', Delta: 'Δ', infty: '∞', sigma: 'σ',
};

/** Превращает LaTeX и разметку в простой текст для поиска. */
export function plain(s: string): string {
  return s
    .replace(/\\text\{([^}]*)\}/g, '$1')
    .replace(/\\([A-Za-z]+)/g, (_, c: string) => (GREEK[c] ? GREEK[c] : ' '))
    .replace(/[{}$^_\\*#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function norm(s: string): string {
  return plain(s).toLowerCase().replace(/ё/g, 'е');
}

export interface SearchHit {
  kind: 'topic' | 'theory' | 'formula' | 'question';
  id: string;
  topicId: string;
  title: string;
  snippet: string;
  score: number;
}

function score(text: string, terms: string[], weight: number): number {
  let s = 0;
  for (const t of terms) {
    const i = text.indexOf(t);
    if (i < 0) return 0;
    s += weight * (i === 0 || text[i - 1] === ' ' ? 2 : 1);
  }
  return s;
}

function snippetOf(text: string, term: string): string {
  const p = plain(text);
  const i = p.toLowerCase().replace(/ё/g, 'е').indexOf(term);
  if (i < 0) return p.slice(0, 120);
  const start = Math.max(0, i - 40);
  return (start > 0 ? '…' : '') + p.slice(start, start + 120) + (p.length > start + 120 ? '…' : '');
}

export function search(index: ContentIndex, query: string, opts: { showReview: boolean; includeReviewQuestions: boolean }): SearchHit[] {
  const terms = norm(query).split(' ').filter((t) => t.length > 0);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  const visibleTopics = new Set(index.allVisibleTopics().map((t) => t.id));
  for (const t of index.topics) {
    if (!visibleTopics.has(t.id)) continue;
    const s = score(norm(t.title), terms, 5);
    if (s) hits.push({ kind: 'topic', id: t.id, topicId: t.id, title: t.title, snippet: index.path(t.id).subsection?.title ?? '', score: s + 10 });
  }
  for (const f of index.formulas) {
    if (!visibleTopics.has(f.topicId) || !ContentIndex.visible(f.status, opts.showReview)) continue;
    const s = score(norm(f.title), terms, 3) || score(norm(f.tex + ' ' + (f.conditions ?? '')), terms, 1);
    if (s) hits.push({ kind: 'formula', id: f.id, topicId: f.topicId, title: f.title, snippet: f.tex, score: s });
  }
  for (const x of index.theory) {
    if (!visibleTopics.has(x.topicId) || !ContentIndex.visible(x.status, opts.showReview)) continue;
    const s = score(norm(x.title ?? ''), terms, 3) || score(norm(x.body), terms, 1);
    if (s) hits.push({ kind: 'theory', id: x.id, topicId: x.topicId, title: x.title ?? index.topic(x.topicId)?.title ?? '', snippet: snippetOf(x.body, terms[0]), score: s });
  }
  for (const q of index.questions) {
    if (!visibleTopics.has(q.topicId) || !ContentIndex.usableQuestion(q, opts.includeReviewQuestions)) continue;
    const s = score(norm(q.prompt), terms, 1);
    if (s) hits.push({ kind: 'question', id: q.id, topicId: q.topicId, title: snippetOf(q.prompt, terms[0]), snippet: index.topic(q.topicId)?.title ?? '', score: s });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 80);
}
