"""Source-preserving media versions, evidence, editorial judgments and manual decisions."""
from collections import Counter,defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import tempfile
import threading
import uuid

from editorial import Conflict,dump,digest,identity,now
from media_pipeline import ROOT,ANALYSIS,FFMPEG,file_path,store_file,analyze_file,run,source_rows
from semantic import DATA

CHECKS=('match','readability','sound','spoilers')
ISSUE_LABELS={'unavailable':'Файл недоступен','invalid_content':'Вместо медиа другой файл','decode_error':'Ошибка обработки',
 'small_image':'Маленькое изображение','small_video':'Низкое разрешение видео','low_detail':'Мало деталей / размытость',
 'quiet_audio':'Тихий звук','loud_audio':'Громкий звук','peak_near_clipping':'Пик у предела','leading_silence':'Тишина в начале',
 'trailing_silence':'Тишина в конце','browser_codec':'Проверить кодек в браузере','animated_image':'Анимированное изображение',
 'answer_text_detected':'OCR / ASR нашёл слова ответа','phase_duplicate':'Один файл в условии и ответе','type_changed':'Уточнён тип содержимого',
 'semantic_uncertain':'Соответствие не подтверждено','possible_spoiler':'Возможен спойлер','mismatch':'Вероятная ошибка ответа'}
ISSUE_LABELS.update(identity_not_verified='Имя по фото / голосу не подтверждено',answer_scope='Уточнить зачёт')
ISSUE_LABELS.update(listening_required='Нужно прослушать',missing_audio='Нет звуковой дорожки')
ISSUE_LABELS.update(metadata_present='Названия в метаданных файла')
ISSUE_LABELS.update(silent_audio='Звуковая дорожка содержит тишину')


