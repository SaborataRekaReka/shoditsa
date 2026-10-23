"""Build the local SIQ library, preserving sources and adding searchable metadata."""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import mimetypes
from pathlib import Path
import re
import sqlite3
import sys
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
import zipfile

from semantic import DATA, MODEL_ID, REVISION, Encoder
from ontology import classify

REPO=Path(__file__).resolve().parents[2]
DB=DATA/'library.sqlite3'
TOPICS={
 'cinema':('Кино и сериалы','Кино, фильмы, сериалы, актёры, режиссёры, персонажи фильмов.'),
 'animation':('Мультфильмы','Мультфильмы, Дисней, Пиксар, советская анимация, герои мультсериалов.'),
 'anime':('Аниме','Японское аниме, манга, персонажи аниме, студии, опенинги и эндинги.'),
 'games':('Видеоигры','Компьютерные игры, консоли, игровые персонажи, Steam, игровые миры.'),
 'music':('Музыка','Песни, исполнители, музыкальные группы, мелодии, инструменты, саундтреки.'),
 'geography':('География','Страны, столицы, города, реки, горы, острова, флаги, достопримечательности.'),
 'history':('История и мифы','История, исторические события, правители, войны, мифология, религия.'),
 'science':('Наука и космос','Физика, химия, биология, математика, астрономия, космос, открытия.'),
 'technology':('Техника и изобретения','Гаджеты, технологии, компьютеры, изобретения, устройства, автомобили.'),
 'language':('Язык и слова','Языки, значения слов, двойные значения, поговорки, перевод, шарады, ребусы.'),
 'literature':('Книги','Литература, книги, писатели, поэзия, книжные персонажи и литературные цитаты.'),
 'food':('Еда и напитки','Еда, кухня, блюда, продукты, специи, кофе, напитки, кулинария.'),
 'nature':('Животные и растения','Природа, животные, растения, птицы, цветы, собаки и кошки.'),
 'art':('Искусство','Живопись, картины, художники, архитектура, скульптура, культура.'),
 'internet':('Интернет и мемы','Интернет, мемы, социальные сети, YouTube, TikTok, блогеры и стримеры.'),
 'sport':('Спорт','Спорт, футбол, хоккей, баскетбол, спортсмены, олимпийские игры.'),
 'people':('Люди и профессии','Знаменитости, известные люди, профессии, биографии, имена и псевдонимы.'),
 'fiction':('Персонажи и вселенные','Вымышленные персонажи и миры, общие вопросы о героях книг, фильмов и игр.'),
 'everyday':('Разное','Повседневная жизнь, реклама, бренды, логотипы, общие знания, необычные факты.')}
RULES={
 'anime':r'аниме|анима?\b|манг[аи]|опенинг|эндинг|шикимори|анимэ|покемон',
 'animation':r'мульт|дисней|disney|pixar', 'cinema':r'фильм|сериал|кино|акт[её]р|netflix|нетфликс',
 'games':r'игр[ауыо]|steam|стим[а-я]*|геймер|nintendo|протагонист|minecraft',
 'music':r'музык|песн|исполнител|трек|\bost\b|\bост\b|мешап|mashup|covers|кавер|караоке|рок\b',
 'geography':r'географ|стран|столиц|город|рек[аи]|водопад|материк|оз[её]р|океан|моря|остров|флаг|достопримеч|вулкан|антарктид|штат',
 'history':r'истори|миф|войн|правител|религи|древн|битв',
 'science':r'наук|космос|астроном|планет|хими|физик|биолог|математ|алгебр|геометр|формул',
 'technology':r'техно|гаджет|изобрет|устройств|компьютер|автомоб|технолог',
 'language':r'язык|слов|перевод|шарад|ребус|поговор|пропуск|аббревиат|значени|латын|ударени',
 'literature':r'книг|литератур|писател|поэзи|стих|сказк', 'food':r'кофе|еда\b|блюд|кухн|продукт|припра|напит|хлеб|съедоб|алкогол',
 'nature':r'животн|растен|цветоч|цвет[ыо]|собак|кошк|котик|кошач|фауна|пород|птиц',
 'art':r'искусств|картин|художник|архитект|живопис', 'internet':r'мем|тикток|тики-ток|youtube|ютуб|интернет|блогер|двач|twitch|стрим',
 'sport':r'спорт|футбол|хокке|баскет|олимпи', 'people':r'личност|знаменит|професси|псевдоним|кем работает|кто такой'}

