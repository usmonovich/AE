// PIN администратора — один, задан владельцем. В сборку попадает только хеш PBKDF2-SHA256 с солью
// (__ADMIN_PIN__, подставляет tools/build.mjs); установить свой PIN в приложении нельзя.
// Хеш хранится вне репозитория — в файле .admin-pin (он в .gitignore): node tools/admin-pin.mjs --write.
// Без файла админ-панель не откроется. Тестовые сборки подставляют свой PIN (tools/build.mjs --test-pin).

declare const __ADMIN_PIN__: string | undefined;

export const ADMIN_PIN_SPEC: string = typeof __ADMIN_PIN__ !== 'undefined' && __ADMIN_PIN__ ? __ADMIN_PIN__ : '';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

/** Проверка PIN: PBKDF2-SHA256 с теми же солью и числом итераций, сравнение без раннего выхода. */
export async function checkAdminPin(pin: string, spec: string = ADMIN_PIN_SPEC): Promise<boolean> {
  const [alg, iter, salt, hash] = spec.split(':');
  if (alg !== 'pbkdf2-sha256' || !iter || !salt || !hash) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(salt), iterations: Number(iter) }, key, 256);
  const got = hex(bits);
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
