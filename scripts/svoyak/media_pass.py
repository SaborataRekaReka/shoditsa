"""Complete media triage and staged corrections, with explicit unresolved semantics."""
from collections import Counter,defaultdict
from concurrent.futures import ThreadPoolExecutor,as_completed
import json
import hashlib
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

from editorial import dump,identity,now
from media_pipeline import ROOT,ANALYSIS,source_rows
from semantic import REPO
from runtime import Library,BASE

LEDGER=Path(__file__).with_name('media-visual-decisions.json')


def normalized(text):return re.sub(r'[^a-zа-яё0-9 ]',' ',str(text).casefold().replace('ё','е')).strip()


def prepare(library):
    reviews=library.editorial.all_reviews();refs=defaultdict(list)
    for m in source_rows():refs[m['question_id']].append(m)
    with library.connect() as db:rows=[library.editorial.apply(dict(r),reviews) for r in db.execute(BASE)]
    ledger=json.loads(LEDGER.read_text(encoding='utf-8')) if LEDGER.exists() else {}
    with library.editorial.connect() as db:previous={r['media_id']:dict(r) for r in db.execute('SELECT * FROM media_assessments')}
    results=[];input=[]
    for row in rows:
        if row['id'] not in refs:continue
        media=library.media.resolve(refs[row['id']],row,detail=True)
        qhashes={m['file']['sha256'] for m in media if m['phase']=='question' and m['file']}
        ahashes={m['file']['sha256'] for m in media if m['phase']=='answer' and m['file']}
        for m in media:
            a=dict(status='unresolved',method='measurements_ocr_asr',checked_at=now(),issues=[],
                   match='uncertain',readability='uncertain',sound='uncertain',spoilers='uncertain',
                   note='Автоматическая диагностика не подтверждает правильность авторского ключа.',observations=[])
            file=m['file']
            if not file:
                a.update(status='unavailable',issues=['unavailable'],note='Внешний файл не удалось скачать: '+str(m.get('fetch',{}).get('error','нет файла')))
            else:
                analysis=file['analysis'];issues=analysis.get('issues',[])
                a['technical_status']=analysis.get('status');a['issues']+=issues
                if m['type']=='image':a['sound']='not_applicable'
                if m['type']=='audio':a['readability']='not_applicable'
                if m['type']=='video' and not analysis.get('has_audio'):a['sound']='not_applicable'
                if m['phase']=='answer':a['spoilers']='not_applicable'
                if analysis.get('loudness'):a['observations'].append('Измеренная громкость '+str(analysis['loudness'].get('input_i'))+' LUFS; true peak '+str(analysis['loudness'].get('input_tp'))+' dBTP.')
                if analysis.get('has_audio') and analysis.get('loudness',{}).get('input_i') is None and analysis.get('loudness',{}).get('input_tp') is None:a['issues'].append('silent_audio')
                if analysis.get('width'):a['observations'].append(f"Размер изображения {analysis['width']}×{analysis['height']} пикселей.")
                ocr=' '.join(v.get('text','') for v in file.get('ocr',[]));speech=file.get('transcript') or {};asr=speech.get('text','')
                a['ocr_status']='complete' if file.get('ocr') else 'not_applicable' if m['type']=='audio' else 'not_available'
                a['speech_status']=speech.get('status','not_applicable' if m['type']=='image' else 'not_available')
                key=normalized(row['answer_text']);haystack=normalized(ocr+' '+asr)
                keys=[normalized(k) for k in [row['answer_text']]+row.get('aliases',[]) if 5<=len(normalized(k))<=90]
                mentions=[k for k in keys if k and k in haystack]
                if mentions and m['phase']=='question':
                    a['issues'].append('answer_text_detected');a['observations'].append('OCR/ASR нашёл слова ключа: '+', '.join(mentions[:4])+'. Это может быть намеренной подсказкой; требуется просмотр.')
                if file['sha256'] in qhashes&ahashes:
                    a['issues'].append('phase_duplicate');a['observations'].append('Одинаковые байты встречаются в условии и ответе. Проверить задумку.')
                if m['phase']=='question' and any(k.rsplit('.',1)[-1].casefold() in ('title','artist','album','description','synopsis') and str(v).strip(" '\"") for k,v in analysis.get('metadata',{}).items()):
                    a['issues'].append('metadata_present');a['observations'].append('В метаданных есть название, исполнитель или описание. Они могут раскрывать ключ, а часть файлов содержит чужие унаследованные теги. Предложена копия без метаданных, исходник сохранён.')
                if m['type']!=m['original_type']:a['issues'].append('type_changed')
                manual=ledger.get(m['id'])
                if manual and manual.get('sha256')==file['sha256']:
                    machine_issues=list(a['issues']);a.update(manual['assessment']);a['issues']=list(dict.fromkeys(machine_issues+a.get('issues',[])));a['method']=manual.get('method','visual_inspection_with_measurements');a['visual_reviewed']=manual.get('method')!='asr_excerpt_review_with_measurements';a['asr_excerpt_reviewed']=manual.get('method')=='asr_excerpt_review_with_measurements'
                else:a['issues'].append('semantic_uncertain')
                if analysis.get('has_audio') and a.get('sound') not in ('pass','not_applicable') and 'silent_audio' not in a['issues']:a['issues'].append('listening_required')
            a['issues']=list(dict.fromkeys(a['issues']))
            prior=previous.get(m['id'])
            if prior and prior['signature']==m['signature']:
                semantic=json.loads(prior['assessment_json']).get('semantic')
                if semantic:a['semantic']=semantic
            results.append(dict(media_id=m['id'],question_id=row['id'],signature=m['signature'],assessment=a))
        input.append(dict(id=row['id'],prompt=row['prompt'],answer_text=row['answer_text'],theme=row['theme_name'],
                          source_url=row['source_url'],raw_sha256=row['raw_sha256'],media=[dict(id=m['id'],phase=m['phase'],type=m['type'],reference=m['reference'],sha256=m['file']['sha256'] if m['file'] else None,status='available' if m['file'] else 'unavailable') for m in media]))
    with library.editorial.connect() as db:
        for item in results:db.execute('INSERT OR REPLACE INTO media_assessments VALUES(?,?,?,?)',(item['media_id'],item['signature'],dump(item['assessment']),now()))
    summary=dict(checked_at=now(),questions=len(input),references=len(results),coverage=len(results),
                 statuses=dict(Counter(i['assessment']['status'] for i in results)),
                 visual_reviewed=sum(i['assessment'].get('visual_reviewed',False) for i in results),
                 full_semantic_verified=False,issues=dict(Counter(x for i in results for x in i['assessment']['issues'])))
    (ROOT/'research-input.json').write_text(dump(input),encoding='utf-8')
    (ROOT/'disposition.jsonl').write_text('\n'.join(dump(i) for i in results)+'\n',encoding='utf-8')
    (ROOT/'review-report.json').write_text(dump(summary),encoding='utf-8');print(dump(summary),flush=True)


