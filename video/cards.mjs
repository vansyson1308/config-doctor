// Renders the 1920x1080 title/end cards and the per-scene backgrounds (navy brand gradient) from HTML.
// Run from the repository root: node video/cards.mjs
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

const out = 'video/raw/cards';
await mkdir(out, { recursive: true });
const script = JSON.parse(await readFile('video/script.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const cards = pathToFileURL(resolve('video/cards.html')).href;
for (const [name, suffix] of [['title', ''], ['end', '?end']]) {
  await page.goto(cards + suffix);
  await page.screenshot({ path: `${out}/${name}.png` });
}
const bg = pathToFileURL(resolve('video/bg.html')).href;
await page.goto(`${bg}?plain=1`);
await page.screenshot({ path: `${out}/bg-plain.png` });
for (const s of script.scenes) {
  if (!s.title) continue;
  await page.goto(`${bg}?${new URLSearchParams({ title: s.title, caption: s.caption })}`);
  await page.screenshot({ path: `${out}/bg-${String(s.id).padStart(2, '0')}.png` });
}
await browser.close();
console.log('cards rendered');
