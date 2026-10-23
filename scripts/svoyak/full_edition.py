"""Prepare/import a source-pinned wording pass; never autoapprove facts or media."""
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import sys

from editorial import Editorial, CHECKS, digest, dump, identity, now, source_revision
from edition_specs import THEMES, EDITS
from runtime import BASE
from semantic import DATA

REPO=Path(__file__).resolve().parents[2]
PACKET=REPO/'qa/svoyak-pilot-2026-10-21/full-edition-reviewed.json'
BATCH='wording-1113-2026-10-21'


def prepare():
    input_rows=json.loads((DATA/'edition-input.json').read_text(encoding='utf-8'))
    ids={row['id'] for row in input_rows}
    with closing(sqlite3.connect(DATA/'library.sqlite3')) as db:
        db.row_factory=sqlite3.Row
        rows=[dict(r) for r in db.execute(BASE+' ORDER BY q.pack_id,q.theme_id,q.ordinal') if r['id'] in ids]
        answers={r['id']:[a[0] for a in db.execute('SELECT text FROM answers WHERE question_id=? AND is_correct=1 ORDER BY ordinal',(r['id'],))] for r in rows}
        media={r['id']:[dict(m) for m in db.execute('SELECT * FROM question_media WHERE question_id=?',(r['id'],))] for r in rows}
        topics={r['id']:db.execute('SELECT topic_slug FROM question_topics WHERE question_id=? ORDER BY score DESC,topic_slug LIMIT 1',(r['id'],)).fetchone()[0] for r in rows}
    keys={identity(r['id']) for r in rows}
    theme_keys={identity(r['theme_id']) for r in rows}
    if set(EDITS)-keys:raise ValueError('Unknown individual decisions: '+str(set(EDITS)-keys))
    if theme_keys-set(THEMES):raise ValueError('Missing theme decisions: '+str(theme_keys-set(THEMES)))
    if len(rows)!=1113:raise ValueError('Pinned remainder must contain 1,113 cards')
    packet=[]
    for row in rows:
        key=identity(row['id']);spec=THEMES[identity(row['theme_id'])];override=dict(EDITS.get(key,{}))
        prompt=row['prompt'] or spec['instruction']
        if 'prefix' in override:prompt=override.pop('prefix')+prompt
        right=answers[row['id']]
        answer=right[0] if right else ''
        aliases=right[1:]
        if row['pack_id']==21337 and ' / ' in answer:
            answer,*extra=answer.split(' / ');aliases=extra+aliases
        patch=dict(prompt=prompt,answer_text=answer,aliases=list(dict.fromkeys(aliases)),
                   topic=spec['topic'] or topics[row['id']],difficulty=max(1,min(5,row['difficulty'] or 3)),
                   editorial_theme='',host_note=spec['host'],genre=spec['genre'],truth_mode=spec['truth'],
                   media_policy='all' if media[row['id']] else 'text_only')
        if spec['age'] is not None:patch['age_min']=spec['age']
        issues=list(spec['flags'])+override.pop('flags',[])
        reason=override.pop('note','') or spec['note'] or 'Условие уже краткое; сохранено без пересказа.'
        patch.update(override)
        if not row['prompt'] and prompt:reason='Добавлено короткое условие к исходному медиа. '+reason
        if patch['prompt']==row['prompt'] and patch['answer_text']==row['answer_text']:reason='Авторский текст и ответ сохранены. '+reason
        if patch['truth_mode']=='factual' and patch['answer_text']:issues.append('facts')
        question_media=[m for m in media[row['id']] if m['phase']=='question']
        if question_media:issues.append('media_semantics')
        if any(m['status']!='local' for m in media[row['id']]):issues.append('external_media')
        if not answer:issues.append('missing_answer')
        if not row['prompt'] and not question_media:issues.append('missing_input')
        if len(aliases)>12:issues.append('loose_aliases')
        if 'map_interaction' in issues:
            patch['host_note']=spec['host']
        checks={k:False for k in CHECKS}
        checks['style']=True
        checks['clarity']=not any(i in issues for i in ('ambiguous','missing_input','service_card','map_interaction'))
        evidence=[dict(url=row['source_url'],note='Исходный авторский пак и ключ ответа; это происхождение, не подтверждение факта.',role='original',status='pass',confidence='high',checked_at=now(),snapshot_sha256=row['raw_sha256'])]
        payload=dict(revision=0,status='needs_review',reviewer='Codex · редакторский проход',note=reason,
                     patch=patch,checks=checks,evidence=evidence)
        packet.append(dict(question_id=row['id'],identity=key,source_hash=source_revision(row),
                           batch_id=BATCH,reason=reason,issues=sorted(set(issues)),payload=payload))
    PACKET.write_text(json.dumps(dict(batch_id=BATCH,scope='wording_and_answer_key',
        limitations=['Факты не утверждены этим проходом','Аудио, видео и изображения семантически не просмотрены','Возраст без явного основания не придуман'],
        items=packet),ensure_ascii=False,indent=2),encoding='utf-8')
    return packet


def apply_packet(packet, state=None):
    state=state or Editorial()
    with closing(sqlite3.connect(DATA/'library.sqlite3')) as db:
        db.row_factory=sqlite3.Row
        rows={r['id']:dict(r) for r in db.execute(BASE)}
        topics={r[0] for r in db.execute('SELECT slug FROM topics')}
    applied=skipped=0
    with state.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        for item in packet:
            row=rows[item['question_id']]
            if source_revision(row)!=item['source_hash']:raise ValueError('Source changed: '+row['id'])
            existing=db.execute('SELECT * FROM reviews WHERE identity=?',(item['identity'],)).fetchone()
            previous=db.execute('SELECT * FROM edition_items WHERE identity=?',(item['identity'],)).fetchone()
            if existing:
                if not previous:raise ValueError('Existing human review will not be overwritten: '+row['id'])
                skipped+=1;continue
            state.save(row,item['payload'],topics,connection=db)
            db.execute('INSERT INTO edition_items(identity,batch_id,source_hash,proposal_json,reason,issues_json,updated_at) VALUES(?,?,?,?,?,?,?)',
                (item['identity'],item['batch_id'],item['source_hash'],dump(item['payload']),item['reason'],dump(item['issues']),now()))
            applied+=1
    return dict(applied=applied,skipped=skipped)


if __name__=='__main__':
    if '--apply' in sys.argv:
        packet=json.loads(PACKET.read_text(encoding='utf-8'))['items']
        # Snapshot just the durable state before this reversible bulk import.
        folder=DATA/'backups';folder.mkdir(exist_ok=True)
        path=folder/('pre-edition-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.sqlite3')
        src=sqlite3.connect(DATA/'editorial.sqlite3');dst=sqlite3.connect(path)
        try:src.backup(dst)
        finally:src.close();dst.close()
        print(json.dumps(apply_packet(packet),ensure_ascii=False))
    else:
        packet=prepare()
        print(json.dumps(dict(items=len(packet),themes=len({identity(i['question_id']).rsplit(':',1)[0] for i in packet}),
            issues=dict(Counter(flag for i in packet for flag in i['issues'])),path=str(PACKET)),ensure_ascii=False,indent=2))
