"""A complete draft pass must remain reversible, source-pinned and unapproved."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest

from editorial import Editorial, Conflict, identity, source_revision
from edition_view import catalog, edition_metadata
from full_edition import apply_packet, PACKET
from runtime import Library, BASE


class FullEditionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work=tempfile.TemporaryDirectory(prefix='svoyak-edition-test-')
        cls.library=Library(Path(cls.work.name)/'empty.sqlite3')
        cls.packet=json.loads(PACKET.read_text(encoding='utf-8'))['items']
        with cls.library.connect() as db:cls.sources={r['id']:dict(r) for r in db.execute(BASE)}

    @classmethod
    def tearDownClass(cls):cls.work.cleanup()

    def state(self,name):return Editorial(Path(self.work.name)/(name+'.sqlite3'))

    def test_exact_1113_coverage_and_untouched_starter(self):
        starter=json.loads((PACKET.parent/'starter-reviewed.json').read_text(encoding='utf-8'))['approved']
        new_ids={i['question_id'] for i in self.packet};old_ids={i['question_id'] for i in starter}
        self.assertEqual(len(new_ids),1113);self.assertEqual(len(old_ids),200)
        self.assertFalse(new_ids&old_ids);self.assertEqual(new_ids|old_ids,set(self.sources))
        for i in self.packet:
            self.assertEqual(i['source_hash'],source_revision(self.sources[i['question_id']]))
            self.assertEqual(i['payload']['status'],'needs_review')
            self.assertFalse(i['payload']['checks']['facts']);self.assertFalse(i['payload']['checks']['media'])
            self.assertTrue(i['reason']);self.assertFalse(any(e['role']=='factual' for e in i['payload']['evidence']))

    def test_entire_packet_import_is_valid_and_repeat_preserves_edits(self):
        state=self.state('whole')
        self.assertEqual(apply_packet(self.packet,state)['applied'],1113)
        self.assertEqual(len(state.editions()),1113)
        item=self.packet[0];row=self.sources[item['question_id']]
        p=deepcopy(item['payload']);p.update(revision=1,reviewer='ISOLATED TEST',status='draft');p['patch']['prompt']='A human change in a temporary test DB'
        state.save(row,p,set(self.library.topic_labels))
        self.assertEqual(apply_packet(self.packet,state),dict(applied=0,skipped=1113))
        self.assertEqual(state.apply(row)['prompt'],p['patch']['prompt'])

    def test_failed_import_rolls_back_every_card(self):
        state=self.state('atomic');items=deepcopy(self.packet[:2]);items[-1]['source_hash']='wrong'
        with self.assertRaises(ValueError):apply_packet(items,state)
        self.assertEqual(state.all_reviews(),{});self.assertEqual(state.editions(),{})

    def test_preexisting_human_review_is_not_overwritten(self):
        state=self.state('existing');item=self.packet[0];row=self.sources[item['question_id']]
        state.save(row,item['payload'],set(self.library.topic_labels))
        with self.assertRaisesRegex(ValueError,'will not be overwritten'):apply_packet([item],state)
        self.assertEqual(state.review(row['id'])['revision'],1)

    def test_wording_verdict_never_approves_facts_and_new_revision_resets_it(self):
        state=self.state('verdict');item=self.packet[0];row=self.sources[item['question_id']]
        apply_packet([item],state);record=state.editions()[item['identity']]
        payload=dict(verdict='accepted',revision=1,decision_version=record['updated_at'],reviewer='ISOLATED TEST',note='Wording only')
        state.decide_edition(row,payload)
        current=state.apply(row)
        self.assertEqual(current['review_status'],'needs_review');self.assertFalse(current['checks']['facts'])
        meta=edition_metadata(current,state.editions()[item['identity']]);self.assertEqual(meta['verdict'],'accepted')
        with self.assertRaises(Conflict):state.decide_edition(row,payload)
        p=deepcopy(item['payload']);p['revision']=1;p['patch']['prompt']='Changed after the verdict'
        updated=state.save(row,p,set(self.library.topic_labels))
        meta=edition_metadata(updated,state.editions()[item['identity']])
        self.assertEqual(meta['verdict'],'pending');self.assertTrue(meta['decision_stale'])

    def test_voice_atoms_are_visible_in_real_card(self):
        with self.library.connect() as db:
            qid=db.execute("SELECT id FROM questions WHERE id LIKE '15161:%:r2:t2:q1'").fetchone()[0]
        value=self.library.question(qid)
        self.assertTrue(any(m['type']=='audio' and m['status']=='local' for m in value['media']))
        self.assertIn('voice',value['original_xml'])

    def test_export_hash_is_always_for_immutable_source(self):
        state=self.library.editorial
        apply_packet(self.packet[:1],state)
        data=catalog(self.library,full=True)
        row=next(q for q in data['items'] if q['id']==self.packet[0]['question_id'])
        self.assertEqual(row['source_hash'],source_revision(self.sources[row['id']]))
        self.assertEqual(row['original_prompt'],self.sources[row['id']]['prompt'])
        self.assertEqual(data['summary']['edition_total'],1)


if __name__=='__main__':unittest.main(verbosity=2)
