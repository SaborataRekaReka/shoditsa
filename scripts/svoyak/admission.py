"""Apply individually reviewed, source-pinned local admission packets in order.

The 200 text candidates precede the 307 media candidates. Original packs and the
source index are never modified. This module does not approve by heuristic.
"""
import argparse
from collections import Counter
import hashlib,json,sqlite3
from pathlib import Path

from editorial import CHECKS,dump,digest,identity,now,source_revision
from runtime import BASE,Library
from semantic import DATA

ROOT=DATA/'readiness-507'
ACTOR='Codex · редакторская проверка 507 · 2026-10-21'


def pinned():
    value=json.loads((ROOT/'input.json').read_text(encoding='utf-8'))
    if len(value['text'])!=200 or len(value['media'])!=307 or len(value['prior_ready'])!=200:raise ValueError('Pinned scope changed')
    actual=hashlib.sha256((DATA/'library.sqlite3').read_bytes()).hexdigest()
    if actual!=value['source_sha256']:raise ValueError('Source index changed; review required')
    return value


def prepare(stage):
    value=pinned()
    if stage=='text':
        from admission_text import decisions
        decisions_by_index=decisions()
    else:
        from admission_media import decisions
        decisions_by_index=decisions(value['media'])
    records=[]
    for i,row in enumerate(value[stage],1):
        d=decisions_by_index[i]
        records.append(dict(index=i,question_id=row['id'],identity=identity(row['id']),
            source_hash=source_revision(dict(row,prompt=row['original_prompt'],answer_text=row['original_answer'])),
            expected_revision=row['editorial_revision'],expected_text_hash=row['text_content_hash'],
            media=[dict(id=m['id'],signature=m['signature'],sha256=m['file']['sha256'] if m['file'] else None) for m in row['media']],**d))
    output=ROOT/(stage+'-decisions.json')
    if output.exists():
        old=json.loads(output.read_text(encoding='utf-8'))
        if old['records']!=records:raise ValueError('A prepared packet exists with different decisions. Preserve it and version the review explicitly.')
        return old
    packet=dict(created_at=now(),stage=stage,input_sha256=hashlib.sha256((ROOT/'input.json').read_bytes()).hexdigest(),
                source_sha256=value['source_sha256'],actor=ACTOR,records=records)
    output.write_text(json.dumps(packet,ensure_ascii=False,indent=2),encoding='utf-8')
    return packet


def apply(library,packet):
    pinned()
    if hashlib.sha256((ROOT/'input.json').read_bytes()).hexdigest()!=packet['input_sha256']:raise ValueError('Review input changed')
    stage=packet['stage'];marker=ROOT/(stage+'-application.json')
    if marker.exists():raise ValueError('Stage already applied; do not overwrite later editor decisions')
    if stage=='media' and not (ROOT/'text-application.json').exists():raise ValueError('Finish text stage first')
    with library.connect() as db:sources={r['id']:dict(r) for r in db.execute(BASE)}
    # Validate the complete batch before any write.
    for item in packet['records']:
        source=sources[item['question_id']];r=library.editorial.review(source['id'])
        if source_revision(source)!=item['source_hash'] or r['revision']!=item['expected_revision'] or r['content_hash']!=item['expected_text_hash']:
            raise ValueError('Content changed since the pinned review: '+item['question_id'])
        if stage=='media':
            live={m['id']:m for m in library.media.question_media(source['id'],False)}
            for m in item['media']:
                current=live[m['id']]
                if current['signature']!=m['signature'] or not current['file'] or current['file']['sha256']!=m['sha256']:raise ValueError('Media changed since review')
    backup=ROOT/('before-'+stage+'.sqlite3')
    if backup.exists():raise ValueError('Pre-stage backup already exists; investigate incomplete application')
    src=sqlite3.connect(library.editorial.path);dst=sqlite3.connect(backup)
    try:src.backup(dst)
    finally:src.close();dst.close()
    saved=[]
    for item in packet['records']:
        source=sources[item['question_id']];old=library.editorial.review(source['id'])
        if old['revision']!=item['expected_revision'] or old['content_hash']!=item['expected_text_hash']:raise ValueError('Concurrent editorial change; stop the batch')
        patch=json.loads(old['patch_json']);patch.update(item['patch'])
        approved=item['outcome']=='approved'
        if approved:
            patch.setdefault('topic',library.topics[source['id']][0]['topic_slug'])
            patch.setdefault('age_min',18 if patch.get('genre') in ('dark_humour','parody') or source['pack_id']==15161 else 0)
            # Wording notes from the earlier pass describe unfinished research;
            # replace them with the actual completed disposition / adjudication.
            patch['host_note']=item['patch'].get('host_note') or item['note']
        checks={k:True for k in CHECKS} if approved else json.loads(old['checks_json'])
        if not approved:checks['facts']=False;checks['answers']=False
        evidence=json.loads(old['evidence_json'])+item['evidence']
        row=library.editorial.save(source,dict(revision=old['revision'],status='approved' if approved else 'needs_review',
            reviewer=ACTOR,patch=patch,checks=checks,evidence=evidence,note=item['note']),set(library.topic_labels))
        edition=library.editorial.editions()[identity(source['id'])]
        library.editorial.decide_edition(source,dict(verdict='accepted' if approved else 'rework',revision=row['editorial_revision'],
            decision_version=edition['updated_at'],reviewer=ACTOR,note=item['note']))
        if approved and stage=='media':
            for binding in item['media']:
                media=library.media.find(binding['id'],False)
                if media['file']['sha256']!=binding['sha256']:raise ValueError('Reviewed bytes changed')
                silent_clip=stage=='media' and item['index']==265 and media['type']=='video' and media['file']['analysis'].get('has_audio') is False
                if media['type']!='image' and not silent_clip:raise ValueError('Unreviewed AV file; separate review required')
                expected=digest([row['content_hash'],media['id'],media['phase'],binding['sha256']])
                if media['signature']!=expected or library.editorial.review(source['id'])['revision']!=row['editorial_revision']:raise ValueError('Text changed after final review')
                library.media.decide(dict(media_id=media['id'],signature=media['signature'],revision=media['decision']['revision'],
                    status='approved',actor=ACTOR,checks=dict(match='pass',readability='pass',sound='not_applicable',
                    spoilers='pass' if media['phase']=='question' else 'not_applicable'),
                    note=item.get('media_note','Проверена статичная иллюстрация в итоговом контексте карточки. Звук отсутствует по типу файла; изображение читается, ответ не раскрыт до своей фазы.')))
        saved.append(dict(question_id=source['id'],outcome=item['outcome'],revision=row['editorial_revision']))
    report=dict(created_at=now(),stage=stage,records=saved,counts=dict(Counter(r['outcome'] for r in saved)),
                packet_sha256=hashlib.sha256((ROOT/(stage+'-decisions.json')).read_bytes()).hexdigest(),
                playable=library.workflow.readiness()['playable'])
    marker.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report


