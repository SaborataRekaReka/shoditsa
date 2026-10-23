"""Approved-only thematic packs, immutable sessions, SIQ export and real playtest data."""
from collections import Counter, defaultdict
import hashlib
from io import BytesIO
import json
import math
import random
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile

from editorial import CHECKS, digest, dump, identity, norm, now


def playable(row, media, checks):
    reasons=[]
    if row['review_status']!='approved': reasons.append('review_required')
    if not all(row['checks'].get(k) for k in CHECKS): reasons.append('incomplete_review')
    if not row['answer_text'].strip(): reasons.append('missing_answer')
    if row.get('stale_review'): reasons.append('source_changed')
    if row['media_policy']=='text_only':
        if not row['text_only'] and row['prompt']==row['original_prompt']:reasons.append('standalone_text_adaptation_required')
        media=[]
    for item in media:
        record=checks.get(item['id'],{})
        if item['status']!='local': reasons.append('external_or_missing_media')
        elif item.get('file'):
            if item['file']['analysis'].get('status')!='measured':reasons.append('media_technical_check_required')
            if item.get('decision',{}).get('status')!='approved':reasons.append('media_semantic_review_required')
        elif record.get('reference_hash')!=digest([item['reference'],item['asset_id']]) or record.get('status')!='ok': reasons.append('media_technical_check_required')
    return list(dict.fromkeys(reasons))


