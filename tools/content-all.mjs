// Сборка учебных баз всех предметов из content/subjects.json (по очереди, каждый — отдельным процессом).
// Запуск: node tools/content-all.mjs [--strict] [--content <папка>]   (--content — например, tests/fixtures/content)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ci = args.indexOf('--content');
const content = ci >= 0 ? path.resolve(args.splice(ci, 2)[1]) : path.join(root, 'content');
const env = ci >= 0 ? { ...process.env, AE_CONTENT: content } : process.env;
const { subjects } = JSON.parse(fs.readFileSync(path.join(content, 'subjects.json'), 'utf8'));
const tsx = fileURLToPath(import.meta.resolve('tsx/cli'));
const extra = args;
let failed = 0;
for (const s of subjects) {
  console.log(`\n── ${s.title} (${s.id}) ──`);
  const r = spawnSync(process.execPath, [tsx, path.join(root, 'tools/build-content.ts'), '--subject', s.id, ...extra], { stdio: 'inherit', cwd: root, env });
  if (r.status !== 0) failed++;
}
if (failed) {
  console.error(`\nНе собрано предметов: ${failed}`);
  process.exit(1);
}
