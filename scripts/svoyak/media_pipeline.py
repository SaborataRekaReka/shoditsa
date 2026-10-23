"""Local media acquisition and reproducible diagnostics. Measurements are not semantic approval."""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
from datetime import datetime,timezone
import hashlib
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
import zipfile

from editorial import Editorial,dump,digest,identity,now,source_revision
from semantic import DATA,REPO
from operations import public_url,SafeRedirect

ROOT=DATA/'media'
OBJECTS=ROOT/'objects'
ANALYSIS=ROOT/'analysis'
FFMPEG=shutil.which('ffmpeg')
FFPROBE=shutil.which('ffprobe')
MAX_FILE=100*1024*1024


def source_rows():
    with closing(sqlite3.connect(DATA/'library.sqlite3')) as db:
        db.row_factory=sqlite3.Row
        return [dict(r) for r in db.execute('SELECT m.*,a.sha256 AS asset_sha256,a.entry_name,a.mime,p.archive_path FROM question_media m JOIN questions q ON q.id=m.question_id JOIN packs p ON p.id=q.pack_id LEFT JOIN assets a ON a.id=m.asset_id ORDER BY m.question_id,m.ordinal')]


def file_path(record):
    path=(DATA/record['path']).resolve()
    if not path.is_relative_to(ROOT.resolve()) or not path.is_file():raise ValueError('Media file unavailable')
    return path


def sniff(path,declared=''):
    from PIL import Image
    try:
        with Image.open(path) as im:
            im.verify();fmt=(im.format or '').lower()
        return {'jpeg':('image/jpeg','.jpg'),'png':('image/png','.png'),'webp':('image/webp','.webp'),'gif':('image/gif','.gif'),'bmp':('image/bmp','.bmp')}[fmt]
    except Exception:pass
    probe=subprocess.run([FFPROBE,'-v','error','-show_streams','-show_format','-of','json',str(path)],capture_output=True,text=True,timeout=25)
    if probe.returncode:raise ValueError('Content is not decodable image/audio/video')
    value=json.loads(probe.stdout);streams=value.get('streams',[]);container=value.get('format',{}).get('format_name','')
    if any(s.get('codec_type')=='video' and not s.get('disposition',{}).get('attached_pic') for s in streams):
        if 'webm' in container:return 'video/webm','.webm'
        if 'avi' in container:return 'video/x-msvideo','.avi'
        if 'matroska' in container:return 'video/x-matroska','.mkv'
        if 'mpegts' in container:return 'video/mp2t','.ts'
        if container=='mpeg':return 'video/mpeg','.mpg'
        return 'video/mp4','.mp4'
    if any(s.get('codec_type')=='audio' for s in streams):
        codec=next(s.get('codec_name') for s in streams if s.get('codec_type')=='audio')
        return ('audio/mpeg','.mp3') if codec=='mp3' else ('audio/ogg','.ogg') if codec in ('vorbis','opus') and 'ogg' in container else ('audio/flac','.flac') if codec=='flac' else ('audio/wav','.wav') if codec.startswith('pcm_') else ('audio/aac','.aac') if container=='aac' else ('audio/mp4','.m4a')
    raise ValueError('No audiovisual streams')


def store_file(state,path,source,declared=''):
    mime,ext=sniff(path,declared)
    sha=hashlib.sha256(path.read_bytes()).hexdigest();target=OBJECTS/(sha+ext);OBJECTS.mkdir(parents=True,exist_ok=True)
    if not target.exists():shutil.copyfile(path,target)
    record=dict(id='file:'+sha,sha256=sha,path=target.relative_to(DATA).as_posix(),mime=mime,bytes=target.stat().st_size,source_json=dump(source),created_at=now())
    with state.connect() as db:
        db.execute('INSERT OR IGNORE INTO media_files(id,sha256,path,mime,bytes,source_json,created_at) VALUES(?,?,?,?,?,?,?)',tuple(record.values()))
    return record


