"""Reproducible structural checks, bounded media probes and restorable local backups."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import ipaddress
from io import BytesIO
import json
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import zipfile

from editorial import digest, dump, norm, now
from semantic import DATA, REPO


def sha_file(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def backup(include_models=False):
    folder=DATA/'backups';folder.mkdir(exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target=folder/('svoyak-'+stamp+'.zip');partial=target.with_suffix('.part')
    manifest=dict(created_at=now(),format_version=2,models_included=include_models,files=[])
    with tempfile.TemporaryDirectory(prefix='backup-',dir=folder) as work:
        work=Path(work)
        with zipfile.ZipFile(partial,'w',zipfile.ZIP_STORED,allowZip64=True) as archive:
            files=[p for p in DATA.rglob('*') if p.is_file() and not p.is_relative_to(folder)
                   and not p.is_relative_to(DATA/'restore-tests') and not p.is_relative_to(DATA/'exports')
                   and (include_models or not p.is_relative_to(DATA/'models'))
                   and not p.name.endswith(('.part','-wal','-shm','-journal')) and '.building.' not in p.name]
            for source in files:
                relative=source.relative_to(DATA).as_posix();actual=source
                if source.suffix=='.sqlite3':
                    actual=work/source.name
                    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as original, closing(sqlite3.connect(actual)) as snapshot:original.backup(snapshot)
                stored='project/archive/local/svoyak-library/'+relative
                archive.write(actual,stored)
                manifest['files'].append(dict(path=stored,bytes=actual.stat().st_size,sha256=sha_file(actual)))
            for directory,prefix in [(REPO/'scripts/svoyak','project/scripts/svoyak'),(REPO/'qa/svoyak-pilot-2026-10-21','project/qa/svoyak-pilot-2026-10-21')]:
                for source in directory.rglob('*'):
                    if source.is_file() and '__pycache__' not in source.parts and source.suffix in ('.py','.sql','.xsd','.json','.html','.js','.mjs','.css','.txt','.tsv','.md','.ps1'):
                        relative=prefix+'/'+source.relative_to(directory).as_posix()
                        archive.write(source,relative);manifest['files'].append(dict(path=relative,bytes=source.stat().st_size,sha256=sha_file(source)))
            archive.writestr('manifest.json',dump(manifest))
    partial.replace(target)
    result=dict(path=str(target),sha256=sha_file(target),files=len(manifest['files']),bytes=target.stat().st_size,models_included=include_models)
    (folder/'latest.json').write_text(dump(result),encoding='utf-8')
    return result


def restore_into(archive_path,target):
    """Restore to a NEW directory only. Does not overwrite the running library."""
    target=Path(target).resolve()
    if target.exists():raise ValueError('Restore destination must not already exist')
    with zipfile.ZipFile(archive_path) as archive:
        manifest=json.loads(archive.read('manifest.json'))
        if manifest.get('format_version') not in (1,2):raise ValueError('Unsupported backup format')
        if len(manifest['files'])>20000:raise ValueError('Too many backup entries')
        for record in manifest['files']:
            path=(target/record['path']).resolve()
            if not path.is_relative_to(target) or Path(record['path']).is_absolute():raise ValueError('Unsafe backup path')
            info=archive.getinfo(record['path'])
            if info.file_size!=record['bytes'] or info.file_size>3*1024**3:raise ValueError('Invalid backup entry size')
        target.mkdir(parents=True)
        for record in manifest['files']:
            path=target/record['path'];path.parent.mkdir(parents=True,exist_ok=True)
            with archive.open(record['path']) as source,path.open('wb') as output:shutil.copyfileobj(source,output)
            if sha_file(path)!=record['sha256']:raise ValueError('Backup checksum mismatch: '+record['path'])
    data=target/('data' if manifest['format_version']==1 else 'project/archive/local/svoyak-library')
    for path in data.glob('*.sqlite3'):
        with closing(sqlite3.connect(path)) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Restored database failed validation')
    return dict(restored_to=str(target),files=len(manifest['files']),integrity='ok',format_version=manifest['format_version'],models_included=manifest.get('models_included',False))


def restore_test(archive_path):
    folder=DATA/'restore-tests';folder.mkdir(exist_ok=True)
    # TemporaryDirectory is confined to this explicitly named local test directory.
    with tempfile.TemporaryDirectory(prefix='verified-',dir=folder) as work:
        result=restore_into(Path(archive_path),Path(work)/'restored')
        if result['format_version']==2 and result['models_included']:
            project=Path(work)/'restored/project'
            check=subprocess.run([sys.executable,'-X','utf8',str(project/'scripts/svoyak/manage.py'),'check'],cwd=project,capture_output=True,text=True,encoding='utf-8',timeout=90)
            if check.returncode:raise ValueError('Restored offline runtime failed: '+check.stderr[-500:])
            result['offline_runtime']='passed'
        result.pop('restored_to')
    result.update(tested_at=now(),archive_sha256=sha_file(Path(archive_path)))
    (DATA/'restore-test.json').write_text(dump(result),encoding='utf-8')
    return result


def public_url(url):
    parsed=urlsplit(url)
    if parsed.scheme not in ('https','http') or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None,80,443):raise ValueError('Unsupported external URL')
    addresses=socket.getaddrinfo(parsed.hostname,parsed.port or (443 if parsed.scheme=='https' else 80),type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):raise ValueError('Non-public external destination')
    return url


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        public_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)


def probe_external(url):
    try:
        public_url(url)
        request=urllib.request.Request(url,method='HEAD',headers={'User-Agent':'SvoyakLocalLibrary/1.0'})
        opener=urllib.request.build_opener(SafeRedirect())
        try:response=opener.open(request,timeout=8)
        except urllib.error.HTTPError as exc:
            if exc.code not in (403,405):raise
            request=urllib.request.Request(url,headers={'User-Agent':'SvoyakLocalLibrary/1.0','Range':'bytes=0-1023'})
            response=opener.open(request,timeout=8)
        with response:
            mime=response.headers.get_content_type();final=response.geturl();public_url(final)
            return dict(status='reachable' if mime.startswith(('image/','audio/','video/')) else 'unexpected_content',
                        http_status=response.status,mime=mime,final_url=final,
                        note='Проверена доступность, содержание не просмотрено; внешний файл исключён из готовых паков')
    except Exception as exc:return dict(status='unavailable',error=str(exc)[:300])


def audit_media(state,external=True):
    db=sqlite3.connect(DATA/'library.sqlite3');db.row_factory=sqlite3.Row
    assets=[dict(r) for r in db.execute('SELECT a.*,p.archive_path FROM assets a JOIN packs p ON p.id=a.pack_id')]
    references=[dict(r) for r in db.execute('SELECT * FROM question_media')];db.close()
    ffprobe=shutil.which('ffprobe');asset_results={}
    for index,asset in enumerate(assets):
        result=dict(status='unknown',mime=asset['mime'])
        try:
            with zipfile.ZipFile(REPO/asset['archive_path']) as archive:content=archive.read(asset['entry_name'])
            if hashlib.sha256(content).hexdigest()!=asset['sha256']:raise ValueError('SHA256 mismatch')
            if asset['mime'].startswith('image/'):
                from PIL import Image
                with Image.open(BytesIO(content)) as picture:
                    result.update(width=picture.width,height=picture.height,format=picture.format)
                    picture.verify()
                result['status']='ok'
            elif asset['mime'].startswith(('audio/','video/')) and ffprobe:
                with tempfile.NamedTemporaryFile(suffix=Path(asset['entry_name']).suffix,delete=False,dir=DATA) as file:
                    path=Path(file.name);file.write(content)
                try:
                    output=subprocess.run([ffprobe,'-v','error','-show_format','-show_streams','-of','json',str(path)],capture_output=True,text=True,timeout=20)
                    if output.returncode:raise ValueError(output.stderr[:200])
                    data=json.loads(output.stdout);duration=float(data.get('format',{}).get('duration') or 0)
                    streams=[dict(codec=s.get('codec_name'),type=s.get('codec_type'),width=s.get('width'),height=s.get('height')) for s in data.get('streams',[])]
                    if not streams:raise ValueError('No playable streams')
                    result.update(status='ok',duration=duration,streams=streams,
                                  note='Контейнер и потоки прочитаны; громкость и смысл требуют редакторской проверки')
                finally:path.unlink(missing_ok=True)
            else:result['note']='Нет подходящего декодера; требуется проверка'
        except Exception as exc:result=dict(status='error',error=str(exc)[:300])
        asset_results[asset['id']]=result
        if (index+1)%100==0:print(f'Media assets checked: {index+1}/{len(assets)}',flush=True)
    external_results={}
    urls=sorted({r['external_url'] for r in references if r['external_url']})
    if external:
        with ThreadPoolExecutor(max_workers=6) as executor:
            for index,(url,result) in enumerate(zip(urls,executor.map(probe_external,urls))):
                external_results[url]=result
                if (index+1)%30==0:print(f'External URLs checked: {index+1}/{len(urls)}',flush=True)
    results=[]
    with state.connect() as connection:
        for item in references:
            result=asset_results.get(item['asset_id']) or external_results.get(item['external_url']) or dict(status='unknown')
            if not external and item['external_url']:continue
            values=(item['id'],digest([item['reference'],item['asset_id']]),result['status'],dump(result),now())
            connection.execute('INSERT OR REPLACE INTO media_checks VALUES (?,?,?,?,?)',values)
            results.append(dict(media_id=item['id'],**result))
    report=dict(checked_at=now(),assets=len(assets),references=len(references),references_checked=len(results),
                unique_external_urls=len(urls),external_urls_checked=len(external_results),external_probe_performed=external,
                asset_status=dict(Counter(r['status'] for r in asset_results.values())),reference_status=dict(Counter(r['status'] for r in results)),items=results)
    (DATA/'media-audit.json').write_text(dump(report),encoding='utf-8')
    return {k:v for k,v in report.items() if k!='items'}


def quality(library):
    rows=library.workflow.rows();findings=[]
    with library.connect() as db:
        integrity=db.execute('PRAGMA integrity_check').fetchone()[0];foreign_keys=[tuple(r) for r in db.execute('PRAGMA foreign_key_check')]
        embeddings=db.execute('SELECT count(*) FROM embeddings').fetchone()[0]
        packs=[dict(r) for r in db.execute('SELECT * FROM packs')]
    for row in rows:
        flags=[]
        if not row['prompt'] and not row['media']:flags.append('missing_question')
        if not row['answer_text'] and not any(m['phase']=='answer' for m in row['media']):flags.append('missing_answer')
        if row['answer_text'] in ('A','B','C','D','E','F'):flags.append('option_key_answer_requires_review')
        if len(norm(row['answer_text']))>=5 and norm(row['answer_text']) in norm(row['prompt']):flags.append('possible_answer_leak')
        if row['review_status']=='approved' and row['blockers']:flags.append('approved_but_not_playable')
        if row.get('stale_review'):flags.append('stale_review')
        for flag in flags:
            reviewed_convention=flag=='possible_answer_leak' and row['review_status']=='approved' and row['truth_mode']=='game_convention' and row['checks'].get('clarity')
            findings.append(dict(question_id=row['id'],rule=flag,status='not_applicable' if reviewed_convention else 'unresolved',
                                 note='Проверенная игровая условность; совпадение текста ответа с частью условия не является само по себе спойлером.' if reviewed_convention else ''))
    sources=[]
    for pack in packs:
        path=REPO/pack['archive_path'];ok=path.exists() and sha_file(path)==pack['archive_sha256']
        sources.append(dict(pack_id=pack['id'],sha256_matches=ok))
    readiness=library.workflow.readiness()
    report=dict(created_at=now(),scope=dict(questions=len(rows),database_sha256=sha_file(DATA/'library.sqlite3')),
        structural_coverage=len(rows),integrity=integrity,foreign_key_errors=foreign_keys,embedding_count=embeddings,
        archives=sources,findings=findings,ready=readiness,
        structural_pass=integrity=='ok' and not foreign_keys and embeddings==len(rows) and all(p['sha256_matches'] for p in sources),
        full_content_ready=all(r['ready'] for r in rows),public_ready=readiness['public_playable']>0 and readiness['public_playable']==readiness['playable'])
    (DATA/'quality-report.json').write_text(dump(report),encoding='utf-8')
    export=[dict(id=r['id'],prompt=r['prompt'],answer_text=r['answer_text'],theme=r.get('editorial_theme') or r['theme_name'],
                 genre=r['genre'],truth_mode=r['truth_mode'],content_hash=r['content_hash'],media_policy=r['media_policy'],
                 raw_sha256=r['raw_sha256'],source_url=r['source_url']) for r in rows]
    (DATA/'factcheck-input.json').write_text(dump(export),encoding='utf-8')
    (DATA/'research-disposition.jsonl').write_text('\n'.join(dump(dict(question_id=r['id'],content_hash=r['content_hash'],
        status=('pass' if r['truth_mode']=='factual' else 'not_applicable') if r['ready'] else 'unresolved',
        genre=r['genre'],truth_mode=r['truth_mode'],game_review='pass' if r['ready'] else 'unresolved',evidence=r['evidence'],reason=r['blockers'])) for r in rows)+'\n',encoding='utf-8')
    return {k:v for k,v in report.items() if k not in ('ready','findings','archives')} | dict(playable=readiness['playable'],findings=len(findings))
