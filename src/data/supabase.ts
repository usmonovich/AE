// Минимальный клиент Supabase (GoTrue + PostgREST) на fetch, без сторонних зависимостей.
// В клиенте только публичный anon-ключ: доступ к данным ограничивают политики RLS на сервере.
// Секретные ключи (service_role, ключ ИИ-провайдера) в приложение не попадают.

import { kv, KEYS } from './storage';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

export const config = {
  url: typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '',
  anonKey: typeof __SUPABASE_ANON_KEY__ !== 'undefined' ? __SUPABASE_ANON_KEY__ : '',
};
export const backendEnabled = () => !!(config.url && config.anonKey);

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  user: { id: string; email?: string };
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type FetchLike = typeof fetch;

export class SupabaseClient {
  constructor(private url: string, private anonKey: string, private fetcher: FetchLike = (...a) => fetch(...a)) {}

  session(): Session | null {
    try {
      const raw = kv.get(KEYS.session);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }
  private saveSession(s: Session | null) {
    if (s) kv.set(KEYS.session, JSON.stringify(s));
    else kv.remove(KEYS.session);
  }

  private async request(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<unknown> {
    const headers: Record<string, string> = { apikey: this.anonKey, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) };
    if (init.auth !== false) {
      const s = await this.validSession();
      if (s) headers.Authorization = `Bearer ${s.access_token}`;
    }
    const res = await this.fetcher(`${this.url}${path}`, { ...init, headers });
    const text = await res.text();
    const body = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (body as { msg?: string; message?: string; error_description?: string })?.msg ?? (body as { message?: string })?.message ?? (body as { error_description?: string })?.error_description ?? res.statusText;
      throw new ApiError(res.status, translateError(String(msg)));
    }
    return body;
  }

  private async validSession(): Promise<Session | null> {
    const s = this.session();
    if (!s) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s;
    try {
      const fresh = (await this.request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', auth: false, body: JSON.stringify({ refresh_token: s.refresh_token }),
      })) as Session & { expires_in: number };
      const next = { ...fresh, expires_at: fresh.expires_at ?? Math.floor(Date.now() / 1000) + fresh.expires_in };
      this.saveSession(next);
      return next;
    } catch {
      this.saveSession(null);
      return null;
    }
  }

  async signUp(email: string, password: string): Promise<{ confirmationRequired: boolean }> {
    const r = (await this.request('/auth/v1/signup', { method: 'POST', auth: false, body: JSON.stringify({ email, password }) })) as Partial<Session> & { expires_in?: number };
    if (r.access_token) {
      this.saveSession({ ...(r as Session), expires_at: r.expires_at ?? Math.floor(Date.now() / 1000) + (r.expires_in ?? 3600) });
      return { confirmationRequired: false };
    }
    return { confirmationRequired: true };
  }
  async signIn(email: string, password: string): Promise<Session> {
    const r = (await this.request('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: JSON.stringify({ email, password }) })) as Session & { expires_in: number };
    const s = { ...r, expires_at: r.expires_at ?? Math.floor(Date.now() / 1000) + r.expires_in };
    this.saveSession(s);
    return s;
  }
  async signOut() {
    try {
      await this.request('/auth/v1/logout', { method: 'POST' });
    } finally {
      this.saveSession(null);
    }
  }
  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })) as T;
  }
  async select<T>(table: string, query: string): Promise<T[]> {
    return (await this.request(`/rest/v1/${table}?${query}`, { method: 'GET' })) as T[];
  }
  async upsert(table: string, rows: unknown[], onConflict: string) {
    if (!rows.length) return;
    await this.request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
    });
  }
  async remove(table: string, query: string) {
    await this.request(`/rest/v1/${table}?${query}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return { message: t };
  }
}

function translateError(msg: string): string {
  const m: Record<string, string> = {
    'Invalid login credentials': 'Неверный email или пароль.',
    'User already registered': 'Пользователь с таким email уже зарегистрирован.',
    'Email not confirmed': 'Подтвердите email по ссылке из письма.',
    'Password should be at least 6 characters': 'Пароль должен быть не короче 6 символов.',
  };
  return m[msg] ?? msg;
}

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!backendEnabled()) return null;
  client ??= new SupabaseClient(config.url, config.anonKey);
  return client;
}