def download_one(url):
    started=time.monotonic();part=None
    try:
        public_url(url)
        opener=urllib.request.build_opener(SafeRedirect())
        request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (Svoyak local media library)','Accept':'image/*,audio/*,video/*;q=0.9,*/*;q=0.1'})
        with opener.open(request,timeout=12) as response:
            public_url(response.geturl())
            length=int(response.headers.get('Content-Length') or 0)
            if length>MAX_FILE:raise ValueError('File exceeds 100 MiB')
            if response.headers.get_content_type() in ('text/html','application/xml','text/xml'):raise ValueError('Server returned a webpage/error document')
            with tempfile.NamedTemporaryFile(dir=ROOT,suffix='.part',delete=False) as stream:
                part=Path(stream.name);size=0
                while chunk:=response.read(256*1024):
                    size+=len(chunk)
                    if size>MAX_FILE or time.monotonic()-started>90:raise ValueError('Download size/time limit')
                    stream.write(chunk)
            if not size:raise ValueError('Empty response')
            return dict(url=url,status='downloaded',part=str(part),details=dict(http_status=response.status,final_url=response.geturl(),declared_mime=response.headers.get_content_type(),bytes=size,etag=response.headers.get('ETag'),last_modified=response.headers.get('Last-Modified')))
    except Exception as exc:
        if part:part.unlink(missing_ok=True)
        return dict(url=url,status='unavailable',details=dict(http_status=getattr(exc,'code',None),error=str(exc)[:500]))


def acquire(state,retry=False):
    ROOT.mkdir(parents=True,exist_ok=True)
    refs=source_rows()
    with state.connect() as db:previous={r['url']:dict(r) for r in db.execute('SELECT * FROM media_fetch')}
    urls=sorted({r['external_url'] for r in refs if r['external_url']})
    todo=[u for u in urls if retry or u not in previous]
    with ThreadPoolExecutor(max_workers=6) as executor:
        for i,future in enumerate(as_completed([executor.submit(download_one,u) for u in todo]),1):
            result=future.result();record=None
            if result.get('part'):
                path=Path(result['part'])
                try:record=store_file(state,path,dict(kind='external',url=result['url'],**result['details']));result['details']['sha256']=record['sha256']
                except Exception as exc:result.update(status='invalid_content');result['details']['error']=str(exc)[:500]
                finally:path.unlink(missing_ok=True)
            with state.connect() as db:
                db.execute('INSERT OR REPLACE INTO media_fetch VALUES(?,?,?,?,?)',(result['url'],result['status'],record['id'] if record else None,dump(result['details']),now()))
            if i%20==0 or i==len(todo):print(f'External files: {i}/{len(todo)}',flush=True)
    with state.connect() as db:known={r[0] for r in db.execute('SELECT sha256 FROM media_files')}
    assets={r['asset_id']:r for r in refs if r['asset_id']}
    count=0
    for ref in assets.values():
        if ref['asset_sha256'] in known:continue
        with zipfile.ZipFile(REPO/ref['archive_path']) as archive:content=archive.read(ref['entry_name'])
        if hashlib.sha256(content).hexdigest()!=ref['asset_sha256']:raise ValueError('Original archive asset checksum changed')
        with tempfile.NamedTemporaryFile(dir=ROOT,suffix=Path(ref['entry_name']).suffix,delete=False) as stream:path=Path(stream.name);stream.write(content)
        try:store_file(state,path,dict(kind='pack',asset_id=ref['asset_id'],archive=ref['archive_path'],entry=ref['entry_name']),ref['mime'])
        finally:path.unlink(missing_ok=True)
        count+=1
        if count%200==0:print('Local media extracted:',count,flush=True)
    return acquisition_report(state)


def acquisition_report(state):
    with state.connect() as db:
        result=dict(checked_at=now(),external=dict(db.execute('SELECT status,count(*) FROM media_fetch GROUP BY status')),
                    files=db.execute('SELECT count(*) FROM media_files').fetchone()[0],bytes=db.execute('SELECT coalesce(sum(bytes),0) FROM media_files').fetchone()[0])
    (ROOT/'acquisition.json').write_text(dump(result),encoding='utf-8');print(dump(result),flush=True);return result


def run(args,timeout=90):
    value=subprocess.run(args,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout)
    if value.returncode:raise ValueError(value.stderr[-1000:])
    return value


def content_metadata(probe):
    """Keep descriptive tags, including stream tags; ignore technical encoder tags."""
    allowed={'title','artist','album','comment','description','synopsis','copyright'}
    result={}
    for prefix,tags in [('',probe.get('format',{}).get('tags',{}))]+[(f'stream_{i}.',s.get('tags',{})) for i,s in enumerate(probe.get('streams',[]))]:
        for key,value in tags.items():
            if key.casefold() in allowed and str(value).strip(" '\""):
                result[prefix+key]=str(value)[:2000]
    return result


