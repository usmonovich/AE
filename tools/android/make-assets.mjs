// Исходные изображения для @capacitor/assets (иконки Android/iOS и заставка) из store/icon.svg.
// Запуск: node tools/android/make-assets.mjs → assets/*.png
// Затем на компьютере сборки: npx capacitor-assets generate --android (делает скрипт build-android.ps1).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'assets');
fs.mkdirSync(out, { recursive: true });

const BLUE = '#2a47c7', NIGHT = '#141d4d';
const grid = (op) => `<g stroke="#ffffff" stroke-opacity="${op}" stroke-width="4">
  <path d="M0 128H1024M0 256H1024M0 384H1024M0 512H1024M0 640H1024M0 768H1024M0 896H1024"/>
  <path d="M128 0V1024M256 0V1024M384 0V1024M512 0V1024M640 0V1024M768 0V1024M896 0V1024"/></g>`;
// рисунок значка (буквы AE, пунктир траектории, горизонт) — как в store/icon.svg
const motif = `<path d="M262 318 Q 540 150 830 262" fill="none" stroke="#ffffff" stroke-width="40" stroke-linecap="round" stroke-dasharray="1 70"/>
  <circle cx="830" cy="262" r="40" fill="#ffffff"/>
  <path d="M282 770 L410 400 L538 770 M330 650 H490" fill="none" stroke="#ffffff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M790 400 H620 V770 H790 M620 585 H760" fill="none" stroke="#ffffff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M215 830H860" stroke="#ffffff" stroke-width="22" stroke-linecap="round"/>`;
// центр рисунка ≈ (540, 526), размер ≈ 670 × 630; для адаптивной иконки — в безопасный круг (≈ 66 % стороны)
const centered = (scale) => `<g transform="translate(512 512) scale(${scale}) translate(-540 -526)">${motif}</g>`;

const files = {
  'icon-only.png': [1024, fs.readFileSync(path.join(root, 'store/icon.svg'), 'utf8')],
  'icon-background.png': [1024, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${BLUE}"/>${grid(0.13)}<path d="M190 0V1024" stroke="#ff7781" stroke-width="10"/></svg>`],
  'icon-foreground.png': [1024, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${centered(0.68)}</svg>`],
  'splash.png': [2732, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${BLUE}"/>${centered(0.36)}</svg>`],
  'splash-dark.png': [2732, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${NIGHT}"/>${centered(0.36)}</svg>`],
};

const browser = await chromium.launch();
for (const [name, [size, svg]] of Object.entries(files)) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log(`assets/${name} ${size}×${size}`);
}
await browser.close();
