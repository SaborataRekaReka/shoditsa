"""Workflow tests use a disposable editorial DB, never real review/playtest results."""
from copy import deepcopy
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
import zipfile

from editorial import CHECKS,Conflict,identity
from runtime import BASE,Library
from operations import public_url,restore_into
from workflow import playable


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work=tempfile.TemporaryDirectory(prefix='svoyak-tests-')
        cls.library=Library(Path(cls.work.name)/'editorial.sqlite3')
        with cls.library.connect() as db:
            cls.sources=[dict(r) for r in db.execute(BASE+" WHERE q.pack_id=25867 AND q.theme_id LIKE '%:r1:t2' ORDER BY q.ordinal")]
            cls.sources += [dict(r) for r in db.execute(BASE+" WHERE q.pack_id=25867 AND q.theme_id LIKE '%:r1:t4' ORDER BY q.ordinal")]

    @classmethod
    def tearDownClass(cls):cls.work.cleanup()

    def setUp(self):
        with self.library.editorial.connect() as db:
            for table in ('play_events','seen','sessions','profiles','reviews','audit','rights','media_checks'):db.execute('DELETE FROM '+table)

    def payload(self,row,**updates):
        value=dict(revision=0,status='approved',reviewer='TEST FIXTURE — not factual evidence',note='Test only',
            patch=dict(topic='nature' if ':t2:' in row['id'] else 'fiction',age_min=0,
                       editorial_theme='Animals' if ':t2:' in row['id'] else 'Addresses'),
            checks={k:True for k in CHECKS},evidence=[dict(url='https://example.invalid/test-fixture',note='Synthetic test assertion, not real verification')])
        value.update(updates);return value

    def seed(self):
        for row in self.sources:self.library.editorial.save(row,self.payload(row),set(self.library.topic_labels))

    def build(self,**updates):
        value=dict(party_id='test-party',name='Fixture',themes=2,rounds=1,minutes=30,age=16,seed='stable',text_only=True)
        value.update(updates);return self.library.workflow.build(value)

    def test_unreviewed_questions_are_excluded(self):
        with self.assertRaisesRegex(ValueError,'доступно 0'):self.build()
        self.assertEqual(self.library.party({'count':'15'})['total'],0)

    def test_approval_requires_evidence_and_all_checks(self):
        row=self.sources[0]
        for changes in (dict(evidence=[]),dict(checks={}),dict(patch=dict(topic='nature'))):
            with self.assertRaises(ValueError):self.library.editorial.save(row,self.payload(row,**changes),set(self.library.topic_labels))

    def test_optimistic_revision_prevents_lost_updates(self):
        row=self.sources[0];payload=self.payload(row)
        self.library.editorial.save(row,payload,set(self.library.topic_labels))
        with self.assertRaises(Conflict):self.library.editorial.save(row,payload,set(self.library.topic_labels))
        self.assertEqual(len(self.library.editorial.history(row['id'])),1)

    def test_edits_to_approved_version_reset_review(self):
        row=self.sources[0];payload=self.payload(row)
        self.library.editorial.save(row,payload,set(self.library.topic_labels))
        payload['revision']=1;payload['patch']['prompt']='A changed fixture question'
        with self.assertRaises(ValueError):self.library.editorial.save(row,payload,set(self.library.topic_labels))
        payload['status']='draft'
        edited=self.library.editorial.save(row,payload,set(self.library.topic_labels))
        self.assertEqual(edited['checks'],{k:False for k in CHECKS});self.assertEqual(edited['evidence'],[])
        self.assertEqual(edited['original_prompt'],row['prompt'])

    def test_saving_equivalent_form_keeps_approval_and_content_identity(self):
        row=self.sources[0];payload=self.payload(row)
        first=self.library.editorial.save(row,payload,set(self.library.topic_labels))
        payload['revision']=1;payload['patch'].update(prompt=row['prompt'],answer_text=row['answer_text'],aliases=[],
            difficulty=row['difficulty'],genre='factual',truth_mode='factual',host_note='')
        saved=self.library.editorial.save(row,payload,set(self.library.topic_labels))
        self.assertEqual(saved['review_status'],'approved');self.assertEqual(saved['content_hash'],first['content_hash'])

    def test_source_or_parser_change_invalidates_approval(self):
        row=self.sources[0];self.library.editorial.save(row,self.payload(row),set(self.library.topic_labels))
        changed=dict(row,answer_text='Different imported answer')
        effective=self.library.editorial.apply(changed)
        self.assertTrue(effective['stale_review']);self.assertEqual(effective['review_status'],'needs_review')

    def test_absurdity_needs_game_explanation_not_literal_fact_evidence(self):
        row=self.sources[0];payload=self.payload(row,evidence=[],note='Авторский абсурд; зачёт по панчлайну, буквальная правдивость не заявлена')
        payload['patch'].update(genre='absurd',truth_mode='game_convention',age_min=18)
        approved=self.library.editorial.save(row,payload,set(self.library.topic_labels))
        self.assertEqual(approved['review_status'],'approved');self.assertEqual(approved['prompt'],row['prompt'])
        self.assertEqual(approved['age_min'],18)

    def test_factual_claim_in_humorous_question_still_requires_evidence(self):
        row=self.sources[0];payload=self.payload(row,evidence=[])
        payload['patch'].update(genre='humour',truth_mode='factual')
        with self.assertRaises(ValueError):self.library.editorial.save(row,payload,set(self.library.topic_labels))

    def test_text_only_version_omits_answer_pictures_without_deleting_originals(self):
        with self.library.connect() as db:
            source=dict(db.execute(BASE+" WHERE q.pack_id=19726 AND q.theme_id LIKE '%:r3:t4' ORDER BY q.ordinal LIMIT 1").fetchone())
            media=[dict(r) for r in db.execute('SELECT * FROM question_media WHERE question_id=?',(source['id'],))]
        self.assertTrue(media);self.assertTrue(all(m['phase']=='answer' for m in media))
        payload=self.payload(source);payload['patch'].update(media_policy='text_only',genre='parody',truth_mode='game_convention')
        reviewed=self.library.editorial.save(source,payload,set(self.library.topic_labels))
        self.assertEqual(playable(reviewed,media,{}),[])
        self.assertTrue(self.library.question(source['id'])['media'])

    def test_media_question_needs_a_standalone_text_adaptation(self):
        with self.library.connect() as db:
            source=dict(db.execute(BASE+" WHERE q.text_only=0 AND q.prompt!='' AND q.answer_text!='' LIMIT 1").fetchone())
        row=self.library.editorial.apply(source)
        row.update(review_status='approved',checks={k:True for k in CHECKS},media_policy='text_only')
        self.assertIn('standalone_text_adaptation_required',playable(row,[],{}))
        row['prompt']='A standalone adapted question'
        self.assertNotIn('standalone_text_adaptation_required',playable(row,[],{}))

    def test_deterministic_full_themes_and_seen_history(self):
        self.seed();first=self.build();second=self.build()
        ids=lambda p:[q['id'] for t in p['themes'] for q in t['questions']]
        self.assertEqual(ids(first),ids(second));self.assertEqual(first['questions'],10)
        self.assertTrue(all(len(t['questions'])==5 for t in first['themes']))
        qid=ids(first)[0];self.library.workflow.presented(dict(session_id=first['id'],question_id=qid))
        third=self.build();self.assertNotIn(qid,ids(third))
        self.assertEqual(len(self.library.workflow.profiles()),1)

    def test_private_export_preserves_xml_sources_and_public_gate(self):
        self.seed();session=self.build()
        with self.assertRaisesRegex(ValueError,'Публичный экспорт закрыт'):self.library.workflow.export(session['id'],'public')
        with zipfile.ZipFile(BytesIO(self.library.workflow.export(session['id']))) as archive:
            root=ET.fromstring(archive.read('content.xml'))
            questions=[n for n in root.iter() if n.tag.endswith('}question')]
            self.assertEqual(len(questions),10)
            self.assertIn('provenance.json',archive.namelist())
        row=self.sources[0];payload=self.payload(row,revision=1,status='rejected')
        self.library.editorial.save(row,payload,set(self.library.topic_labels))
        # The chosen question might be another source, so reject every question in the snapshot.
        qid=session['themes'][0]['questions'][0]['id'];source=next(r for r in self.sources if r['id']==qid)
        revision=self.library.editorial.review(qid)['revision']
        self.library.editorial.save(source,self.payload(source,revision=revision,status='rejected'),set(self.library.topic_labels))
        with self.assertRaisesRegex(ValueError,'снят с одобрения'):self.library.workflow.export(session['id'])

    def test_play_events_are_real_inputs_idempotent_and_revision_bound(self):
        self.seed();session=self.build();qid=session['themes'][0]['questions'][0]['id']
        event=dict(session_id=session['id'],question_id=qid,participant='Fixture player',correct=True,seconds=12.5,disputed=False,fun=4)
        self.assertFalse(self.library.workflow.record_play(event)['duplicate'])
        self.assertTrue(self.library.workflow.record_play(event)['duplicate'])
        with self.assertRaises(ValueError):self.library.workflow.record_play(dict(event,correct=False))
        result=list(self.library.workflow.calibration().values())[0]
        self.assertEqual(result['n'],1);self.assertFalse(result['calibrated']);self.assertIsNone(result['difficulty'])
        self.assertEqual(self.library.workflow.readiness()['calibration'],self.library.workflow.calibration())

    def test_invalid_age_profile_and_play_inputs_are_rejected(self):
        self.seed()
        with self.assertRaises(ValueError):self.build(party_id='../unsafe')
        with self.assertRaises(ValueError):self.build(themes=0)
        session=self.build()
        with self.assertRaises(ValueError):self.library.workflow.record_play(dict(session_id=session['id'],question_id='other',participant='x',correct=True,seconds=1))

    def test_search_uses_editorial_text_and_original_is_retained(self):
        row=self.sources[0];payload=self.payload(row,status='draft');payload['patch']['prompt']='Уникальныйпроверочныйтермин'
        self.library.editorial.save(row,payload,set(self.library.topic_labels))
        found=self.library.search(dict(q='Уникальныйпроверочныйтермин',mode='literal',mature='show'))
        self.assertEqual(found['total'],1);self.assertEqual(found['items'][0]['id'],row['id'])
        self.assertEqual(self.library.question(row['id'])['original_prompt'],row['prompt'])


class BackupSafetyTests(unittest.TestCase):
    def test_restore_rejects_archive_traversal_before_creating_destination(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'bad.zip';target=Path(folder)/'destination'
            with zipfile.ZipFile(path,'w') as archive:
                archive.writestr('../escape','bad')
                archive.writestr('manifest.json',json.dumps(dict(format_version=1,files=[dict(path='../escape',bytes=3,sha256='bad')])))
            with self.assertRaises(ValueError):restore_into(path,target)
            self.assertFalse(target.exists())

    def test_external_media_cannot_probe_private_network(self):
        with self.assertRaises(ValueError):public_url('file:///private')
        with self.assertRaises(ValueError):public_url('http://127.0.0.1/media.mp4')


if __name__=='__main__':unittest.main(verbosity=2)
