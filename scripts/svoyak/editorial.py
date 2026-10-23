"""Durable, versioned editorial state, separate from the replaceable source index."""
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit

from semantic import DATA


CHECKS = ('facts', 'clarity', 'style', 'answers', 'category', 'safety', 'duplicates', 'media')
STATUSES = ('draft', 'needs_review', 'approved', 'rejected')
GENRES = {'factual':'Факты и узнавание','wordplay':'Игра слов','humour':'Юмор','absurd':'Абсурд','meme':'Мемы','dark_humour':'Чёрный юмор','parody':'Ироничный пересказ'}


def now(): return datetime.now(timezone.utc).isoformat()
def dump(value): return json.dumps(value, ensure_ascii=False, sort_keys=True)
def digest(value): return hashlib.sha256(dump(value).encode()).hexdigest()
def identity(qid): return re.sub(r'^([0-9]+):[a-f0-9]+:', r'\1:', qid)
def norm(value): return re.sub(r'[^\w]+', ' ', value.casefold().replace('ё', 'е')).strip()
def source_revision(row): return digest([row['raw_sha256'],row['prompt'],row['answer_text'],row['atoms_json']])
def material(source,patch):
    return dict(dict(prompt=source['prompt'],answer_text=source['answer_text'],aliases=[],editorial_theme='',
                     difficulty=source['difficulty'],age_min=None,host_note='',genre='factual',truth_mode='factual',
                     media_policy='text_only' if source['text_only'] else 'all'),**patch)


class Conflict(ValueError): pass


