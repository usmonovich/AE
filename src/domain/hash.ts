// Детерминированный хеш строки (cyrb53) — одинаковый в Node и в браузере.
// Используется для защиты от дублей вопросов и записей при повторном импорте.

export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36).padStart(11, '0');
}

/** Нормализация текста для сравнения дублей: регистр, пробелы, пунктуация, ё→е. */
export function normalizeForHash(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\\[,;:! ]|\\quad|\\qquad/g, ' ')
    .replace(/[\s.,;:!?«»"'()\-–—]+/g, ' ')
    .trim();
}

export function contentHash(...parts: (string | undefined)[]): string {
  return cyrb53(parts.map((p) => normalizeForHash(p ?? '')).join('|'));
}