def variants(library):
    refs=source_rows();byqid=defaultdict(list)
    for r in refs:byqid[r['question_id']].append(r)
    reviews=library.editorial.all_reviews()
    with library.connect() as db:rows=[library.editorial.apply(dict(r),reviews) for r in db.execute(BASE)]
    todo=[]
    for row in rows:
        for m in library.media.resolve(byqid[row['id']],row):
            f=m['source_file']
            if not f or not f['mime'].startswith(('audio/','video/')):continue
            a=f['analysis'];issues=set(a.get('issues',[]))
            if a.get('status')!='measured' or not issues&{'quiet_audio','loud_audio','peak_near_clipping','leading_silence','trailing_silence','browser_codec'}:continue
            if a.get('has_audio') and a.get('loudness',{}).get('input_i') is None:continue
            duration=a['duration'];start=0;end=duration
            silence=a.get('silence',[])
            if 'leading_silence' in issues and silence and 1<silence[0]['end']<min(5,duration*.3):start=max(0,silence[0]['end']-.15)
            if 'trailing_silence' in issues and silence and 1<duration-silence[-1]['start']<min(5,duration*.3):end=min(duration,silence[-1]['start']+.2)
            normalize=bool(issues&{'quiet_audio','loud_audio','peak_near_clipping'});gain=0
            level=a.get('loudness',{}).get('input_i');peak=a.get('loudness',{}).get('input_tp')
            output_level=a.get('loudness',{}).get('output_i')
            if normalize and duration<5 and level is not None and peak is not None and output_level is not None and abs(output_level+18)>2 and peak+(-18-level)<=-1.5:
                gain=round(-18-level,2);normalize=False
            todo.append(dict(media_id=m['id'],source_sha256=f['sha256'],start=start,end=end,normalize=normalize,gain_db=gain))
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures={executor.submit(library.media.render,p):p for p in todo}
        failures=[]
        for i,f in enumerate(as_completed(futures),1):
            try:f.result()
            except Exception as e:failures.append(dict(media_id=futures[f]['media_id'],error=str(e)))
            if i%15==0 or i==len(todo):print(f'Proposed AV versions: {i}/{len(todo)}',flush=True)
    report=dict(proposals_requested=len(todo),failed=failures,automatically_selected=0,checked_at=now())
    (ROOT/'renditions-report.json').write_text(dump(report),encoding='utf-8');print(dump(report),flush=True)


