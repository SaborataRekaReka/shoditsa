import {writeFile} from 'node:fs/promises';
const origin='https://shoditsa.ru',sha='8f74ca79a70e2d2c7768e2b5666a4d0077cd70ae';
const sitemap=await (await fetch(origin+'/sitemap.xml')).text();const urls=[...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]);
const pages=[];for(let i=0;i<urls.length;i+=4){pages.push(...await Promise.all(urls.slice(i,i+4).map(async url=>{const r=await fetch(url,{headers:{'Cache-Control':'no-cache'}});const h=await r.text();return{url,status:r.status,buildMatches:h.includes(`name="shoditsa-build-sha" content="${sha}"`),h1:(h.match(/<h1\b/g)||[]).length,canonical:h.match(/<link rel="canonical" href="([^"]+)"/)?.[1]??null};})));}
const [meta,manifest,health]=await Promise.all(['/api/v1/meta','/build-manifest.json','/api/v1/health/ready'].map(p=>fetch(origin+p).then(r=>r.json())));
const assets=[...new Set((await (await fetch(origin+'/')).text()).matchAll(/(?:src|href)="(\/assets\/[^"?#]+)[^"]*"/g))].map(m=>m[1]);
const assetResults=await Promise.all(assets.map(async p=>{const r=await fetch(origin+p,{method:'HEAD'});return{path:p,status:r.status};}));
const notfound=await fetch(origin+'/traffic-release-nonexistent-check',{method:'HEAD'});
const result={capturedAt:new Date().toISOString(),sha,meta,manifest,health,pages,assetResults,notfoundStatus:notfound.status,passed:pages.length===58&&pages.every(p=>p.status===200&&p.buildMatches&&p.h1===1&&p.canonical===p.url)&&meta.buildSha===sha&&manifest.commitSha===sha&&assetResults.every(r=>r.status===200)&&notfound.status===404};
await writeFile('qa/traffic-fixes-2026-10-26/public-postrelease.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,pages:pages.length,assets:assetResults.length,sha,health,failures:pages.filter(p=>p.status!==200||!p.buildMatches||p.h1!==1||p.canonical!==p.url)}));if(!result.passed)process.exitCode=1;
