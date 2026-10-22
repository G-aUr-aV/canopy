import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {fixtureRoutes, sampleCode} from './fixtures.mjs';
const {chromium} = await import(process.env.CANOPY_PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.CANOPY_ORIGIN || 'http://127.0.0.1:4319';
const output = fileURLToPath(new URL('./browser-results/', import.meta.url));
await mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true});
const checks = [], exceptions = [], unexpectedConsole = [], external = [];
const context = await browser.newContext({viewport: {width: 1440, height: 1024}, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write']});
const page = await context.newPage();
page.on('pageerror', error => exceptions.push(String(error)));
page.on('console', message => {if (message.type() === 'error' && !/Failed to load resource.*status of (403|503)/.test(message.text())) unexpectedConsole.push(message.text());});
page.on('request', request => {if (!request.url().startsWith(origin)) external.push(new URL(request.url()).hostname);});
const state = await fixtureRoutes(page);
const nav = () => page.getByRole('navigation', {name: (page.viewportSize().width <= 760 ? 'Mobile navigation' : 'Main navigation'), exact: true});
async function visit(hash = '') {await page.goto(origin + '/' + hash); await page.locator('.metric strong').first().waitFor();}
async function check(name, work) {await work(); checks.push(name); console.log('PASS ' + name);}
async function noOverflow() {
  // ResizeObserver updates Recharts after the viewport/media-query layout change.
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, {timeout: 2000});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The document must fit the viewport');
}
try {
  await check('sidebar expands content, restores preference, and reopens', async () => {
    await visit();
    const before = await page.locator('main').boundingBox();
    await page.getByRole('button', {name: 'Hide sidebar', exact: true}).click();
    assert.equal(await page.locator('#sidebar').count(), 0);
    const after = await page.locator('main').boundingBox();
    assert.ok(after.width > before.width + 200);
    await page.reload();
    await page.getByRole('button', {name: 'Show sidebar', exact: true}).waitFor();
    await page.screenshot({path: output + 'desktop-collapsed.png'});
    await page.getByRole('button', {name: 'Show sidebar', exact: true}).click();
    await page.locator('#sidebar').waitFor();
  });
  await check('chart range, pause/resume, connection recovery, expired-session prompt', async () => {
    state.memoryUsed = .5 * 1024 ** 3;
    await page.waitForFunction(() => document.querySelector('.memory-number')?.textContent === '0.5 / 7.6 GiB');
    state.memoryUsed = null;
    await page.getByRole('button', {name: '5m', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"]')?.textContent === '5m');
    await page.waitForResponse(response => response.url().includes('/api/metrics?minutes=5'));
    await page.getByRole('button', {name: '1h', exact: true}).click();
    await page.waitForResponse(response => response.url().includes('/api/metrics?minutes=60'));
    await page.getByRole('button', {name: 'Pause live updates', exact: true}).filter({visible: true}).click();
    const calls = state.metricCalls;
    await page.waitForTimeout(2200);
    assert.equal(state.metricCalls, calls);
    assert.match(await page.locator('.desktop-live').textContent(), /Paused/);
    await page.getByRole('button', {name: 'Resume live updates', exact: true}).filter({visible: true}).click();
    await page.waitForResponse(response => response.url().includes('/api/metrics'));
    state.metricsError = true;
    await page.locator('.connection-banner').waitFor();
    await page.screenshot({path: output + 'connection-error.png'});
    state.metricsError = false;
    await page.getByRole('button', {name: 'Retry', exact: true}).click();
    await page.locator('.connection-banner').waitFor({state: 'hidden'});
    state.authExpired = true;
    await page.getByRole('heading', {name: 'Welcome to Canopy.'}).waitFor();
    state.authExpired = false;
    await page.locator('input[name=password]').fill('fixture password');
    await page.getByRole('button', {name: 'Sign in', exact:true}).click();
    await page.locator('.connection-banner').waitFor({state: 'hidden'});
  });
  await check('resource details and process/service filtering and sorting', async () => {
    await nav().getByRole('button', {name: 'Resources', exact: true}).click();
    await page.getByRole('heading', {name: 'Storage', exact: true}).waitFor();
    assert.equal(await page.locator('.core').count(), 2);
    assert.equal(await page.locator('.interface').count(), 1);
    await nav().getByRole('button', {name: 'Processes', exact: true}).click();
    await page.getByLabel('Filter processes', {exact: true}).fill('node');
    assert.equal(await page.locator('.process-table tbody tr').count(), 1);
    await page.getByLabel('Filter processes', {exact: true}).fill('');
    await page.getByRole('button', {name: 'Memory', exact: true}).click();
    assert.match(await page.locator('.process-table tbody tr').first().textContent(), /node/);
    await nav().getByRole('button', {name: 'Services', exact: true}).click();
    await page.getByLabel('Filter services', {exact: true}).fill('inactive');
    assert.equal(await page.locator('.services-table tbody tr').count(), 1);
    assert.match(await page.locator('.services-table tbody').textContent(), /Inactive/);
    await page.getByLabel('Filter services', {exact: true}).fill('absent');
    await page.getByText('No matching services.', {exact: true}).waitFor();
  });
  await check('locations, folders, hidden files, sorting, bounded filename search, empty state', async () => {
    await nav().getByRole('button', {name: 'Files', exact: true}).click();
    await page.getByRole('button', {name: /Projects Source code/}).click();
    await page.locator('.file-row').first().waitFor();
    assert.equal(await page.locator('.file-row.protected').isDisabled(), true);
    await page.getByRole('button', {name: 'Hidden files', exact: true}).click();
    await page.locator('.file-row').filter({hasText: '.gitignore'}).waitFor();
    await page.getByLabel('Sort files', {exact: true}).selectOption('size');
    await page.locator('.file-row').filter({hasText: 'observatory'}).click();
    await page.getByRole('button', {name: 'Parent folder', exact: true}).waitFor();
    await page.getByLabel('Filter filenames', {exact: true}).fill('missing');
    await page.getByRole('heading', {name: 'No matching filenames'}).waitFor();
    await page.getByLabel('Filter filenames', {exact: true}).fill('main');
    await page.getByLabel('Search subfolders').check();
    await page.getByText(/search limit reached/).waitFor();
    assert.ok(state.requests.some(url => url.startsWith('/api/search?') && url.includes('q=main')));
    await page.getByRole('button', {name: 'Clear filter', exact: true}).click();
    await page.getByLabel('Search subfolders').uncheck();
    await page.getByRole('button', {name: 'Hidden files', exact: true}).click();
    await page.locator('.file-row').filter({hasText: /^empty/}).click();
    await page.getByRole('heading', {name: 'This folder is empty'}).waitFor();
    await page.getByRole('button', {name: 'Parent folder', exact: true}).click();
    await page.locator('.file-row').filter({hasText: 'main.py'}).waitFor();
  });
  await check('read-only syntax, folding, find, wrapping, clipboard, line navigation and refresh', async () => {
    await page.locator('.file-row').filter({hasText: 'main.py'}).click();
    await page.waitForFunction(() => document.querySelectorAll('.cm-line span').length > 5);
    const code = page.locator('.cm-content');
    assert.equal(await code.getAttribute('contenteditable'), 'false');
    const before = await code.textContent();
    await code.focus();
    await page.keyboard.type('UNAUTHORIZED_EDIT');
    assert.equal(await code.textContent(), before);
    const fold = page.locator('.cm-foldGutter .cm-gutterElement').filter({hasText: '⌄'}).first();
    const foldCandidate = await fold.count() ? fold : page.locator('.cm-foldGutter .cm-gutterElement[title]').first();
    if (await foldCandidate.count()) {
      await foldCandidate.click();
      await page.locator('.cm-foldPlaceholder').first().waitFor();
      await page.locator('.cm-foldPlaceholder').first().click();
    } else throw new Error('No code folding control found');
    await page.getByRole('button', {name: 'Find', exact: true}).click();
    await page.locator('.cm-search input[name=search]').pressSequentially('memory');
    await page.locator('.cm-searchMatch').first().waitFor();
    await page.locator('.cm-search [name=close]').click();
    await page.getByRole('button', {name: 'Wrap text', exact: true}).click();
    await page.locator('.cm-lineWrapping').waitFor();
    await page.getByRole('button', {name: 'Copy', exact: true}).click();
    await page.getByRole('button', {name: 'Copied', exact: true}).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sampleCode);
    await page.getByRole('button', {name: 'Go to line', exact: true}).click();
    await page.locator('.cm-panel input').fill('34');
    await page.locator('.cm-panel input').press('Enter');
    await page.locator('.cm-panel').waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.querySelector('.cm-scroller')?.scrollTop > 0);
    const count = state.requests.filter(url => url.startsWith('/api/file?')).length;
    await page.getByRole('button', {name: 'Refresh file', exact: true}).click();
    await page.locator('.cm-content').waitFor();
    assert.ok(state.requests.filter(url => url.startsWith('/api/file?')).length > count);
  });
  await check('safe Markdown source/preview, partial-preview notice and protected-file recovery', async () => {
    await page.getByRole('button', {name: 'Back to folder', exact: true}).filter({visible: true}).first().click();
    await page.locator('.file-row').filter({hasText: 'README.md'}).click();
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    await page.locator('article.markdown').waitFor();
    assert.equal(await page.locator('article.markdown img').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureUnsafe), undefined);
    assert.equal(await page.getByRole('button', {name: 'Find', exact: true}).isDisabled(), true);
    await page.getByRole('button', {name: 'Source', exact: true}).click();
    await page.locator('.cm-content').waitFor();
    state.truncated = true;
    await page.getByRole('button', {name: 'Refresh file', exact: true}).click();
    await page.getByText(/This preview is truncated/).waitFor();
    state.truncated = false;
    state.fileError = true;
    await page.getByRole('button', {name: 'Refresh file', exact: true}).click();
    await page.getByRole('heading', {name: 'Preview unavailable'}).waitFor();
    await page.getByRole('button', {name: 'Back to folder', exact: true}).click();
    await page.locator('.file-row').first().waitFor();
    state.fileError = false;
  });
  await check('responsive routes at 320, 390, 760, 1024 and 1440px; mobile reader controls', async () => {
    for (const width of [320, 390, 760, 1024, 1440]) {
      await page.setViewportSize({width, height: width < 400 ? 844 : 1024});
      for (const tab of ['Overview', 'Resources', 'Processes', 'Services', 'Files']) {
        await nav().getByRole('button', {name: tab, exact: true}).click();
        await nav().getByRole('button', {name: tab, exact: true}).and(page.locator('[aria-current="page"]')).waitFor();
        await noOverflow();
        assert.equal(await nav().getByRole('button', {name: tab, exact: true}).getAttribute('aria-current'), 'page');
      }
      await page.goto(origin + '/#files?root=repos&path=observatory&file=observatory%2Fmain.py');
      await page.locator('.cm-content').waitFor();
      await noOverflow();
      if (width <= 760) {
        assert.equal(await page.locator('.mobile-nav').isVisible(), false);
        const controls = await page.locator('.reader-bottom').boundingBox();
        assert.ok(controls.y + controls.height <= page.viewportSize().height + 1, `Reader controls must fit at ${width}px`);
        await page.locator('.reader-mobile-top').getByRole('button', {name: 'Files', exact: true}).click();
        await page.locator('.mobile-nav').waitFor({state: 'visible'});
      } else await page.getByRole('button', {name: 'Back to folder', exact: true}).first().click();
      await nav().getByRole('button', {name: 'Overview', exact: true}).click();
    }
    await page.setViewportSize({width: 390, height: 844});
    const lastRow = await page.locator('.services-table tbody tr').last().boundingBox();
    const bottomNav = await page.locator('.mobile-nav').boundingBox();
    assert.ok(lastRow.y + lastRow.height <= bottomNav.y, 'All three overview service rows must be visible above mobile navigation');
    await page.setViewportSize({width: 320, height: 568});
    await page.goto(origin + '/#files?root=repos&path=observatory&file=observatory%2FREADME.md');
    await page.getByRole('button', {name: 'Preview', exact: true}).waitFor();
    const controls = await page.locator('.reader-bottom').boundingBox();
    assert.ok(controls.y + controls.height <= 569, 'Small-screen Markdown reader controls must fit');
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    await noOverflow();
    await page.locator('.reader-mobile-top').getByRole('button', {name: 'Files', exact: true}).click();
    await page.goBack();
    await page.locator('.reader').waitFor();
  });
  await check('keyboard entry, zoom-equivalent reflow, reduced motion, no private/outbound requests', async () => {
    await page.setViewportSize({width: 1440, height: 1024});
    await visit();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('main').evaluate(el => el === document.activeElement), true);
    await page.emulateMedia({reducedMotion: 'reduce'});
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    // 200% browser zoom's CSS viewport equivalent is 720px on a 1440px display.
    await page.setViewportSize({width: 720, height: 512});
    await noOverflow();
    assert.deepEqual(external, []);
    assert.deepEqual(exceptions, []);
    assert.deepEqual(unexpectedConsole, []);
  });
  const result = {passed: true, checks, viewportWidths: [320, 390, 760, 1024, 1440], browser: browser.version(), exceptions, unexpectedConsole, thirdPartyRequests: external.length};
  await writeFile(output + 'interaction-results.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({path: output + 'failure.png', fullPage: true});
  await writeFile(output + 'interaction-failure.json', JSON.stringify({checks, error: String(error), exceptions, unexpectedConsole}, null, 2) + '\n');
  throw error;
} finally {await browser.close();}
