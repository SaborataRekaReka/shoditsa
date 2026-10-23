"""Structural and retrieval tests; these do not certify the factual correctness of packs."""
import json
import sqlite3
import unittest
import xml.etree.ElementTree as ET

from build import atoms_for,media_reference,answer_options
from runtime import Library
from semantic import DATA


class ParsingTests(unittest.TestCase):
    def test_legacy_voice_atom_is_playable_audio(self):
        asset={'id':'test-audio'}
        value=media_reference({'text':'@clip.mp3','type':'voice','phase':'question'}, {'audio/clip.mp3':asset})
        self.assertEqual(value['type'],'audio')
        self.assertEqual(value['asset_id'],'test-audio')
        self.assertEqual(value['status'],'local')

    def test_v4_answer_marker_does_not_leak_answer_into_prompt(self):
        node=ET.fromstring('<question><scenario><atom>Question</atom><atom type="marker"/><atom type="image">@answer.png</atom></scenario></question>')
        atoms=atoms_for(node)
        self.assertEqual([(a['type'],a['phase']) for a in atoms],[('text','question'),('marker','answer'),('image','answer')])

    def test_v5_content_and_answer_are_separate(self):
        node=ET.fromstring('<question><params><param name="question" type="content"><item>Question</item><item type="image" isRef="True">file.png</item></param><param name="answer" type="content"><item>Answer</item></param></params></question>')
        atoms=atoms_for(node)
        self.assertEqual([a['text'] for a in atoms if a['phase']=='question'],['Question','file.png'])
        self.assertEqual(atoms[-1]['phase'],'answer')

    def test_external_media_is_preserved_without_network_request(self):
        result=media_reference({'text':'https://example.test/movie.mp4','type':'text','phase':'question'}, {})
        self.assertEqual(result['status'],'external_unchecked')
        self.assertEqual(result['type'],'video')

    def test_select_options_are_preserved_and_answer_key_resolves(self):
        node=ET.fromstring('<question><params><param name="question" type="content"><item>Who?</item></param><param name="answerOptions" type="group"><param name="A" type="content"><item>Cook</item></param><param name="B" type="content"><item>Wine specialist</item></param></param></params><right><answer>B</answer></right></question>')
        self.assertEqual(answer_options(node)['B'],'Wine specialist')
        self.assertIn('B) Wine specialist',[a['text'] for a in atoms_for(node)])


class LibraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.library=Library()

    def test_source_coverage_and_integrity(self):
        with self.library.connect() as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])
            self.assertEqual(db.execute('SELECT count(*) FROM packs').fetchone()[0],9)
            self.assertEqual(db.execute('SELECT count(*) FROM questions').fetchone()[0],1313)
            self.assertEqual(db.execute('SELECT count(*) FROM embeddings').fetchone()[0],1313)
            self.assertEqual(db.execute('SELECT count(DISTINCT question_id) FROM question_topics').fetchone()[0],1313)
            self.assertEqual(db.execute('SELECT count(*) FROM adaptations').fetchone()[0],15)
            self.assertEqual(db.execute('SELECT count(*) FROM question_media WHERE status="local_missing"').fetchone()[0],0)

    def test_semantic_queries_return_relevant_categories(self):
        for query,topics in [('страны и столицы',{'geography'}),('пища и пряности',{'food'}),('необычные технические устройства',{'technology','games'})]:
            results=self.library.search({'q':query,'limit':'8','mature':'show','text_only':'1'})['items']
            self.assertTrue(results,query)
            self.assertTrue(any(t['topic_slug'] in topics for q in results for t in q['topics']),query)

    def test_filter_and_party_do_not_repeat_answers(self):
        selection=self.library.party({'count':'15','text_only':'1','mature':'hide','seed':'test'})
        self.assertLessEqual(selection['total'],15)
        ids=[q['id'] for q in selection['items']]
        self.assertEqual(len(set(ids)),selection['total'])
        with self.library.connect() as db:
            rows=[db.execute('SELECT * FROM questions WHERE id=?',(qid,)).fetchone() for qid in ids]
            self.assertEqual(len({q['answer_key'] for q in rows}),selection['total'])
            self.assertTrue(all(q['text_only'] and not q['mature_hint'] for q in rows))
            self.assertTrue(all(q['review_status']=='approved' for q in selection['items']))
        result=self.library.search({'pack':'15714','topic':'geography','text_only':'1','limit':'100'})
        self.assertTrue(result['items'])
        self.assertTrue(all(q['pack_id']==15714 and q['text_only'] for q in result['items']))

    def test_search_text_is_not_executed_as_sql(self):
        self.library.search({'q':'" OR 1=1; DROP TABLE questions; --','mode':'literal'})
        self.assertEqual(self.library.stats()['questions'],1313)

    def test_theme_context_does_not_create_unrelated_subjects(self):
        with self.library.connect() as db:
            for query,expected,forbidden in [('Где жил Карлсон?', 'fiction','food'),('Как называют самца у кур?','nature','language')]:
                qid=db.execute('SELECT id FROM questions WHERE prompt=?',(query,)).fetchone()[0]
                categories={t['topic_slug'] for t in self.library.topics[qid]}
                self.assertIn(expected,categories)
                self.assertNotIn(forbidden,categories)


if __name__=='__main__':unittest.main(verbosity=2)
