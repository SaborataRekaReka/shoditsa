"""Meaningful media findings, audit provenance and stale-review behavior."""
from contextlib import closing
import json
from pathlib import Path
import shutil
import sqlite3
import tempfile
import unittest

from runtime import Library,BASE
from semantic import DATA
from media_semantics import verify_inputs,INPUT_HASHES


class SemanticTests(unittest.TestCase):
    def setUp(self):
        self.work=tempfile.TemporaryDirectory(prefix='svoyak-semantic-test-')
        state=Path(self.work.name)/'editorial.sqlite3'
        with closing(sqlite3.connect(DATA/'editorial.sqlite3')) as a,closing(sqlite3.connect(state)) as b:a.backup(b)
        self.library=Library(state)

    def tearDown(self):self.work.cleanup()

    def test_full_coverage_keeps_unresolved_and_does_not_invent_human_reviews(self):
        catalog=self.library.media.catalog()
        self.assertEqual(len(catalog['items']),930)
        self.assertEqual(sum(catalog['summary']['semantic_questions'].values()),930)
        self.assertEqual(catalog['summary']['semantic_questions']['consistent'],324)
        self.assertEqual(catalog['summary']['decisions'],{'approved':384,'pending':941})
        self.assertEqual(sum(m['semantic']['method']=='human_decision' for q in catalog['items'] for m in q['media']),0)
        self.assertTrue(all(m['semantic']['method']!='not_reviewed' for q in catalog['items'] for m in q['media']))

    def test_mashup_incomplete_key_and_geographic_mismatch_stay_visible(self):
        for mid in ['15161:e7239409ce9c:r2:t3:q3:m0','15714:70608e0821fe:r3:t3:q1:m2']:
            self.assertEqual(self.library.media.find(mid)['semantic']['status'],'conflict')
        self.assertIn('Второй компонент',self.library.media.find('15161:e7239409ce9c:r2:t3:q3:m0')['semantic']['note'])

    def test_answer_poster_cannot_validate_question_audio(self):
        q=next(q for q in self.library.media.catalog()['items'] if q['id']=='24974:33840b52813d:r2:t5:q1')
        self.assertTrue(q['semantic']['review_required']);self.assertIn('audio',q['semantic']['reasons'])
        self.assertTrue(any(m['phase']=='answer' and m['semantic']['status']=='consistent' for m in q['media']))

    def test_text_change_invalidates_a_consistent_visual_relation(self):
        q=next(q for q in self.library.media.catalog()['items'] if q['semantic']['status']=='consistent')
        with self.library.connect() as db:row=dict(db.execute(BASE+' WHERE q.id=?',(q['id'],)).fetchone())
        old=self.library.editorial.review(q['id']);revision=old['revision'] if old else 0
        self.library.editorial.save(row,dict(revision=revision,status='draft',reviewer='ISOLATED TEST',patch=dict(prompt='Unrelated fixture question')),set(self.library.topic_labels))
        item=self.library.media.find(q['media'][0]['id'])
        self.assertTrue(item['semantic']['review_required']);self.assertIn('stale',item['semantic']['reasons'])

    def test_explicit_human_decision_resolves_queue_without_deleting_audit(self):
        q=next(q for q in self.library.media.catalog()['items'] if len(q['media'])==1 and q['media'][0]['type']=='image' and q['media'][0]['available'] and q['semantic']['review_required'])
        m=self.library.media.find(q['media'][0]['id'])
        self.library.media.decide(dict(media_id=m['id'],signature=m['signature'],revision=0,status='approved',actor='ISOLATED TEST',note='Fixture only',checks=dict(match='pass',readability='pass',sound='not_applicable',spoilers='pass' if m['phase']=='question' else 'not_applicable')))
        new=self.library.media.find(m['id']);self.assertFalse(new['semantic']['review_required'])
        self.assertEqual(new['semantic']['method'],'human_decision');self.assertTrue(new['assessment']['semantic']['review_required'])
        self.library.media.decide(dict(media_id=m['id'],signature=new['signature'],revision=1,status='rework',actor='ISOLATED TEST',note='Explicit editorial issue',checks=new['decision']['checks']))
        disputed=self.library.media.find(m['id']);self.assertIn('editorial',disputed['semantic']['reasons']);self.assertTrue(disputed['semantic']['review_required'])

    def test_changed_context_cannot_reuse_the_curated_group_decisions(self):
        folder=Path(self.work.name)/'inputs';folder.mkdir()
        for name in INPUT_HASHES:shutil.copyfile(DATA/'media'/name,folder/name)
        (folder/'research-input.json').write_text('[]',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'context changed'):verify_inputs(folder)


if __name__=='__main__':unittest.main()
