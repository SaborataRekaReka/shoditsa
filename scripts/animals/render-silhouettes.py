#!/usr/bin/env python3
"""Build real, local animal silhouettes from the licensed primary images.

The one-off media dependency is intentionally kept outside the application
runtime:

    python -m pip install --target .tmp/animal-media-python rembg==2.0.67
    $env:PYTHONPATH=".tmp/animal-media-python"
    python scripts/animals/render-silhouettes.py
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlparse
from urllib.request import Request, urlopen

import cv2
import numpy as np
from PIL import Image, ImageDraw
from rembg import new_session, remove


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ITEMS = ROOT / "public" / "data" / "libraries" / "animals" / "items.json"
DEFAULT_OUTPUT = ROOT / "public" / "images" / "animals" / "silhouettes"
DEFAULT_MANIFEST = ROOT / "data" / "animals" / "media" / "silhouettes-manifest.json"
DEFAULT_OVERRIDES = ROOT / "data" / "animals" / "media" / "silhouette-source-overrides.json"
SOURCE_CACHE = ROOT / ".tmp" / "animal-media" / "silhouette-sources"
CONTACT_SHEET = ROOT / ".tmp" / "animal-media" / "silhouette-contact-sheet.webp"
USER_AGENT = "ShoditsaAnimalMedia/1.0 (+https://shoditsa.ru)"
ALLOWED_LICENSE = re.compile(r"public domain|cc0|cc by", re.IGNORECASE)
DISALLOWED_LICENSE = re.compile(r"\bnc\b|\bnd\b|noncommercial|no derivatives|all rights reserved", re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--items", type=Path, default=DEFAULT_ITEMS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES)
    parser.add_argument("--model", default="u2net")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=10_000)
    parser.add_argument("--ids", default="")
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def safe_slug(item_id: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", item_id.removeprefix("animal:").lower()).strip("-")


def licensed(attribution: dict[str, Any] | None) -> bool:
    license_name = str((attribution or {}).get("license") or "")
    return bool(ALLOWED_LICENSE.search(license_name)) and not bool(DISALLOWED_LICENSE.search(license_name))


def commons_thumbnail(item: dict[str, Any]) -> str:
    source_page = str((item.get("mediaAttribution") or {}).get("sourcePageUrl") or "")
    marker = "/wiki/File:"
    if marker in source_page:
        file_name = unquote(source_page.split(marker, 1)[1]).replace("_", " ")
        return f"https://commons.wikimedia.org/wiki/Special:Redirect/file/{quote(file_name)}?width=1400"
    return str(item.get("posterUrl") or "")


def source_for(item: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    override = overrides.get(str(item.get("id") or "")) or {}
    if override:
        return {
            "url": str(override.get("sourceUrl") or ""),
            "sourcePageUrl": str(override.get("sourcePageUrl") or ""),
            "attribution": override.get("attribution") or {},
        }
    return {
        "url": commons_thumbnail(item),
        "sourcePageUrl": str((item.get("mediaAttribution") or {}).get("sourcePageUrl") or ""),
        "attribution": item.get("mediaAttribution") or {},
    }


def download(url: str, cache_path: Path) -> bytes:
    if cache_path.exists() and cache_path.stat().st_size > 1_000:
        return cache_path.read_bytes()
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*"})
    with urlopen(request, timeout=90) as response:
        declared = int(response.headers.get("Content-Length") or 0)
        if declared > 40_000_000:
            raise ValueError(f"source image is too large: {declared} bytes")
        payload = response.read(40_000_001)
    if len(payload) > 40_000_000:
        raise ValueError("source image exceeded 40 MB")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(payload)
    return payload


def largest_components(alpha: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    binary = (alpha >= 24).astype(np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    areas = stats[1:, cv2.CC_STAT_AREA] if count > 1 else np.array([], dtype=np.int32)
    if not len(areas):
        raise ValueError("segmentation returned an empty mask")
    largest = int(areas.max())
    # A silhouette must be the animal, not disconnected pieces of vegetation
    # or scenery. The foreground model's largest component is the conservative
    # automatic choice; questionable results remain visible in the contact sheet.
    keep_labels = [int(areas.argmax()) + 1]
    kept = np.isin(labels, keep_labels)
    cleaned = np.where(kept, alpha, 0).astype(np.uint8)
    foreground = cleaned >= 24
    ys, xs = np.where(foreground)
    if not len(xs):
        raise ValueError("mask cleanup removed the complete subject")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    bbox_area = max(1, (x1 - x0) * (y1 - y0))
    coverage = float(foreground.sum() / bbox_area)
    largest_share = float(largest / max(1, foreground.sum()))
    if coverage > 0.94:
        raise ValueError(f"segmentation resembles a rectangle (coverage={coverage:.3f})")
    if coverage < 0.015:
        raise ValueError(f"segmentation is too sparse (coverage={coverage:.3f})")
    return cleaned[y0:y1, x0:x1], {
        "sourceWidth": int(alpha.shape[1]),
        "sourceHeight": int(alpha.shape[0]),
        "subjectWidth": x1 - x0,
        "subjectHeight": y1 - y0,
        "bboxCoverage": round(coverage, 4),
        "componentCount": len(keep_labels),
        "largestComponentShare": round(largest_share, 4),
    }


def render(source_bytes: bytes, destination: Path, session: Any) -> dict[str, Any]:
    with Image.open(io.BytesIO(source_bytes)) as opened:
        source = opened.convert("RGB")
    source.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
    cutout = remove(source, session=session, alpha_matting=False, post_process_mask=True)
    alpha = np.asarray(cutout.getchannel("A"))
    cropped_alpha, metrics = largest_components(alpha)

    mask = Image.fromarray(cropped_alpha, mode="L")
    canvas_size = 768
    content_size = 660
    scale = min(content_size / mask.width, content_size / mask.height)
    resized = mask.resize(
        (max(1, round(mask.width * scale)), max(1, round(mask.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    silhouette = Image.new("RGBA", resized.size, (14, 18, 15, 255))
    silhouette.putalpha(resized)
    canvas.alpha_composite(
        silhouette,
        ((canvas_size - resized.width) // 2, (canvas_size - resized.height) // 2),
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, "WEBP", lossless=True, method=6)
    metrics.update({
        "outputWidth": canvas_size,
        "outputHeight": canvas_size,
        "outputBytes": destination.stat().st_size,
    })
    return metrics


def opaque_asset_path(source: Path) -> Path:
    digest = hashlib.sha256(source.read_bytes()).hexdigest()[:24]
    destination = source.parent / f"{digest}.webp"
    if source != destination:
        if destination.exists():
            source.unlink()
        else:
            source.replace(destination)
    return destination


def remove_stale_assets(records: dict[str, dict[str, Any]], output_dir: Path) -> None:
    referenced = {
        Path(str(record.get("assetUrl") or "")).name
        for record in records.values()
        if record.get("status") == "ready"
    }
    for asset in output_dir.glob("*.webp"):
        if asset.name not in referenced:
            asset.unlink()


def manifest_summary(records: dict[str, dict[str, Any]]) -> dict[str, int]:
    return {
        "total": len(records),
        "ready": sum(record.get("status") == "ready" for record in records.values()),
        "errors": sum(record.get("status") == "error" for record in records.values()),
    }


def build_contact_sheet(records: dict[str, dict[str, Any]], output_dir: Path) -> None:
    ready = [record for record in records.values() if record.get("status") == "ready"]
    if not ready:
        return
    cell = 112
    columns = 15
    rows = (len(ready) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell, rows * cell), (239, 234, 219))
    draw = ImageDraw.Draw(sheet)
    for index, record in enumerate(ready):
        asset = output_dir / Path(str(record["assetUrl"])).name
        with Image.open(asset) as opened:
            preview = opened.convert("RGBA")
        preview.thumbnail((92, 88), Image.Resampling.LANCZOS)
        x = (index % columns) * cell + (cell - preview.width) // 2
        y = (index // columns) * cell + 5
        sheet.paste(preview, (x, y), preview)
        draw.text(((index % columns) * cell + 4, (index // columns) * cell + 94), str(index + 1), fill=(40, 40, 36))
    CONTACT_SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(CONTACT_SHEET, "WEBP", quality=82, method=6)


def main() -> int:
    args = parse_args()
    os.environ.setdefault("U2NET_HOME", str(ROOT / ".tmp" / "animal-media-models"))
    items = read_json(args.items)
    if not isinstance(items, list):
        raise ValueError("animal items file must contain an array")
    previous = read_json(args.manifest) if args.manifest.exists() else {}
    records: dict[str, dict[str, Any]] = dict(previous.get("items") or {})
    overrides = read_json(args.overrides) if args.overrides.exists() else {}
    selected = items[max(0, args.offset):max(0, args.offset) + max(0, args.limit)]
    requested_ids = {value.strip() for value in args.ids.split(",") if value.strip()}
    if requested_ids:
        selected = [item for item in selected if str(item.get("id") or "") in requested_ids]
    session = new_session(args.model)

    for position, item in enumerate(selected, start=1):
        item_id = str(item.get("id") or "")
        slug = safe_slug(item_id)
        source = source_for(item, overrides)
        source_url = source["url"]
        attribution = source["attribution"]
        existing = records.get(item_id) or {}
        existing_asset = args.output / Path(str(existing.get("assetUrl") or "")).name
        if (
            not args.force
            and existing_asset.exists()
            and existing.get("status") == "ready"
            and existing.get("sourceUrl") == source_url
        ):
            destination = opaque_asset_path(existing_asset)
            existing["assetUrl"] = f"/images/animals/silhouettes/{destination.name}"
            records[item_id] = existing
            print(f"[{position}/{len(selected)}] skip {item_id}")
            continue
        started = time.monotonic()
        try:
            if not item_id or not slug or not source_url:
                raise ValueError("item has no usable identity or primary image")
            if not licensed(attribution):
                raise ValueError("source image license is not accepted for a derivative")
            extension = Path(urlparse(source_url).path).suffix or ".image"
            source_digest = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:12]
            cache_path = SOURCE_CACHE / f"{slug}-{source_digest}{extension[:8]}"
            source_bytes = download(source_url, cache_path)
            temporary_destination = args.output / f".building-{slug}.webp"
            metrics = render(source_bytes, temporary_destination, session)
            destination = opaque_asset_path(temporary_destination)
            records[item_id] = {
                "itemId": item_id,
                "status": "ready",
                "assetUrl": f"/images/animals/silhouettes/{destination.name}",
                "sourceUrl": source_url,
                "sourcePageUrl": source["sourcePageUrl"],
                "attribution": attribution,
                "transform": {
                    "model": args.model,
                    "kind": "foreground-segmentation-to-black-alpha-mask",
                },
                "metrics": metrics,
            }
            print(f"[{position}/{len(selected)}] ready {item_id} ({time.monotonic() - started:.1f}s)")
        except Exception as error:  # noqa: BLE001 - every item must reach the audit
            records[item_id] = {
                "itemId": item_id,
                "status": "error",
                "sourceUrl": source_url,
                "error": str(error),
            }
            print(f"[{position}/{len(selected)}] ERROR {item_id}: {error}", file=sys.stderr)
        write_json(args.manifest, {
            "version": 1,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "model": args.model,
            "summary": manifest_summary(records),
            "items": records,
        })

    remove_stale_assets(records, args.output)
    build_contact_sheet(records, args.output)
    summary = manifest_summary(records)
    write_json(args.manifest, {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": args.model,
        "summary": summary,
        "items": records,
    })
    print(json.dumps({"manifest": str(args.manifest.relative_to(ROOT)), **summary}, ensure_ascii=False))
    selected_ids = {str(item.get("id") or "") for item in selected}
    selected_errors = sum(records.get(item_id, {}).get("status") != "ready" for item_id in selected_ids)
    return 0 if selected_errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
