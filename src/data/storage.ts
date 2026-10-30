// Локальное хранилище. В браузере и в Capacitor WebView — localStorage; если он недоступен
// (приватный режим, запрет сайта), данные живут в памяти до закрытия приложения,
// а экран настроек предупреждает об этом.

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  readonly persistent: boolean;
}

const memory = new Map<string, string>();

function detect(): boolean {
  try {
    const k = '__probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const persistent = typeof window !== 'undefined' && detect();

export const kv: KV = {
  persistent,
  get(key) {
    if (persistent) {
      try {
        return localStorage.getItem(key);
      } catch {
        /* падение доступа — используем память */
      }
    }
    return memory.get(key) ?? null;
  },
  set(key, value) {
    memory.set(key, value);
    if (!persistent) return;
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn('Не удалось сохранить данные', key, (e as Error).name);
    }
  },
  remove(key) {
    memory.delete(key);
    if (!persistent) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const KEYS = {
  session: 'ae.session.v1',
  syncMeta: 'ae.sync.v1',
} as const;