def pin_research():
    """Pin the exact media audit input and explicitly account for every research task."""
    folder=ROOT/'factcheck'/('media-'+now().replace(':','').replace('+','-')+'-'+uuid.uuid4().hex[:8])
    folder.mkdir(parents=True)
    for name in ('research-input.json','disposition.jsonl','review-report.json'):
        shutil.copyfile(ROOT/name,folder/('input.json' if name=='research-input.json' else name))
    subprocess.run(['node','scripts/factcheck/run.mjs','--source=input','--input='+str(folder/'input.json'),
                    '--mode=custom','--fields=prompt,answer_text,media','--research=all','--ai=never',
                    '--output='+str(folder/'run')],cwd=REPO,check=True)
    byquestion=defaultdict(list)
    for line in (folder/'disposition.jsonl').read_text(encoding='utf-8').splitlines():
        item=json.loads(line);byquestion[item['question_id']].append(item)
    cards=json.loads((folder/'input.json').read_text(encoding='utf-8'))
    results=[]
    for card in cards:
        refs=byquestion[card['id']]
        results.append(dict(question_id=card['id'],status='uncertain',
            reason='Все ссылки разобраны и доступны для ручной проверки. Технические измерения, просмотр изображений/контрольных кадров и ASR не заменяют полное прослушивание, просмотр ролика и подтверждение авторского ключа.',
            media=[dict(media_id=r['media_id'],signature=r['signature'],**r['assessment']) for r in refs]))
    (folder/'research-disposition.jsonl').write_text('\n'.join(dump(r) for r in results)+'\n',encoding='utf-8')
    queued=[json.loads(line) for line in (folder/'run/research-queue.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    if len(queued)!=len(results) or len(results)!=len(cards):raise ValueError('Incomplete media research accounting')
    result=dict(path=str(folder.relative_to(REPO)),checked_at=now(),questions=len(cards),references=sum(len(v) for v in byquestion.values()),
                explicitly_unresolved=len(results),full_semantic_verified=False,
                sha256={name:hashlib.sha256((folder/name).read_bytes()).hexdigest() for name in ('input.json','disposition.jsonl','research-disposition.jsonl')})
    (folder/'coverage.json').write_text(dump(result),encoding='utf-8')
    (ROOT/'factcheck/latest.json').write_text(dump(result),encoding='utf-8')
    print(dump(result),flush=True)


if __name__=='__main__':
    library=Library()
    if len(sys.argv)>1 and sys.argv[1]=='variants':variants(library)
    elif len(sys.argv)>1 and sys.argv[1]=='factcheck':pin_research()
    else:prepare(library)
