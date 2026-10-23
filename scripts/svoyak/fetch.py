"""Download the selected packs atomically, reusing the four existing local copies."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sys
import time
import urllib.request
import zipfile

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / 'archive' / 'local' / 'svoyak-library'
PACKS = DATA / 'packs'
LEGACY = REPO / 'tmp' / 'svoyak-pilot-2026-10-21'
CATALOG = json.loads(Path(__file__).with_name('packs.json').read_text(encoding='utf-8'))


def check_archive(path):
    with zipfile.ZipFile(path) as archive:
        info = next(n for n in archive.infolist() if n.filename.casefold() == 'content.xml')
        if info.file_size > 15 * 1024 * 1024:
            raise ValueError('content.xml is too large')
        archive.read(info)  # Verify XML CRC before accepting a download.


def fetch(source):
    result = dict(source, page_url=f"https://www.sibrowser.ru/packages/{source['id']}",
                  downloaded_at=datetime.now(timezone.utc).isoformat())
    result['download_url'] = result['page_url'] + '/direct_download'
    path = PACKS / f"{source['id']}.siq"
    part = path.with_suffix('.siq.part')
    for attempt in range(3):
        try:
            if not path.exists():
                previous = LEGACY / path.name
                if previous.exists():
                    check_archive(previous)
                    shutil.copy2(previous, part)
                    result['reused_existing_download'] = True
                else:
                    request = urllib.request.Request(result['download_url'], headers={'User-Agent':'Mozilla/5.0 (local SIQ reader)'})
                    with urllib.request.urlopen(request, timeout=40) as response, part.open('wb') as out:
                        result['resolved_host'] = urllib.parse.urlsplit(response.url).hostname
                        size = 0
                        while chunk := response.read(1024 * 1024):
                            size += len(chunk)
                            if size > 256 * 1024 * 1024:
                                raise ValueError('Package exceeds the 256 MiB download limit')
                            out.write(chunk)
                    check_archive(part)
                part.replace(path)
            check_archive(path)
            with path.open('rb') as archive:
                result.update(status='downloaded', bytes=path.stat().st_size,
                              sha256=hashlib.file_digest(archive,'sha256').hexdigest(),
                              archive_path=str(path.relative_to(REPO)))
            return result
        except Exception as exc:
            result['error'] = f'{type(exc).__name__}: {exc}'
            if part.exists():
                assert part.resolve().is_relative_to(PACKS.resolve())
                part.unlink()
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
    result['status'] = 'failed'
    return result


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    PACKS.mkdir(parents=True,exist_ok=True)
    results = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(fetch, source): source for source in CATALOG}
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            print(json.dumps({k:result[k] for k in ['id','title','status','bytes','error'] if k in result},ensure_ascii=False),flush=True)
    results.sort(key=lambda p: next(i for i,s in enumerate(CATALOG) if s['id']==p['id']))
    (DATA/'sources.json').write_text(json.dumps({'sources':results},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    if any(p['status']!='downloaded' for p in results):
        sys.exit(1)