local=lambda n:n.tag.rsplit('}',1)[-1]
children=lambda n,tag:[e for e in n if local(e)==tag] if n is not None else []
child=lambda n,tag:next(iter(children(n,tag)),None)
text=lambda n:''.join(n.itertext()) if n is not None else ''
dump=lambda v:json.dumps(v,ensure_ascii=False,separators=(',',':'))
sha=lambda v:hashlib.sha256(v.encode('utf-8') if isinstance(v,str) else v).hexdigest()
norm=lambda v:re.sub(r'[^a-zа-я0-9]+','',v.casefold().replace('ё','е'))


def info(node):
    node=child(node,'info')
    return {'authors':[text(e) for e in children(child(node,'authors'),'author')],
            'sources':[text(e) for e in children(child(node,'sources'),'source')],
            'comments':text(child(node,'comments')),'host_comments':text(child(node,'showmanComments'))}


def atoms_for(question):
    atoms=[]
    scenario=child(question,'scenario')
    if scenario is not None:
        phase='question'
        for atom in scenario:
            kind=atom.get('type','text')
            if kind=='marker':phase='answer'
            atoms.append({'phase':phase,'type':kind,'text':text(atom),'attrs':dict(atom.attrib)})
    else:
        params=child(question,'params')
        for parameter in children(params,'param'):
            name=parameter.get('name','')
            phase='question' if name=='question' else 'answer' if name=='answer' else name
            if parameter.get('type')=='content':
                for atom in parameter.iter():
                    if local(atom)=='item':atoms.append({'phase':phase,'type':atom.get('type','text'),'text':text(atom),'attrs':dict(atom.attrib)})
            elif name in ('question','answer') and text(parameter).strip():
                atoms.append({'phase':phase,'type':'text','text':text(parameter),'attrs':dict(parameter.attrib)})
            elif name=='answerOptions':
                for option in children(parameter,'param'):
                    label=option.get('name','')
                    for atom in option.iter():
                        if local(atom)=='item':
                            kind=atom.get('type','text')
                            atoms.append({'phase':'question','type':kind,
                                'text':(label+') ' if kind=='text' else '')+text(atom),
                                'attrs':dict(atom.attrib, option=label)})
    return atoms


def answer_options(question):
    """SIQ5 select answers store option keys in <right>, not the displayed text."""
    params=child(question,'params')
    group=next((p for p in children(params,'param') if p.get('name')=='answerOptions'),None)
    return {p.get('name'): ' '.join(text(a).strip() for a in p.iter() if local(a)=='item' and a.get('type','text')=='text').strip()
            for p in children(group,'param')}


def guess_format(theme,prompt,media):
    s=(theme+' '+prompt).casefold()
    for key,pattern in [('rebus',r'ребус|шарад'),('wordplay',r'два значения|двойн|поговор|значение.*слова'),
                        ('clues',r'тр[её]м подсказ|по описани|по одному предложени|ии описание|глубокий сюжет'),
                        ('true_false',r'правда|да или нет|50/50'),('enumeration',r'назовите (?:любые )?\d|назови \d'),
                        ('continuation',r'что будет дальше|что они скажут|заполни|пропуск')]:
        if re.search(pattern,s):return key
    kinds={m['type'] for m in media if m['phase']=='question'}
    return 'video' if 'video' in kinds else 'audio' if 'audio' in kinds else 'image' if 'image' in kinds else 'quiz'


