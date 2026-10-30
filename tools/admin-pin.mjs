// Хеш PIN администратора (PBKDF2-SHA256 с солью). Сам PIN нигде не хранится.
//   node tools/admin-pin.mjs --write   — спросит PIN и запишет хеш в .admin-pin (файл не попадает в репозиторий)
//   node tools/admin-pin.mjs           — спросит PIN и выведет хеш
//   node tools/admin-pin.mjs --pin 1234 — для тестов
import crypto from 'node:crypto';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ITERATIONS = 310000;
export function pinSpec(pin, salt = crypto.randomBytes(16)) {
  const hash = crypto.pbkdf2Sync(String(pin), salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2-sha256:${ITERATIONS}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

const isMain = /admin-pin\.mjs$/.test(process.argv[1] ?? '');
if (isMain) {
  const i = process.argv.indexOf('--pin');
  const write = process.argv.includes('--write');
  const out = (pin) => {
    if (!/^\d{4,12}$/.test(pin)) { console.error('PIN — от 4 до 12 цифр.'); process.exit(1); }
    const spec = pinSpec(pin);
    if (write) {
      const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.admin-pin');
      fs.writeFileSync(file, spec + '\n');
      console.error('Хеш PIN записан в .admin-pin. Пересоберите приложение: npm run build');
    } else console.log(spec);
  };
  if (i >= 0) out(process.argv[i + 1] ?? '');
  else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question('Новый PIN администратора: ', (pin) => { rl.close(); out(pin.trim()); });
  }
}
