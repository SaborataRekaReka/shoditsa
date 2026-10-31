"""Export a read-only snapshot of the entire local Svoyak editorial library.

Does not approve questions, update SQLite, fetch external URLs, or record plays.
Only the resulting admin snapshot and referenced media are prepared for upload.
"""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import zipfile


def export(source, destination):
    source = source.resolve()
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=False)
    sys.path.insert(0, str(source / 'scripts/svoyak'))
    from runtime import Library
    from editorial import Editorial, identity, now
    from workflow import Workflow
    from media_workflow import MediaWorkflow
    from media_pipeline import file_path

    data = source / 'archive/local/svoyak-library'
    # sqlite backup includes any WAL consistently; source connections are read-only.
    for name in ('library.sqlite3', 'editorial.sqlite3'):
        with closing(sqlite3.connect((data / name).as_uri() + '?mode=ro', uri=True)) as src:
            with closing(sqlite3.connect(destination / name)) as dst:
                src.backup(dst)
    library = Library.__new__(Library)
    library.path = destination / 'library.sqlite3'
    library.editorial = Editorial.__new__(Editorial)
    library.editorial.path = destination / 'editorial.sqlite3'
    library.topics = defaultdict(list)
    with library.connect() as db:
        for row in db.execute('SELECT qt.*,t.label FROM question_topics qt JOIN topics t ON t.slug=qt.topic_slug ORDER BY score DESC'):
            library.topics[row['question_id']].append(dict(row))
        library.topic_labels = dict(db.execute('SELECT slug,label FROM topics'))
        rows = db.execute('SELECT id FROM questions ORDER BY id').fetchall()
        packs = [dict(r) for r in db.execute('SELECT id,title FROM packs ORDER BY id')]
        assets = {r['id']: dict(r) for r in db.execute('SELECT a.*,p.archive_path FROM assets a JOIN packs p ON p.id=a.pack_id')}
    library.workflow = Workflow(library)
    library.media = MediaWorkflow(library)
    files, manifest, questions, sources = {}, {}, [], {}
    suffixes = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
                'image/bmp': '.bmp', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
                'audio/ogg': '.ogg', 'audio/flac': '.flac', 'video/mp4': '.mp4', 'video/webm': '.webm',
                'audio/mp4': '.m4a', 'audio/webm': '.webm', 'video/quicktime': '.mov'}

    def persist(content, mime, expected):
        sha = hashlib.sha256(content).hexdigest()
        if expected and sha != expected:
            raise ValueError('Source media checksum mismatch: ' + expected)
        suffix = suffixes.get(mime, '.bin')
        name = sha[:2] + '/' + sha + suffix
        if sha not in manifest:
            target = destination / 'assets' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            manifest[sha] = dict(path=name, mime=mime, bytes=len(content))
        return '/api/v1/admin/svoyak/library/media/' + sha

    def medium(item, original=False):
        record = item.get('source_file') if original else item.get('file')
        url, mime = None, ''
        if record:
            full = library.media.file(record['id'])
            path = file_path(full)
            mime = full['mime']
            url = persist(path.read_bytes(), mime, full['sha256'])
        elif item.get('id') and item.get('asset_id') in assets:
            asset = assets[item['asset_id']]
            archive = Path(asset['archive_path'])
            if not archive.is_absolute():
                archive = source / archive
            with zipfile.ZipFile(archive) as z:
                mime = asset['mime'] or ''
                url = persist(z.read(asset['entry_name']), mime, asset['sha256'])
        kind = mime.split('/')[0] if mime else item.get('type', item.get('original_type', 'image'))
        if kind == 'voice': kind = 'audio'
        if kind not in ('image', 'audio', 'video'): kind = item.get('original_type', 'image')
        phase = 'answer' if item.get('phase') == 'answer' else 'question'
        return dict(kind=kind, phase=phase, caption='', url=url, reference=item.get('external_url') or item.get('reference', ''),
                    status='available' if url else 'unavailable', issues=item.get('issues', []),
                    review=item.get('decision', {}).get('status', 'pending'))

    for row in rows:
        q = library.question(row['id'])
        media = [medium(m) for m in q['media']]
        originals = [medium(m, True) for m in q['media']]
        playable_media = [{k: m[k] for k in ('kind', 'url', 'caption', 'phase')} for m in media if m['url']]
        questions.append(dict(id=q['id'], hash=q['content_hash'], themeId=q.get('editorial_theme') or f"{q['pack_id']}:{q['theme_name']}",
                              theme=q.get('editorial_theme') or q['theme_name'], topic=q['topics'][0]['topic_slug'] if q['topics'] else 'everyday',
                              packId=q['pack_id'], packTitle=q['pack_title'], prompt=q['prompt'], answer=q['answer'], aliases=q.get('aliases') or [],
                              note=q.get('host_note') or '', source=q['source_url'], difficulty=q.get('difficulty') or 3, age=q.get('age_min') if q.get('age_min') is not None else 18,
                              duplicateIds=[r['id'] for r in q['related'] if r['kind'] in ('exact_duplicate', 'possible_duplicate')],
                              media=playable_media if q['media_policy'] != 'text_only' else [], enabled=False))
        sources[identity(q['id'])] = dict(id=q['id'], originalPrompt=q['original_prompt'], originalAnswer=q['original_answer'],
                                         originalHash=q['raw_sha256'], reviewStatus=q['review_status'], blockers=q['blockers'],
                                         checks=q.get('checks') or {}, evidence=q.get('evidence') or [], revision=q['editorial_revision'],
                                         genre=q.get('genre'), mediaPolicy=q['media_policy'], format=q['format'],
                                         media=media, originalMedia=originals, originalAtoms=q['original_atoms'],
                                         history=q['history'], edition=q.get('edition'), reviewNote=q.get('review_note') or '')
    summary = dict(total=len(questions), packs=len(packs), withMedia=sum(bool(s['media']) for s in sources.values()),
                   unavailableMedia=sum(m['status'] != 'available' for s in sources.values() for m in s['media']),
                   assets=len(manifest), bytes=sum(a['bytes'] for a in manifest.values()))
    snapshot = dict(version=1, importedAt=now(), summary=summary, questions=questions, sources=sources, assets=manifest,
                    packs=[dict(**p, total=sum(q['packId'] == p['id'] for q in questions), playable=0, topics=[]) for p in packs],
                    topics=[dict(id=k, label=v, playable=0) for k,v in library.topic_labels.items()])
    (destination / 'library.json').write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    export(args.source, args.destination)
