"""Download original word-vector assets with resumable files and provenance."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(os.environ.get("SHODITSA_SEMANTIC_CACHE", str(ROOT / "archive/local/semantic-models")))
SOURCES = {
    "navec": {
        "filename": "navec_hudlit_v1_12B_500K_300d_100q.tar",
        "url": "https://storage.yandexcloud.net/natasha-navec/packs/navec_hudlit_v1_12B_500K_300d_100q.tar",
        "source": "https://github.com/natasha/navec",
        "expectedBytes": 53012480,
        "license": "MIT (project); archive provenance recorded separately",
    },
    "fasttext": {
        "filename": "cc.ru.300.vec.gz",
        "url": "https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.ru.300.vec.gz",
        "source": "https://fasttext.cc/docs/en/crawl-vectors.html",
        "expectedBytes": 1306357571,
        "license": "CC-BY-SA-3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
    },
}


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch(name: str) -> dict:
    spec = SOURCES[name]
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / spec["filename"]
    manifest_path = path.with_name(path.name + ".source.json")
    if path.exists():
        if path.stat().st_size != spec["expectedBytes"]:
            raise ValueError(f"Unexpected size of completed asset: {path}")
        digest = sha256(path)
        if manifest_path.exists():
            previous = json.loads(manifest_path.read_text(encoding="utf-8"))
            if previous["sha256"] != digest:
                raise ValueError(f"Checksum mismatch: {path}")
        print(f"Cached {name}: {path.stat().st_size:,} bytes", flush=True)
    else:
        part = path.with_name(path.name + ".part")
        if shutil.disk_usage(CACHE).free < spec["expectedBytes"] + 1024**3:
            raise ValueError("Insufficient free disk space for the model and working files")
        for attempt in range(4):
            offset = part.stat().st_size if part.exists() else 0
            if offset == spec["expectedBytes"]:
                break
            headers = {"User-Agent": "Shoditsa-local-semantic-data/1.0"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            try:
                request = urllib.request.Request(spec["url"], headers=headers)
                with urllib.request.urlopen(request, timeout=60) as response:
                    if offset and response.status != 206:
                        raise ValueError("Server did not honor resume request; partial file preserved")
                    if offset and not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                        raise ValueError("Unexpected Content-Range; partial file preserved")
                    total = offset
                    report_at = total + 64 * 1024**2
                    with part.open("ab" if offset else "wb") as out:
                        while chunk := response.read(1024**2):
                            total += len(chunk)
                            if total > spec["expectedBytes"]:
                                raise ValueError("Download exceeds pinned source size")
                            out.write(chunk)
                            if total >= report_at:
                                print(f"{name}: {total / spec['expectedBytes']:.0%}", flush=True)
                                report_at = total + 64 * 1024**2
                if part.stat().st_size == spec["expectedBytes"]:
                    break
            except (OSError, urllib.error.URLError) as error:
                if attempt == 3:
                    raise
                print(f"Resuming {name} after {type(error).__name__}", flush=True)
                time.sleep(2)
        if part.stat().st_size != spec["expectedBytes"]:
            raise ValueError("Incomplete model download; resumable .part file preserved")
        part.replace(path)
        digest = sha256(path)
    manifest = {
        "schemaVersion": 1,
        "model": name,
        **spec,
        "sha256": digest,
        "bytes": path.stat().st_size,
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "checksumMeaning": "Locally computed content hash; upstream does not publish a SHA256 here",
    }
    if not manifest_path.exists():
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Ready {name}: {digest}", flush=True)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="*", choices=list(SOURCES), default=list(SOURCES))
    args = parser.parse_args()
    for model in args.models:
        fetch(model)
