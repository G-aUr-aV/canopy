import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {fixtureRoutes} from './fixtures.mjs';
const origin = process.env.CANOPY_ORIGIN || 'http://127.0.0.1:4320';
const output = new URL('./browser-results/session-install/', import.meta.url);
await mkdir(output, {recursive: true});
const profile = await mkdtemp('/tmp/canopy-session-install-');
const context = await chromium.launchPersistentContext(profile, {headless: true, viewport: {width: 390,height: 844}, permissions: ['clipboard-read','clipboard-write'], userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36'});
const checks = [], errors = [];
async function pageWithFixtures() {
  const page = await context.newPage();
  // Keep the browser's own promotion from opening an OS dialog in deterministic UI checks.
  await page.addInitScript(() => window.addEventListener('beforeinstallprompt', event => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); } }));
  page.on('pageerror', error => errors.push(String(error)));
  const state = await fixtureRoutes(page);
  return {page,state};
}
async function check(name, work) {await work(); checks.push(name); console.log('PASS ' + name);}
try {
  await check('real login redirect is detected without fetching the broker; all polling stops', async () => {
    const {page,state} = await pageWithFixtures();
    let external = 0, policyErrors = 0;
    page.on('request', request => {if (!request.url().startsWith(origin)) external++;});
    page.on('console', message => {if (message.type() === 'error' && /Content Security Policy|CORS/.test(message.text())) policyErrors++;});
    await page.goto(origin); await page.locator('.metric strong').first().waitFor();
    state.authRedirect = true;
    await page.getByRole('heading',{name:'Welcome to Canopy.'}).waitFor();
    assert.match(await page.locator('.auth-message').textContent(), /session ended/);
    assert.equal(await page.locator('.metric').count(),0);
    const count = state.metricCalls, serviceCount = state.requests.filter(url=>url==='/api/services').length;
    await page.waitForTimeout(2300);
    assert.equal(state.metricCalls,count);
    assert.equal(state.requests.filter(url=>url==='/api/services').length,serviceCount);
    assert.equal(external,0); assert.equal(policyErrors,0);
    for (const width of [320,390,760,1440]) {
      await page.setViewportSize({width,height:844});
      await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,null,{timeout:2000});
      assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).isVisible(),true);
    }
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:new URL('after-auth.png',output).pathname});
    state.authRedirect = false;
    await page.locator('input[name=password]').fill('fixture password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.locator('.metric strong').first().waitFor();
    await page.close();
  });
  await check('service-only expiry preserves the auth warning and gates file navigation', async () => {
    const {page,state} = await pageWithFixtures(); state.servicesAuthRedirect = true;
    await page.goto(origin + '/#files?root=repos&path=observatory');
    await page.getByRole('heading',{name:'Welcome to Canopy.'}).waitFor();
    assert.match(await page.locator('.auth-message').textContent(),/session ended/);
    assert.equal(await page.locator('.file-row').count(),0);
    state.servicesAuthRedirect = false;
    await page.locator('input[name=password]').fill('fixture password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.locator('.file-row').first().waitFor();
    assert.ok(page.url().includes('path=observatory'));
    await page.close();
  });
  await check('offline recovery and HTML gateway errors remain distinct from session expiry', async () => {
    const {page,state} = await pageWithFixtures();
    await page.goto(origin); await page.locator('.metric strong').first().waitFor();
    state.networkError = true; await context.setOffline(true);
    await page.getByText('You’re offline. Reconnect to resume live updates.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Sign in again',exact:true}).count(),0);
    state.networkError = false; await context.setOffline(false);
    await page.locator('.connection-banner').waitFor({state:'hidden',timeout:2000});
    state.gatewayError = true;
    await page.getByText('The server is temporarily unavailable. Retrying…',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Sign in again',exact:true}).count(),0);
    state.gatewayError = false;
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await page.locator('.connection-banner').waitFor({state:'hidden'});
    await page.close();
  });
  await check('credentialed manifest, exact icon sizes and native Chromium installability', async () => {
    await context.addCookies([{name:'canopy_fixture_session',value:'invented_fixture_only',url:origin,sameSite:'Lax'}]);
    const {page} = await pageWithFixtures();
    let manifestHadCookie = false;
    await page.route('**/manifest.webmanifest', async route => {
      manifestHadCookie = (route.request().headers().cookie || '').includes('canopy_fixture_session=');
      if (!manifestHadCookie) return route.fulfill({status:302,headers:{location:'https://app.example.com/authorize'}});
      return route.continue();
    });
    await page.goto(origin);
    const cdp = await context.newCDPSession(page); await cdp.send('Page.enable');
    const fetched = await cdp.send('Page.getAppManifest');
    assert.deepEqual(fetched.errors,[]); assert.ok(fetched.data); assert.equal(manifestHadCookie,true);
    assert.equal(await page.locator('link[rel=manifest]').getAttribute('crossorigin'),'use-credentials');
    const manifest = JSON.parse(fetched.data);
    assert.equal(manifest.display,'standalone'); assert.equal(manifest.scope,'/');
    for (const size of [192,512]) {
      const icon = manifest.icons.find(icon => icon.sizes===`${size}x${size}` && icon.purpose==='any');
      assert.ok(icon);
      const response = await context.request.get(origin+icon.src), bytes = await response.body();
      assert.equal(response.status(),200); assert.match(response.headers()['content-type'],/image\/png/);
      assert.equal(bytes.readUInt32BE(16),size); assert.equal(bytes.readUInt32BE(20),size);
    }
    assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'));
    assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors,[]);
    assert.deepEqual(await page.evaluate(()=>caches.keys()),[]);
    assert.equal((await page.evaluate(()=>navigator.serviceWorker.getRegistrations().then(registrations=>registrations.length))),0);
    await page.close();
  });
  await check('Android install fallback opens instructions, copies the link and closes by keyboard', async () => {
    const {page} = await pageWithFixtures(); await page.goto(origin);
    await page.getByRole('button',{name:'Install app',exact:true}).click();
    await page.getByRole('dialog',{name:'Keep Canopy close.'}).waitFor();
    assert.ok(await page.getByText(/Open in Chrome/).isVisible());
    assert.equal(await page.getByRole('textbox',{name:'Canopy app link'}).inputValue(),origin+'/');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:new URL('install-android.png',output).pathname});
    await page.getByRole('button',{name:'Copy link',exact:true}).click();
    await page.getByRole('button',{name:'Copied',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),origin+'/');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.getByRole('button',{name:'Install app',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.close();
  });
  await check('native install prompt is invoked only from the button; installed state hides it', async () => {
    const {page} = await pageWithFixtures(); await page.goto(origin);
    await page.getByRole('button',{name:'Install app',exact:true}).waitFor();
    await page.evaluate(()=>{
      window.fixtureInstallCalls=0;
      const event=new Event('beforeinstallprompt',{cancelable:true});
      Object.assign(event,{prompt:async()=>{window.fixtureInstallCalls++;},userChoice:Promise.resolve({outcome:'accepted'})});
      window.dispatchEvent(event);
    });
    assert.equal(await page.evaluate(()=>window.fixtureInstallCalls),0);
    await page.getByRole('button',{name:'Install app',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.fixtureInstallCalls),1);
    assert.equal(await page.getByRole('dialog').isVisible(),false);
    await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
    await page.getByRole('button',{name:'Install app',exact:true}).waitFor({state:'hidden'});
    await page.close();
  });
  await check('Safari instructions and small phone dialog remain usable', async () => {
    const {page} = await pageWithFixtures();
    await page.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{get:()=> 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'}));
    await page.setViewportSize({width:320,height:568}); await page.goto(origin);
    await page.getByRole('button',{name:'Install app',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    assert.ok(await page.getByText('Add to Home Screen',{exact:true}).isVisible());
    assert.equal(await page.getByText(/Open in Chrome/).count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    await page.close();
  });
  assert.deepEqual(errors,[]);
  const result={passed:true,checks,browser:context.browser().version(),pageErrors:errors,privateCachesCreated:false,phoneHardwareInstallVerified:false};
  await writeFile(new URL('results.json',output),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {await context.setOffline(false);await context.close();await rm(profile,{recursive:true,force:true});}
