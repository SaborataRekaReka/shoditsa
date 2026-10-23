"""Rebuild the section SVGs from the approved artwork (Pillow + vtracer).

Run from the repository root. This is an authoring tool, not a build step.
The binary alpha threshold removes background haze; spline paths retain the
original contour, palette, highlights and facets without embedding bitmaps.
"""
from pathlib import Path
import argparse
import json
import re

from PIL import Image
import vtracer

ROOT = Path(__file__).resolve().parents[2]
ICONS = ROOT / "public/images/shoditsa-study/generated-icons-v2"
SETTINGS = dict(
    colormode="color", hierarchical="stacked", mode="spline",
    filter_speckle=64, color_precision=6, layer_difference=8,
    corner_threshold=90, length_threshold=8.0, max_iterations=10,
    splice_threshold=90, path_precision=2,
)
SOURCES = {name: ICONS / f"{name}.webp" for name in ("play", "archive", "league", "medal")}
SOURCES["profile"] = ROOT / "public/images/shoditsa-study/profile-v1/profile-card-v1.png"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--only", nargs="+", choices=list(SOURCES), help="Rebuild only these icons")
selected = parser.parse_args().only or list(SOURCES)

manifest = {}
for name in selected:
    source = SOURCES[name]
    image = Image.open(source).convert("RGBA")
    pixels = [(r, g, b, 255) if a >= 128 else (0, 0, 0, 0) for r, g, b, a in image.get_flattened_data()]
    settings = {**SETTINGS}
    if name in ("play", "profile"):
        settings.update(color_precision=8, layer_difference=4, filter_speckle=32)
    elif name == "league":
        settings.update(layer_difference=4, filter_speckle=48)
    traced = vtracer.convert_pixels_to_svg(pixels, image.size, **settings)
    paths = re.search(r"<svg\b[^>]*>(.*)</svg>", traced, re.S).group(1).strip()
    view_box = f"0 0 {image.width} {image.height}"
    if name == "profile":
        # Match the existing 80x80 image at (-16,-16) in the 48x48 viewport.
        paths = f'<g transform="translate(-426.666667 -71.111111) scale(1.388888889)">{paths}</g>'
        view_box = "0 0 1280 1280"
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1280" viewBox="0 0 1280 1280">\n'
        f'<symbol id="art" viewBox="{view_box}">\n{paths}\n</symbol>\n'
        '<use href="#art" width="1280" height="1280"/>\n</svg>\n'
    )
    destination = ICONS / f"{name}.svg"
    destination.write_text(svg, encoding="utf-8", newline="\n")
    manifest[name] = dict(source=source.relative_to(ROOT).as_posix(), bytes=len(svg.encode()), paths=svg.count("<path"), settings=settings)
    print(name, manifest[name])

print(json.dumps(dict(settings=SETTINGS, icons=manifest), indent=2))
