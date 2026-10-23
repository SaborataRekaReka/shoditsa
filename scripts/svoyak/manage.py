"""Manage the local source library. No production data or external publication is involved."""
import argparse
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__,epilog='Database: archive/local/svoyak-library/library.sqlite3. Browser: http://127.0.0.1:5188/library.html')
    parser.add_argument('command',choices=['sync','build','serve','status','check','media','backup','restore-test','restore','factcheck'],help='sync/build/serve; check: quality gates; media: technical audit; backup/restore-test/restore; factcheck: full read-only research queue')
    parser.add_argument('--archive',type=Path)
    parser.add_argument('--destination',type=Path)
    parser.add_argument('--models',action='store_true')
    parser.add_argument('--local-only',action='store_true')
    args=parser.parse_args()
    if args.command=='sync':
        for script in ['fetch.py','semantic.py','build.py']:
            subprocess.run([sys.executable,'-X','utf8',str(HERE/script)],cwd=REPO,check=True)
    elif args.command=='build':subprocess.run([sys.executable,'-X','utf8',str(HERE/'build.py')],cwd=REPO,check=True)
    elif args.command=='serve':subprocess.run([sys.executable,'-X','utf8',str(REPO/'qa/svoyak-pilot-2026-10-21/serve_preview.py')],cwd=REPO,check=True)
    elif args.command in ('backup','restore-test','restore'):
        import json
        from operations import backup,restore_test,restore_into
        if args.command=='backup':result=backup(args.models)
        else:
            if not args.archive:parser.error('--archive is required')
            if args.command=='restore-test':result=restore_test(args.archive)
            else:
                if not args.destination:parser.error('--destination is required; use a NEW directory')
                result=restore_into(args.archive,args.destination)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    else:
        import json
        from runtime import Library
        library=Library()
        from operations import quality,audit_media
        if args.command=='check':result=quality(library)
        elif args.command=='media':result=audit_media(library.editorial,external=not args.local_only)
        elif args.command=='factcheck':
            quality(library)
            from datetime import datetime,timezone
            import shutil
            import uuid
            from semantic import DATA
            run_folder=DATA/'factcheck'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8])
            run_folder.mkdir(parents=True)
            shutil.copyfile(DATA/'factcheck-input.json',run_folder/'input.json')
            node='node'
            subprocess.run([node,'scripts/factcheck/run.mjs','--source=input',
                '--input='+str(run_folder/'input.json'),'--mode=custom',
                '--fields=prompt,answer_text,theme,genre,truth_mode','--research=all','--ai=never',
                '--output='+str(run_folder)],cwd=REPO,check=True)
            (DATA/'factcheck/latest.json').write_text(json.dumps(dict(path=str(run_folder))),encoding='utf-8')
            result={'path':str(run_folder),'note':'Read-only full research queue; each run pins its input. Manual evidence and explicitly unresolved tasks are in research-disposition.jsonl. No AI output is treated as evidence.'}
        else:result=library.stats()
        print(json.dumps(result,ensure_ascii=False,indent=2))
        if args.command=='check' and not result['structural_pass']:raise SystemExit(1)
