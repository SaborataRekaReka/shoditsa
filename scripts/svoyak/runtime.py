"""Read-only source index with durable editorial overlays and local gameplay state."""
from collections import Counter, defaultdict
from contextlib import contextmanager
from functools import lru_cache
import json
import math
import random
import re
import sqlite3

from semantic import DATA, Encoder
from editorial import Editorial, identity

BASE='''SELECT q.*,p.title AS pack_title,p.source_url,p.authors_json,t.name AS theme_name,r.name AS round_name
 FROM questions q JOIN packs p ON p.id=q.pack_id JOIN themes t ON t.id=q.theme_id JOIN rounds r ON r.id=t.round_id'''


class Library:
    def __init__(self,state_path=None):
        import numpy as np
        self.np=np
        self.path=DATA/'library.sqlite3'
        self.encoder=Encoder()
        self.editorial=Editorial(state_path)
        with self.connect() as db:
            rows=db.execute('SELECT question_id,vector FROM embeddings ORDER BY question_id').fetchall()
            self.vector_ids=[r[0] for r in rows]
            self.vector_index={qid:i for i,qid in enumerate(self.vector_ids)}
            self.vectors=np.stack([np.frombuffer(r[1],dtype=np.float32) for r in rows])
            self.topics=defaultdict(list)
            for row in db.execute('SELECT qt.*,t.label FROM question_topics qt JOIN topics t ON t.slug=qt.topic_slug ORDER BY score DESC'):
                self.topics[row['question_id']].append(dict(row))
            self.topic_labels=dict(db.execute('SELECT slug,label FROM topics'))
            self.duplicate_pairs={frozenset((r[0],r[1])) for r in db.execute("SELECT question_id,related_id FROM question_links WHERE kind IN ('exact_duplicate','possible_duplicate')")}
        from workflow import Workflow
        self.workflow=Workflow(self)
        from media_workflow import MediaWorkflow
        self.media=MediaWorkflow(self)

    def similar_pair(self,a,b):return frozenset((a,b)) in self.duplicate_pairs

    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path.as_uri()+'?mode=ro',uri=True)
        db.row_factory=sqlite3.Row
        try:yield db
        finally:db.close()

    @staticmethod
    def integer(params,key,default,minimum=0,maximum=100000):
        try:return max(minimum,min(maximum,int(params.get(key,str(default)))))
        except ValueError:return default

    def stats(self):
        with self.connect() as db:
            report={r['key']:json.loads(r['value']) for r in db.execute('SELECT * FROM metadata')}
            report['packs_list']=[dict(r) for r in db.execute('SELECT p.id,p.title,p.source_url,p.authors_json,count(q.id) AS questions FROM packs p JOIN questions q ON q.pack_id=p.id GROUP BY p.id ORDER BY p.id')]
            report['topics']=[dict(r) for r in db.execute('SELECT t.*,count(qt.question_id) AS questions FROM topics t LEFT JOIN question_topics qt ON qt.topic_slug=t.slug GROUP BY t.slug ORDER BY questions DESC')]
            report['formats']=[dict(r) for r in db.execute('SELECT format,count(*) AS questions FROM questions GROUP BY format ORDER BY questions DESC')]
            report['flags']=dict(Counter(flag for r in db.execute('SELECT flags_json FROM questions') for flag in json.loads(r[0])))
            report['search_engine']='hybrid_local_neural_and_fts5'
            report['readiness']=self.workflow.readiness()
            report['factual_review']='partial_editorial_review' if report['readiness']['factual_checked'] else 'not_performed'
            report['difficulty_calibrated']=any(c['calibrated'] for c in report['readiness']['calibration'].values())
            return report

    def filter_rows(self,params,db):
        clauses=[];args=[]
        if params.get('pack','').isdigit():clauses.append('q.pack_id=?');args.append(int(params['pack']))
        if params.get('format'):clauses.append('q.format=?');args.append(params['format'])
        if params.get('text_only')=='1':clauses.append('q.text_only=1')
        if params.get('flag')=='duplicates':clauses.append('q.duplicate_group IS NOT NULL')
        elif params.get('flag')=='issues':clauses.append("q.flags_json!='[]'")
        reviews=self.editorial.all_reviews()
        rows=[self.editorial.apply(dict(r),reviews) for r in db.execute(BASE+(' WHERE '+' AND '.join(clauses) if clauses else '')+' ORDER BY q.text_only DESC,q.pack_id DESC,q.ordinal,q.theme_id',args)]
        if params.get('topic'):rows=[r for r in rows if (r.get('topic')==params['topic'] if r.get('topic') else any(t['topic_slug']==params['topic'] for t in self.topics[r['id']]))]
        if params.get('difficulty') in ['1','2','3','4','5']:rows=[r for r in rows if r['difficulty']==int(params['difficulty'])]
        if params.get('mature','hide')=='hide':rows=[r for r in rows if (r['age_min']<18 if r['age_min'] is not None else not r['mature_hint'])]
        if params.get('review'):rows=[r for r in rows if r['review_status']==params['review']]
        if params.get('genre'):rows=[r for r in rows if r['genre']==params['genre']]
        return rows

    @lru_cache(maxsize=128)
    def query_vector(self,query):return self.encoder.encode([query])[0]

    @lru_cache(maxsize=1024)
    def edited_vector(self,document):return self.encoder.encode([document])[0]

    def decorate(self,row,detail=False):
        result={k:row[k] for k in ['id','pack_id','pack_title','theme_name','round_name','ordinal','price','prompt','format','difficulty','text_only','mature_hint','source_url','duplicate_group']}
        result['topics']=self.topics[row['id']]
        result['flags']=json.loads(row['flags_json'])
        result['review_status']=row['review_status']
        result.update(editorial_revision=row.get('editorial_revision',0),age_min=row.get('age_min'),content_hash=row.get('content_hash'),genre=row.get('genre','factual'),truth_mode=row.get('truth_mode','factual'),media_policy=row.get('media_policy','all'))
        if row.get('topic'):result['topics']=[dict(topic_slug=row['topic'],label=self.topic_labels[row['topic']],score=1,basis='editor_review')]
        if 'score' in row:result['score']=round(row['score'],4)
        if detail:
            result.update(answer=row['answer_text'],raw_sha256=row['raw_sha256'],source_info=json.loads(row['source_info_json']),authors=json.loads(row['authors_json']))
            for k in ('original_prompt','original_answer','checks','evidence','reviewer','review_note','aliases','editorial_theme','stale_review','host_note'):
                result[k]=row.get(k)
            result['calibration']=self.workflow.calibration().get(identity(row['id'])+':'+row['content_hash'])
        return result

    def search(self,params):
        query=params.get('q','').strip()[:500]
        offset=self.integer(params,'offset',0)
        limit=self.integer(params,'limit',24,1,100)
        with self.connect() as db:
            rows=self.filter_rows(params,db)
            if query:
                words=re.findall(r'[\w]+',query.casefold(),re.UNICODE)[:20]
                expression=' OR '.join('"'+word+'"*' for word in words if len(word)>1)
                lexical={r[0] for r in db.execute('SELECT question_id FROM question_fts WHERE question_fts MATCH ?',(expression,))} if expression else set()
                for row in rows:
                    if row.get('editorial_revision'):
                        lexical.discard(row['id'])
                        document=(row['prompt']+' '+row['answer_text']+' '+row.get('editorial_theme','')).casefold()
                        if any(word in document for word in words if len(word)>1):lexical.add(row['id'])
                if params.get('mode')=='literal':rows=[r for r in rows if r['id'] in lexical]
                else:
                    similarities=self.vectors@self.query_vector(query)
                    ranked=[]
                    for row in rows:
                        similarity=float(similarities[self.vector_index[row['id']]])
                        if row['prompt']!=row['original_prompt'] or row['answer_text']!=row['original_answer']:
                            similarity=float(self.edited_vector(row['theme_name']+'\n'+row['answer_text']+'\n'+row['prompt'])@self.query_vector(query))
                        if similarity<.22 and row['id'] not in lexical:continue
                        row['score']=similarity+(.16 if row['id'] in lexical else 0)
                        ranked.append(row)
                    rows=sorted(ranked,key=lambda r:r['score'],reverse=True)
            return {'total':len(rows),'offset':offset,'limit':limit,'query':query,'items':[self.decorate(row) for row in rows[offset:offset+limit]],
                    'search_mode':'literal' if params.get('mode')=='literal' else 'hybrid'}

    def question(self,qid):
        with self.connect() as db:
            row=db.execute(BASE+' WHERE q.id=?',(qid,)).fetchone()
            if row is None:return None
            result=self.decorate(self.editorial.apply(dict(row)),True)
            result['answers']=[dict(r) for r in db.execute('SELECT text,is_correct FROM answers WHERE question_id=? ORDER BY is_correct DESC,ordinal',(qid,))]
            result['original_answers']=[a['text'] for a in result['answers'] if a['is_correct']]
            if result['editorial_revision']:
                result['answers']=[dict(text=a,is_correct=1) for a in [result['answer']]+(result.get('aliases') or [])]
            result['media']=[dict(r) for r in db.execute('SELECT m.*,a.mime,a.entry_name,a.sha256 AS asset_sha256 FROM question_media m LEFT JOIN assets a ON a.id=m.asset_id WHERE question_id=? ORDER BY ordinal',(qid,))]
            for media in result['media']:
                if media['asset_id']:media['url']='/library-media/'+media['asset_id']
            result['adaptations']=[json.loads(r[0]) for r in db.execute('SELECT data_json FROM adaptations WHERE original_id=?',(qid,))]
            result['related']=[dict(r) for r in db.execute('SELECT l.kind,l.score,q.id,q.prompt,t.name AS theme_name FROM question_links l JOIN questions q ON q.id=l.related_id JOIN themes t ON t.id=q.theme_id WHERE l.question_id=? ORDER BY l.score DESC LIMIT 6',(qid,))]
            result['same_answer_count']=db.execute('SELECT count(*) FROM questions WHERE answer_key=?',(row['answer_key'],)).fetchone()[0] if row['answer_key'] else 0
            result['history']=self.editorial.history(qid)
            from edition_view import edition_metadata
            result['edition']=edition_metadata(self.editorial.apply(dict(row)),self.editorial.editions().get(identity(qid)))
            result['original_atoms']=json.loads(row['atoms_json'])
            result['original_xml']=row['raw_xml']
            with self.editorial.connect() as state:media_checks={r['media_id']:dict(r) for r in state.execute('SELECT * FROM media_checks')}
            for media in result['media']:
                check=media_checks.get(media['id'])
                media['technical_check']=dict(check,details=json.loads(check['details_json'])) if check else None
            effective=self.editorial.apply(dict(row))
            result['original_media']=result['media']
            result['media']=self.media.resolve(result['media'],effective,detail=True)
            result['text_content_hash']=effective['content_hash']
            result['content_hash']=self.media.content_hash(effective,result['media'])
            result['calibration']=self.workflow.calibration().get(identity(qid)+':'+result['content_hash'])
            from workflow import playable
            result['blockers']=playable(effective,result['media'],media_checks)
            return result

    def save_review(self,qid,payload):
        with self.connect() as db:row=db.execute(BASE+' WHERE q.id=?',(qid,)).fetchone()
        if row is None:raise KeyError('Question not found')
        self.editorial.save(dict(row),payload,set(self.topic_labels))
        self.query_vector.cache_clear()
        return self.question(qid)

    def decide_edition(self,qid,payload):
        with self.connect() as db:row=db.execute(BASE+' WHERE q.id=?',(qid,)).fetchone()
        if row is None:raise KeyError('Question not found')
        self.editorial.decide_edition(dict(row),payload)
        return self.question(qid)

    def party(self,params):
        count=self.integer(params,'count',15,1,50)
        rng=random.Random(params.get('seed','first'))
        with self.connect() as db:rows=self.filter_rows(dict(params,text_only=params.get('text_only','1')),db)
        ready_ids={r['id'] for r in self.workflow.rows() if r['ready']}
        rows=[r for r in rows if r['id'] in ready_ids and r['answer_key']]
        rng.shuffle(rows)
        # Prefer concise prompts, then spread the selection across subjects and packs.
        rows.sort(key=lambda r:len(r['prompt'])>180)
        selected=[];used_fingerprints=set();used_answers=set();topic_count=Counter();pack_count=Counter()
        while rows and len(selected)<count:
            best=min(range(len(rows)),key=lambda i:(topic_count[self.topics[rows[i]['id']][0]['topic_slug']],pack_count[rows[i]['pack_id']],len(rows[i]['prompt'])>180))
            row=rows.pop(best)
            if row['content_fingerprint'] in used_fingerprints or row['answer_key'] in used_answers:continue
            selected.append(row)
            used_fingerprints.add(row['content_fingerprint']);used_answers.add(row['answer_key'])
            topic_count[self.topics[row['id']][0]['topic_slug']]+=1;pack_count[row['pack_id']]+=1
        return {'total':len(selected),'requested':count,'items':[self.decorate(r) for r in selected],
                'note':'Только одобренные вопросы. Для полных тем и сохранения используйте сборщик паков.'}

    def asset(self,asset_id):
        if asset_id.startswith('file:'):
            record=self.media.file(asset_id)
            return dict(record,entry_name=__import__('pathlib').Path(record['path']).name) if record else None
        with self.connect() as db:
            row=db.execute('SELECT a.*,p.archive_path FROM assets a JOIN packs p ON p.id=a.pack_id WHERE a.id=?',(asset_id,)).fetchone()
            return dict(row) if row else None
