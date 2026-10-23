"""Contextual media audit. Observations and uncertainty never become human approval."""
from collections import Counter,defaultdict
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

from editorial import dump,now
from media_pipeline import ROOT,ANALYSIS,source_rows
from semantic import REPO

REASONS={
    'conflict':'Расхождение с ключом', 'spoiler':'Спойлер или неверная граница условия',
    'task':'Не хватает условия или ключа', 'unavailable':'Исходный файл недоступен',
    'audio':'Звуковой ключ требует прослушивания', 'identity':'Нужен источник атрибуции человека / голоса',
    'scope':'Неоднозначный зачёт', 'source':'Нужен первоисточник',
    'visual':'Неоднозначная визуальная отсылка', 'stale':'Вопрос или файл изменился',
    'editorial':'Замечание редактора'}

# All 140 observation groups were read in full with question/answer context.
# These are visual relationships, not confirmation of every fact in a text question.
VISUAL_GROUPS=set(range(140))-{9,18,28,36,54,57,81,101,117,124,126,132}


INPUT_HASHES={'semantic-proposed_match-notes.json': 'fbb8f3e164c50c1994c80e3bd32d23b54ae698bdabf9e6a258c489c5036de0df', 'semantic-visually_reviewed_uncertain-notes.json': 'fdad0435c1718392eba3d8ddedc62147ab1f3ac2b70d0b0ed488298a94035596', 'research-input.json': '2689036f3605afee6d13d4be0b6e81afb445370c8e77a3a772aff9d2571a27ae'}
LEDGER_HASH='a8620c07c6ed6c996dc973c07c7697309377ffc784bf739c5b54666af1aa79bf'

def verify_inputs(root=ROOT,ledger_path=None):
    ledger_path=ledger_path or Path(__file__).with_name('media-visual-decisions.json')
    for name,expected in INPUT_HASHES.items():
        if hashlib.sha256((root/name).read_bytes()).hexdigest()!=expected:raise ValueError('Audit context changed; a new contextual review is required: '+name)
    if hashlib.sha256(ledger_path.read_bytes()).hexdigest()!=LEDGER_HASH:raise ValueError('Visual observation ledger changed; review the audit bindings')


def effective(item):
    value=dict(item.get('assessment',{}).get('semantic') or {})
    if item['decision']['status']=='approved':
        actor=item['decision'].get('actor','')
        method='agent_editorial_decision' if actor.startswith('Codex') else 'human_decision'
        return dict(status='consistent',reasons=[],priority=9,note='Проверено и принято редактором: '+actor,method=method,review_required=False)
    if not item['decision'].get('stale') and (item['decision']['status'] in ('rework','rejected') or 'fail' in item['decision'].get('checks',{}).values()):
        return dict(status='needs_review',reasons=['editorial'],priority=1,note=item['decision'].get('note') or 'Редактор отметил проблему и вернул файл на проверку.',method='human_rework',review_required=True)
    if item.get('assessment',{}).get('stale') or not value:
        return dict(status='needs_review',reasons=['stale'],priority=1,note='Нет актуального смыслового заключения для этой версии.',method='not_reviewed',review_required=True)
    value['review_required']=value['status']!='consistent'
    return value


def question_result(media):
    values=[m['semantic'] for m in media]
    statuses={v['status'] for v in values}
    status='conflict' if 'conflict' in statuses else 'unavailable' if 'unavailable' in statuses else 'needs_review' if statuses!={'consistent'} else 'consistent'
    return dict(status=status,review_required=status!='consistent',priority=min((v['priority'] for v in values if v['review_required']),default=9),
                reasons=list(dict.fromkeys(r for v in values if v['review_required'] for r in v['reasons'])))


