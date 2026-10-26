// Render the source component and real read-only aggregate snapshot in an isolated local harness.
import {chromium} from 'playwright';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output=new URL('./',import.meta.url),origin='http://127.0.0.1:5197';
const browser=await chromium.launch({headless:true});
const source=await readFile(new URL('../../.tmp/server-journeys-validation/result.json',output));
const evidence={scope:'Source AdminServerJourneyPanel + admin CSS + read-only aggregate response, localhost-only isolated browser; no auth or production.',sourceSha256:createHash('sha256').update(source).digest('hex'),results:[],blocked:[]};
const harnessFiles=[];
try {
 const templates={
  '.qa-admin-journey.html':'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated server journey panel QA</title><style>body{margin:0}</style></head><body><div id="root"></div><script type="module" src="/.qa-admin-journey.tsx"></script></body></html>',
  '.qa-admin-journey.tsx':`import React from 'react'; import {createRoot} from 'react-dom/client'; import {AdminServerJourneyPanel} from './src/admin/AdminServerJourneyPanel'; import './src/admin/admin.css'; import snapshot from '../../.tmp/server-journeys-validation/result.json'; const days=new URLSearchParams(location.search).get('days')==='31'?'31':'14'; createRoot(document.getElementById('root')!).render(<div className="admin-root"><main className="admin-main"><div className="admin-content"><section className="admin-panel admin-acquisition"><header><h2>Серверный игровой путь</h2><span>{days} дней</span></header><AdminServerJourneyPanel report={snapshot.reports[days] as any}/></section></div></main></div>);`,
 };
 for(const [name,source] of Object.entries(templates)){const file=new URL('../../apps/web/'+name,output);await writeFile(file,source,{flag:'wx'});harnessFiles.push(file)}
 for(const width of [1280,390])for(const days of [14,31]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin||url.pathname.startsWith('/api/')){evidence.blocked.push(url.origin+url.pathname);return route.abort()}
   return route.continue();
  });
  await page.goto(origin+'/.qa-admin-journey.html?days='+days,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Диагнозы: повтор или другая игра'}).waitFor();
  await page.waitForTimeout(250);
  const articles=page.locator('.admin-server-journeys').first().locator('.admin-acquisition__danetki-columns > article');
  const text=await articles.allTextContents();
  const diagnostics=await page.locator('.admin-server-journeys').nth(1).innerText();
  const layout=await page.evaluate(()=>{
   const panel=document.querySelector('.admin-acquisition');
   const bounds=panel.getBoundingClientRect();
   const escaping=[...panel.querySelectorAll('p,article,dt,dd,header,summary')].map(e=>({tag:e.tagName,text:e.textContent.slice(0,80),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth})).filter(e=>e.left<bounds.left-1||e.right>bounds.right+1);
   return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,panelLeft:bounds.left,panelRight:bounds.right,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,escaping};
  });
  const checks=days===14?{
   currentOrganicSixOf141:text[0].includes('6/141'),previousOrganicThreeOf107:text[1].includes('3/107'),
   characterCurrent8of29:diagnostics.includes('8/29'),characterPrevious9of29:diagnostics.includes('9/29'),
   currentD1:diagnostics.includes('1/12'),previousD1:diagnostics.includes('3/8')
  }:{previousPartial:text[1].includes('Частичное покрытие'),previousNullRatesVisible:text[1].includes('—'),diagnosticPartial:diagnostics.includes('проценты скрыты')};
  const file=`admin-server-journey-${days}d-${width}.png`;
  await page.screenshot({path:new URL(file,output).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  evidence.results.push({width,days,checks,layout,errors,screenshot:file});
  await context.close();
 }
}catch(error){evidence.failure=String(error?.stack??error)}
finally{await browser.close();for(const file of harnessFiles)await unlink(file);await writeFile(new URL('admin-server-journey-browser-check.json',output),JSON.stringify(evidence,null,2))}
console.log(JSON.stringify(evidence));if(evidence.failure)process.exitCode=1;
