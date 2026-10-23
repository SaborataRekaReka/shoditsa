"""Media workflow invariants, using a disposable copy of editorial state."""
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from editorial import Conflict
from media_pipeline import source_rows,content_metadata
from runtime import Library
from semantic import DATA


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.work=tempfile.TemporaryDirectory(prefix='svoyak-media-test-')
        state=Path(self.work.name)/'editorial.sqlite3'
        with closing(sqlite3.connect(DATA/'editorial.sqlite3')) as a,closing(sqlite3.connect(state)) as b:a.backup(b)
        self.library=Library(state);self.media=self.library.media

    def tearDown(self):self.work.cleanup()

    def payload(self,item,**updates):
        value=dict(media_id=item['id'],revision=item['decision']['revision'],signature=item['signature'],status='approved',actor='ISOLATED TEST',checks=dict(match='pass',readability='pass',sound='not_applicable',spoilers='pass'))
        value.update(updates);return value

    def test_metadata_finds_stream_titles_and_ignores_empty_and_encoder_tags(self):
        tags=content_metadata(dict(format=dict(tags=dict(title='Track',album='"',encoder='ffmpeg')),streams=[dict(tags=dict(TITLE='Answer clue',artist='  '))]))
        self.assertEqual(tags,{'title':'Track','stream_0.TITLE':'Answer clue'})

    def test_downloaded_video_uses_decoded_mime_and_local_bytes(self):
        refs=[r for r in source_rows() if r.get('external_url')]
        found=next(m for r in refs for m in [self.media.find(r['id'],False)] if m['file'] and m['file']['mime'].startswith('video/'))
        self.assertEqual(found['type'],'video');self.assertTrue(found['url'].startswith('/library-media/file:'))
        self.assertEqual(found['source_file']['sha256'],found['file']['sha256'])

    def test_unavailable_media_cannot_be_approved(self):
        ref=next(r for r in source_rows() if 'openquiz.hb.bizmrg.com' in (r.get('external_url') or ''))
        item=self.media.find(ref['id']);self.assertIsNone(item['file'])
        with self.assertRaisesRegex(ValueError,'Недоступный'):self.media.decide(self.payload(item))

    def test_decision_conflict_and_answer_phase_not_applicable(self):
        item=self.media.find('15161:e7239409ce9c:r1:t2:q3:m2')
        payload=self.payload(item,checks=dict(match='pass',readability='pass',sound='not_applicable',spoilers='not_applicable'))
        result=self.media.decide(payload);self.assertEqual(result['decision']['status'],'approved')
        with self.assertRaises(Conflict):self.media.decide(payload)
        self.assertEqual(self.media.find(item['id'])['decision']['revision'],1)

    def test_selection_invalidates_decision_and_session_content_identity(self):
        item=self.media.find('25388:1ad198d73de1:r2:t3:q1:m0');qid=item['question_id']
        original=self.library.question(qid);old_sha=item['source_file']['sha256']
        p=self.payload(item,checks=dict(match='pass',readability='pass',sound='pass',spoilers='pass'))
        self.media.decide(p);before=self.media.find(item['id'])
        payload=dict(media_id=item['id'],signature=before['signature'],revision=0,rendition_id=before['renditions'][0]['id'],actor='ISOLATED TEST')
        selected=self.media.select(payload)
        self.assertEqual(selected['decision']['status'],'pending');self.assertTrue(selected['decision']['stale'])
        self.assertEqual(selected['source_file']['sha256'],old_sha)
        self.assertNotEqual(self.library.question(qid)['content_hash'],original['content_hash'])
        with self.assertRaises(Conflict):self.media.decide(dict(p,revision=1))
        with self.assertRaises(Conflict):self.media.select(payload)
        restored=self.media.select(dict(payload,signature=selected['signature'],revision=1,rendition_id=None))
        self.assertEqual(restored['file']['sha256'],old_sha)
        self.assertEqual(self.library.question(qid)['content_hash'],original['content_hash'])

    def test_render_rejects_unbounded_inputs_and_foreign_sources(self):
        item=self.media.find('25388:1ad198d73de1:r2:t3:q1:m0')
        p=dict(media_id=item['id'],source_sha256=item['source_file']['sha256'],start=0,end=1)
        for change in [dict(start=-1),dict(end=999999),dict(gain_db=float('nan')),dict(masks=[dict(x=0,y=0,w=2,h=1)]),dict(masks='drawbox=anything')]:
            with self.assertRaises(ValueError):self.media.render(dict(p,**change))
        with self.assertRaises(Conflict):self.media.render(dict(p,source_sha256='0'*64))
        silent=self.media.find('24974:33840b52813d:r3:t2:q1:m0')
        with self.assertRaisesRegex(ValueError,'Измеримого звука нет'):
            self.media.render(dict(media_id=silent['id'],source_sha256=silent['source_file']['sha256'],normalize=True))

    def test_catalog_covers_sources_without_accepting_machine_results(self):
        catalog=self.media.catalog();self.assertEqual(catalog['summary']['references'],1325)
        self.assertEqual(catalog['summary']['unavailable'],195)
        self.assertEqual(catalog['summary']['decisions'],{'approved':384,'pending':941})
        self.assertEqual(sum(r['ready'] for r in self.library.workflow.rows()),629)
        for q in catalog['items']:
            for m in q['media']:
                if m['decision']=='approved':
                    self.assertEqual(m['semantic']['method'],'agent_editorial_decision')


if __name__=='__main__':unittest.main()
