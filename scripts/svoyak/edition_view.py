"""Fast editorial browsing without neural inference or gameplay side effects."""
from collections import Counter
import json

from editorial import identity, source_revision, now


ISSUES = {
 'facts':'Факт ещё не подтверждён', 'media_semantics':'Посмотреть / прослушать медиа',
 'external_media':'Внешнее медиа', 'answer_scope':'Уточнить зачёт',
 'ambiguous':'Неоднозначное условие', 'time_sensitive':'Зависит от даты',
 'answer_changed':'Предложена замена ответа', 'missing_answer':'Нет обычного ответа',
 'service_card':'Служебная карточка', 'loose_aliases':'Слишком широкие варианты зачёта',
 'attribution':'Проверить атрибуцию', 'legal_claim':'Проверить закон',
 'legend':'Байка / легенда', 'medical':'Медицинское утверждение',
 'safety_advice':'Совет о безопасности', 'statistics':'Проверить статистику',
 'map_interaction':'Интерактивная карта', 'missing_input':'Нет условия / медиа'
}


def edition_metadata(row, record):
    if not record:return None
    source=dict(row,prompt=row.get('original_prompt',row['prompt']),answer_text=row.get('original_answer',row['answer_text']))
    current=record['source_hash']==source_revision(source) and record['reviewed_revision']==row['editorial_revision']
    return dict(batch_id=record['batch_id'],reason=record['reason'],issues=json.loads(record['issues_json']),
                proposal=json.loads(record['proposal_json']),verdict=record['verdict'] if current else 'pending',
                previous_verdict=record['verdict'],reviewed_revision=record['reviewed_revision'],
                reviewer=record['reviewer'],note=record['reviewer_note'],decision_version=record['updated_at'],
                decision_stale=record['verdict']!='pending' and not current)


def catalog(library, full=False):
    from runtime import BASE
    reviews=library.editorial.all_reviews();editions=library.editorial.editions()
    ready_ids={r['id'] for r in library.workflow.rows() if r['ready']}
    with library.connect() as db:
        rows=[library.editorial.apply(dict(r),reviews) for r in db.execute(BASE+' ORDER BY q.pack_id,r.ordinal,t.ordinal,q.ordinal')]
        media_counts=dict(db.execute('SELECT question_id,count(*) FROM question_media GROUP BY question_id'))
    items=[]
    for row in rows:
        meta=edition_metadata(row,editions.get(identity(row['id'])))
        item=dict(id=row['id'],identity=identity(row['id']),pack_id=row['pack_id'],pack_title=row['pack_title'],
                  theme=row['theme_name'],theme_id=row['theme_id'],round=row['round_name'],ordinal=row['ordinal'],
                  prompt=row['prompt'],answer=row['answer_text'],original_prompt=row['original_prompt'],
                  original_answer=row['original_answer'],genre=row['genre'],age_min=row['age_min'],
                  review_status=row['review_status'],revision=row['editorial_revision'],source_url=row['source_url'],
                  content_hash=row['content_hash'],has_media=bool(media_counts.get(row['id'])),
                  prompt_changed=row['prompt']!=row['original_prompt'],answer_changed=row['answer_text']!=row['original_answer'],
                  edition=meta,topic=row.get('topic') or library.topics[row['id']][0]['topic_slug'])
        # The sidebar only needs the reason/issues/decision. Immutable full
        # proposals are supplied in the detail card and the downloadable export.
        if meta and not full:item['edition']={k:v for k,v in meta.items() if k!='proposal'}
        if full:
            item.update(patch=json.loads(reviews[identity(row['id'])]['patch_json']) if identity(row['id']) in reviews else {},
                        checks=row['checks'],evidence=row['evidence'],note=row['review_note'],
                        source_hash=source_revision(dict(row,prompt=row['original_prompt'],answer_text=row['original_answer'])),source_info=json.loads(row['source_info_json']),
                        original_atoms=json.loads(row['atoms_json']))
        items.append(item)
    batch=[i for i in items if i['edition']]
    summary=dict(total=len(items),edition_total=len(batch),verdicts=dict(Counter(i['edition']['verdict'] for i in batch)),
                 original_text_kept=sum(not i['prompt_changed'] for i in batch),
                 prompt_changed=sum(i['prompt_changed'] for i in batch),answer_changed=sum(i['answer_changed'] for i in batch),
                 gameplay_approved=sum(i['id'] in ready_ids for i in items),
                 issues=dict(Counter(flag for i in batch for flag in i['edition']['issues'])))
    return dict(schema_version=1,exported_at=now(),summary=summary,issue_labels=ISSUES,items=items)