def inspect(library):
    from runtime import BASE
    verify_inputs()
    groups=json.loads((ROOT/'semantic-proposed_match-notes.json').read_text(encoding='utf-8'))
    uncertain=json.loads((ROOT/'semantic-visually_reviewed_uncertain-notes.json').read_text(encoding='utf-8'))
    allowed={mid for i,g in enumerate(groups) if i in VISUAL_GROUPS for mid in g['ids']}
    visual=json.loads(Path(__file__).with_name('media-visual-decisions.json').read_text(encoding='utf-8'))
    # Reviewed again at full size / on an annotated copy of the exact map.
    overrides={}
    def override(mid,note,method='visual_context_review',**extra):
        overrides[mid]=dict(status='consistent',reasons=[],priority=9,note=note,method=method,**extra)
    for mid in uncertain[113]['ids']:
        override(mid,'Точка авторского ответа нанесена на исходную карту и сопоставлена с названным объектом: расположение согласуется. Проверен именно этот растр, координаты не менялись.','map_point_review')
    for mid in uncertain[114]['ids']:
        override(mid,'Цветовой образец согласуется с ключом и текстовой подсказкой. Подсказки различают фуксию и мадженту; точное совпадение с калиброванным цветовым стандартом не требуется. Этимология текста этим выводом не проверяется.','color_and_clue_review')
    for i in (0,1,2,3,5):
        mid=uncertain[78]['ids'][i]
        features=['металлический шарик в наконечнике','выступающие сосочки языка','снежный кристалл и песчинки в паре','крючки и петли застёжки','тело с четырьмя парами коротких ног и коготками'][[0,1,2,3,5].index(i)]
        override(mid,'В полном изображении различимы '+features+'. Это согласуется с широким предметным ключом; точные вид животного, масштаб и материал не утверждаются.')
    override(uncertain[86]['ids'][1],'Красным выделен контур Румынии, остальные страны зелёные. Авторский шуточный принцип карты буквально согласуется с изображением.','decoded_visual_joke')
    override(uncertain[11]['ids'][0],'СИГНА: перестановка 3-й и 4-й букв даёт СИНГА. ПУР — первые три буквы «пурпурный». СИНГА + ПУР = СИНГАПУР. Личность человека не использовалась.','decoded_rebus')
    override(uncertain[23]['ids'][0],'Э + перевёрнутый ЛЕВ без последней буквы (ВЕ) + ТЕСТ с заменой первой буквы на Р (РЕСТ) = ЭВЕРЕСТ.','decoded_rebus')
    for mid in uncertain[103]['ids']:
        override(mid,'Авторское вычисление: 20 пальцев Сукуны + 91 Days + Zero Two (2) + 5 сантиметров в секунду + 9 разумных титанов из подсказки = 127. Число титанов задано трактовкой подсказки; без неё ребус был бы неоднозначен.','decoded_rebus',
                 evidence=[dict(url='https://www.bandai.com/amfile/file/download/file/206/product/1276664/',note='Официальная инструкция лицензированной игры: 20 пальцев Сукуны.'),dict(url='https://darli-fra.jp/character/',note='Официальная карточка Zero Two: Code 002.'),dict(url='https://www.shinkaiworks.com/news/post-4078.html',note='Официальный портал автора: название 秒速5センチメートル.')])
    av={r['mid']:r for r in json.loads((ROOT/'semantic-av-input.json').read_text(encoding='utf-8'))}
    refs=defaultdict(list)
    for r in source_rows():refs[r['question_id']].append(r)
    with library.connect() as db:rows=[library.editorial.apply(dict(r),library.editorial.all_reviews()) for r in db.execute(BASE+' ORDER BY q.pack_id,r.ordinal,t.ordinal,q.ordinal')]
    output=[];questions=[]
    for q in rows:
        if q['id'] not in refs:continue
        media=library.media.resolve(refs[q['id']],q,True)
        for m in media:
            issues=set(m['issues']);a=m['assessment'];f=m['file']
            result=dict(status='needs_review',reasons=[],priority=2,method='context_review',note=a.get('note','Соответствие не установлено.'),evidence=a.get('evidence',[]),human_listened=False)
            if not f:result.update(status='unavailable',reasons=['unavailable'],priority=1,note='Содержимое недоступно: HTTP 404 исходного хранилища. Соответствие не проверено.')
            elif not q['answer_text'].strip() or not q['prompt'].strip():result.update(reasons=['task'],priority=0,note='Не задан явный вопрос или текстовый ключ. По одному медиа нельзя определить, что именно засчитывать.')
            elif 'mismatch' in issues:result.update(status='conflict',reasons=['conflict'],priority=0)
            elif m['id'] in overrides and visual.get(m['id'],{}).get('sha256')==f['sha256']:result.update(overrides[m['id']])
            elif m['type']=='audio' or m['type']=='video' and f['analysis'].get('has_audio'):
                result.update(reasons=['audio'],priority=1,method='full_transcript_and_context_review')
                if 'identity_not_verified' in issues or 'имитирует ИИ' in q['prompt']:result['reasons'].append('identity')
                if 'silent_audio' in issues:result['note']='Весь звуковой сигнал — цифровая тишина. Видеокадры доступны; требуется проверить авторскую задумку и произведение, нормализация сигнал не восстановит.'
                elif m['type']=='audio':
                    result['note']=audio_note(q,m,av.get(m['id'],{}))
                else:result['note']=a.get('note','')+' Полная расшифровка сопоставлена с ключом; звук и быстрые промежуточные кадры этим не подтверждены.'
                t=f.get('transcript') or {};second=ANALYSIS/f['sha256']/'semantic-transcript.json'
                result['transcript_reviewed']=bool(t);result['second_asr_available']=second.exists()
                if second.exists():result['second_asr_reviewed']=True
                result['asr_key_support']=asr_support(q['answer_text'],t.get('text',''),json.loads(second.read_text(encoding='utf-8')).get('text','') if second.exists() else '')
            elif 'identity_not_verified' in issues:result.update(reasons=['identity'],priority=1)
            elif 'answer_scope' in issues:result.update(reasons=['scope'])
            elif 'semantic_uncertain' in issues or m['id'] not in allowed:result.update(reasons=['source' if 'источник' in result['note'] or 'подтвержд' in result['note'] else 'visual'])
            elif m['id'] in visual and visual[m['id']]['sha256']==f['sha256']:
                result.update(status='consistent',reasons=[],priority=9,method='observed_visual_relation',note=a['note'])
            if 'possible_spoiler' in issues:
                result.update(status='needs_review',priority=0);result['reasons']=list(dict.fromkeys(['spoiler']+result['reasons']))
                result['note']=a['note']+' Проверить границу условия / подпись до выдачи ответа.'
            if q['id']=='15161:e7239409ce9c:r2:t3:q3':
                result.update(status='conflict',reasons=['scope'],priority=0,note='Формулировка требует смешанные треки, а ключ содержит только NILETTO — «Любимка». Второй компонент mashup не задан. Нужен полный ключ либо вопрос только об одной составляющей.')
            if q['id']=='25388:1ad198d73de1:r2:t5:q3':
                result.update(status='needs_review',reasons=['scope','source'],priority=1,note='На показанном интро написано ZIROBAZ PLAY, ключ — «Куплинов». Нужно уточнить, спрашивается канал из кадра или оригинал пародии; это разные правила зачёта.')
            result['review_required']=result['status']!='consistent';result['checked_at']=now();result['signature']=m['signature']
            result['source_sha256']=f['sha256'] if f else None
            result['observed_media']=dict(sha256=f['sha256'],url=f['url'],phase=m['phase'],type=m['type'],control_frame_times=[p['time'] for p in f['analysis'].get('previews',[])]) if f else None
            result['scope']='Связь данного медиа с условием и ключом; исторические, медицинские и прочие утверждения текста отдельно не удостоверяются.'
            item=dict(media_id=m['id'],question_id=q['id'],signature=m['signature'],semantic=result)
            output.append(item);m['semantic']=result
        qr=question_result(media)
        questions.append(dict(id=q['id'],pack=q['pack_title'],theme=q['theme_name'],prompt=q['prompt'],answer=q['answer_text'],semantic=qr,
                              url='media.html?filter=semantic_review&question='+q['id'],media=[r for r in output if r['question_id']==q['id']]))
    if len(output)!=len(source_rows()):raise ValueError('Incomplete semantic audit coverage')
    with library.editorial.connect() as db:
        for item in output:
            old=db.execute('SELECT * FROM media_assessments WHERE media_id=?',(item['media_id'],)).fetchone()
            if not old or old['signature']!=item['signature']:raise ValueError('Media changed during audit; rerun with fresh input')
            a=json.loads(old['assessment_json']);a['semantic']=item['semantic']
            db.execute('UPDATE media_assessments SET assessment_json=?,updated_at=? WHERE media_id=?',(dump(a),now(),item['media_id']))
    report=dict(checked_at=now(),audit_complete=True,all_media_semantically_confirmed=False,questions=len(questions),references=len(output),
                reference_statuses=dict(Counter(r['semantic']['status'] for r in output)),question_statuses=dict(Counter(q['semantic']['status'] for q in questions)),
                question_reasons=dict(Counter(reason for q in questions for reason in q['semantic']['reasons'])),human_listened=False,reason_labels=REASONS,
                note='Все ссылки получили заключение; audit_complete означает полный охват, а не подтверждение спорных ключей. Человеческие решения не менялись.')
    folder=ROOT/'semantic-audit'/uuid.uuid4().hex;folder.mkdir(parents=True)
    for name,data in [('report.json',report),('results.json',output),('questions.json',questions)]:
        (folder/name).write_text(dump(data),encoding='utf-8')
    qa=REPO/'qa/svoyak-pilot-2026-10-21'
    (qa/'media-semantic-review.json').write_text(dump(dict(report=report,questions=questions)),encoding='utf-8')
    queue=sorted((q for q in questions if q['semantic']['review_required']),key=lambda q:q['semantic']['priority'])
    (qa/'media-semantic-queue.json').write_text(dump(dict(report=report,questions=queue)),encoding='utf-8')
    (ROOT/'semantic-audit/latest.json').write_text(dump(dict(path=str(folder.relative_to(REPO)),**report)),encoding='utf-8')
    print(dump(report),flush=True)
    return folder,questions


