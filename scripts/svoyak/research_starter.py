"""Fetch inspectable reference material; never approves a question automatically."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request
from urllib.parse import quote
from urllib.parse import urlencode
import time

from semantic import DATA
from editorial import now


def specifications():
    rows=[]
    for line in Path(__file__).with_name('starter-spec.tsv').read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.startswith('#'):continue
        pack,position,title,note,topic,theme,prompt,answer=line.split('|')
        rows.append(dict(pack_id=int(pack),position=position,title=title,note=note,topic=topic,theme=theme,prompt=prompt,answer=answer))
    return rows


def fetch_reference(spec):
    folder=DATA/'research-cache';folder.mkdir(exist_ok=True)
    key=hashlib.sha256(spec['title'].encode()).hexdigest()
    path=folder/(key+'.json')
    if path.exists():return json.loads(path.read_text(encoding='utf-8'))
    title=spec['title'];language='ru'
    if title.startswith('en:'):language='en';title=title[3:]
    url='https://'+language+'.wikipedia.org/wiki/'+quote(title.replace(' ','_'))
    result=dict(requested_title=spec['title'],url=url,checked_at=now(),status='unresolved')
    try:
        endpoint='https://'+language+'.wikipedia.org/api/rest_v1/page/summary/'+quote(title.replace(' ','_'))
        with urllib.request.urlopen(urllib.request.Request(endpoint,headers={'User-Agent':'LocalQuizResearch/1.0'}),timeout=15) as response:
            data=json.loads(response.read(1024*1024))
        result.update(title=data.get('title'),extract=data.get('extract',''),page_type=data.get('type'),page_id=data.get('pageid'),
            url=data.get('content_urls',{}).get('desktop',{}).get('page') or url,status='fetched')
        # Full article paragraphs make every editorial evidence claim inspectable.
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'LocalQuizResearch/1.0'}),timeout=20) as response:
            content=response.read(8*1024*1024)
        from bs4 import BeautifulSoup
        soup=BeautifulSoup(content,'html.parser')
        result['paragraphs']=[p.get_text(' ',strip=True) for p in soup.select('p') if len(p.get_text(strip=True))>40]
        result['page_sha256']=hashlib.sha256(content).hexdigest()
    except Exception as exc:result['error']=str(exc)[:300]
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return result


def batch_references(specs):
    """Use the documented API in small batches; avoid bursts against article endpoints."""
    folder=DATA/'research-cache';folder.mkdir(exist_ok=True)
    results={}
    pending=[]
    for spec in specs:
        key=hashlib.sha256(spec['title'].encode()).hexdigest();path=folder/(key+'.json')
        cached=json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
        if cached and cached.get('status')=='fetched' and cached.get('paragraphs'):results[spec['title']]=cached
        elif spec['title'] not in pending:pending.append(spec['title'])
    for start in range(0,len(pending),15):
        titles=pending[start:start+15]
        query=urlencode(dict(action='query',prop='extracts',explaintext='1',exintro='1',exlimit='max',redirects='1',titles='|'.join(titles),format='json'))
        endpoint='https://ru.wikipedia.org/w/api.php?'+query
        try:
            with urllib.request.urlopen(urllib.request.Request(endpoint,headers={'User-Agent':'LocalQuizResearch/1.0'}),timeout=25) as response:data=json.loads(response.read(12*1024*1024))
            query=data.get('query',{});redirects={r['from']:r['to'] for r in query.get('normalized',[])+query.get('redirects',[])}
            pages={p['title']:p for p in query.get('pages',{}).values()}
            for title in titles:
                resolved=title.replace('_',' ');visited=set()
                while resolved in redirects and resolved not in visited:visited.add(resolved);resolved=redirects[resolved]
                page=pages.get(resolved,{})
                text=page.get('extract','')
                result=dict(requested_title=title,title=page.get('title'),page_id=page.get('pageid'),
                    url='https://ru.wikipedia.org/wiki/'+quote(resolved.replace(' ','_')),checked_at=now(),
                    status='fetched' if text else 'unresolved',extract=text.split('\n\n')[0],paragraphs=[p for p in text.split('\n') if len(p)>30],
                    page_sha256=hashlib.sha256(text.encode()).hexdigest())
                if not text:result['error']='No article extract returned; requires another source'
                path=folder/(hashlib.sha256(title.encode()).hexdigest()+'.json');path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
                results[title]=result
            print(f'Reference batch: {min(start+15,len(pending))}/{len(pending)}',flush=True)
        except Exception as exc:
            for title in titles:results[title]=dict(requested_title=title,status='unresolved',error=str(exc))
            if isinstance(exc,urllib.error.HTTPError) and exc.code==429:
                print('Rate limited; remaining references stay unresolved. Retry later.',flush=True)
                break
        time.sleep(1.2)
    return [results.get(s['title'],dict(status='unresolved',error='Not fetched')) for s in specs]


def full_reference(title):
    folder=DATA/'research-cache';path=folder/(hashlib.sha256(title.encode()).hexdigest()+'.json')
    cached=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    if cached.get('full_text'):return cached
    endpoint='https://ru.wikipedia.org/w/api.php?'+urlencode(dict(action='query',prop='extracts',explaintext='1',redirects='1',titles=title,format='json'))
    with urllib.request.urlopen(urllib.request.Request(endpoint,headers={'User-Agent':'LocalQuizResearch/1.0'}),timeout=25) as response:data=json.loads(response.read(12*1024*1024))
    page=next(iter(data.get('query',{}).get('pages',{}).values()),{})
    text=page.get('extract','')
    if not text:return cached
    value=dict(requested_title=title,title=page['title'],page_id=page.get('pageid'),
        url='https://ru.wikipedia.org/wiki/'+quote(page['title'].replace(' ','_')),checked_at=now(),status='fetched',
        extract=text.split('\n\n')[0],paragraphs=[p for p in text.split('\n') if len(p)>20],full_text=True,page_sha256=hashlib.sha256(text.encode()).hexdigest())
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');return value


if __name__=='__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    specs=specifications()
    references=batch_references(specs)
    report=[dict(spec=s,reference=r) for s,r in zip(specs,references)]
    (DATA/'starter-research.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    for s,r in zip(specs,references):print(s['pack_id'],s['position'],r['status'],r.get('title'),r.get('error',''))
