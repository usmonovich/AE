// Production-сборка: esbuild → dist/ (для веба и Capacitor) и artifact/ (одна страница для предпросмотра).
// --release — сборка для магазинов: вместо полной учебной базы встраиваются content/release/*.json
// (только утверждённые записи, см. tools/release-pack.ts); artifact/ при этом не перезаписывается.
// Переменные окружения (необязательно): SUPABASE_URL, SUPABASE_ANON_KEY — включают вход и синхронизацию.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const art = path.join(root, 'artifact');
const release = process.argv.includes('--release');
// --content <папка> — собрать приложение с другими учебными базами (тестовые предметы для e2e: tests/fixtures/content)
const contentArg = process.argv.indexOf('--content');
const contentDir = contentArg >= 0 ? path.resolve(process.argv[contentArg + 1] ?? '') : path.join(root, 'content');
const customContent = contentArg >= 0;
if (customContent && (release || !fs.existsSync(path.join(contentDir, 'packs.generated.ts')))) {
  console.error('--content: только для тестовой сборки, в папке нужны subjects.json и packs.generated.ts (node tools/content-all.mjs --content <папка>)');
  process.exit(1);
}
// --test-pin N — сборка для автотестов: свой PIN администратора (artifact/ не перезаписывается)
const testPinArg = process.argv.indexOf('--test-pin');
const testPin = testPinArg >= 0 ? process.argv[testPinArg + 1] : '';
if (testPinArg >= 0 && !/^\d{4,12}$/.test(testPin ?? '')) { console.error('--test-pin: PIN из 4–12 цифр'); process.exit(1); }
// хеш PIN владельца — из .admin-pin (не в репозитории) или ADMIN_PIN_SPEC; в релизной сборке админ-панели нет
const pinFile = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), '.admin-pin');
const adminPinSpec = testPin
  ? (await import('./admin-pin.mjs')).pinSpec(testPin)
  : release ? '' : (process.env.ADMIN_PIN_SPEC || (fs.existsSync(pinFile) ? fs.readFileSync(pinFile, 'utf8').trim() : ''));
if (!release && !testPin && !adminPinSpec) console.warn('PIN администратора не задан (.admin-pin) — админ-панель не откроется. Задать: node tools/admin-pin.mjs --write');
const writeArtifact = !release && !testPin && !customContent;
const subjectsCfg = JSON.parse(fs.readFileSync(path.join(contentDir, 'subjects.json'), 'utf8'));
const appTitle = subjectsCfg.app.title;
const subjectIds = subjectsCfg.subjects.map((x) => x.id);
const releasePacks = Object.fromEntries(subjectIds.map((id) => [`content/subjects/${id}/pack.json`, path.join(root, `content/release/${id}.json`)]));
if (release) {
  for (const [src, rel] of Object.entries(releasePacks)) {
    if (!fs.existsSync(rel)) {
      console.error(`Нет релизной учебной базы ${path.relative(root, rel)} — сначала: npm run release:pack`);
      process.exit(1);
    }
    // релизная база должна быть сделана из текущей учебной базы (сверка по SHA-256 исходного файла)
    const meta = JSON.parse(fs.readFileSync(rel.replace(/\.json$/, '.meta.json'), 'utf8'));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, src))).digest('hex');
    if (meta.sourceSha256 !== sha) {
      console.error(`${path.relative(root, rel)} сделана из другой версии ${src} — пересоберите: npm run release:pack`);
      process.exit(1);
    }
  }
}
// подменяет импорт полной учебной базы на релизную
const releasePlugin = {
  name: 'release-packs',
  setup(b) {
    b.onResolve({ filter: /content[\\/]subjects[\\/][a-z0-9]+[\\/]pack\.json$/ }, (args) => {
      const abs = path.resolve(args.resolveDir, args.path);
      const key = path.relative(root, abs).split(path.sep).join('/');
      return releasePacks[key] ? { path: releasePacks[key] } : undefined;
    });
  },
};
// подменяет реестр предметов и список учебных баз (--content)
const contentPlugin = {
  name: 'custom-content',
  setup(b) {
    b.onResolve({ filter: /content[\\/]subjects\.json$/ }, () => ({ path: path.join(contentDir, 'subjects.json') }));
    b.onResolve({ filter: /^\.\/packs\.generated$/ }, () => ({ path: path.join(contentDir, 'packs.generated.ts') }));
  },
};
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(art, { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(root, 'src/main.tsx')],
  bundle: true,
  minify: true,
  write: false,
  outdir: dist,
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  loader: { '.woff2': 'dataurl', '.woff': 'empty', '.ttf': 'empty', '.json': 'json' },
  define: {
    'process.env.NODE_ENV': '"production"',
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL ?? ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.SUPABASE_ANON_KEY ?? ''),
    // в сборке для магазинов и сайта админ-панели нет
    __ADMIN__: JSON.stringify(!release),
    __ADMIN_PIN__: JSON.stringify(adminPinSpec),
  },
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
  plugins: release ? [releasePlugin] : customContent ? [contentPlugin] : [],
});
if (release) {
  const inputs = Object.keys(result.metafile.inputs).map((f) => path.resolve(root, f));
  for (const rel of Object.values(releasePacks)) if (!inputs.includes(rel)) { console.error(`Релизная база не встроена: ${rel}`); process.exit(1); }
}