def asr_support(key,*texts):
    import re
    words=re.findall(r'[a-zа-яё0-9]+',key.casefold())
    hits=[]
    for i,text in enumerate(texts):
        tokens=set(re.findall(r'[a-zа-яё0-9]+',text.casefold()))
        overlap=[w for w in words if len(w)>2 and w in tokens]
        if overlap:hits.append(dict(transcript='base' if i==0 else 'small',key_words=overlap))
    return dict(hits=hits,note='Совпадение слов — подсказка; не доказательство атрибуции, качества записи или отсутствия спойлера.')


def audio_note(q,m,av):
    theme=q['theme_name'].casefold();key=q['answer_text'];text=av.get('transcript') or ''
    if 'имитирует ИИ' in q['prompt']:return 'Проверен полный текст ASR. Узнаваемые слова песни не доказывают, чей голос имитируется. Нужны подпись автора кавера / первоисточник; выдавать запись за реальное исполнение нельзя.'
    if '8 бит' in theme:return '8-битная мелодия: текстового материала для идентификации нет. Для ключа «'+key+'» нужно сравнить мелодию с эталоном. Обработку сохранять как условие задания.'
    if 'спорт на слух' in theme or 'коровка' in theme:return 'Ключ «'+key+'» относится к неречевому звуку. Пустая или случайная ASR-фраза вид спорта / животное не подтверждает. Нужны прослушивание и проверка однозначности среди близких звуков.'
    if 'mashup' in theme:return 'Полная расшифровка может отражать лишь вокальную составляющую. Для mashup нужно подтвердить оба компонента, включая инструментальную основу; ключ «'+key+'» пока не подтверждён целиком.'
    if 'перемотка' in theme:return 'Опенинг дан в изменённой / обратной форме. Проверен полный ASR, но он не устанавливает произведение. Сравнить с официальным опенингом; изменение воспроизведения является частью задания.'
    if 'bardcore' in theme or '♂' in theme:return 'Пародийная аранжировка / вокальные вставки намеренны. Полный ASR не устанавливает исходную мелодию «'+key+'». Требуется музыкальное сравнение; пошлость и авторский стиль сохранены.'
    if not text.strip():return 'Полная ASR-расшифровка не дала слов. Это не отсутствие звука и не ошибка ключа: произведение «'+key+'» по имеющимся данным не атрибутировано.'
    return 'Полная расшифровка сопоставлена с условием и ключом «'+key+'». Текстовые зацепки сохранены, но по одной ASR нельзя подтвердить точную запись, исполнительский кредит, инструментальную основу либо обработку.'