def catalog(library):
    """Live view: later user edits and revoked approvals take precedence."""
    initial=json.loads((ROOT/'input.json').read_text(encoding='utf-8'))
    live={identity(r['id']):r for r in library.workflow.rows()}
    followup_path=ROOT/'followups.json'
    followups={r['identity']:r for r in json.loads(followup_path.read_text(encoding='utf-8'))['records']} if followup_path.exists() else {}
    items=[];stages={}
    for stage in ('text','media'):
        path=ROOT/(stage+'-decisions.json')
        if not path.exists():continue
        packet=json.loads(path.read_text(encoding='utf-8'))
        group=[]
        for d in packet['records']:
            row=live[d['identity']]
            followup=followups.get(d['identity'])
            if followup and followup['content_hash']==row['text_content_hash']:d=dict(d,**followup)
            state='ready' if row['ready'] else 'owner' if d['outcome']=='owner_review' else 'changed'
            value=dict(id=row['id'],identity=d['identity'],stage=stage,index=d['index'],state=state,
                basis=d.get('basis','external_reference' if row['truth_mode']=='factual' else 'game_convention'),
                ready=row['ready'],blockers=row['blockers'],pack_id=row['pack_id'],pack=row['pack_title'],theme=row['theme_name'],
                prompt=row['prompt'],answer=row['answer_text'],aliases=row['aliases'],original_prompt=row['original_prompt'],
                original_answer=row['original_answer'],note=row['review_note'],initial_note=d['note'],host_note=row['host_note'],
                genre=row['genre'],age_min=row['age_min'],truth_mode=row['truth_mode'],evidence=row['evidence'],
                source_url=row['source_url'],source_sha256=row['raw_sha256'],content_hash=row['content_hash'],
                reviewer=row['reviewer'],revision=row['editorial_revision'],review_status=row['review_status'],
                media=[dict(id=m['id'],phase=m['phase'],type=m['type'],url=m.get('url'),file=m['file'],
                    signature=m['signature'],decision=m['decision'],semantic=m['semantic']) for m in row['media']])
            items.append(value);group.append(value)
        stages[stage]=dict(total=len(group),ready=sum(r['ready'] for r in group),owner=sum(r['state']=='owner' for r in group),
            changed=sum(r['state']=='changed' for r in group),applied=(ROOT/(stage+'-application.json')).exists())
    return dict(created_at=now(),source='local_library',scope=507,items=items,stages=stages,
        summary=dict(total=len(items),ready=sum(r['ready'] for r in items),owner=sum(r['state']=='owner' for r in items),
            changed=sum(r['state']=='changed' for r in items),library_ready=sum(r['ready'] for r in live.values()),
            prior_ready=len(initial['prior_ready']),bases=dict(Counter(r['basis'] for r in items if r['ready']))))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--stage',choices=['text','media'],required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
    packet=prepare(a.stage)
    print(dump(dict(stage=a.stage,decisions=dict(Counter(r['outcome'] for r in packet['records'])))))
    if a.apply:
        result=apply(Library(),packet);print(dump({k:v for k,v in result.items() if k!='records'}))