class Workflow:
    def __init__(self, library):
        self.library=library
        self.state=library.editorial

    def rows(self):
        from runtime import BASE
        with self.library.connect() as db:
            reviews=self.state.all_reviews()
            rows=[self.state.apply(dict(r),reviews) for r in db.execute(BASE+' ORDER BY q.id')]
            media=defaultdict(list)
            for row in db.execute('SELECT m.*,a.sha256 AS asset_sha256 FROM question_media m LEFT JOIN assets a ON a.id=m.asset_id'):media[row['question_id']].append(dict(row))
        with self.state.connect() as db:checks={r['media_id']:dict(r) for r in db.execute('SELECT * FROM media_checks')}
        for row in rows:
            row['text_content_hash']=row['content_hash']
            row['media']=self.library.media.resolve(media[row['id']],row)
            row['content_hash']=self.library.media.content_hash(row,row['media'])
            row['play_media']=[] if row['media_policy']=='text_only' else row['media']
            row['blockers']=playable(row,row['media'],checks)
            row['ready']=not row['blockers']
            row['effective_topic']=row.get('topic') or self.library.topics[row['id']][0]['topic_slug']
        return rows

    def readiness(self):
        rows=self.rows()
        rights=self.state.rights()
        with self.library.connect() as db:packs=[dict(r) for r in db.execute('SELECT id,title,source_url FROM packs')]
        for pack in packs:pack.update(rights.get(pack['id'],dict(status='unknown',url='',note='Условия повторного использования не подтверждены')))
        return dict(total=len(rows),review_status=dict(Counter(r['review_status'] for r in rows)),
            playable=sum(r['ready'] for r in rows),public_playable=sum(r['ready'] and rights.get(r['pack_id'],{}).get('status') in ('open_license','permission_obtained') for r in rows),
            approved_genres=dict(Counter(r['genre'] for r in rows if r['ready'])),
            factual_checked=sum(r['ready'] and r['truth_mode']=='factual' for r in rows),
            game_checked=sum(r['ready'] and r['truth_mode']!='factual' for r in rows),
            blockers=dict(Counter(reason for r in rows for reason in r['blockers'])),packs=packs,
            themes=[dict(name=key,questions=len(group)) for key,group in self.groups([r for r in rows if r['ready']]).items()],
            calibration=self.calibration(),schema_version=1)

    @staticmethod
    def groups(rows):
        groups=defaultdict(list)
        for row in rows:
            # A shared broad subject is insufficient to form a coherent theme.
            key=row.get('editorial_theme') or (str(row['pack_id'])+' · '+row['theme_name'])
            groups[key].append(row)
        return groups

    @staticmethod
    def profile(payload):
        party=str(payload.get('party_id','friends')).strip()
        if not re.fullmatch(r'[\w-]{1,80}',party):raise ValueError('ID компании: буквы, цифры, дефис, до 80 символов')
        def integer(key,default,lo,hi):
            try:value=int(payload.get(key,default))
            except (ValueError,TypeError):raise ValueError('Invalid '+key)
            if not lo<=value<=hi:raise ValueError('Invalid '+key)
            return value
        topics=payload.get('topics',[])
        genres=payload.get('genres',[])
        from editorial import GENRES
        if not isinstance(genres,list) or not all(g in GENRES for g in genres):raise ValueError('Invalid genres')
        excluded=payload.get('exclude_topics',[])
        if not isinstance(topics,list) or not isinstance(excluded,list) or not all(isinstance(t,str) for t in topics+excluded):raise ValueError('Invalid topics')
        return dict(party_id=party,name=str(payload.get('name',party))[:100],topics=topics,exclude_topics=excluded,genres=genres,
                    level=integer('level',3,1,5),age=integer('age',18,0,100),rounds=integer('rounds',1,1,3),
                    themes=integer('themes',3,1,6),text_only=payload.get('text_only',True) is True,
                    minutes=integer('minutes',30,5,180))

    def profiles(self):
        with self.state.connect() as db:return [json.loads(r[0]) for r in db.execute('SELECT data_json FROM profiles ORDER BY updated_at DESC')]

    def build(self,payload):
        profile=self.profile(payload)
        known=set(self.library.topic_labels)
        if set(profile['topics']+profile['exclude_topics'])-known:raise ValueError('Unknown topic')
        seed=str(payload.get('seed') or uuid.uuid4())[:100]
        rng=random.Random(seed)
        with self.state.connect() as db:
            seen={r[0] for r in db.execute('SELECT identity FROM seen WHERE party_id=?',(profile['party_id'],))}
        candidates=[r for r in self.rows() if r['ready'] and r.get('age_min') is not None and r['age_min']<=profile['age']
                    and identity(r['id']) not in seen and r['effective_topic'] not in profile['exclude_topics']
                    and (not profile['topics'] or r['effective_topic'] in profile['topics'])
                    and (not profile['genres'] or r['genre'] in profile['genres'])
                    and (not profile['text_only'] or not r['play_media'])]
        groups=self.groups(candidates)
        groups={k:v for k,v in groups.items() if len(v)>=5}
        names=sorted(groups);rng.shuffle(names)
        count=profile['rounds']*profile['themes']
        if len(names)<count:
            raise ValueError(f'Для этих настроек доступно {len(names)} полных тем по 5 вопросов, нужно {count}. Уменьшите число тем/раундов или расширьте интересы. Уже показанные вопросы исключены.')
        calibration=self.calibration()
        selected=[];used_answers=set();used_facts=set();used_ids=set();topics=Counter();genre_count=Counter();themes=[]
        while names and len(themes)<count:
            # Prefer an even topic mix; seeded ties remain reproducible.
            name=min(names,key=lambda n:(genre_count[groups[n][0]['genre']],topics[groups[n][0]['effective_topic']]));names.remove(name)
            pool=groups[name][:];rng.shuffle(pool)
            pool.sort(key=lambda r:abs((calibration.get(identity(r['id'])+':'+r['content_hash'],{}).get('difficulty') or r['difficulty'] or 3)-profile['level']))
            chosen=[]
            for row in pool:
                answers={norm(row['answer_text'])} | {norm(a) for a in row.get('aliases',[])}
                answers.discard('')
                fact=row.get('content_fingerprint')
                if used_answers.intersection(answers) or fact in used_facts or row['id'] in used_ids:continue
                if any(self.library.similar_pair(row['id'],other['id']) for other in selected+chosen):continue
                chosen.append(row);used_answers.update(answers);used_facts.add(fact);used_ids.add(row['id'])
                if len(chosen)==5:break
            if len(chosen)<5:
                # Failed themes must not reserve facts or answers.
                used_answers={norm(r['answer_text']) for r in selected}
                used_answers.update(norm(a) for r in selected for a in r.get('aliases',[]))
                used_facts={r['content_fingerprint'] for r in selected};used_ids={r['id'] for r in selected}
                continue
            chosen.sort(key=lambda r:calibration.get(identity(r['id'])+':'+r['content_hash'],{}).get('difficulty') or r['difficulty'] or 3)
            round_index=len(themes)//profile['themes']+1
            theme=dict(name=chosen[0].get('editorial_theme') or chosen[0]['theme_name'],round=round_index,questions=[])
            for i,row in enumerate(chosen):
                snapshot={k:row.get(k) for k in ('id','pack_id','prompt','answer_text','aliases','host_note','source_url','pack_title','authors_json','raw_sha256','content_hash','difficulty','age_min','evidence','editorial_revision','media','genre','truth_mode')}
                snapshot.update(points=(i+1)*100*round_index,topic=row['effective_topic'])
                snapshot['media']=row['play_media']
                snapshot['media_policy']=row['media_policy']
                theme['questions'].append(snapshot)
            themes.append(theme);selected.extend(chosen);topics[chosen[0]['effective_topic']]+=1;genre_count[chosen[0]['genre']]+=1
        if len(themes)<count:raise ValueError('После исключения повторов не хватает полных тем. Расширьте интересы или уменьшите число тем.')
        session_id=str(uuid.uuid4())
        snapshot=dict(id=session_id,profile=profile,seed=seed,themes=themes,created_at=now(),
                      questions=len(selected),estimated_minutes=round(len(selected)*1.5),
                      note='Сложность редакторская; калибровка появится после реальных игр. Публичный экспорт требует подтверждённых прав.')
        if snapshot['estimated_minutes']>profile['minutes']:
            raise ValueError(f"Для {len(selected)} вопросов заложено около {snapshot['estimated_minutes']} минут. Увеличьте длительность или уменьшите число тем.")
        with self.state.connect() as db:
            db.execute('INSERT INTO profiles VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at',(profile['party_id'],dump(profile),now()))
            db.execute('INSERT INTO sessions VALUES (?,?,?,?,?)',(session_id,profile['party_id'],seed,dump(snapshot),now()))
            self.state.audit(db,session_id,'build_pack',None,dict(profile=profile,seed=seed,ids=[r['id'] for r in selected]),'local_host')
        return snapshot

    def session(self,sid):
        with self.state.connect() as db:
            row=db.execute('SELECT snapshot_json FROM sessions WHERE id=?',(sid,)).fetchone()
            if row is None:raise KeyError('Пак не найден')
            return json.loads(row[0])

    def sessions(self):
        with self.state.connect() as db:
            return [dict(id=r['id'],party_id=r['party_id'],created_at=r['created_at'],questions=json.loads(r['snapshot_json'])['questions']) for r in db.execute('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 50')]

    def presented(self,payload):
        snapshot=self.session(payload['session_id'])
        q=next((q for t in snapshot['themes'] for q in t['questions'] if q['id']==payload['question_id']),None)
        if q is None:raise ValueError('Вопрос не входит в этот пак')
        with self.state.connect() as db:
            db.execute('INSERT INTO seen VALUES (?,?,?,?,?) ON CONFLICT(party_id,identity) DO UPDATE SET content_hash=excluded.content_hash,session_id=excluded.session_id,seen_at=excluded.seen_at',
                       (snapshot['profile']['party_id'],identity(q['id']),q['content_hash'],snapshot['id'],now()))
        return dict(saved=True)

    def record_play(self,payload):
        snapshot=self.session(payload['session_id'])
        question=next((q for t in snapshot['themes'] for q in t['questions'] if q['id']==payload['question_id']),None)
        if question is None:raise ValueError('Вопрос не входит в этот пак')
        participant=str(payload.get('participant','')).strip()[:80]
        if not participant:raise ValueError('Укажите игрока или команду')
        correct=payload.get('correct');seconds=payload.get('seconds');fun=payload.get('fun');disputed=payload.get('disputed',False)
        if type(correct) is not bool or type(disputed) is not bool:raise ValueError('Invalid result')
        if type(seconds) not in (int,float) or not math.isfinite(seconds) or not 0<=seconds<=3600:raise ValueError('Invalid response time')
        if fun is not None and (type(fun) is not int or not 1<=fun<=5):raise ValueError('Fun rating must be 1–5')
        event_id=str(payload.get('event_id') or uuid.uuid4())[:100]
        with self.state.connect() as db:
            old=db.execute('SELECT * FROM play_events WHERE session_id=? AND question_id=? AND participant=?',(snapshot['id'],question['id'],participant)).fetchone()
            if old:
                if (old['correct'],old['seconds'],old['disputed'],old['fun'])!=(int(correct),float(seconds),int(disputed),fun):raise ValueError('Результат этого игрока уже сохранён с другими значениями')
                return dict(saved=True,duplicate=True)
            db.execute('INSERT INTO play_events VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (event_id,snapshot['id'],question['id'],identity(question['id']),question['content_hash'],participant,int(correct),float(seconds),int(disputed),fun,now()))
            db.execute('INSERT INTO seen VALUES (?,?,?,?,?) ON CONFLICT(party_id,identity) DO UPDATE SET content_hash=excluded.content_hash,session_id=excluded.session_id,seen_at=excluded.seen_at',
                       (snapshot['profile']['party_id'],identity(question['id']),question['content_hash'],snapshot['id'],now()))
        return dict(saved=True,duplicate=False)

    def calibration(self):
        with self.state.connect() as db:
            rows=db.execute('''SELECT e.identity,e.content_hash,count(*) n,avg(correct) solve_rate,avg(seconds) response_seconds,
                sum(disputed) disputes,avg(fun) fun,count(DISTINCT s.party_id) parties
                FROM play_events e JOIN sessions s ON s.id=e.session_id GROUP BY e.identity,e.content_hash''').fetchall()
        result={}
        for r in rows:
            item=dict(r);n=item['n'];p=item['solve_rate'];z=1.96
            center=(p+z*z/(2*n))/(1+z*z/n);margin=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n)
            calibrated=n>=20 and item['parties']>=3 and item['disputes']/n<.1
            item.update(interval95=[round(center-margin,3),round(center+margin,3)],calibrated=calibrated,
                        difficulty=(1 if p>=.85 else 2 if p>=.65 else 3 if p>=.4 else 4 if p>=.2 else 5) if calibrated else None)
            result[item['identity']+':'+item['content_hash']]=item
        return result

    def export(self,sid,usage='private'):
        snapshot=self.session(sid)
        current={r['id']:r for r in self.rows()};rights=self.state.rights()
        if usage not in ('private','public'):raise ValueError('Invalid usage')
        for theme in snapshot['themes']:
            for q in theme['questions']:
                active=current.get(q['id'])
                if not active or not active['ready'] or active['content_hash']!=q['content_hash']:raise ValueError('Вопрос изменён или снят с одобрения. Соберите пак заново.')
                if usage=='public' and rights.get(q['pack_id'],{}).get('status') not in ('open_license','permission_obtained'):
                    raise ValueError('Публичный экспорт закрыт: условия использования одного из исходных паков не подтверждены')
        ns='https://github.com/VladimirKhil/SI/blob/master/assets/siq_5.xsd'
        ET.register_namespace('',ns)
        root=ET.Element('{'+ns+'}package',dict(name='Для '+snapshot['profile']['name'],version='5',id=sid,date=snapshot['created_at'][:10]))
        info=ET.SubElement(root,'info');authors=ET.SubElement(info,'authors');ET.SubElement(authors,'author').text='Локальная редакторская сборка; авторы исходников перечислены в вопросах'
        ET.SubElement(info,'comments').text='Назначение: '+usage+'. Проверяйте условия исходников в provenance.json. Seed: '+snapshot['seed']
        rounds=ET.SubElement(root,'rounds');round_elements={}
        assets={}
        for theme in snapshot['themes']:
            ri=theme['round']
            if ri not in round_elements:
                element=ET.SubElement(rounds,'round',dict(name='Раунд '+str(ri),type='standard'))
                round_elements[ri]=ET.SubElement(element,'themes')
            element=ET.SubElement(round_elements[ri],'theme',dict(name=theme['name']));questions=ET.SubElement(element,'questions')
            for q in theme['questions']:
                node=ET.SubElement(questions,'question',dict(price=str(q['points'])))
                info=ET.SubElement(node,'info');authors=ET.SubElement(info,'authors')
                for author in json.loads(q['authors_json']):ET.SubElement(authors,'author').text=author
                sources=ET.SubElement(info,'sources');ET.SubElement(sources,'source').text=q['source_url']
                ET.SubElement(info,'comments').text=q.get('host_note') or ''
                params=ET.SubElement(node,'params')
                for phase in ('question','answer'):
                    items=[m for m in q['media'] if m['phase']==phase]
                    content=ET.SubElement(params,'param',dict(name=phase,type='content'))
                    ET.SubElement(content,'item',dict(type='text')).text=q['prompt'] if phase=='question' else q['answer_text']
                    for media in items:
                        asset=self.library.asset(media['asset_id']);folder={'image':'Images','audio':'Audio','video':'Video'}[media['type']]
                        filename=asset['id'].replace(':','_')+__import__('pathlib').Path(asset['entry_name']).suffix
                        ET.SubElement(content,'item',dict(type=media['type'],isRef='True')).text=filename
                        assets[folder+'/'+filename]=asset
                right=ET.SubElement(node,'right')
                for answer in dict.fromkeys([q['answer_text']]+q.get('aliases',[])):ET.SubElement(right,'answer').text=answer
        xml=ET.tostring(root,encoding='utf-8',xml_declaration=True)
        from lxml import etree
        schema_path=__import__('pathlib').Path(__file__).with_name('vendor')/'siq_5.xsd'
        etree.XMLSchema(etree.parse(str(schema_path))).assertValid(etree.fromstring(xml))
        out=BytesIO()
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('content.xml',xml)
            archive.writestr('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
            archive.writestr('provenance.json',dump(dict(snapshot=snapshot,rights=rights,usage=usage)))
            for name,asset in assets.items():
                from semantic import REPO
                if asset.get('path'):
                    from media_pipeline import file_path
                    archive.writestr(name,file_path(asset).read_bytes())
                else:
                    with zipfile.ZipFile(REPO/asset['archive_path']) as source:archive.writestr(name,source.read(asset['entry_name']))
        return out.getvalue()
