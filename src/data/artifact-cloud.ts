// Сохранение в базе данных артефакта claude.ai.
//
// Когда приложение открыто как артефакт claude.ai, память браузера (localStorage) там не надёжна:
// в мобильном приложении Claude она может быть пустой при каждом новом открытии. Поэтому:
//   • решения администратора (утверждения, отклонения, правки, замечания) — общий документ предмета
//     `ae/<предмет>/admin`, писать его может только владелец артефакта, читают все, кому он открыт;
//   • прогресс ученика — личный документ `data/users/<id>/<предмет>` (виден только ему самому);
//   • общие настройки (тема, размер шрифта) — личный документ `data/users/<id>/settings`.
// PIN администратора в базе не хранится: в личную сборку встроен только его хеш (см. src/data/admin-pin.ts).
// Большие значения делятся на части по 40 000 символов (документ базы — до 256 КиБ).
//
// В обычном браузере, в приложении Capacitor и в тестах window.claude нет — всё работает
// через localStorage, как раньше.

import { useSyncExternalStore } from 'react';
import { runtimes, settingsStore, type Store } from './store';
import { SUBJECTS, SUBJECT_IDS, SHARED_KEYS } from './subjects';
import { cyrb53 } from '../domain/hash';
import type { AdminOverlay } from '../domain/types';

const CHUNK = 40_000;
const PUSH_DELAY_MS = 500;

// Минимальные типы платформы (полные — в документации артефактов, контракт 0.2.85).
interface Snap { exists: boolean; data(): Record<string, unknown> | undefined }
interface Ref {
  get(): Promise<Snap>;
  set(d: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (s: Snap) => void, error?: (e: { code: string }) => void): () => void;
}
interface Db { doc(path: string): Ref }
interface UserCap { id(): Promise<string | null>; isOwner(): Promise<boolean> }
interface Runtime { use(name: string): Promise<unknown> }

// ───────────── статус для интерфейса ─────────────
export interface CloudStatus {
  /** local — только память этого устройства; connecting — подключение; cloud — база артефакта. */
  mode: 'local' | 'connecting' | 'cloud';
  /** Решения администратора сохраняются в общей базе (только у владельца артефакта). */
  adminWritable: boolean;
  /** Прогресс ученика сохраняется в базе. */
  userSaved: boolean;
  /** Есть изменения, которые ещё отправляются. */
  pending: boolean;
  savedAt?: number;
  error?: string;
}
let status: CloudStatus = { mode: 'local', adminWritable: false, userSaved: false, pending: false };
/** Пока идёт первая загрузка из базы, интерфейс ждёт: иначе действие до загрузки затёрло бы сохранённое. */
const LOAD_TIMEOUT_MS = 12_000;
const statusSubs = new Set<() => void>();
function patchStatus(p: Partial<CloudStatus>) {
  status = { ...status, ...p };
  statusSubs.forEach((f) => f());
}
export const getCloudStatus = () => status;
export function useCloudStatus(): CloudStatus {
  return useSyncExternalStore(
    (cb) => (statusSubs.add(cb), () => statusSubs.delete(cb)),
    () => status,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errCode = (e: unknown) => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : 'unknown');
function errText(e: unknown): string {
  const c = errCode(e);
  if (c === 'invalid_argument') return 'Нет права записи в базу артефакта.';
  if (c === 'quota_exceeded') return 'База артефакта заполнена.';
  if (c === 'revoked' || c === 'not_granted') return 'Доступ к базе артефакта закрыт.';
  return 'Не удалось сохранить — повторю при следующем изменении.';
}

// ───────────── большое JSON-значение в нескольких документах ─────────────
export class ChunkedDoc {
  private written: string[] = [];
  constructor(private readonly db: Db, readonly base: string) {}

  /** null — документа ещё нет. Бросает, если части не совпадают с заголовком (запись ещё идёт). */
  async read(): Promise<{ value: unknown; time: number } | null> {
    const head = await this.db.doc(this.base).get();
    if (!head.exists) return null;
    const h = head.data() as { n?: number; hashes?: string[]; time?: number };
    const n = Number(h.n ?? 0);
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const c = await this.db.doc(`${this.base}/chunks/c${i}`).get();
      const s = c.exists ? String((c.data() as { s?: unknown }).s ?? '') : '';
      if (cyrb53(s) !== h.hashes?.[i]) throw Object.assign(new Error('части ещё записываются'), { code: 'partial' });
      parts.push(s);
    }
    this.written = parts;
    return { value: JSON.parse(parts.join('') || 'null'), time: Number(h.time ?? 0) };
  }

  async readSettled(): Promise<{ value: unknown; time: number } | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.read();
      } catch (e) {
        if (attempt >= 3 || (errCode(e) !== 'partial' && errCode(e) !== 'unavailable')) throw e;
        await sleep(400 + Math.random() * 600);
      }
    }
  }

  /** Пишет только изменившиеся части, затем заголовок; лишние части удаляет. */
  async write(json: string, time: number): Promise<void> {
    const parts: string[] = [];
    for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
    if (!parts.length) parts.push('');
    for (let i = 0; i < parts.length; i++) {
      if (this.written[i] === parts[i]) continue;
      await this.db.doc(`${this.base}/chunks/c${i}`).set({ s: parts[i] });
    }
    await this.db.doc(this.base).set({ v: 1, n: parts.length, hashes: parts.map((p) => cyrb53(p)), time });
    for (let i = parts.length; i < this.written.length; i++) await this.db.doc(`${this.base}/chunks/c${i}`).delete();
    this.written = parts;
  }

  watch(cb: (time: number) => void): () => void {
    return this.db.doc(this.base).onSnapshot(
      (s) => { if (s.exists) cb(Number((s.data() as { time?: unknown }).time ?? 0)); },
      () => { /* подписка умерла — данные всё равно сохраняются записью */ },
    );
  }
}