def media_reference(atom,inventory):
    value=atom['text'].strip()
    # SIQ4 calls audio atoms "voice". Preserve the source atom verbatim, but
    # normalize its playback type so audio is indexed and shown in the editor.
    kind={'voice':'audio'}.get(atom['type'],atom['type'])
    suffix=Path(urlsplit(value).path).suffix.casefold()
    if kind=='text' and re.fullmatch(r'https?://\S+',value):
        mime=mimetypes.guess_type(urlsplit(value).path)[0] or ''
        if mime.startswith(('image/','audio/','video/')):kind=mime.split('/')[0]
    if kind not in ('image','audio','video'):return None
    if value.startswith(('http://','https://')):
        return dict(phase=atom['phase'],type=kind,reference=value,asset_id=None,external_url=value,status='external_unchecked')
    name=unquote(value.lstrip('@')).replace('\\','/').lstrip('/')
    folder={'image':'Images','audio':'Audio','video':'Video'}[kind]
    candidates=[name,folder+'/'+name]
    asset=next((inventory.get(candidate.casefold()) for candidate in candidates if inventory.get(candidate.casefold())),None)
    return dict(phase=atom['phase'],type=kind,reference=value,asset_id=asset['id'] if asset else None,
                external_url=None,status='local' if asset else 'local_missing')


def insert(connection,table,row):
    connection.execute(f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})",list(row.values()))


def import_pack(db,source):
    path=REPO/source['archive_path']
    with path.open('rb') as source_file:
        assert hashlib.file_digest(source_file,'sha256').hexdigest()==source['sha256']
    records=[]
    with zipfile.ZipFile(path) as archive:
        xml_name=next(n for n in archive.namelist() if n.casefold()=='content.xml')
        raw=archive.read(xml_name)
        root=ET.fromstring(raw)
        package_info=info(root)
        insert(db,'packs',dict(id=source['id'],title=source['title'],package_name=root.get('name'),package_id=root.get('id'),
            version=root.get('version'),date=root.get('date'),authors_json=dump(package_info['authors']),source_url=source['page_url'],
            archive_path=source['archive_path'],archive_sha256=source['sha256'],bytes=source['bytes'],raw_xml=raw))
        inventory={}
        for entry in archive.infolist():
            if entry.is_dir() or entry.filename.casefold()==xml_name.casefold():continue
            mime=mimetypes.guess_type(entry.filename)[0] or 'application/octet-stream'
            asset=dict(id=f"{source['id']}:{sha(entry.filename)[:20]}",pack_id=source['id'],entry_name=entry.filename,
                       mime=mime,bytes=entry.file_size,sha256=sha(archive.read(entry)))
            inventory[entry.filename.casefold()]=asset
            inventory[unquote(entry.filename).casefold()]=asset
            insert(db,'assets',asset)
        for ri,round_ in enumerate(children(child(root,'rounds'),'round'),1):
            rid=f"{source['id']}:{source['sha256'][:12]}:r{ri}"
            insert(db,'rounds',dict(id=rid,pack_id=source['id'],ordinal=ri,name=round_.get('name',''),type=round_.get('type','standard')))
            prices=sorted({int(q.get('price','0')) for q in round_.iter() if local(q)=='question' and q.get('price','').isdigit() and int(q.get('price'))>0})
            for ti,theme in enumerate(children(child(round_,'themes'),'theme'),1):
                tid=f'{rid}:t{ti}'
                theme_name=theme.get('name','')
                insert(db,'themes',dict(id=tid,round_id=rid,ordinal=ti,name=theme_name))
                for qi,question in enumerate(children(child(theme,'questions'),'question'),1):
                    qid=f'{tid}:q{qi}'
                    atoms=atoms_for(question)
                    media=[dict(m,ordinal=i) for i,a in enumerate(atoms) if (m:=media_reference(a,inventory))]
                    prompt_parts=[a['text'] for a in atoms if a['phase']=='question' and a['type']=='text' and not media_reference(a,inventory)]
                    prompt=' '.join(prompt_parts).strip()
                    right=[text(a).strip() for a in children(child(question,'right'),'answer') if text(a).strip()]
                    wrong=[text(a).strip() for a in children(child(question,'wrong'),'answer') if text(a).strip()]
                    options=answer_options(question)
                    if options:
                        right=[options.get(a) or a for a in right]
                        wrong=[options.get(a) or a for a in wrong]
                    price=int(question.get('price','0')) if question.get('price','').isdigit() else None
                    difficulty=1+round(4*prices.index(price)/max(1,len(prices)-1)) if price in prices and len(prices)>1 else None
                    flags=[]
                    input_media=[m for m in media if m['phase']=='question']
                    if not prompt:flags.append('no_question_text')
                    if not right:flags.append('no_text_answer')
                    if options and any(not value for value in options.values()):flags.append('media_answer_options_require_review')
                    if any(m['status']=='local_missing' for m in media):flags.append('missing_local_media')
                    if any(m['status']=='external_unchecked' for m in media):flags.append('external_media_unchecked')
                    if input_media:flags.append('media_not_interpreted')
                    mature=int(bool(re.search(r'18\+|порно|хентай|эротик|пизд|ебан|ебат|хуй|хуя|бляд|секс|фаллос|пенис|генитал|вагин',theme_name+' '+prompt,re.I)))
                    if mature:flags.append('explicit_content_hint')
                    if right and len(norm(right[0]))>=5 and norm(right[0]) in norm(prompt):flags.append('answer_may_be_in_prompt')
                    input_keys=[inventory_entry['sha256'] if (inventory_entry:=next((a for a in inventory.values() if a['id']==m['asset_id']),None)) else m['reference'] for m in input_media]
                    fingerprint=sha(dump([norm(prompt),sorted(norm(a) for a in right),input_keys]))
                    if not prompt and not media and not right:fingerprint=sha(qid)
                    raw_question=ET.tostring(question,encoding='unicode')
                    q=dict(id=qid,pack_id=source['id'],theme_id=tid,ordinal=qi,price=price,prompt=prompt,answer_text='; '.join(right),
                        answer_key=norm(right[0]) if right else '',raw_xml=raw_question,raw_sha256=sha(raw_question),atoms_json=dump(atoms),
                        source_info_json=dump({'package':package_info,'round':info(round_),'theme':info(theme),'question':info(question)}),
                        format=guess_format(theme_name,prompt,media),difficulty=difficulty,difficulty_basis='price_rank_within_round_unvalidated',
                        text_only=int(bool(prompt and right and not input_media)),mature_hint=mature,flags_json=dump(flags),content_fingerprint=fingerprint)
                    insert(db,'questions',q)
                    for correct,answers in [(1,right),(0,wrong)]:
                        for ai,answer in enumerate(answers,1):insert(db,'answers',dict(question_id=qid,ordinal=ai,text=answer,is_correct=correct))
                    for m in media:insert(db,'question_media',dict(id=f"{qid}:m{m['ordinal']}",question_id=qid,**m))
                    records.append(dict(q,theme=theme_name,round=round_.get('name','')))
    assert len(records)==source['expected_questions'],(source['id'],len(records),source['expected_questions'])
    print(f"Imported {source['id']}: {len(records)} questions",flush=True)
    return records