let js = '', css = '';
for (const f of result.outputFiles) {
  if (f.path.endsWith('.js')) js = f.text;
  if (f.path.endsWith('.css')) css = f.text;
}
fs.writeFileSync(path.join(dist, 'app.js'), js);
fs.writeFileSync(path.join(dist, 'app.css'), css);

// изображения страниц материалов (в публичном репозитории их нет — приложение покажет пояснение вместо фото)
for (const id of subjectIds) {
  const pagesSrc = path.join(contentDir, 'subjects', id, 'pages');
  if (!fs.existsSync(pagesSrc)) continue;
  const imgs = fs.readdirSync(pagesSrc).filter((x) => /\.(webp|jpe?g|png)$/i.test(x));
  if (!imgs.length) continue;
  fs.mkdirSync(path.join(dist, 'pages', id), { recursive: true });
  for (const f of imgs) fs.copyFileSync(path.join(pagesSrc, f), path.join(dist, 'pages', id, f));
}

const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Unbounded:wght@500;600;700&display=swap">';
const title = appTitle;

fs.writeFileSync(
  path.join(dist, 'index.html'),
  `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#2a47c7">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co">
<title>${title}</title>
<link rel="icon" href="icon.png">
${fonts}
<link rel="stylesheet" href="app.css">
</head>
<body>
<div id="root"></div>
<noscript>Для работы приложения нужен JavaScript.</noscript>
<script src="app.js"></script>
</body>
</html>
`,
);
const icon = path.join(root, 'store/icon-512.png');
if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(dist, 'icon.png'));

// Вариант для опубликованной страницы: без html/head/body, всё встроено (в релизной и тестовой сборке не пишется).
if (writeArtifact) {
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  const safeCss = css.replace(/<\/style/gi, '<\\/style');
  fs.writeFileSync(
    path.join(art, 'index.html'),
    `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>${safeCss}</style>
<div id="root"></div>
<script>${safeJs}</script>
`,
  );
}

const kb = (n) => `${(n / 1024).toFixed(0)} КБ`;
console.log(release
  ? `Релизная сборка: dist/app.js ${kb(js.length)}, app.css ${kb(css.length)} (учебная база — только утверждённые записи, без админ-панели)`
  : testPin ? `Тестовая сборка (свой PIN${customContent ? `, учебные базы из ${path.relative(root, contentDir)}` : ''}): dist/app.js ${kb(js.length)}` : `dist/app.js ${kb(js.length)}, app.css ${kb(css.length)}; artifact/index.html ${kb(fs.statSync(path.join(art, 'index.html')).size)}`);
