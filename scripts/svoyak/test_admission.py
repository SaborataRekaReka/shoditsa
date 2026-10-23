"""Admission withdrawal and exact source binding, isolated from real review data."""
from contextlib import closing
from copy import deepcopy
import json,sqlite3,tempfile,unittest
from pathlib import Path
from admission import ROOT,catalog
from editorial import identity
from edition_view import catalog as edition_catalog
from runtime import BASE,Library
from semantic import DATA


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.work=tempfile.TemporaryDirectory(prefix='svoyak-admission-test-')
        path=Path(self.work.name)/'editorial.sqlite3'
        with closing(sqlite3.connect(DATA/'editorial.sqlite3')) as a,closing(sqlite3.connect(path)) as b:a.backup(b)
        self.library=Library(path)
        self.qid=json.loads((ROOT/'media-decisions.json').read_text(encoding='utf-8'))['records'][0]['question_id']
        with self.library.connect() as db:self.source=dict(db.execute(BASE+' WHERE q.id=?',(self.qid,)).fetchone())

    def tearDown(self):self.work.cleanup()

    def test_exact_scope_and_explicit_owner_dispositions(self):
        value=catalog(self.library)
        self.assertEqual(value['summary']['total'],507);self.assertEqual(value['summary']['ready'],429)
        self.assertEqual(value['summary']['owner'],78);self.assertEqual(value['summary']['library_ready'],629)
        self.assertEqual(len({q['id'] for q in value['items']}),507)
        self.assertTrue(all(q['note'] for q in value['items'] if not q['ready']))
        self.assertEqual(sum(q['basis']=='map_interaction' for q in value['items']),8)

    def test_editorial_rework_withdraws_a_previously_playable_card(self):
        old=self.library.editorial.review(self.qid);record=self.library.editorial.editions()[identity(self.qid)]
        self.library.editorial.decide_edition(self.source,dict(verdict='rework',revision=old['revision'],
            decision_version=record['updated_at'],reviewer='ISOLATED TEST',note='Question needs a new clue'))
        current=self.library.editorial.review(self.qid)
        self.assertEqual(current['revision'],old['revision']+1)
        self.assertEqual(current['status'],'needs_review');self.assertEqual(current['evidence_json'],old['evidence_json'])
        self.assertFalse(next(r for r in self.library.workflow.rows() if r['id']==self.qid)['ready'])
        self.assertEqual(catalog(self.library)['summary']['library_ready'],628)

    def test_a_changed_prompt_stales_existing_media_admission(self):
        old=self.library.editorial.review(self.qid)
        patch=json.loads(old['patch_json']);patch['prompt']='Unrelated isolated test question'
        self.library.editorial.save(self.source,dict(status='draft',revision=old['revision'],reviewer='ISOLATED TEST',
            patch=patch,checks=json.loads(old['checks_json']),evidence=json.loads(old['evidence_json'])),set(self.library.topic_labels))
        media=self.library.media.question_media(self.qid,False)
        self.assertTrue(all(m['decision']['stale'] for m in media))
        self.assertTrue(all(m['decision']['status']=='pending' for m in media))
        self.assertEqual(catalog(self.library)['summary']['changed'],1)

    def test_media_rework_is_reflected_in_ready_counter_even_if_text_is_approved(self):
        m=self.library.media.question_media(self.qid,False)[0]
        self.library.media.decide(dict(media_id=m['id'],revision=m['decision']['revision'],signature=m['signature'],
            status='rework',actor='ISOLATED TEST',note='Clue is not visible',checks=dict(match='uncertain',readability='fail',sound='not_applicable',spoilers='pass')))
        self.assertEqual(self.library.editorial.review(self.qid)['status'],'approved')
        self.assertEqual(edition_catalog(self.library)['summary']['gameplay_approved'],628)
        self.assertEqual(catalog(self.library)['summary']['changed'],1)


if __name__=='__main__':unittest.main()
