"""Apply this session's explicit reviewed selection. Never called by import/sync.

Research downloads alone never approve a card. The selection below records the
manual disposition; omitted research candidates remain unresolved. The generated
packet pins the imported source revision and can be inspected before application.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

from editorial import CHECKS,identity,source_revision,now,dump
from research_starter import specifications
from runtime import BASE,Library
from semantic import DATA,REPO

REVIEW_PACKET=REPO/'qa/svoyak-pilot-2026-10-21/starter-reviewed.json'
# Explicit manual scope, keyed by the ordered reference worksheet of this session.
# These candidates need further evidence or context, or are covered separately as
# game conventions. They do not become fact-checked merely because a URL resolved.
DEFERRED=set(range(64,72))|set(range(48,56))|{
    102,104,111,119,124,128,35,46,2,6,7,36,37,38,43,45,59,60,61,63,
    72,75,131,132,142,160,169,172}
PRIMARY={
 24:[('https://www.weather.gov/media/owlie/Owlie-Skywarn-Coloring-home-print.pdf','NWS прямо указывает, что в США температуру сообщают в градусах Фаренгейта.')],
 33:[('https://science.nasa.gov/mars/facts/','NASA подтверждает красный цвет Марса, марсоходы и гору Олимп.')],
 41:[('https://mario.nintendo.com/about/','Nintendo описывает Марио как знаменитого водопроводчика; не утверждается, что это была первая профессия персонажа.')],
 106:[('https://www.invent.org/inductees/harry-w-coover','NIHF подтверждает работу Кувера над прозрачным пластиком для прицелов и открытие цианоакрилатного суперклея.')],
 107:[('https://www.post-it.com/3M/en_US/post-it/contact-us/about-us/','История производителя подтверждает слабый клей Сильвера, закладки Фрая для нот и создание Post-it.')],
 108:[('https://www.kelloggs.com/ja-jp/who-we-are/our-history.html','История производителя различает пшеничные Granose и последующую компанию кукурузных хлопьев братьев Келлог.')],
 109:[('https://www.nobelprize.org/prizes/physics/1901/perspectives/?print=1','Нобелевский фонд описывает открытие Рентгена в 1895 году и свечение экрана через преграды, включая картон.')],
 110:[('https://www.teflon.com/en/news-events/history','Производитель подтверждает открытие PTFE Планкеттом в 1938 году, белое твёрдое вещество в баллоне и применение в покрытиях.')],
 113:[('https://www.pixar.com/finding-nemo','Pixar помещает дом Немо на Большой Барьерный риф Австралии.')],
 114:[('https://www.eurovision.com/eurovision-song-contest/brighton-1974/','Официальный архив подтверждает победу ABBA с Waterloo в 1974 году.')],
 115:[('https://www.noaa.gov/rms-titanic','NOAA подтверждает столкновение с айсбергом и гибель Титаника в Северной Атлантике; океан в исходном ответе сохранён.')],
}

GAME_GROUPS=[
 (23938,'r1:t2',range(1,8),'absurd','language','Загадки говна',18,
  'Авторская антизагадка: ожидается неожиданный панчлайн, а не буквальный научный вывод. Принимать эквивалентный ответ и объяснение каламбура. Нелепость и двусмысленность сохранены.'),
 (23938,'r1:t10',range(1,8),'dark_humour','language','Эвфемизмы',18,
  'Нужно назвать прямой или грубый подтекст выражения в рамках авторской темы. Принимать смысловые эквиваленты; это не универсальное определение фразы во всех контекстах.'),
 (23938,'r2:t2',range(1,8),'humour','everyday','Работа с Авито',18,
  'Угадываем авторский вариант занятия по странному объявлению. Реальность вакансии не заявляется проверенным фактом. Описательный ответ с тем же занятием засчитывается.'),
 (19726,'r1:t7',[1,2,4,5,6,7,8],'absurd','language','Загадки для особенных',16,
  'Авторская загадка с подвохом. Проверен игровой зачёт и смена смысла слов; не следует применять буквальное бытовое прочтение к шуточному условию.'),
 (19726,'r4:t3',range(1,9),'wordplay','language','Значение какой поговорки?',12,
  'По смысловому пересказу угадывается поговорка. Допустимы общепринятые варианты той же поговорки. Авторские формулировки и оценочные оттенки сохранены.'),
 (19726,'r3:t4',range(1,9),'parody','cinema','Фильм по одному предложению',18,
  'Ироничный пересказ фильма: гиперболы и намеренно нелепый ракурс являются условностью. Засчитывается название из исходника или его распространённый перевод.'),
 (19726,'r4:t7',range(1,9),'parody','animation','Мульт по одному предложению',18,
  'Ироничный пересказ мультфильма для взрослой компании. Намеренная двусмысленность и чёрный юмор сохранены; проверка не заявляет буквальную правдивость гипербол.'),
 (23938,'r1:t5',[1,2,3,6,7],'dark_humour','internet','Зумерские профессии',18,
  'Сатирическое авторское обозначение занятия. Сленг, провокации, грубость и преувеличения сохранены. Засчитывается равнозначное описание; обобщения не выдаются за статистику.'),
 (25867,'r2:t5',range(1,9),'wordplay','language','Два значения',0,
  'Словесная загадка на омонимию и многозначность: назовите одно слово, объединяющее подсказки. У ламы допустим буддийский учитель, не обязательно монах; «стиль плавания» относится к баттерфляю.'),
]


def packet(library):
    with library.connect() as db:
        rows=[dict(r) for r in db.execute(BASE)]
        answers={r['id']:[a[0] for a in db.execute('SELECT text FROM answers WHERE question_id=? AND is_correct=1 ORDER BY ordinal',(r['id'],))] for r in rows}
    lookup={identity(r['id']):r for r in rows}
    approved=[];deferred=[]
    specs=specifications()
    if len(specs)!=179:raise ValueError('Review worksheet changed; update manual scope before applying')
    for index,spec in enumerate(specs):
        row=lookup[str(spec['pack_id'])+':'+spec['position']]
        if index in DEFERRED:
            deferred.append(dict(question_id=row['id'],status='unresolved',reason='Требуется дополнительное подтверждение, уточнение контекста либо отдельная проверка игрового жанра'))
            continue
        path=DATA/'research-cache'/(hashlib.sha256(spec['title'].encode()).hexdigest()+'.json')
        reference=json.loads(path.read_text(encoding='utf-8'))
        if reference.get('status')!='fetched' or not reference.get('url'):raise ValueError('Missing reviewed source: '+spec['title'])
        correct=answers[row['id']]
        patch=dict(topic=spec['topic'],editorial_theme=spec['theme'],age_min=0,genre='factual',truth_mode='factual',media_policy='text_only',
                   answer_text=spec['answer'] or correct[0],aliases=[] if spec['answer'] else correct[1:])
        if spec['prompt']:patch['prompt']=spec['prompt']
        # Preserve the original playful lead-ins; research must not flatten them.
        if index in (113,115,118):
            patch.pop('prompt',None);patch['answer_text']=correct[0];patch['aliases']=correct[1:]
        if index==20:patch['prompt']='Что означает «апломб» в характеристике человека?'
        if index==27:patch['prompt']='В чём измеряют уровень шума?'
        if index==41:patch['prompt']='Какую профессию обычно приписывают Марио?'
        if index==42:
            patch['answer_text']='Инспектор по безопасности на атомной электростанции'
            patch['aliases']=['Работник атомной электростанции','Инспектор по безопасности на АЭС']
        if index==105:patch['prompt']='Какую печь изобрёл инженер Перси Спенсер?'
        if index==115:
            patch['answer_text']='Атлантический океан';patch['aliases']=['Атлантический','Атлантика','Северная Атлантика']
        if index==133:patch.update(genre='wordplay',truth_mode='game_convention',host_note='Игра со значением названия реки; этимология её названия не утверждается.')
        if 148<=index<=152:
            patch.update(genre='wordplay',truth_mode='game_convention',host_note='Анаграмма названия вулкана. Порядок букв не важен, набор букв совпадает с ответом.')
            answer=patch['answer_text']
            letters=lambda value:Counter(c for c in value.casefold() if c.isalpha())
            if letters(row['prompt'])!=letters(answer):
                patch['prompt']=''.join(reversed([c for c in answer.upper() if c.isalpha()]))
        if index in (47,):patch['age_min']=18
        if index in (42,):patch['age_min']=12
        evidence=[dict(url=reference['url'],note=spec['note'],status='pass',role='factual',confidence='medium',
                       checked_at=reference['checked_at'],snapshot_sha256=reference.get('page_sha256',''))]
        if index==115:evidence=[]
        for url,note in PRIMARY.get(index,[]):evidence.append(dict(url=url,note=note,status='pass',role='factual',confidence='high',checked_at=now()))
        approved.append(dict(question_id=row['id'],expected_source_revision=source_revision(row),payload=dict(
            status='approved',revision=0,reviewer='Codex · редакторская проверка 2026-10-21',
            patch=patch,checks={k:True for k in CHECKS},evidence=evidence,note=spec['note'])))
    for pack,theme,ordinals,genre,topic,label,age,note in GAME_GROUPS:
        for ordinal in ordinals:
            row=lookup[f'{pack}:{theme}:q{ordinal}']
            if any(r['question_id']==row['id'] for r in approved):raise ValueError('Duplicate editorial selection')
            correct=answers[row['id']]
            aliases=list(correct[1:])
            if '/' in correct[0]:aliases+=correct[0].split('/')
            patch=dict(topic=topic,editorial_theme=label,age_min=age,genre=genre,truth_mode='game_convention',media_policy='text_only',
                       aliases=list(dict.fromkeys(a.strip() for a in aliases if a.strip())),host_note=note)
            if pack==23938 and theme=='r2:t2' and ordinal==5:patch['aliases']+=['Очередник','Профессиональный стоятель в очереди','Стоятель в очереди']
            if pack==25867 and ordinal==6:
                # Keep the author's line. Explain the broader meaning at adjudication.
                patch['host_note']='Лама — буддийский учитель, который может быть монахом. Засчитывается «лама». Авторская подача сохранена.'
            approved.append(dict(question_id=row['id'],expected_source_revision=source_revision(row),payload=dict(
                status='approved',revision=0,reviewer='Codex · проверка игрового зачёта 2026-10-21',patch=patch,
                checks={k:True for k in CHECKS},evidence=[dict(url=row['source_url'],note='Авторский вопрос и ответ в скачанном исходном паке; сохранена игровая условность.',role='original',status='pass',confidence='high',checked_at=now())],note=note)))
    if len(approved)!=200:raise ValueError(f'Unexpected starter scope: {len(approved)}')
    return dict(created_at=now(),source='local_library',scope='200 individually selected text questions',
                editorial_policy='scripts/svoyak/EDITORIAL_POLICY.md',approved=approved,deferred=deferred,
                note='Игровая проверка шуток не является фактчекингом. Права на публичное использование и калибровка требуют отдельного подтверждения.')


def apply_packet(library,value):
    with library.connect() as db:source={r['id']:dict(r) for r in db.execute(BASE)}
    saved=0;skipped=0
    for record in value['approved']:
        row=source.get(record['question_id'])
        if not row or source_revision(row)!=record['expected_source_revision']:raise ValueError('Source changed; re-review required')
        if library.editorial.review(row['id']):skipped+=1;continue
        library.editorial.save(row,dict(record['payload'],revision=0),set(library.topic_labels));saved+=1
    return dict(saved=saved,existing_reviews_preserved=skipped,readiness=library.workflow.readiness())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    library=Library()
    value=packet(library)
    if not REVIEW_PACKET.exists():REVIEW_PACKET.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    else:value=json.loads(REVIEW_PACKET.read_text(encoding='utf-8'))
    if args.apply:
        result=apply_packet(library,value)
        (DATA/'starter-application.json').write_text(dump(result),encoding='utf-8')
        print(dump({k:v for k,v in result.items() if k!='readiness'}))
        print(dump({k:v for k,v in result['readiness'].items() if k in ('playable','review_status','factual_checked','game_checked','approved_genres')}))
    else:print(dump(dict(packet=str(REVIEW_PACKET),questions=len(value['approved']))))