def build():
    sources=json.loads((DATA/'sources.json').read_text(encoding='utf-8'))['sources']
    assert all(p['status']=='downloaded' for p in sources)
    temporary=DB.with_suffix('.building.sqlite3')
    if temporary.exists():temporary.unlink()
    db=sqlite3.connect(temporary)
    db.executescript(Path(__file__).with_name('schema.sql').read_text(encoding='utf-8'))
    records=[]
    for source in sources:records.extend(import_pack(db,source))
    encoder=Encoder()
    documents=[q['theme']+'\nОтвет: '+q['answer_text'][:350]+'\n'+q['prompt'][:1400] for q in records]
    cache={}
    if DB.exists():
        with sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True) as previous:
            revision=previous.execute("SELECT value FROM metadata WHERE key='model_revision'").fetchone()
            if revision and json.loads(revision[0])==REVISION:
                for qid,theme,answer,prompt,vector in previous.execute('SELECT q.id,t.name,q.answer_text,q.prompt,e.vector FROM questions q JOIN themes t ON t.id=q.theme_id JOIN embeddings e ON e.question_id=q.id WHERE e.model_id=?',(MODEL_ID,)):
                    old_document=theme+'\nОтвет: '+answer[:350]+'\n'+prompt[:1400]
                    cache[qid]=(sha(old_document),encoder.np.frombuffer(vector,dtype=encoder.np.float32))
        previous.close()
    missing=[i for i,q in enumerate(records) if q['id'] not in cache or cache[q['id']][0]!=sha(documents[i])]
    computed=encoder.encode([documents[i] for i in missing],progress=True)
    new_vectors={i:computed[j] for j,i in enumerate(missing)}
    vectors=encoder.np.stack([new_vectors[i] if i in new_vectors else cache[q['id']][1] for i,q in enumerate(records)])
    print(f'Embedding cache reused: {len(records)-len(missing)}/{len(records)}',flush=True)
    for slug,(label,description) in TOPICS.items():insert(db,'topics',dict(slug=slug,label=label,description=description))
    groups=defaultdict(list)
    for i,q in enumerate(records):
        groups[q['content_fingerprint']].append(q['id'])
        chosen=classify(q,RULES)
        for slug,(score,basis) in chosen.items():insert(db,'question_topics',dict(question_id=q['id'],topic_slug=slug,score=score,basis=basis))
        insert(db,'embeddings',dict(question_id=q['id'],model_id=MODEL_ID,dimension=vectors.shape[1],vector=vectors[i].tobytes()))
        db.execute('INSERT INTO question_fts VALUES (?,?,?,?,?)',(q['id'],q['prompt'],q['answer_text'],q['theme'],' '.join(TOPICS[s][0] for s in chosen)))
    duplicates=0
    for fingerprint,ids in groups.items():
        if len(ids)>1:
            duplicates+=len(ids)-1
            db.executemany('UPDATE questions SET duplicate_group=? WHERE id=?',[(fingerprint,qid) for qid in ids])
            for qid in ids:
                for other in ids:
                    if other!=qid:insert(db,'question_links',dict(question_id=qid,related_id=other,kind='exact_duplicate',score=1.0))
    similarities=vectors@vectors.T
    for i,q in enumerate(records):
        for j in similarities[i].argsort()[-7:][::-1]:
            if i==j or similarities[i,j]<.55:continue
            other=records[j]
            kind='possible_duplicate' if q['answer_key'] and q['answer_key']==other['answer_key'] and len(q['prompt'])>30 and q['text_only'] and other['text_only'] and similarities[i,j]>.9 else 'similar'
            insert(db,'question_links',dict(question_id=q['id'],related_id=other['id'],kind=kind,score=float(similarities[i,j])))
    adapted=json.loads((REPO/'qa/svoyak-pilot-2026-10-21/adapted-pack.json').read_text(encoding='utf-8'))
    for theme in adapted['themes']:
        for q in theme['questions']:
            p=q['provenance']
            original=next(r for r in records if r['pack_id']==p['pack_id'] and r['theme']==p['theme'] and r['ordinal']==p['question_index'] and r['round']==p['round'])
            insert(db,'adaptations',dict(id=q['id'],original_id=original['id'],prompt=q['question'],answer=q['answer'],changes=q['adaptation'],data_json=dump(q)))
    report={'built_at':datetime.now(timezone.utc).isoformat(),'packs':len(sources),'questions':len(records),
            'rounds':db.execute('SELECT count(*) FROM rounds').fetchone()[0],
            'themes':db.execute('SELECT count(*) FROM themes').fetchone()[0],
            'assets':db.execute('SELECT count(*) FROM assets').fetchone()[0],
            'question_media':dict(db.execute('SELECT status,count(*) FROM question_media GROUP BY status')),
            'text_only_questions':sum(q['text_only'] for q in records),'adaptations':15,
            'exact_duplicate_excess':duplicates,'embedding_model':MODEL_ID,'model_revision':REVISION,
            'difficulty_calibrated':False,'factual_review':'not_performed','media_semantics_review':'not_performed',
            'classification':'theme_context_and_text_rules_unreviewed','rights_status':'unknown',
            'schema_version':2,'parser_version':'siq-choices-voice-3',
            'all_archives_sha256_verified':True,'all_question_counts_match_sources':True}
    for k,v in report.items():insert(db,'metadata',dict(key=k,value=dump(v)))
    db.commit()
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert db.execute('SELECT count(*) FROM question_fts').fetchone()[0]==len(records)
    db.close()
    temporary.replace(DB)
    (DATA/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    build()