class Editorial:
    def __init__(self, path=None):
        self.path = Path(path) if path else DATA / 'editorial.sqlite3'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version > 3: raise ValueError('Unsupported editorial schema version')
            if version == 0:
                db.executescript('''
                CREATE TABLE reviews(identity TEXT PRIMARY KEY, question_id TEXT NOT NULL, source_hash TEXT NOT NULL,
                  revision INTEGER NOT NULL, patch_json TEXT NOT NULL, checks_json TEXT NOT NULL,
                  evidence_json TEXT NOT NULL, status TEXT NOT NULL, reviewer TEXT NOT NULL, note TEXT NOT NULL,
                  content_hash TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, action TEXT NOT NULL,
                  before_json TEXT, after_json TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE rights(pack_id INTEGER PRIMARY KEY, status TEXT NOT NULL, url TEXT NOT NULL,
                  note TEXT NOT NULL, actor TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE media_checks(media_id TEXT PRIMARY KEY, reference_hash TEXT NOT NULL,
                  status TEXT NOT NULL, details_json TEXT NOT NULL, checked_at TEXT NOT NULL);
                CREATE TABLE profiles(id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE sessions(id TEXT PRIMARY KEY, party_id TEXT NOT NULL, seed TEXT NOT NULL,
                  snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE play_events(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
                  question_id TEXT NOT NULL, identity TEXT NOT NULL, content_hash TEXT NOT NULL,
                  participant TEXT NOT NULL, correct INTEGER NOT NULL, seconds REAL NOT NULL,
                  disputed INTEGER NOT NULL, fun INTEGER, created_at TEXT NOT NULL,
                  UNIQUE(session_id, question_id, participant));
                CREATE INDEX play_question ON play_events(identity,content_hash);
                CREATE TABLE seen(party_id TEXT NOT NULL, identity TEXT NOT NULL, content_hash TEXT NOT NULL,
                  session_id TEXT NOT NULL REFERENCES sessions(id), seen_at TEXT NOT NULL,
                  PRIMARY KEY(party_id,identity));
                PRAGMA user_version=1;
                ''')
            if version < 2:
                db.executescript('''
                CREATE TABLE edition_items(identity TEXT PRIMARY KEY, batch_id TEXT NOT NULL,
                  source_hash TEXT NOT NULL, proposal_json TEXT NOT NULL, reason TEXT NOT NULL,
                  issues_json TEXT NOT NULL, verdict TEXT NOT NULL DEFAULT 'pending',
                  reviewed_revision INTEGER NOT NULL DEFAULT 0, reviewer TEXT NOT NULL DEFAULT '',
                  reviewer_note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
                PRAGMA user_version=2;
                ''')
            if version < 3:
                db.executescript('''
                CREATE TABLE media_files(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL UNIQUE,
                  path TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,
                  source_json TEXT NOT NULL,analysis_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
                CREATE TABLE media_fetch(url TEXT PRIMARY KEY,status TEXT NOT NULL,file_id TEXT REFERENCES media_files(id),
                  details_json TEXT NOT NULL,checked_at TEXT NOT NULL);
                CREATE TABLE media_renditions(id TEXT PRIMARY KEY,media_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,
                  params_json TEXT NOT NULL,file_id TEXT NOT NULL REFERENCES media_files(id),created_at TEXT NOT NULL);
                CREATE TABLE media_selections(media_id TEXT PRIMARY KEY,rendition_id TEXT REFERENCES media_renditions(id),
                  revision INTEGER NOT NULL,actor TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE media_assessments(media_id TEXT PRIMARY KEY,signature TEXT NOT NULL,
                  assessment_json TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE media_decisions(media_id TEXT PRIMARY KEY,signature TEXT NOT NULL,revision INTEGER NOT NULL,
                  checks_json TEXT NOT NULL,status TEXT NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,updated_at TEXT NOT NULL);
                PRAGMA user_version=3;
                ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally: db.close()

    def all_reviews(self):
        with self.connect() as db:
            return {r['identity']: dict(r) for r in db.execute('SELECT * FROM reviews')}

    def review(self, qid): return self.all_reviews().get(identity(qid))

    def editions(self):
        with self.connect() as db:
            return {r['identity']:dict(r) for r in db.execute('SELECT * FROM edition_items')}

    def decide_edition(self, source, payload):
        """A wording verdict never fabricates the eight gameplay approvals."""
        verdict=payload.get('verdict')
        if verdict not in ('accepted','rework','rejected','pending'):raise ValueError('Неизвестное решение')
        actor=str(payload.get('reviewer','')).strip()[:100]
        if not actor:raise ValueError('Укажите имя редактора')
        key=identity(source['id'])
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT * FROM edition_items WHERE identity=?',(key,)).fetchone()
            if old is None:raise ValueError('Для этой карточки нет предложенной редакции')
            review=db.execute('SELECT * FROM reviews WHERE identity=?',(key,)).fetchone()
            if not review or review['revision']!=payload.get('revision'):raise Conflict('Версия изменилась. Обновите карточку.')
            if review['source_hash']!=source_revision(source) or old['source_hash']!=source_revision(source):
                raise Conflict('Изменился исходник. Редакцию нужно подготовить заново.')
            if old['updated_at']!=payload.get('decision_version'):raise Conflict('Решение уже изменено в другой вкладке. Обновите карточку.')
            if verdict in ('rework','rejected') and review['status']=='approved':
                # Rejecting previously approved wording must withdraw gameplay
                # admission, while keeping the factual evidence and media bytes.
                before=dict(review);after=dict(before)
                checks=json.loads(before['checks_json']);checks['style']=False
                after.update(status='needs_review',revision=before['revision']+1,checks_json=dump(checks),
                             reviewer=actor,note=str(payload.get('note','')).strip()[:4000],updated_at=now())
                db.execute('UPDATE reviews SET status=?,revision=?,checks_json=?,reviewer=?,note=?,updated_at=? WHERE identity=?',
                    (after['status'],after['revision'],after['checks_json'],actor,after['note'],after['updated_at'],key))
                self.audit(db,key,'wording_withdrawal',before,after,actor)
                review=after
            value=dict(old)
            value.update(verdict=verdict,reviewed_revision=review['revision'],reviewer=actor,
                         reviewer_note=str(payload.get('note','')).strip()[:4000],updated_at=now())
            db.execute('UPDATE edition_items SET verdict=?,reviewed_revision=?,reviewer=?,reviewer_note=?,updated_at=? WHERE identity=?',
                       (verdict,review['revision'],actor,value['reviewer_note'],value['updated_at'],key))
            self.audit(db,key,'wording_decision',dict(old),value,actor)
        return value

    def apply(self, row, reviews=None):
        result = dict(row)
        result['original_prompt'] = row['prompt']
        result['original_answer'] = row['answer_text']
        result['content_hash'] = digest([source_revision(row), {}])
        result.update(editorial_revision=0, review_status='unreviewed', checks={}, evidence=[],
                      reviewer='', review_note='', age_min=None, aliases=[], editorial_theme='', stale_review=False, genre='factual',truth_mode='factual',
                      media_policy='text_only' if row['text_only'] else 'all')
        review = (reviews if reviews is not None else self.all_reviews()).get(identity(row['id']))
        if review:
            result['editorial_revision'] = review['revision']
            if review['source_hash'] != source_revision(row):
                result['stale_review'] = True
                result['review_status'] = 'needs_review'
            else:
                patch = json.loads(review['patch_json'])
                result.update(patch)
                if 'answer_text' in patch: result['answer_key'] = norm(patch['answer_text'])
                result.update(review_status=review['status'], checks=json.loads(review['checks_json']),
                              evidence=json.loads(review['evidence_json']), reviewer=review['reviewer'],
                              review_note=review['note'], content_hash=review['content_hash'])
        return result

    @staticmethod
    def evidence(value):
        if not isinstance(value, list) or len(value) > 30: raise ValueError('Evidence must be a list, up to 30 sources')
        result = []
        for source in value:
            if not isinstance(source, dict): raise ValueError('Invalid source')
            url = str(source.get('url', ''))[:2000]
            if urlsplit(url).scheme not in ('http', 'https') or not urlsplit(url).hostname:
                raise ValueError('Укажите прямую HTTP(S)-ссылку на источник проверки')
            note = str(source.get('note', '')).strip()[:4000]
            if not note: raise ValueError('Укажите, что именно подтверждает источник')
            if source.get('role','factual') not in ('factual','original','context'):raise ValueError('Invalid source role')
            result.append(dict(url=url, note=note, checked_at=str(source.get('checked_at') or now()),
                               status=source.get('status', 'pass'),role=source.get('role','factual'),
                               confidence=source.get('confidence','medium'),snapshot_sha256=str(source.get('snapshot_sha256',''))[:64]))
        return result

    def save(self, source, payload, topic_slugs, connection=None):
        key = identity(source['id'])
        status = payload.get('status', 'draft')
        if status not in STATUSES: raise ValueError('Invalid review status')
        actor = str(payload.get('reviewer', '')).strip()[:100]
        if not actor: raise ValueError('Укажите редактора')
        patch = payload.get('patch', {})
        if not isinstance(patch, dict): raise ValueError('Invalid patch')
        allowed = {'prompt','answer_text','aliases','topic','editorial_theme','difficulty','age_min','host_note','genre','truth_mode','media_policy'}
        if set(patch) - allowed: raise ValueError('Unsupported editable field')
        patch = dict(patch)
        for field, limit in [('prompt',5000),('answer_text',2000),('editorial_theme',120),('host_note',2000)]:
            if field in patch:
                if not isinstance(patch[field], str) or len(patch[field]) > limit: raise ValueError('Invalid '+field)
                patch[field] = patch[field].strip()
        if 'aliases' in patch:
            if not isinstance(patch['aliases'], list) or len(patch['aliases']) > 30 or not all(isinstance(a,str) and len(a)<300 for a in patch['aliases']):
                raise ValueError('Invalid aliases')
            patch['aliases'] = list(dict.fromkeys(a.strip() for a in patch['aliases'] if a.strip()))
        if 'topic' in patch and patch['topic'] not in topic_slugs: raise ValueError('Unknown category')
        if 'genre' in patch and patch['genre'] not in GENRES:raise ValueError('Unknown genre')
        if patch.get('truth_mode','factual') not in ('factual','game_convention'):raise ValueError('Unknown truth mode')
        if patch.get('media_policy','text_only' if source['text_only'] else 'all') not in ('text_only','all'):raise ValueError('Unknown media policy')
        if 'difficulty' in patch and (type(patch['difficulty']) is not int or not 1<=patch['difficulty']<=5): raise ValueError('Difficulty must be 1–5')
        if 'age_min' in patch and patch['age_min'] not in (0,12,16,18): raise ValueError('Invalid minimum age')
        if not isinstance(payload.get('checks',{}),dict):raise ValueError('Invalid checks')
        checks = {k:payload.get('checks',{}).get(k) is True for k in CHECKS}
        evidence = self.evidence(payload.get('evidence', []))
        note = str(payload.get('note',''))[:4000]
        if status == 'approved':
            if not all(checks.values()): raise ValueError('Для одобрения завершите все восемь проверок')
            factual=patch.get('truth_mode','factual')=='factual'
            if factual and (not evidence or not any(e['role']=='factual' for e in evidence) or any(e['status']!='pass' for e in evidence)):
                raise ValueError('Для фактического вопроса нужны подтверждающие источники без нерешённых противоречий')
            if not factual and not (note.strip() or patch.get('host_note','').strip()):
                raise ValueError('Опишите задумку и принцип зачёта ответа; абсурд не требует доказательства буквальной правдивости')
            if 'age_min' not in patch or not patch.get('topic'): raise ValueError('Укажите категорию и возраст')
            if not patch.get('answer_text', source['answer_text']).strip(): raise ValueError('Для одобрения нужен текстовый ответ')
            if not patch.get('prompt', source['prompt']).strip() and source['text_only']: raise ValueError('Пустой вопрос')
        record = dict(identity=key,question_id=source['id'],source_hash=source_revision(source),
                      patch_json=dump(patch),checks_json=dump(checks),evidence_json=dump(evidence),status=status,
                      reviewer=actor,note=note,content_hash=digest([source_revision(source),patch]),updated_at=now())
        with (self.connect() if connection is None else nullcontext(connection)) as db:
            if connection is None:db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT * FROM reviews WHERE identity=?',(key,)).fetchone()
            current = old['revision'] if old else 0
            if payload.get('revision',0) != current: raise Conflict('Вопрос уже изменён. Обновите карточку перед сохранением.')
            changed=bool(old and (old['source_hash']!=record['source_hash'] or material(source,json.loads(old['patch_json']))!=material(source,patch)))
            if old and not changed:record['content_hash']=old['content_hash']
            # Editing an approved version requires a new review before reapproval.
            if old and old['status']=='approved' and changed and status=='approved':
                raise ValueError('Изменённый вопрос сначала сохраните как черновик и проверьте заново')
            if old and old['status']=='approved' and changed:
                record['checks_json']=dump({k:False for k in CHECKS})
                record['evidence_json']='[]'
            record['revision'] = current+1
            db.execute('INSERT OR REPLACE INTO reviews ('+','.join(record)+') VALUES ('+','.join('?' for _ in record)+')',list(record.values()))
            self.audit(db,key,'review',dict(old) if old else None,record,actor)
        return self.apply(source,{key:record})

    @staticmethod
    def audit(db,entity,action,before,after,actor):
        db.execute('INSERT INTO audit(entity,action,before_json,after_json,actor,created_at) VALUES (?,?,?,?,?,?)',
                   (str(entity),action,dump(before) if before is not None else None,dump(after),actor,now()))

    def history(self,qid):
        with self.connect() as db:
            return [dict(r) for r in db.execute('SELECT * FROM audit WHERE entity=? ORDER BY id DESC LIMIT 100',(identity(qid),))]

    def rights(self):
        with self.connect() as db: return {r['pack_id']:dict(r) for r in db.execute('SELECT * FROM rights')}

    def save_rights(self,payload):
        status=payload.get('status','unknown')
        if status not in ('unknown','open_license','permission_obtained','restricted'): raise ValueError('Invalid rights status')
        url=str(payload.get('url',''))[:2000];note=str(payload.get('note','')).strip()[:5000];actor=str(payload.get('actor','')).strip()[:100]
        if not actor or not note: raise ValueError('Укажите редактора и основание статуса')
        if status!='unknown' and (urlsplit(url).scheme not in ('http','https') or not urlsplit(url).hostname): raise ValueError('Нужна ссылка на лицензию или разрешение')
        value=dict(pack_id=int(payload['pack_id']),status=status,url=url,note=note,actor=actor,updated_at=now())
        with self.connect() as db:
            old=db.execute('SELECT * FROM rights WHERE pack_id=?',(value['pack_id'],)).fetchone()
            db.execute('INSERT OR REPLACE INTO rights VALUES (?,?,?,?,?,?)',tuple(value.values()))
            self.audit(db,'pack:'+str(value['pack_id']),'rights',dict(old) if old else None,value,actor)
        return value
