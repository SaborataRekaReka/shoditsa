"""Snapshot coverage, file checksums and limits of the local media edition."""
from collections import Counter
import hashlib
import json

from editorial import dump,now
from media_pipeline import ROOT,ANALYSIS,file_path
from runtime import Library
from semantic import DATA,REPO


def report():
    library=Library()
    with library.editorial.connect() as db:
        files=[dict(r) for r in db.execute('SELECT * FROM media_files')]
        versions=[dict(r) for r in db.execute('SELECT * FROM media_renditions')]
        counts={name:db.execute('SELECT count(*) FROM '+name).fetchone()[0] for name in ('media_decisions','media_selections','play_events')}
        external=dict(db.execute('SELECT status,count(*) FROM media_fetch GROUP BY status'))
    originals=[r for r in files if json.loads(r['source_json']).get('kind')!='rendition']
    errors=[]
    for record in files:
        with file_path(record).open('rb') as stream:actual=hashlib.file_digest(stream,'sha256').hexdigest()
        if actual!=record['sha256']:errors.append(record['id'])
    technical=Counter(json.loads(r['analysis_json']).get('status','unknown') for r in originals)
    methods=Counter(r['mime'].split('/')[0] for r in originals)
    previews=sum(len(json.loads(r['analysis_json']).get('previews',[])) for r in originals)
    ocr=sum((ANALYSIS/r['sha256']/f'ocr-{i}.json').is_file() for r in originals for i in range(len(json.loads(r['analysis_json']).get('previews',[]))))
    transcripts=sum((ANALYSIS/r['sha256']/'transcript.json').is_file() for r in originals)
    review=json.loads((ROOT/'review-report.json').read_text(encoding='utf-8'))
    result=dict(checked_at=now(),source_database_sha256=hashlib.sha256((DATA/'library.sqlite3').read_bytes()).hexdigest(),
        coverage=review,external=external,technical=dict(unique_originals=len(originals),original_types=dict(methods),decode_status=dict(technical),
            checked_files=len(files),checksum_errors=errors,control_images=previews,ocr_results=ocr,asr_results=transcripts),
        renditions=dict(active=len(versions),metadata_only=sum(bool(json.loads(v['params_json']).get('metadata_only')) for v in versions),
            masked=sum(bool(json.loads(v['params_json']).get('masks')) for v in versions),
            av_levels_or_trim=sum(not json.loads(v['params_json']).get('metadata_only') and not json.loads(v['params_json']).get('masks') for v in versions)),
        human_state=counts,full_semantic_verified=False,
        limits=['195 внешних файлов недоступны: HTTP 404 исходного хранилища.',
                'Видео просмотрены по контрольным кадрам; полного просмотра всех роликов нет.',
                'Звук измерен, OCR/ASR использованы как подсказки. Полное прослушивание и подтверждение произведений/эпизодов не выполнены.',
                'Личности реальных людей по лицам/голосам не устанавливались.',
                'Оригиналы сохранены. Варианты не выбраны и не приняты автоматически.'])
    for path in (ROOT/'final-report.json',REPO/'qa/svoyak-pilot-2026-10-21/media-edition-report.json'):
        path.write_text(dump(result),encoding='utf-8')
    print(dump(result),flush=True)
    if errors or technical.get('error'):raise SystemExit(1)


if __name__=='__main__':report()