def pin(folder,questions):
    cards=json.loads((ROOT/'research-input.json').read_text(encoding='utf-8'))
    (folder/'input.json').write_text(dump(cards),encoding='utf-8')
    subprocess.run(['node','scripts/factcheck/run.mjs','--source=input','--input='+str(folder/'input.json'),'--mode=custom','--fields=media','--research=all','--ai=never','--output='+str(folder/'run')],cwd=REPO,check=True,capture_output=True)
    tasks=[line for line in (folder/'run/research-queue.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    if len(tasks)!=len(questions):raise ValueError('Incomplete research dispositions')
    (folder/'research-disposition.jsonl').write_text('\n'.join(dump(dict(question_id=q['id'],status='pass' if not q['semantic']['review_required'] else 'uncertain',scope='media_relationship_only',reason=q['semantic'],evidence=q['media'])) for q in questions)+'\n',encoding='utf-8')
    (folder/'coverage.json').write_text(dump(dict(questions=len(questions),research_tasks=len(tasks),explicit_dispositions=len(questions),input_sha256=hashlib.sha256((folder/'input.json').read_bytes()).hexdigest(),human_listened=False)),encoding='utf-8')


if __name__=='__main__':
    from runtime import Library
    folder,questions=inspect(Library());pin(folder,questions)
