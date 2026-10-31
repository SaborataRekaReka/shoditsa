"""Retry original missing-media URLs without modifying source or editorial data."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'svoyak'))
from operations import public_url, SafeRedirect
from media_pipeline import sniff

MAX_BYTES = 100 * 1024 * 1024


def fetch(item, output):
    result = dict(item, checkedAt=datetime.now(timezone.utc).isoformat(), status='unresolved', attempts=1)
    partial = None
    try:
        public_url(item['reference'])
        request = urllib.request.Request(item['reference'], headers={
            'User-Agent': 'Mozilla/5.0 (Svoyak owner media recovery)',
            'Accept': 'image/*,audio/*,video/*;q=0.9,*/*;q=0.1'})
        opener = urllib.request.build_opener(SafeRedirect())
        started = time.monotonic()
        with opener.open(request, timeout=15) as response:
            public_url(response.geturl())
            result.update(httpStatus=response.status, finalUrl=response.geturl())
            if response.headers.get_content_type() in ('text/html', 'text/xml', 'application/xml'):
                raise ValueError('Вместо медиа сервер вернул страницу или XML')
            if int(response.headers.get('Content-Length') or 0) > MAX_BYTES:
                raise ValueError('Файл превышает 100 МиБ')
            with tempfile.NamedTemporaryFile(dir=output, suffix='.part', delete=False) as stream:
                partial = Path(stream.name)
                size = 0
                while chunk := response.read(256 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES or time.monotonic() - started > 90:
                        raise ValueError('Превышен лимит размера или времени скачивания')
                    stream.write(chunk)
            if not size:
                raise ValueError('Сервер вернул пустой файл')
        mime, suffix = sniff(partial)
        digest = hashlib.sha256(partial.read_bytes()).hexdigest()
        target = output / 'assets' / digest[:2] / (digest + suffix)
        target.parent.mkdir(parents=True, exist_ok=True)
        partial.replace(target)
        result.update(status='recovered', reason='Файл скачан и технически распознан',
                      assetSha=digest, asset=dict(path=digest[:2]+'/'+digest+suffix, mime=mime, bytes=size))
    except urllib.error.HTTPError as error:
        result.update(httpStatus=error.code, reason=f'Файл не найден (HTTP {error.code})' if error.code == 404
                      else f'Сервер отказал в скачивании (HTTP {error.code})')
    except Exception as error:
        result.update(reason=str(error)[:600])
    finally:
        if partial:
            partial.unlink(missing_ok=True)
    return result


def recover(source, output):
    snapshot = json.loads(source.read_text(encoding='utf-8'))
    output.mkdir(parents=True, exist_ok=False)
    questions = {q['id']: q for q in snapshot['questions']}
    items = []
    for identity, question in snapshot['sources'].items():
        card = questions[question['id']]
        for index, media in enumerate(question['media']):
            if media['status'] == 'available':
                continue
            items.append(dict(id=identity+':media:'+str(index), questionId=question['id'], identity=identity,
                              mediaIndex=index, packId=card['packId'], packTitle=card['packTitle'],
                              theme=card['theme'], prompt=card['prompt'], kind=media['kind'],
                              phase=media['phase'], reference=media['reference']))
    results = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(fetch, item, output) for item in items]
        for future in as_completed(futures):
            results.append(future.result())
            if len(results) % 20 == 0 or len(results) == len(items):
                print(json.dumps(dict(checked=len(results), total=len(items),
                                      recovered=sum(r['status']=='recovered' for r in results))), flush=True)
    results.sort(key=lambda r: (r['questionId'], r['mediaIndex']))
    report = dict(version=1, checkedAt=datetime.now(timezone.utc).isoformat(),
                  summary=dict(total=len(results), recovered=sum(r['status']=='recovered' for r in results),
                               unresolved=sum(r['status']!='recovered' for r in results)), items=results)
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    with (output / 'unresolved.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        fields = ['questionId','packTitle','theme','prompt','kind','phase','reference','httpStatus','reason','checkedAt']
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(r for r in results if r['status'] != 'recovered')
    print(json.dumps(report['summary']), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    recover(args.source.resolve(), args.output.resolve())
