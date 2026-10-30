// Хеш-маршрутизация: работает одинаково в браузере, в Capacitor и в опубликованной странице.

// Адреса: #/ — стартовый экран (выбор предмета); #/<prefix>/… — экраны предмета (префиксы — в content/subjects.json).
// Адрес без известного префикса открывает стартовый экран.
// navigate() и href() принимают путь внутри предмета и сами добавляют префикс активного предмета.

import { useSyncExternalStore } from 'react';
import { activateSubject, subject as activeSubject } from '../data/store';
import { SUBJECTS, subjectByPrefix, type SubjectId } from '../data/subjects';

export interface Route {
  path: string; // путь внутри предмета, без ведущего # и префикса
  parts: string[];
  /** null — стартовый экран выбора предмета. */
  subject: SubjectId | null;
}

function read(): Route {
  const raw = decodeURIComponent((typeof location !== 'undefined' ? location.hash : '').replace(/^#\/?/, ''));
  const full = raw.split('?')[0].replace(/\/+$/, '');
  let parts = full ? full.split('/') : [];
  let subject: SubjectId | null;
  const bySeg = parts.length ? subjectByPrefix(parts[0]) : null;
  if (bySeg) {
    subject = bySeg;
    parts = parts.slice(1);
  } else {
    subject = null;
    parts = [];
  }
  if (subject) activateSubject(subject);
  return { path: parts.join('/'), parts, subject };
}

let current = read();
const subs = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = read();
    subs.forEach((s) => s());
    window.scrollTo({ top: 0 });
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => current,
    () => current,
  );
}

let depth = 0; // сколько переходов сделано внутри приложения — чтобы «Назад» не уводил из него

const prefixed = (path: string, subject: SubjectId = activeSubject) => {
  const p = path.replace(/^\/+/, '');
  return '#/' + SUBJECTS[subject].prefix + (p ? '/' + p : '');
};

/** Переход внутри активного предмета (или указанного). */
export function navigate(path: string, opts: { replace?: boolean; subject?: SubjectId } = {}) {
  go(prefixed(path, opts.subject), opts);
}
/** Стартовый экран выбора предмета. */
export function navigateStart(opts: { replace?: boolean } = {}) {
  go('#/', opts);
}
function go(target: string, opts: { replace?: boolean }) {
  if (location.hash === target) return;
  if (opts.replace) {
    history.replaceState(null, '', target);
    current = read();
    subs.forEach((s) => s());
  } else {
    depth++;
    location.hash = target;
  }
}

export function back(fallback = '') {
  if (depth > 0) {
    depth--;
    history.back();
  } else navigate(fallback, { replace: true });
}

export function href(path: string, subject?: SubjectId) {
  return prefixed(path, subject);
}
