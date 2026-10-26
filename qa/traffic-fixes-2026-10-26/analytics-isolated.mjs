// One-off isolated browser observation. No saved browser, account, production requests or writes.
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const origin='http://127.0.0.1:5198';
const browser=await chromium.launch({headless:true});
const result={scope:'Fresh headless browser, local fixture proxy only, normal analytics enabled; external traffic blocked.',checks:[],blockedExternal:[],blockedWrites:[],pageErrors:[],batches:[],metrika:[]};
const save=()=>writeFile(new URL('analytics-isolated.json',import.meta.url),JSON.stringify(result,null,2));
try {
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',serviceWorkers:'block'});
 await context.addInitScript(()=>{
   window.__qaMetrika=[];
   window.ym=(...args)=>window.__qaMetrika.push(args);
   const marker=document.createElement('meta');marker.name='shoditsa-build-sha';marker.content='a'.repeat(40);
   new MutationObserver((_,observer)=>{if(document.head){document.head.appendChild(marker);observer.disconnect()}}).observe(document,{childList:true,subtree:true});
 });
 await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==origin){result.blockedExternal.push(url.origin+url.pathname);return route.abort();}
   if(url.pathname==='/api/v1/client-events/batch'){
     const data=req.postDataJSON();result.batches.push(...(data.events??[]));return route.fulfill({json:{accepted:data.events?.length??0}});
   }
   if(url.pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(req.method())){
     result.blockedWrites.push({path:url.pathname,method:req.method()});return route.fulfill({status:409,json:{error:{code:'QA_NO_MUTATION',message:'Isolated analytics observation'}}});
   }
   return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message));
 const settle=async()=>{await page.waitForTimeout(350);await page.evaluate(async()=>{const c=await import('/src/app/client-events.ts');await c.flushClientEvents()});await page.waitForTimeout(150)};
 const views=()=>result.batches.filter(e=>e.eventName==='page_view');
 const metrika=()=>page.evaluate(()=>window.__qaMetrika.filter(args=>args[1]==='hit'));
 const record=async(name,details)=>{result.checks.push({name,...details});await save()};
 await page.goto(origin+'/?utm_source=qa&utm_medium=isolated&utm_campaign=traffic_review',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Разрешить аналитику',exact:true}).waitFor({timeout:30000});
 await settle();
 await record('pending before decision',{pageViews:views().length,metrikaHits:(await metrika()).length});
 await page.getByRole('button',{name:'Разрешить аналитику',exact:true}).click();await settle();
 await record('first consent',{pageViews:views().length,metrikaHits:(await metrika()).length,versions:[...new Set(views().map(e=>e.appVersion))],consents:views().map(e=>e.properties.analytics_consent)});
 const beforeRepeat=views().length;
 await page.evaluate(async()=>{const a=await import('/src/app/navigation-analytics.ts');a.trackNavigationView({pathname:location.pathname,search:location.search});a.refreshNavigationConsent();a.trackNavigationView({pathname:location.pathname,search:location.search})});await settle();
 await record('same route and accepted-consent replay',{newPageViews:views().length-beforeRepeat,metrikaHits:(await metrika()).length});
 const navigate=async(href)=>{await page.evaluate(async h=>{const r=await import('/src/app/router.tsx');await r.appRouter.navigate({href:h})},href);await settle()};
 const beforeRoute=views().length;
 await navigate('/games/animal');
 await record('SPA route change',{newPageViews:views().length-beforeRoute,lastRoute:views().at(-1)?.route,url:page.url(),metrikaHits:(await metrika()).length});
 const beforeQuery=views().length;
 await navigate('/games/animal?token=qa-secret-token&utm_campaign=other#details');
 await record('token utm and anchor do not create view',{newPageViews:views().length-beforeQuery,lastHit:(await metrika()).at(-1)?.[2]});
 const beforeBack=views().length;
 await page.goBack();await settle();
 await page.goBack();await settle();
 const afterBack=views().length;
 await page.goForward();await settle();
 await record('SPA back and forward',{viewsDuringBack:afterBack-beforeBack,viewsDuringForward:views().length-afterBack,lastRoute:views().at(-1)?.route});
 await navigate('/sessions/qa-character-playing?qa=guest&token=qa-secret-token');
 await record('private session identity',{lastRoute:views().at(-1)?.route,lastHit:(await metrika()).at(-1)?.[2],exportsContainToken:JSON.stringify({events:result.batches,ym:await page.evaluate(()=>window.__qaMetrika)}).includes('qa-secret-token'),exportsContainSessionId:JSON.stringify({events:result.batches,ym:await page.evaluate(()=>window.__qaMetrika)}).includes('qa-character-playing')});
 await navigate('/');
 const cookie=page.getByRole('button',{name:'Настройки cookie',exact:true}).first();
 await cookie.waitFor({timeout:15000});await cookie.click();
 await page.getByRole('button',{name:'Только необходимые',exact:true}).click();await settle();
 const hitsBeforeRejected=(await metrika()).length;
 await navigate('/games/animal');
 await record('rejected navigation',{newMetrikaHits:(await metrika()).length-hitsBeforeRejected,lastConsent:views().at(-1)?.properties.analytics_consent,lastAcquisition:views().at(-1)?.properties.acquisition_id??null});
 // Destruction intentionally removed ym; restore only the local QA sink before accepting again.
 await page.evaluate(()=>{window.ym=(...args)=>window.__qaMetrika.push(args)});
 await page.getByRole('button',{name:'Настройки cookie',exact:true}).first().click();
 const beforeReaccept=views().length;
 await page.getByRole('button',{name:'Разрешить аналитику',exact:true}).click();await settle();
 await record('cookie footer and reaccept',{newPageViews:views().length-beforeReaccept,newMetrikaHits:(await metrika()).length-hitsBeforeRejected,lastConsent:views().at(-1)?.properties.analytics_consent});
 const canonical=await page.evaluate(async()=>{const m=await import('/src/app/metrics.ts');return ['/sessions/private-id','/svoyak/join/private-token','/svoyak/rooms/ABCDEF','/svoyak/rooms/ABCDEF/result'].map(path=>({input:path,output:m.canonicalAnalyticsPath(path)}))});
 await record('canonical private paths',{canonical});
 result.metrika=await page.evaluate(()=>window.__qaMetrika);
 result.pageViewCount=views().length;result.distinctPageViewIds=new Set(views().map(e=>e.eventId)).size;
 await page.screenshot({path:new URL('analytics-isolated.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
 await context.close();
} catch(error){result.failure=String(error?.stack??error);}
finally{await browser.close();await save();}
console.log(JSON.stringify({checks:result.checks,pageViewCount:result.pageViewCount,distinctPageViewIds:result.distinctPageViewIds,pageErrors:result.pageErrors,failure:result.failure}));
if(result.failure)process.exitCode=1;
