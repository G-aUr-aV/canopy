// A computed-text check complements visual, keyboard and reflow checks. It is not a full accessibility audit.
import assert from 'node:assert/strict';
import {writeFile, mkdir} from 'node:fs/promises';
import {fixtureRoutes} from './fixtures.mjs';
const {chromium} = await import(process.env.CANOPY_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport: {width: 1440, height: 1024}});
await fixtureRoutes(page);
const origin = process.env.CANOPY_ORIGIN || 'http://127.0.0.1:4319';
const results = [];
try {
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: width === 390 ? 844 : 1024});
    for (const hash of ['', '#resources', '#processes', '#services', '#files', '#files?root=repos&path=observatory', '#files?root=repos&path=observatory&file=observatory%2Fmain.py']) {
      await page.goto(origin + '/' + hash);
      await page.locator(hash.includes('file=') ? '.cm-content' : hash.includes('root=') ? '.file-row' : hash === '#files' ? '.location' : '.metric strong, .services-table tbody tr, .process-table tbody tr').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const low = await page.evaluate(() => {
        const parse = value => {const n = value.match(/[\d.]+/g)?.map(Number); return n?.length >= 3 ? [...n.slice(0, 3), n[3] ?? 1] : [0, 0, 0, 0];};
        const mix = (a, b) => a.slice(0, 3).map((v, i) => v * a[3] + b[i] * (1 - a[3]));
        const background = el => el ? mix(parse(getComputedStyle(el).backgroundColor), background(el.parentElement)) : [255, 255, 255];
        const luminance = color => color.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const failures = new Map();
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el), box = el.getBoundingClientRect();
          if (!box.width || !box.height || cs.visibility === 'hidden' || el.closest('button:disabled') || (el.namespaceURI.includes('svg') && el.tagName !== 'text')) continue;
          if (!Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())) continue;
          const b = background(el), fg = parse(el.tagName === 'text' ? cs.fill : cs.color);
          const x = luminance(mix(fg, b)), y = luminance(b), ratio = (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
          const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5)) failures.set(cs.color + el.className, {element: el.tagName, class: typeof el.className === 'string' ? el.className : el.getAttribute('class'), color: cs.color, ratio: Number(ratio.toFixed(2)), text: el.textContent.trim().slice(0, 40)});
        }
        return [...failures.values()];
      });
      results.push({width, route: hash || '#overview', low});
    }
  }
  await mkdir(new URL('./browser-results/', import.meta.url), {recursive: true});
  await writeFile(new URL('./browser-results/contrast-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
  const failures = results.filter(result => result.low.length);
  console.log(JSON.stringify({screens: results.length, failures}));
  assert.deepEqual(failures, []);
} finally {await browser.close();}
