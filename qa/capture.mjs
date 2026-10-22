import {readFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureRoutes} from './fixtures.mjs';
const {chromium} = await import(process.env.CANOPY_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, process.env.CANOPY_QA_OUTPUT || 'qa/browser-results');
await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1024}, deviceScaleFactor: 1, timezoneId: 'Asia/Kolkata'});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await fixtureRoutes(page);
const origin = process.env.CANOPY_ORIGIN || 'http://127.0.0.1:4319';
try {
  await page.goto(origin);
  await page.getByRole('heading', {name: 'Your server, at a glance.'}).waitFor();
  await page.locator('.recharts-line-curve').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({path: path.join(out, 'desktop.png')});
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: path.join(out, 'mobile-overview.png')});
  await page.goto(origin + '/#files?root=repos&path=observatory&file=observatory%2Fmain.py');
  await page.locator('.cm-content').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.cm-line span').length > 5);
  await page.screenshot({path: path.join(out, 'mobile-reader.png')});
  // Compare actual raster sources and captures on one canvas, normalized to CSS density.
  for (const [name, width, height] of [['desktop', 1440, 1024], ['mobile-overview', 390, 844], ['mobile-reader', 390, 844]]) {
    const source = await readFile(path.join(root, 'docs/design', name + '.png'));
    const actual = await readFile(path.join(out, name + '.png'));
    const sourceSize = [source.readUInt32BE(16), source.readUInt32BE(20)];
    const compare = await context.newPage();
    await compare.setViewportSize({width: width * 2 + 24, height: height + 32});
    await compare.setContent(`<style>body{margin:0;background:#e2e7e2;font:12px system-ui}.row{display:flex;gap:24px}figure{margin:0}figcaption{height:32px;display:flex;align-items:center;padding-left:12px}img{display:block;width:${width}px;height:${height}px;object-fit:contain;object-position:top;background:#f7f8f6}</style><div class="row"><figure><figcaption>SELECTED DESIGN</figcaption><img src="data:image/png;base64,${source.toString('base64')}"></figure><figure><figcaption>RENDERED APP · CSS ${width} × ${height} · DPR 1</figcaption><img src="data:image/png;base64,${actual.toString('base64')}"></figure></div>`);
    await compare.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await compare.screenshot({path: path.join(out, name + '-comparison.png')});
    if (name === 'desktop') await compare.screenshot({path: path.join(out, name + '-detail.png'), clip: {x: 0, y: 32, width: width * 2 + 24, height: 380}});
    if (name === 'mobile-reader') await compare.screenshot({path: path.join(out, name + '-detail.png'), clip: {x: 0, y: 32, width: width * 2 + 24, height: 380}});
    console.log(JSON.stringify({name, sourcePixels: sourceSize, capturePixels: [width, height], dpr: 1}));
    await compare.close();
  }
  console.log(JSON.stringify({errors, output: out}));
} finally { await browser.close(); }