// ───────────── синхронизация одного хранилища ─────────────
interface SyncOptions<T> {
  writable: boolean;
  /** Что отправлять (например, без PIN). */
  toRemote?: (v: T) => unknown;
  /** Как принять значение из базы (например, сохранить свой PIN). */
  fromRemote?: (remote: unknown) => T;
  onDenied?: () => void;
}

const pushers: (() => Promise<void>)[] = [];

export async function syncStore<T>(store: Store<T>, doc: ChunkedDoc, o: SyncOptions<T>): Promise<void> {
  const toRemote = o.toRemote ?? ((v: T) => v);
  const fromRemote = o.fromRemote ?? ((r: unknown) => r as T);
  let lastTime = 0;
  let writing = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writable = o.writable;

  const run = async (): Promise<void> => {
    timer = null;
    if (!writable) return;
    if (writing) { again = true; return; }
    writing = true;
    try {
      do {
        again = false;
        const time = store.localTime() || Date.now();
        await doc.write(JSON.stringify(toRemote(store.get())), time);
        lastTime = time;
      } while (again);
      patchStatus({ pending: false, savedAt: Date.now(), error: undefined });
    } catch (e) {
      if (errCode(e) === 'invalid_argument') { writable = false; o.onDenied?.(); }
      patchStatus({ pending: false, error: errText(e) });
    } finally {
      writing = false;
    }
  };
  const schedule = (delay = PUSH_DELAY_MS) => {
    if (!writable) return;
    patchStatus({ pending: true });
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delay);
  };
  pushers.push(async () => { if (timer) { clearTimeout(timer); await run(); } });

  // 1. Загрузка: в базе новее — берём её; на устройстве новее — отправляем.
  try {
    const remote = await doc.readSettled();
    if (remote && remote.time >= store.localTime()) {
      lastTime = remote.time;
      store.applyRemote(fromRemote(remote.value), remote.time);
    } else {
      // В базе ещё ничего нет или на этом устройстве есть более новые изменения — отправляем.
      schedule(50);
    }
  } catch (e) {
    patchStatus({ error: errText(e) });
  }

  // 2. Каждое изменение на этом устройстве — в базу (с небольшой задержкой).
  store.onLocalChange(() => schedule());

  // 3. Изменения с другого устройства — сразу на экран.
  doc.watch(async (time) => {
    if (writing || time <= lastTime || time <= store.localTime()) return;
    try {
      const r = await doc.readSettled();
      if (r && r.time > store.localTime()) {
        lastTime = r.time;
        store.applyRemote(fromRemote(r.value), r.time);
      }
    } catch {
      /* прочитаем при следующем изменении */
    }
  });
}

/** Отправить всё несохранённое прямо сейчас (при сворачивании приложения). */
export function flushCloud(): void {
  for (const p of pushers) void p();
}

// ───────────── запуск ─────────────
let started = false;

export async function startCloud(): Promise<void> {
  if (started || typeof window === 'undefined') return;
  started = true;
  const rt = (window as unknown as { claude?: Runtime }).claude;
  if (!rt || typeof rt.use !== 'function') return; // не артефакт — работаем локально

  patchStatus({ mode: 'connecting' });
  // Страховка: если платформа не ответила, через 12 с работаем локально.
  const guard = setTimeout(() => { if (status.mode === 'connecting') patchStatus({ mode: 'local', error: 'База артефакта не ответила — данные сохраняются только на этом устройстве.' }); }, LOAD_TIMEOUT_MS);
  try {
    await connect(rt);
  } finally {
    clearTimeout(guard);
  }
}

async function connect(rt: Runtime): Promise<void> {
  const [db, user] = (await Promise.all([rt.use('db'), rt.use('user')])) as [Db | null, UserCap | null];
  if (status.mode !== 'connecting') return; // время ожидания вышло — остаёмся в локальном режиме
  if (!db) {
    patchStatus({ mode: 'local' });
    return;
  }
  const uid = user ? await user.id().catch(() => null) : null;
  const owner = user ? await user.isOwner().catch(() => false) : false;
  let adminDenied = false;
  let userDenied = false;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCloud();
  });
  window.addEventListener('pagehide', flushCloud);

  // Каждый предмет — в своих документах (пути — в src/data/subjects.ts). Документы независимы —
  // загружаются параллельно, чтобы запуск не замедлялся с ростом числа предметов.
  const userDeniedCb = () => { userDenied = true; patchStatus({ userSaved: false }); };
  await Promise.all([
    ...SUBJECT_IDS.flatMap((id) => {
      const rt = runtimes[id];
      const meta = SUBJECTS[id];
      return [
        syncStore<AdminOverlay>(rt.adminStore, new ChunkedDoc(db, meta.cloud.admin), {
          writable: owner,
          onDenied: () => { adminDenied = true; patchStatus({ adminWritable: false }); },
        }),
        uid ? syncStore(rt.userStore, new ChunkedDoc(db, meta.cloud.user(uid)), { writable: true, onDenied: userDeniedCb }) : null,
      ];
    }),
    uid ? syncStore(settingsStore, new ChunkedDoc(db, SHARED_KEYS.cloudSettings(uid)), { writable: true, onDenied: userDeniedCb }) : null,
  ]);
  // Данные загружены — интерфейс можно показывать.
  patchStatus({ mode: 'cloud', adminWritable: owner && !adminDenied, userSaved: !!uid && !userDenied });
}
