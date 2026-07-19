#!/usr/bin/env python3
"""Download the public source corpora used by the danetki dataset build."""

from __future__ import annotations

import gzip
import json
import re
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from lxml import html


ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "sources"
USER_AGENT = "DanetkiDatasetBuilder/1.0 (+private research corpus)"


DOWNLOADS = {
    "splat/puzzles.xlsx": "https://raw.githubusercontent.com/chenqi008/LateralThinking/main/puzzles.xlsx",
    "splat/README.md": "https://raw.githubusercontent.com/chenqi008/LateralThinking/main/README.md",
    "lateval/english.json": "https://raw.githubusercontent.com/THUKElab/LatEval/main/data/english.json",
    "lateval/chinese.json": "https://raw.githubusercontent.com/THUKElab/LatEval/main/data/chinese.json",
    "lateval/README.md": "https://raw.githubusercontent.com/THUKElab/LatEval/main/README.md",
    "turtlebench/LICENSE": "https://huggingface.co/datasets/Duguce/TurtleBench1.5k/resolve/main/LICENSE",
    "turtlebench/README.md": "https://huggingface.co/datasets/Duguce/TurtleBench1.5k/resolve/main/README.md",
    "turtlebench/en_data.jsonl": "https://huggingface.co/datasets/Duguce/TurtleBench1.5k/resolve/main/english/en_data-00000-of-00001.jsonl",
    "turtlebench/zh_data.jsonl": "https://huggingface.co/datasets/Duguce/TurtleBench1.5k/resolve/main/chinese/zh_data-00000-of-00001.jsonl",
    "turtlebench/en_stories.json": "https://huggingface.co/datasets/Duguce/TurtleBench1.5k/resolve/main/english/staging/stories.json",
    "turtlebench/zh_stories.json": "https://huggingface.co/datasets/Duguce/TurtleBench1.5k/resolve/main/chinese/staging/stories.json",
    "deepturtle/deep_turtle.json": "https://huggingface.co/datasets/YuiMax/DeepTurtle/resolve/main/deep_turtle.json",
    "deepturtle/README.md": "https://huggingface.co/datasets/YuiMax/DeepTurtle/resolve/main/README.md",
    "turtlesoup_bench/README.md": "https://raw.githubusercontent.com/lin-ruo/TurtleSoup-Bench/main/README.md",
}

TURTLESOUP_FILES = [
    "Clever_Logic.json",
    "Constant_Change.json",
    "Crime_Thriller.json",
    "Mind_Game.json",
    "Original_Data.json",
    "Supernatural_Fantasy.json",
]


def request_bytes(url: str, attempts: int = 4) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts:
                raise
            time.sleep(attempt * 1.5)
    raise RuntimeError("unreachable")


def download(url: str, target: Path) -> None:
    if target.exists() and target.stat().st_size:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(request_bytes(url))


def text_of(node) -> str:
    return " ".join(node.text_content().split()) if node is not None else ""


def first(root, xpath: str):
    nodes = root.xpath(xpath)
    return nodes[0] if nodes else None


def parse_yesnogame_story(url: str) -> dict:
    root = html.fromstring(request_bytes(url))
    story_id = int(url.rsplit("/", 1)[1])
    title_node = first(root, "//h1[contains(@class,'quest__title')]")
    title = text_of(title_node)
    pre_title = text_of(first(title_node, ".//span[contains(@class,'pre-title')]") if title_node is not None else None)
    if pre_title and title.startswith(pre_title):
        title = title[len(pre_title) :].strip()
    condition = text_of(first(root, "//div[contains(@class,'quest__card__front')]//div[contains(@class,'quest__story__text')]"))
    solution = text_of(first(root, "//div[contains(@class,'quest__card__back')]//div[contains(@class,'quest__story__text')]"))
    values = [text_of(n) for n in root.xpath("//div[contains(@class,'quest__aside')][1]//div[contains(@class,'quest__about__value')]")]
    tags = [text_of(n) for n in root.xpath("//div[contains(@class,'tags')]//a")]

    liked = None
    duration = None
    difficulty = None
    votes = None
    for value in values:
        if "%" in value:
            match = re.search(r"(\d+)%", value)
            liked = int(match.group(1)) if match else None
        elif "минут" in value:
            match = re.search(r"(\d+)", value)
            duration = int(match.group(1)) if match else None
        elif "/10" in value:
            match = re.search(r"(\d+)/10", value)
            difficulty = int(match.group(1)) if match else None
    aside_text = text_of(first(root, "//div[contains(@class,'quest__aside')][1]"))
    match = re.search(r"По мнению\s+(\d+)\s+пользов", aside_text)
    votes = int(match.group(1)) if match else None

    if not condition or not solution:
        raise ValueError(f"Missing condition or solution: {url}")
    return {
        "source_id": story_id,
        "title": title,
        "condition": condition,
        "solution": solution,
        "tags": tags,
        "liked_percent": liked,
        "solve_minutes": duration,
        "difficulty_10": difficulty,
        "rating_votes": votes,
        "source_url": url,
    }


def collect_yesnogame_language(sitemap: str, language: str, target: Path) -> None:
    if target.exists() and target.stat().st_size:
        return
    prefix = "" if language == "ru" else f"/{language}"
    escaped_prefix = re.escape(prefix)
    urls = sorted(
        set(re.findall(rf"<loc>(https://yesnogame\.net{escaped_prefix}/stories/\d+)</loc>", sitemap)),
        key=lambda item: int(item.rsplit("/", 1)[1]),
    )
    stories = []
    failures = []
    # A small bounded pool keeps the collection practical while remaining gentle
    # compared with ordinary browser traffic to the public story pages.
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_url = {executor.submit(parse_yesnogame_story, url): url for url in urls}
        for index, future in enumerate(as_completed(future_to_url), start=1):
            url = future_to_url[future]
            try:
                stories.append(future.result())
            except Exception as exc:  # preserve a complete failure log in the source snapshot
                failures.append({"url": url, "error": f"{type(exc).__name__}: {exc}"})
            if index % 25 == 0:
                print(f"yesnogame-{language}: {index}/{len(urls)}", flush=True)
    stories.sort(key=lambda item: item["source_id"])

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(stories, ensure_ascii=False, indent=2), encoding="utf-8")
    (target.parent / f"{language}_failures.json").write_text(
        json.dumps(failures, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def collect_yesnogame() -> None:
    sitemap = gzip.decompress(request_bytes("https://yesnogame.net/sitemaps/sitemap.xml.gz")).decode("utf-8")
    collect_yesnogame_language(sitemap, "ru", SOURCES / "yesnogame/ru_stories.json")
    collect_yesnogame_language(sitemap, "en", SOURCES / "yesnogame/en_stories.json")


def main() -> None:
    SOURCES.mkdir(parents=True, exist_ok=True)
    for relative_path, url in DOWNLOADS.items():
        download(url, SOURCES / relative_path)
    for language in ("en", "zh"):
        for filename in TURTLESOUP_FILES:
            url = f"https://raw.githubusercontent.com/lin-ruo/TurtleSoup-Bench/main/data/{language}/{filename}"
            download(url, SOURCES / "turtlesoup_bench" / language / filename)
    collect_yesnogame()
    print("source collection complete")


if __name__ == "__main__":
    main()
