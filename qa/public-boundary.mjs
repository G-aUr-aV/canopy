// Public signed-out checks only: no credentials, private data, screenshots or cookies are submitted/saved.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const target=process.env.CANOPY_PUBLIC_URL;
if(!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(target||'')) throw Error('An explicit Quick Tunnel URL is required.');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try {
  assert.equal((await context.request.get(target+'/',{maxRedirects:0})).status(),200);
  assert.equal((await (await context.request.get(target+'/readyz')).json()).authentication,'password');
  for(const path of ['/api/metrics','/api/services','/api/locations','/api/files?root=repos','/api/file?root=system&path=passwd','/api/search?root=repos&q=x']) {
    const response=await context.request.get(target+path,{maxRedirects:0});assert.equal(response.status(),401);assert.equal(response.headers()['cache-control'],'no-store');
  }
  await page.goto(target);await page.getByRole('heading',{name:'Welcome to Canopy.'}).waitFor();
  assert.equal(await page.locator('.metric,.location,.file-row').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const cdp=await context.newCDPSession(page);
  assert.deepEqual((await cdp.send('Page.getAppManifest')).errors,[]);
  assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors,[]);
  // A public entry link reaches our password form, without Cloudflare's email broker.
  await page.goto('https://example.com');
  await page.evaluate(url=>{const a=document.createElement('a');a.href=url;a.id='canopy-link';a.textContent='Canopy';document.body.append(a);},target);
  await page.locator('#canopy-link').click();await page.getByRole('heading',{name:'Welcome to Canopy.'}).waitFor();
  assert.equal(new URL(page.url()).origin,target);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,scope:'public signed-out only',privateEndpointsDenied:6,passwordFormRendered:true,externalLink:true,manifestErrors:0,installabilityErrors:0,credentialsSubmitted:false}));
}finally{await browser.close();}