class MediaWorkflow:
    def __init__(self,library):
        self.library=library;self.state=library.editorial;self.lock=threading.RLock();self.cache_key=None;self.cache=None

    def snapshot(self):
        key=(self.state.path.stat().st_mtime_ns,self.state.path.stat().st_size)
        with self.lock:
            if key==self.cache_key:return self.cache
            with self.state.connect() as db:
                files={r['id']:dict(r) for r in db.execute('SELECT * FROM media_files')}
                fetch={r['url']:dict(r) for r in db.execute('SELECT * FROM media_fetch')}
                renditions=defaultdict(list)
                for r in db.execute('SELECT * FROM media_renditions ORDER BY created_at'):renditions[r['media_id']].append(dict(r))
                selections={r['media_id']:dict(r) for r in db.execute('SELECT * FROM media_selections')}
                decisions={r['media_id']:dict(r) for r in db.execute('SELECT * FROM media_decisions')}
                assessments={r['media_id']:dict(r) for r in db.execute('SELECT * FROM media_assessments')}
            for f in files.values():f['analysis']=json.loads(f.pop('analysis_json'));f['source']=json.loads(f.pop('source_json'))
            self.cache=dict(files=files,by_sha={f['sha256']:f for f in files.values()},fetch=fetch,renditions=renditions,selections=selections,decisions=decisions,assessments=assessments)
            self.cache_key=key;return self.cache

    def file(self,file_id):return self.snapshot()['files'].get(file_id)

    @staticmethod
    def public_file(record,detail=False):
        if not record:return None
        result={k:record[k] for k in ('id','sha256','mime','bytes')}
        result['url']='/library-media/'+record['id'];result['analysis']=record['analysis']
        # Paths are never accepted from the browser; only whitelisted previews
        # are served through a hash-addressed endpoint.
        result['analysis']=dict(record['analysis'])
        video=next((s for s in result['analysis'].get('streams',[]) if s['codec_type']=='video'),None)
        if video:result['analysis'].update(width=video['width'],height=video['height'])
        result['analysis']['previews']=[dict(time=p['time'],url='/library-media-preview/'+record['sha256']+'/'+Path(p['path']).name) for p in record['analysis'].get('previews',[])]
        result['analysis'].pop('waveform',None)
        if record['analysis'].get('waveform'):result['analysis']['waveform_url']='/library-media-preview/'+record['sha256']+'/waveform.png'
        if detail:
            folder=ANALYSIS/record['sha256'];ocr=[]
            for file in sorted(folder.glob('ocr-*.json')):
                value=json.loads(file.read_text(encoding='utf-8'));ocr.append(value)
            result['ocr']=ocr
            speech=folder/'transcript.json';result['transcript']=json.loads(speech.read_text(encoding='utf-8')) if speech.exists() else None
            second=folder/'semantic-transcript.json';result['semantic_transcript']=json.loads(second.read_text(encoding='utf-8')) if second.exists() else None
            result['provenance']=record['source']
        return result

    @staticmethod
    def signature(row,media,sha):return digest([row.get('text_content_hash',row['content_hash']),media['id'],media['phase'],sha])

    def resolve(self,refs,row,detail=False):
        data=self.snapshot();result=[]
        for ref in refs:
            item=dict(ref);source=None
            if ref.get('asset_id'):
                source=data['by_sha'].get(ref.get('asset_sha256',''))
                if source is None:
                    # SQL joins in existing call sites can omit the asset hash.
                    source=next((f for f in data['files'].values() if f['source'].get('asset_id')==ref['asset_id']),None)
            elif ref.get('external_url'):
                fetched=data['fetch'].get(ref['external_url']);source=data['files'].get(fetched['file_id']) if fetched else None
                item['fetch']=dict(status=fetched['status'],checked_at=fetched['checked_at'],**json.loads(fetched['details_json'])) if fetched else dict(status='not_attempted')
            variants=data['renditions'].get(ref['id'],[]);selection=data['selections'].get(ref['id'])
            selected=next((r for r in variants if selection and r['id']==selection['rendition_id']),None)
            # An edited version tied to an old source is retained for history,
            # but never silently applied to a newly downloaded source.
            if selected and (not source or selected['source_sha256']!=source['sha256']):selected=None
            active=data['files'].get(selected['file_id']) if selected else source
            item.update(original_type=ref['type'],original_status=ref['status'],source_file=self.public_file(source,detail),file=self.public_file(active,detail),selection_revision=selection['revision'] if selection else 0,
                        selected_rendition=selected['id'] if selected else None,
                        renditions=[dict(id=v['id'],params=json.loads(v['params_json']),file=self.public_file(data['files'][v['file_id']],detail),source_sha256=v['source_sha256']) for v in variants])
            if active:
                item.update(status='local',asset_id=active['id'],url='/library-media/'+active['id'],type=active['mime'].split('/')[0])
            sha=active['sha256'] if active else 'unavailable:'+str(ref.get('external_url') or ref.get('asset_id'))
            signature=self.signature(row,item,sha);item['signature']=signature
            decision=data['decisions'].get(ref['id']);assessment=data['assessments'].get(ref['id'])
            item['decision']=dict(status=decision['status'] if decision['signature']==signature else 'pending',revision=decision['revision'],checks=json.loads(decision['checks_json']),note=decision['note'],actor=decision['actor'],updated_at=decision['updated_at'],stale=decision['signature']!=signature) if decision else dict(status='pending',revision=0,checks={},note='',actor='',stale=False)
            item['assessment']=dict(**json.loads(assessment['assessment_json']),stale=assessment['signature']!=signature) if assessment else dict(status='unresolved',note='Семантический просмотр ещё не завершён.',issues=['semantic_uncertain'])
            from media_semantics import effective
            item['semantic']=effective(item)
            issues=list(active['analysis'].get('issues',[])) if active else ['unavailable']
            if active and item['type']!=item['original_type']:issues.append('type_changed')
            issues+=item['assessment'].get('issues',[])
            item['issues']=list(dict.fromkeys(issues));result.append(item)
        return result

    @staticmethod
    def content_hash(row,media):
        if row['media_policy']=='text_only':return row['content_hash']
        changed=[(m['id'],m['file']['sha256']) for m in media if m.get('file')]
        return digest([row['content_hash'],changed]) if changed else row['content_hash']

    def catalog(self):
        from runtime import BASE
        from media_semantics import question_result,REASONS
        with self.library.connect() as db:
            reviews=self.state.all_reviews();rows=[self.state.apply(dict(r),reviews) for r in db.execute(BASE+' ORDER BY q.pack_id,r.ordinal,t.ordinal,q.ordinal')]
        refs=defaultdict(list)
        for ref in source_rows():refs[ref['question_id']].append(ref)
        items=[]
        for row in rows:
            if row['id'] not in refs:continue
            media=self.resolve(refs[row['id']],row)
            items.append(dict(id=row['id'],pack_id=row['pack_id'],pack=row['pack_title'],theme=row['theme_name'],ordinal=row['ordinal'],prompt=row['prompt'],answer=row['answer_text'],semantic=question_result(media),media=[dict(id=m['id'],phase=m['phase'],type=m['type'],available=bool(m['file']),issues=m['issues'],decision=m['decision']['status'],assessment=m['assessment'].get('status','unresolved'),semantic=m['semantic'],renditions=len(m['renditions'])) for m in media]))
        all_media=[m for item in items for m in item['media']]
        return dict(items=items,issue_labels=ISSUE_LABELS,semantic_reason_labels=REASONS,summary=dict(questions=len(items),references=len(all_media),available=sum(m['available'] for m in all_media),unavailable=sum(not m['available'] for m in all_media),decisions=dict(Counter(m['decision'] for m in all_media)),issues=dict(Counter(i for m in all_media for i in m['issues'])),assessments=dict(Counter(m['assessment'] for m in all_media)),semantic_questions=dict(Counter(q['semantic']['status'] for q in items)),semantic_reasons=dict(Counter(r for q in items for r in q['semantic']['reasons']))),checked_at=now())

    def question_media(self,qid,detail=True):
        from runtime import BASE
        with self.library.connect() as db:source=db.execute(BASE+' WHERE q.id=?',(qid,)).fetchone()
        if source is None:raise ValueError('Question not found')
        row=self.state.apply(dict(source));refs=[m for m in source_rows() if m['question_id']==qid]
        return self.resolve(refs,row,detail)

    def find(self,media_id,detail=True):
        ref=next((r for r in source_rows() if r['id']==media_id),None)
        if not ref:raise ValueError('Unknown media reference')
        return next(m for m in self.question_media(ref['question_id'],detail) if m['id']==media_id)

    def decide(self,payload):
        # Read the text, selected bytes and decision under the same writer lock.
        # Otherwise a selection made between find() and BEGIN could be approved
        # using the previous file's checks.
        with self.state.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self.cache_key=None
            return self._decide(db,payload)

    def _decide(self,db,payload):
        item=self.find(str(payload.get('media_id','')))
        status=payload.get('status');actor=str(payload.get('actor','')).strip()[:100]
        if status not in ('pending','approved','rework','rejected') or not actor:raise ValueError('Укажите редактора и решение')
        checks=payload.get('checks',{})
        if not isinstance(checks,dict):raise ValueError('Invalid checks')
        if set(checks)-set(CHECKS) or any(v not in ('pass','fail','uncertain','not_applicable') for v in checks.values()):raise ValueError('Invalid checks')
        if status=='approved':
            if not item['file'] or item['file']['analysis'].get('status')!='measured':raise ValueError('Недоступный или повреждённый файл нельзя принять')
            required={'match'}|({'spoilers'} if item['phase']=='question' else set())|({'readability'} if item['type'] in ('image','video') else {'sound'})
            if item['type']=='video' and item['file']['analysis'].get('has_audio'):required.add('sound')
            if any(checks.get(k) not in ('pass','not_applicable') for k in CHECKS) or any(checks.get(k)!='pass' for k in required):raise ValueError('Завершите проверки соответствия, читаемости, звука и спойлеров')
        value=dict(media_id=item['id'],signature=item['signature'],revision=item['decision']['revision']+1,checks_json=dump(checks),status=status,note=str(payload.get('note',''))[:4000],actor=actor,updated_at=now())
        old=db.execute('SELECT * FROM media_decisions WHERE media_id=?',(item['id'],)).fetchone()
        if (old['revision'] if old else 0)!=payload.get('revision',0) or payload.get('signature')!=item['signature']:raise Conflict('Медиа или решение изменились. Обновите карточку.')
        db.execute('INSERT OR REPLACE INTO media_decisions VALUES(?,?,?,?,?,?,?,?)',tuple(value.values()))
        self.state.audit(db,item['id'],'media_decision',dict(old) if old else None,value,actor)
        item['decision']=dict(status=status,revision=value['revision'],checks=checks,note=value['note'],actor=actor,updated_at=value['updated_at'],stale=False)
        return item

    def render(self,payload,actor='Codex · медиаредакция'):
        actor=str(payload.get('actor') or actor).strip()[:100]
        if not actor:raise ValueError('Укажите редактора')
        item=self.find(str(payload.get('media_id','')))
        source=item['source_file']
        if not source or source['mime'].startswith('image/'):raise ValueError('Обрезка и нормализация доступны для аудио/видео')
        if payload.get('source_sha256')!=source['sha256']:raise Conflict('Исходный файл изменился')
        duration=source['analysis'].get('duration',0)
        start=float(payload.get('start',0));end=float(payload.get('end',duration));gain=float(payload.get('gain_db',0));normalize=payload.get('normalize') is True
        if not all(math.isfinite(v) for v in (start,end,gain)) or not 0<=start<end<=duration+.05 or not -30<=gain<=20 or end-start<.2:raise ValueError('Проверьте границы и громкость')
        if normalize and source['analysis'].get('loudness',{}).get('input_i') is None:raise ValueError('Измеримого звука нет: нормализация не восстановит отсутствующий сигнал')
        params=dict(start=round(start,3),end=round(end,3),gain_db=round(gain,2),normalize=normalize)
        masks=payload.get('masks',[])
        if not isinstance(masks,list) or len(masks)>4:raise ValueError('Допустимо до четырёх масок')
        if masks and not source['mime'].startswith('video/'):raise ValueError('Маска доступна для видео')
        clean=[]
        for rect in masks:
            if not isinstance(rect,dict) or set(rect)!={'x','y','w','h'}:raise ValueError('Некорректная маска')
            r={k:float(rect[k]) for k in ('x','y','w','h')}
            if not all(math.isfinite(v) for v in r.values()) or not (0<=r['x']<1 and 0<=r['y']<1 and .001<=r['w']<=1-r['x'] and .001<=r['h']<=1-r['y']):raise ValueError('Маска должна находиться внутри кадра')
            clean.append({k:round(v,5) for k,v in r.items()})
        if clean:params['masks']=clean
        metadata_only=payload.get('metadata_only') is True
        if metadata_only:
            if start!=0 or abs(end-duration)>.01 or normalize or gain or clean:raise ValueError('Удаление метаданных не совмещается с обрезкой, маской и громкостью')
            params['metadata_only']=True
        key=digest([item['id'],source['sha256'],params])
        with self.state.connect() as db:existing=db.execute('SELECT id FROM media_renditions WHERE id=?',(key,)).fetchone()
        if existing:return self.find(item['id'])
        original=self.snapshot()['files'][source['id']];path=file_path(original)
        video=source['mime'].startswith('video/');suffix=path.suffix if metadata_only else '.mp4' if video else '.mp3'
        ROOT.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=ROOT,suffix=suffix,delete=False) as file:output=Path(file.name)
        try:
            args=[FFMPEG,'-v','error','-threads','1']
            if not metadata_only:args+=['-ss',str(start)]
            args+=['-i',str(path)]
            if not metadata_only:args+=['-t',str(end-start)]
            args+=['-map_metadata','-1','-map_metadata:s','-1','-map_chapters','-1']
            filters=[]
            if normalize:filters.append('loudnorm=I=-18:TP=-1.5:LRA=11')
            if gain:filters.append('volume='+str(gain)+'dB')
            has_audio=source['analysis'].get('has_audio',not video)
            if filters and has_audio:args+=['-af',','.join(filters)]
            if clean:args+=['-vf',','.join(f"drawbox=x=iw*{r['x']}:y=ih*{r['y']}:w=iw*{r['w']}:h=ih*{r['h']}:color=black:t=fill" for r in clean)]
            if metadata_only:args+=['-map','0:v?' if video else '0:a','-c','copy']+(['-map','0:a?','-movflags','+faststart'] if video and suffix=='.mp4' else [])
            elif video:args+=['-c:v','libx264','-threads','1','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart']
            else:args+=['-vn','-c:a','libmp3lame','-b:a','192k']
            run(args+['-y',str(output)],timeout=180)
            record=store_file(self.state,output,dict(kind='rendition',source_sha256=source['sha256'],media_id=item['id'],params=params))
            analysis=analyze_file(record)
            if analysis['status']!='measured':raise ValueError('Изменённый файл не прошёл проверку: '+analysis.get('error',''))
            with self.state.connect() as db:
                db.execute('UPDATE media_files SET analysis_json=? WHERE id=?',(dump(analysis),record['id']))
                inserted=db.execute('INSERT OR IGNORE INTO media_renditions VALUES(?,?,?,?,?,?)',(key,item['id'],source['sha256'],dump(params),record['id'],now())).rowcount
                if inserted:self.state.audit(db,item['id'],'media_render',None,dict(id=key,file_id=record['id'],params=params),actor)
        finally:output.unlink(missing_ok=True)
        return self.find(item['id'])

    def select(self,payload):
        with self.state.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self.cache_key=None
            media_id=self._select(db,payload)
        return self.find(media_id)

    def _select(self,db,payload):
        item=self.find(str(payload.get('media_id','')))
        actor=str(payload.get('actor','')).strip()[:100]
        if not actor:raise ValueError('Укажите редактора')
        chosen=payload.get('rendition_id')
        if chosen is not None and not item['source_file']:raise ValueError('Исходный файл недоступен')
        if chosen is not None and not any(v['id']==chosen and v['source_sha256']==item['source_file']['sha256'] for v in item['renditions']):raise ValueError('Версия не относится к этому исходнику')
        old=db.execute('SELECT * FROM media_selections WHERE media_id=?',(item['id'],)).fetchone()
        if (old['revision'] if old else 0)!=payload.get('revision',0) or payload.get('signature')!=item['signature']:raise Conflict('Версия уже изменена. Обновите карточку.')
        value=dict(media_id=item['id'],rendition_id=chosen,revision=(old['revision'] if old else 0)+1,actor=actor,updated_at=now())
        db.execute('INSERT OR REPLACE INTO media_selections VALUES(?,?,?,?,?)',tuple(value.values()))
        self.state.audit(db,item['id'],'media_selection',dict(old) if old else None,value,actor)
        return item['id']
