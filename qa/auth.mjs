// Real local auth against an isolated, disposable credential directory. Never use owner credentials here.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const origin=process.env.CANOPY_ORIGIN || 'http://127.0.0.1:4320';
if (!process.env.CANOPY_QA_AUTH_DIR || !origin.startsWith('http://127.0.0.1:4320')) throw Error('Use isolated local auth state only.');
const initial=(await readFile(process.env.CANOPY_QA_AUTH_DIR+'/initial-login.txt','utf8')).split('Temporary password: ')[1].split('\n')[0];
const password='Invented QA password for isolated preview only';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1024}});
const page=await context.newPage(), errors=[],checks=[];
const output=new URL('./browser-results/password/',import.meta.url); await mkdir(output,{recursive:true});
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',message=>{if(message.type()==='error' && !/Failed to load resource/.test(message.text())) errors.push(message.text());});
async function signIn(secret){await page.locator('input[name=password]').fill(secret);await page.getByRole('button',{name:'Sign in',exact:true}).click();}
try {
  const privateReads=['/api/metrics','/api/services','/api/locations','/api/files?root=repos','/api/file?root=system&path=passwd','/api/search?root=repos&q=x'];
  for(const path of privateReads) assert.equal((await context.request.get(origin+path)).status(),401);
  await page.goto(origin+'/#files');
  await page.getByRole('heading',{name:'Welcome to Canopy.'}).waitFor();
  assert.equal(await page.locator('.metric,.file-row,.location').count(),0);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:new URL('login-desktop.png',output).pathname});
  for(const width of [320,390,760,1440]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.ok(await page.getByRole('button',{name:'Sign in',exact:true}).isVisible());
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:new URL('login-mobile.png',output).pathname});
  await signIn('wrong invented password');
  await page.getByRole('alert').filter({hasText:'incorrect'}).waitFor();
  await signIn(initial);
  await page.getByRole('heading',{name:'Make yourself at home.'}).waitFor();
  assert.equal((await context.request.get(origin+'/api/locations')).status(),428);
  await page.screenshot({path:new URL('first-password-mobile.png',output).pathname});
  await page.locator('input[name=current]').fill(initial);
  await page.locator('input[name=new]').fill(password);
  await page.locator('input[name=confirm]').fill(password+' mismatch');
  await page.getByRole('button',{name:'Save password & continue'}).click();
  await page.getByRole('alert').filter({hasText:'don’t match'}).waitFor();
  await page.locator('input[name=confirm]').fill(password);
  await page.getByRole('button',{name:'Save password & continue'}).click();
  await page.locator('.location').first().waitFor();
  assert.ok(page.url().endsWith('#files'));
  const cookies=await context.cookies(); const session=cookies.find(c=>c.name==='__Host-canopy_session');
  assert.ok(session?.httpOnly && session.secure && session.sameSite==='Strict');
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/session|token|password|auth/i.test(k)).length),0);
  checks.push('anonymous reads denied; responsive login; wrong-password feedback; mandatory password replacement; hash route and cookie security');
  await page.reload(); await page.locator('.location').first().waitFor();
  await page.waitForTimeout(6500);
  assert.equal((await context.request.get(origin+'/api/locations')).status(),200);
  await page.getByRole('navigation',{name:'Mobile navigation',exact:true}).getByRole('button',{name:'Overview',exact:true}).click();
  await page.locator('.metric strong').first().waitFor();
  await page.getByRole('button',{name:'Password',exact:true}).click();
  await page.getByRole('heading',{name:'A fresh password.'}).waitFor();
  await page.getByRole('button',{name:'Back to your server'}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByRole('heading',{name:'Welcome to Canopy.'}).waitFor();
  assert.equal((await context.request.get(origin+'/api/metrics')).status(),401);
  await signIn(password);
  await page.locator('.metric strong').first().waitFor();
  // Simulate revoked session (e.g. app restart/another device changes the password).
  await context.clearCookies();
  await page.getByRole('heading',{name:'Welcome to Canopy.'}).waitFor();
  assert.equal(await page.locator('.metric').count(),0);
  checks.push('reload and continued access; account controls; logout invalidation; chosen-password login; expired session removes private UI');
  assert.deepEqual(errors,[]);
  await writeFile(new URL('results.json',output),JSON.stringify({passed:true,checks,pageErrors:errors,realOwnerDataSaved:false},null,2)+'\n');
  console.log(JSON.stringify({passed:true,checks}));
} finally {await browser.close();}
