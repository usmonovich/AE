// Хранилища состояния: прогресс пользователя и правки администратора — отдельно для каждого предмета.
// Простая модель: get/set/subscribe + сохранение в KV с небольшой задержкой.
// Активный предмет переключает маршрутизатор (#/<prefix>/…, префиксы — в content/subjects.json); экспортируемые
// pack, userStore и adminStore — живые привязки ES-модуля и всегда указывают на активный предмет.

import { useSyncExternalStore } from 'react';
import { kv } from './storage';
import { emptyUserState } from '../domain/progress';
import { emptyOverlay, ContentIndex } from '../domain/content-index';
import type { AdminOverlay, ContentPack, UserState, Settings } from '../domain/types';
import { PACKS } from './packs.generated';
import { setPageLabels } from '../domain/page-label';
import { SUBJECTS, SUBJECT_IDS, SHARED_KEYS, type SubjectId, type SubjectMeta } from './subjects';

/** Встроенная учебная база; если с сервера получена более новая опубликованная версия — используется она. */
function loadPack(bundled: ContentPack, cacheKey?: string): ContentPack {
  if (!cacheKey) return bundled;
  try {
    const raw = kv.get(cacheKey);
    if (raw) {
      const p = JSON.parse(raw) as ContentPack;
      if (p?.schema === 1 && p.builtAt > bundled.builtAt) return p;
    }
  } catch {
    /* повреждённый кеш игнорируем */
  }
  return bundled;
}

export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (prev: T) => T): void;
  subscribe(cb: () => void): () => void;
  flush(): void;
  /** Значение из облака (база артефакта): показывается и кешируется, но обратно в облако не уходит. */
  applyRemote(next: T, remoteTime: number): void;
  /** Время последнего изменения сохранённого значения, мс (0 — изменений не было). */
  localTime(): number;
  /** Подписка только на изменения, сделанные на этом устройстве, — их отправляет облако. */
  onLocalChange(cb: () => void): () => void;
}

export function createStore<T>(key: string, initial: () => T, migrate: (raw: unknown) => T | null): Store<T> {
  let value: T;
  try {
    const raw = kv.get(key);
    value = (raw && migrate(JSON.parse(raw))) || initial();
  } catch {
    value = initial();
  }
  const timeKey = `${key}.t`;
  let mtime = Number(kv.get(timeKey) ?? 0) || 0;
  const subs = new Set<() => void>();
  const localSubs = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const persist = () => {
    timer = null;
    try {
      kv.set(key, JSON.stringify(value));
      kv.set(timeKey, String(mtime));
    } catch (e) {
      console.warn('save failed', e);
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, 150);
  };
  return {
    get: () => value,
    set(next) {
      value = next;
      mtime = Date.now();
      subs.forEach((s) => s());
      localSubs.forEach((s) => s());
      schedule();
    },
    update(fn) {
      this.set(fn(value));
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        persist();
      }
    },
    applyRemote(next, remoteTime) {
      const m = migrate(next);
      if (!m) return;
      value = m;
      mtime = remoteTime;
      subs.forEach((s) => s());
      schedule();
    },
    localTime: () => mtime,
    onLocalChange(cb) {
      localSubs.add(cb);
      return () => localSubs.delete(cb);
    },
  };
}

function migrateUser(raw: unknown): UserState | null {
  const r = raw as Partial<UserState> | null;
  if (!r || r.version !== 1) return null;
  const base = emptyUserState();
  return { ...base, ...r, settings: { ...base.settings, ...(r.settings ?? {}) } } as UserState;
}
function migrateAdmin(raw: unknown): AdminOverlay | null {
  const r = raw as Partial<AdminOverlay> | null;
  if (!r || r.version !== 1) return null;
  const base = emptyOverlay();
  return { ...base, ...r, added: { ...base.added, ...(r.added ?? {}) } } as AdminOverlay;
}

interface Runtime {
  meta: SubjectMeta;
  pack: ContentPack;
  userStore: Store<UserState>;
  adminStore: Store<AdminOverlay>;
  cachedOverlay: AdminOverlay | null;
  cachedIndex: ContentIndex | null;
}
function runtime(id: SubjectId, bundled: ContentPack): Runtime {
  const meta = SUBJECTS[id];
  return {
    meta,
    pack: loadPack(bundled, meta.storage.pack),
    userStore: createStore<UserState>(meta.storage.user, () => emptyUserState(), migrateUser),
    adminStore: createStore<AdminOverlay>(meta.storage.admin, () => emptyOverlay(), migrateAdmin),
    cachedOverlay: null,
    cachedIndex: null,
  };
}
export const runtimes: Record<SubjectId, Runtime> = Object.fromEntries(
  SUBJECT_IDS.map((id) => {
    const bundled = PACKS[id];
    if (!bundled) throw new Error(`Нет учебной базы предмета ${id} — запустите npm run content:build`);
    return [id, runtime(id, bundled as unknown as ContentPack)];
  }),
);

/** Активный предмет. Меняется только через activateSubject (его вызывает маршрутизатор). */
export let subject: SubjectId = SUBJECT_IDS[0];
export let pack: ContentPack = runtimes[subject].pack;
export let userStore: Store<UserState> = runtimes[subject].userStore;
export let adminStore: Store<AdminOverlay> = runtimes[subject].adminStore;

const LAST_SUBJECT_KEY = SHARED_KEYS.lastSubject;
const subjectSubs = new Set<() => void>();
setPageLabels(pack.sourceFiles);
export function activateSubject(id: SubjectId) {
  if (id === subject) return;
  subject = id;
  ({ pack, userStore, adminStore } = runtimes[id]);
  setPageLabels(pack.sourceFiles);
  kv.set(LAST_SUBJECT_KEY, id);
  subjectSubs.forEach((f) => f());
}
export function lastSubject(): SubjectId | null {
  const v = kv.get(LAST_SUBJECT_KEY);
  return v && SUBJECTS[v] ? v : null;
}
export function useSubject(): SubjectMeta {
  const id = useSyncExternalStore((cb) => (subjectSubs.add(cb), () => subjectSubs.delete(cb)), () => subject, () => subject);
  return SUBJECTS[id];
}

/** Общие для всех предметов настройки (тема, размер шрифта, показ материалов на проверке) — в отдельном
 *  хранилище: от предметов они не зависят. Используется только поле settings. */
export const settingsStore: Store<UserState> = createStore<UserState>(SHARED_KEYS.settings, () => emptyUserState(), migrateUser);

const allStores = () => [settingsStore, ...Object.values(runtimes).flatMap((r) => [r.userStore, r.adminStore])];
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => allStores().forEach((s) => s.flush()));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') allStores().forEach((s) => s.flush());
  });
}

// Индекс учебной базы пересчитывается только при изменении оверлея (у каждого предмета — свой).
export function indexOf(id: SubjectId): ContentIndex {
  const r = runtimes[id];
  const ov = r.adminStore.get();
  if (ov !== r.cachedOverlay || !r.cachedIndex) {
    r.cachedOverlay = ov;
    r.cachedIndex = new ContentIndex(r.pack, ov);
  }
  return r.cachedIndex;
}
export function getIndex(): ContentIndex {
  return indexOf(subject);
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
export function useUser(): UserState {
  useSubject();
  return useStore(userStore);
}
export function useAdmin(): AdminOverlay {
  useSubject();
  return useStore(adminStore);
}
export function useIndex(): ContentIndex {
  useSubject();
  useStore(adminStore);
  return getIndex();
}
export function useSettings(): Settings {
  return useStore(settingsStore).settings;
}