def metadata(state):
    """Refresh descriptive tags without repeating the expensive decode/audio pass."""
    with state.connect() as db:files=[dict(r) for r in db.execute('SELECT * FROM media_files')]
    files=[r for r in files if r['mime'].startswith(('audio/','video/')) and json.loads(r['source_json']).get('kind')!='rendition']
    report=[]
    for record in files:
        probe=json.loads(run([FFPROBE,'-v','error','-show_format','-show_streams','-of','json',str(file_path(record))]).stdout)
        analysis=json.loads(record['analysis_json']);analysis['metadata']=content_metadata(probe)
        with state.connect() as db:db.execute('UPDATE media_files SET analysis_json=? WHERE id=?',(dump(analysis),record['id']))
        (ANALYSIS/record['sha256']/'analysis.json').write_text(dump(analysis),encoding='utf-8')
        report.append(dict(sha256=record['sha256'],metadata=analysis['metadata']))
    result=dict(checked_at=now(),scanned=len(report),with_metadata=sum(bool(r['metadata']) for r in report),items=report)
    (ROOT/'metadata-report.json').write_text(dump(result),encoding='utf-8')
    print(dump({k:v for k,v in result.items() if k!='items'}),flush=True)
    return result


def analyze_file(record):
    path=file_path(record);folder=ANALYSIS/record['sha256'];folder.mkdir(parents=True,exist_ok=True)
    result=dict(version=1,sha256=record['sha256'],checked_at=now(),issues=[])
    try:
        if record['mime'].startswith('image/'):
            from PIL import Image,ImageOps,ImageStat
            import cv2
            import numpy as np
            with Image.open(path) as im:
                im=ImageOps.exif_transpose(im);w,h=im.size;result.update(width=w,height=h,frames=getattr(im,'n_frames',1),mode=im.mode)
                rgb=im.convert('RGB');rgb.thumbnail((1500,1500));thumb=folder/'preview.jpg';rgb.save(thumb,quality=93)
                gray=cv2.cvtColor(np.array(rgb),cv2.COLOR_RGB2GRAY);result['edge_variance']=round(float(cv2.Laplacian(gray,cv2.CV_64F).var()),2)
            if min(w,h)<180:result['issues'].append('small_image')
            if result['edge_variance']<20:result['issues'].append('low_detail')
            if result['frames']>1:result['issues'].append('animated_image')
            result['previews']=[dict(path=thumb.relative_to(DATA).as_posix(),time=0)]
        else:
            probe=json.loads(run([FFPROBE,'-v','error','-show_format','-show_streams','-of','json',str(path)]).stdout)
            result['metadata']=content_metadata(probe);result['duration']=float(probe['format'].get('duration') or 0);result['streams']=[{k:s.get(k) for k in ('codec_type','codec_name','width','height','sample_rate','channels')} for s in probe['streams']]
            has_audio=any(s['codec_type']=='audio' for s in probe['streams']);has_video=any(s['codec_type']=='video' for s in probe['streams'])
            result['has_audio']=has_audio
            if has_audio:
                scan=run([FFMPEG,'-hide_banner','-nostats','-threads','1','-i',str(path),'-vn','-af','loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json,silencedetect=noise=-45dB:d=0.35','-f','null','-'],timeout=120)
                match=re.search(r'\{\s*"input_i".*?\}',scan.stderr,re.S)
                if match:
                    raw=json.loads(match.group());result['loudness']={k:(v if k=='normalization_type' else float(v) if v not in ('-inf','inf') else None) for k,v in raw.items()}
                    level=result['loudness']['input_i'];peak=result['loudness']['input_tp']
                    if level is None or level<-30:result['issues'].append('quiet_audio')
                    if level is not None and level>-10:result['issues'].append('loud_audio')
                    if peak is not None and peak>-.05:result['issues'].append('peak_near_clipping')
                starts=[float(v) for v in re.findall(r'silence_start: ([\d.]+)',scan.stderr)]
                ends=[float(v) for v in re.findall(r'silence_end: ([\d.]+)',scan.stderr)]
                result['silence']=[dict(start=a,end=next((b for b in ends if b>a),result['duration'])) for a in starts]
                if starts and starts[0]<.05 and ends and ends[0]>1:result['issues'].append('leading_silence')
                if starts and result['duration']-starts[-1]>1 and not any(e>starts[-1] and e<result['duration']-.05 for e in ends):result['issues'].append('trailing_silence')
                wav=folder/'speech.wav';run([FFMPEG,'-v','error','-threads','1','-i',str(path),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-y',str(wav)])
                wave=folder/'waveform.png';run([FFMPEG,'-v','error','-i',str(path),'-filter_complex','aformat=channel_layouts=mono,showwavespic=s=1100x150:colors=5c4bc4','-frames:v','1','-y',str(wave)])
                result['waveform']=wave.relative_to(DATA).as_posix()
            elif record['mime'].startswith('audio/'):result['issues'].append('missing_audio')
            result['previews']=[]
            if has_video:
                times=sorted(set(round(min(max(0,result['duration']-.04),result['duration']*f),2) for f in (.02,.2,.4,.6,.8,.98)))
                for i,t in enumerate(times):
                    target=folder/f'frame-{i}.jpg'
                    run([FFMPEG,'-v','error','-threads','1','-ss',str(t),'-i',str(path),'-frames:v','1','-vf','scale=1000:1000:force_original_aspect_ratio=decrease,format=yuvj420p','-y',str(target)])
                    if target.exists():result['previews'].append(dict(path=target.relative_to(DATA).as_posix(),time=t))
                video=next(s for s in result['streams'] if s['codec_type']=='video')
                if min(video.get('width') or 0,video.get('height') or 0)<240:result['issues'].append('small_video')
                if video['codec_name'] not in ('h264','vp8','vp9','av1'):result['issues'].append('browser_codec')
        result['status']='measured'
    except Exception as exc:result.update(status='error',error=str(exc));result['issues'].append('decode_error')
    (folder/'analysis.json').write_text(dump(result),encoding='utf-8');return result


def analyze(state):
    with state.connect() as db:files=[dict(r) for r in db.execute('SELECT * FROM media_files')]
    todo=[r for r in files if not json.loads(r['analysis_json']).get('version') or json.loads(r['analysis_json']).get('status')=='error']
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures={executor.submit(analyze_file,r):r for r in todo}
        for i,f in enumerate(as_completed(futures),1):
            record=futures[f];result=f.result()
            with state.connect() as db:db.execute('UPDATE media_files SET analysis_json=? WHERE id=?',(dump(result),record['id']))
            if i%50==0 or i==len(todo):print(f'Media diagnostics: {i}/{len(todo)}',flush=True)
    with state.connect() as db:files=[dict(r) for r in db.execute('SELECT * FROM media_files')]
    ocr=[]
    for record in files:
        analysis=json.loads(record['analysis_json'])
        for i,preview in enumerate(analysis.get('previews',[])):
            ocr.append(dict(file_id=record['id'],index=i,path=str(DATA/preview['path']),time=preview['time'],output=str(ANALYSIS/record['sha256']/f'ocr-{i}.json')))
    (ROOT/'ocr-input.json').write_text(dump(ocr),encoding='utf-8')
    print(dump(dict(files=len(files),ocr_images=len(ocr),issues=dict(Counter(x for r in files for x in json.loads(r['analysis_json']).get('issues',[]))))),flush=True)


def transcribe(state):
    from faster_whisper import WhisperModel
    model=WhisperModel('base',device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True)
    with state.connect() as db:files=[dict(r) for r in db.execute('SELECT * FROM media_files')]
    todo=[r for r in files if (ANALYSIS/r['sha256']/'speech.wav').exists() and not (ANALYSIS/r['sha256']/'transcript.json').exists()]
    for i,record in enumerate(todo,1):
        folder=ANALYSIS/record['sha256']
        try:
            segments,info=model.transcribe(str(folder/'speech.wav'),beam_size=3,vad_filter=True,condition_on_previous_text=False,word_timestamps=True)
            values=[dict(start=s.start,end=s.end,text=s.text,avg_logprob=s.avg_logprob,no_speech_prob=s.no_speech_prob,words=[dict(start=w.start,end=w.end,word=w.word,probability=w.probability) for w in s.words or []]) for s in segments]
            result=dict(status='machine_transcript',model='Systran/faster-whisper-base',language=info.language,language_probability=info.language_probability,segments=values,text=' '.join(s['text'].strip() for s in values),checked_at=now(),note='Автоматическое распознавание может ошибаться и галлюцинировать на музыке. Не является подтверждением произведения.')
        except Exception as exc:result=dict(status='error',error=str(exc),text='')
        (folder/'transcript.json').write_text(dump(result),encoding='utf-8')
        print(f'Speech: {i}/{len(todo)} {record["sha256"][:8]}',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['acquire','analyze','transcribe','metadata']);parser.add_argument('--retry',action='store_true');args=parser.parse_args()
    state=Editorial()
    if args.command=='acquire':acquire(state,args.retry)
    elif args.command=='analyze':analyze(state)
    elif args.command=='metadata':metadata(state)
    else:transcribe(state)
