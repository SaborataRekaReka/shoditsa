#!/usr/bin/env python3
"""Build the public DTF discussion corpus specified by this scraping pack.

The script uses only DTF's public, unauthenticated endpoints.  It hashes public
author IDs before writing output and never requests profiles or private data.
It is intentionally restartable: a game with a completed manifest is skipped
when --skip-complete is used.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import requests


PACK_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG = PACK_DIR / "dtf-25-games-scraping-manifest.json"
DEFAULT_OUTPUT = PACK_DIR / "dtf-25-games-corpus"
API_BASE = "https://api.dtf.ru/v2.10"
USER_AGENT = "Mozilla/5.0 (compatible; DTF-public-corpus-research/1.0; +https://dtf.ru/)"
AUTHOR_HASH_NAMESPACE = "dtf-public-corpus-v1"


class PublicDtfClient:
    def __init__(self, delay_seconds: float) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://dtf.ru/",
            }
        )
        self.delay_seconds = delay_seconds
        self.last_request_at = 0.0

    def get_result(self, endpoint: str, params: dict[str, Any]) -> Any:
        """GET a public API endpoint with a small, conservative retry budget."""
        url = f"{API_BASE}/{endpoint.lstrip('/')}"
        last_error: Exception | None = None
        for attempt in range(3):
            pause = self.delay_seconds - (time.monotonic() - self.last_request_at)
            if pause > 0:
                time.sleep(pause)
            try:
                response = self.session.get(url, params=params, timeout=45)
                self.last_request_at = time.monotonic()
                response.raise_for_status()
                payload = response.json()
                if payload.get("error"):
                    raise RuntimeError(str(payload.get("message") or payload["error"]))
                if "result" not in payload:
                    raise RuntimeError("DTF response has no result field")
                return payload["result"]
            except (requests.RequestException, ValueError, RuntimeError) as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"{endpoint} failed after retries: {last_error}")

    def search(self, query: str) -> list[dict[str, Any]]:
        result = self.get_result("search", {"query": query})
        return [item["data"] for item in result.get("contents", []) if item.get("type") == "entry"]

    def comments(self, post_id: int) -> list[dict[str, Any]]:
        result = self.get_result("comments", {"contentId": post_id})
        return result.get("items", [])


def utc_timestamp(value: Any) -> str | None:
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def stable_author_hash(author: Any) -> str | None:
    if not isinstance(author, dict) or author.get("id") is None:
        return None
    token = f"{AUTHOR_HASH_NAMESPACE}:{author['id']}".encode("utf-8")
    return hashlib.sha256(token).hexdigest()


def html_to_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = re.sub(r"<(?:br|/p|/div|/li|/h[1-6])\\b[^>]*>", "\n", value, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    # U+0085/U+2028/U+2029 are valid JSON string characters, but a number of
    # JSONL readers treat them as physical line separators.  Normalize them
    # before json.dumps escapes the resulting ordinary newline.
    text = text.replace("\u0085", "\n").replace("\u2028", "\n").replace("\u2029", "\n")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def blocks_to_text(blocks: Any) -> str:
    pieces: list[str] = []
    if not isinstance(blocks, list):
        return ""
    for block in blocks:
        if not isinstance(block, dict) or block.get("hidden"):
            continue
        data = block.get("data")
        if not isinstance(data, dict):
            continue
        for key in ("text", "caption", "title", "description"):
            cleaned = html_to_text(data.get(key))
            if cleaned:
                pieces.append(cleaned)
    return "\n\n".join(pieces)


def walk(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for nested in value.values():
            yield from walk(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from walk(nested)


def media_urls(blocks: Any) -> list[str]:
    """Keep public image or video source URLs/descriptors found in post blocks."""
    collected: list[str] = []
    for item in walk(blocks):
        external = item.get("external_service")
        if isinstance(external, dict) and external.get("name") == "youtube" and external.get("id"):
            collected.append(f"https://www.youtube.com/watch?v={external['id']}")
        uuid = item.get("uuid")
        if isinstance(uuid, str) and re.fullmatch(r"[0-9a-f-]{36}", uuid, flags=re.I):
            collected.append(f"https://leonardo.osnova.io/{uuid}/-/format/webp/")
        for key in ("url", "src"):
            candidate = item.get(key)
            if isinstance(candidate, str) and candidate.startswith(("https://", "http://")):
                collected.append(candidate)
    return list(dict.fromkeys(collected))[:100]


def tags_from_text(text: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"(?<!\w)#([\w-]+)", text, flags=re.UNICODE)))[:50]


def reaction_counts(reactions: Any) -> dict[str, int]:
    if not isinstance(reactions, dict):
        return {}
    counts: dict[str, int] = {}
    for item in reactions.get("counters", []):
        if isinstance(item, dict) and isinstance(item.get("id"), int):
            counts[str(item["id"])] = int(item.get("count") or 0)
    return counts


def comment_rating(comment: dict[str, Any]) -> int:
    likes = comment.get("likes") or {}
    return int(likes.get("counterLikes") or 0) - int(likes.get("counterDislikes") or 0)


def canonical_query(url: str) -> str:
    marker = "query="
    if marker not in url:
        return ""
    value = url.split(marker, 1)[1].split("&", 1)[0]
    return requests.utils.unquote(value).replace("+", " ").lower()


def relevance_score(post: dict[str, Any], game: dict[str, Any]) -> int:
    title = str(post.get("title") or "").lower()
    url = str(post.get("url") or "").lower()
    body = blocks_to_text(post.get("blocks")).lower()
    terms = [str(game.get("title") or "").lower()] + [str(x).lower() for x in game.get("aliases", [])]
    score = 0
    for term in terms:
        term = term.strip()
        if not term:
            continue
        score += 40 * title.count(term)
        score += 30 * url.count(term.replace(" ", "-"))
        score += min(8, body.count(term))
    # Exact search results can be legitimate even when their URL uses a Russian slug.
    return score


def classify_post_type(post: dict[str, Any], body: str) -> str:
    source = f"{post.get('title') or ''}\n{body}".lower()
    if re.search(r"\b(мем|мемы|шутк|постирон|ржа|прикол)", source):
        return "meme_or_local_post"
    if re.search(r"\b(обзор|мнение|прош[её]л|впечатлен|отзыв)", source):
        return "user_review_or_opinion"
    if re.search(r"\b(dlc|дополнени|патч|ремастер|обновлен|expansion|shattered space)\b", source):
        return "later_reappraisal_patch_or_dlc"
    if post.get("isEditorial"):
        return "editorial_news"
    return "community_discussion"


def classify_phase(post: dict[str, Any], body: str) -> str:
    source = f"{post.get('title') or ''}\n{body}".lower()
    if re.search(r"\b(анонс|ожидан|предрелиз|трейлер|перенос|pre-?release|early access)\b", source):
        return "pre_release"
    if re.search(r"\b(релиз|выш[её]л|launch|оценк[аи]|перв[ыеы] впечатлен)\b", source):
        return "release_or_early_response"
    if re.search(r"\b(патч|обновлен|dlc|дополнени|ремастер|переоцен|спустя|год(?:а|ов)?|mod(?:ы|s)?)\b", source):
        return "post_release_update_or_reappraisal"
    return "general_discussion"


def selection_score(post: dict[str, Any], game: dict[str, Any]) -> tuple[int, int, int]:
    comments = int((post.get("counters") or {}).get("comments") or 0)
    return (comments, relevance_score(post, game), int(post.get("date") or 0))


def select_posts(candidates: list[dict[str, Any]], game: dict[str, Any]) -> list[dict[str, Any]]:
    """Select ten discussion-heavy posts while reserving room for coverage."""
    ranked = sorted(candidates, key=lambda item: selection_score(item, game), reverse=True)
    high_discussion = [item for item in ranked if int((item.get("counters") or {}).get("comments") or 0) >= 100]
    if len(high_discussion) >= 8:
        pool = high_discussion
    else:
        medium_discussion = [item for item in ranked if int((item.get("counters") or {}).get("comments") or 0) >= 30]
        pool = medium_discussion if len(medium_discussion) >= 8 else ranked

    selected: list[dict[str, Any]] = []
    selected_ids: set[int] = set()

    def add(item: dict[str, Any]) -> None:
        post_id = int(item["id"])
        if post_id not in selected_ids and len(selected) < 10:
            selected.append(item)
            selected_ids.add(post_id)

    top_comments = int((pool[0].get("counters") or {}).get("comments") or 0) if pool else 0
    coverage_minimum = max(10, int(top_comments * 0.05))
    enriched: list[tuple[dict[str, Any], str, str]] = []
    for item in pool:
        body = blocks_to_text(item.get("blocks"))
        enriched.append((item, classify_phase(item, body), classify_post_type(item, body)))

    for phase in ("pre_release", "release_or_early_response", "post_release_update_or_reappraisal"):
        for item, item_phase, _ in enriched:
            comments = int((item.get("counters") or {}).get("comments") or 0)
            if item_phase == phase and comments >= coverage_minimum:
                add(item)
                break
    for material_type in (
        "editorial_news",
        "user_review_or_opinion",
        "meme_or_local_post",
        "later_reappraisal_patch_or_dlc",
    ):
        for item, _, item_type in enriched:
            if item_type == material_type:
                add(item)
                break
    for item in pool + ranked:
        add(item)
        if len(selected) == 10:
            break
    return selected


def parent_id(comment: dict[str, Any]) -> int | None:
    reply_to = comment.get("replyTo")
    return int(reply_to) if isinstance(reply_to, int) and reply_to > 0 else None


def is_disagreeing_root(comment: dict[str, Any]) -> bool:
    if parent_id(comment) is not None or int(comment.get("level") or 0) != 0:
        return False
    if comment_rating(comment) < 0:
        return True
    text = html_to_text(comment.get("text")).lower()
    return bool(re.search(r"\b(не соглас|несоглас|бред|плох|разочар|ужас|провал|хуже|нет)\b", text))


def sample_comments(comments: list[dict[str, Any]], limit: int = 100) -> list[tuple[dict[str, Any], str]]:
    """Select the four required buckets, deduplicating at insertion time."""
    unique = {int(item["id"]): item for item in comments if isinstance(item.get("id"), int)}
    items = list(unique.values())
    direct_children: Counter[int] = Counter(parent_id(item) for item in items if parent_id(item) is not None)
    by_id = unique

    def root_for(item: dict[str, Any]) -> int:
        current = int(item["id"])
        seen: set[int] = set()
        while current not in seen:
            seen.add(current)
            parent = parent_id(by_id.get(current, {}))
            if parent is None or parent not in by_id:
                return current
            current = parent
        return current

    branch_sizes: Counter[int] = Counter(root_for(item) for item in items)
    top_rated = sorted(items, key=lambda item: (comment_rating(item), int(item.get("replyCount") or 0), -int(item.get("date") or 0)), reverse=True)
    early_roots = sorted(
        [item for item in items if parent_id(item) is None and int(item.get("level") or 0) == 0],
        key=lambda item: int(item.get("date") or 0),
    )
    long_threads = sorted(
        items,
        key=lambda item: (branch_sizes[root_for(item)], int(item.get("level") or 0), comment_rating(item)),
        reverse=True,
    )
    disagreeing = sorted([item for item in items if is_disagreeing_root(item)], key=comment_rating)

    chosen: list[tuple[dict[str, Any], str]] = []
    chosen_ids: set[int] = set()

    def take(source: Iterable[dict[str, Any]], count: int, bucket: str) -> None:
        for item in source:
            if len(chosen) >= limit:
                return
            comment_id = int(item["id"])
            if comment_id not in chosen_ids:
                chosen.append((item, bucket))
                chosen_ids.add(comment_id)
                if sum(1 for _, item_bucket in chosen if item_bucket == bucket) >= count:
                    return

    take(top_rated, 40, "top_rated")
    take(early_roots, 20, "early_root")
    take(long_threads, 20, "long_thread")
    take(disagreeing, 20, "negative_or_disagreeing_root")
    take(top_rated, limit, "coverage_fill")
    return chosen


def post_record(post: dict[str, Any], game: dict[str, Any], source_urls: list[str]) -> dict[str, Any]:
    body = blocks_to_text(post.get("blocks"))
    counters = post.get("counters") or {}
    output = {
        "post_id": int(post["id"]),
        "canonical_url": post.get("url"),
        "title": post.get("title") or "",
        "published_at": utc_timestamp(post.get("date")),
        "section": (post.get("subsite") or {}).get("name"),
        "tags": tags_from_text(body),
        "author_hash": stable_author_hash(post.get("author")),
        "views": int(counters.get("views") or 0),
        "comment_count": int(counters.get("comments") or 0),
        "reaction_counts": reaction_counts(post.get("reactions")),
        "post_type": classify_post_type(post, body),
        "discussion_phase": classify_phase(post, body),
        "body_text": body,
        "media_urls": media_urls(post.get("blocks")),
        "search_origin": source_urls,
    }
    if game.get("spoiler"):
        output["spoiler"] = True
    return output


def comment_record(comment: dict[str, Any], post_id: int, bucket: str, game: dict[str, Any]) -> dict[str, Any]:
    output = {
        "comment_id": int(comment["id"]),
        "post_id": post_id,
        "parent_id": parent_id(comment),
        "depth": int(comment.get("level") or 0),
        "published_at": utc_timestamp(comment.get("date")),
        "author_hash": stable_author_hash(comment.get("author")),
        "rating": comment_rating(comment),
        "reply_count": int(comment.get("replyCount") or 0),
        "text": html_to_text(comment.get("text")),
        "is_deleted": bool(comment.get("isRemoved") or comment.get("isRemovedByModerator") or comment.get("isHiddenByBan")),
        "sampling_bucket": bucket,
    }
    if game.get("spoiler"):
        output["spoiler"] = True
    return output


def write_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")
    temporary.replace(path)


def complete_game(game_dir: Path) -> bool:
    manifest_path = game_dir / "manifest.json"
    if not all((game_dir / filename).is_file() for filename in ("manifest.json", "posts.jsonl", "comments.jsonl")):
        return False
    try:
        return bool(json.loads(manifest_path.read_text(encoding="utf-8")).get("completed"))
    except (OSError, ValueError):
        return False


def scrape_game(client: PublicDtfClient, game: dict[str, Any], output_root: Path) -> dict[str, int]:
    game_dir = output_root / game["id"]
    game_dir.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    candidates: dict[int, dict[str, Any]] = {}
    origins: defaultdict[int, list[str]] = defaultdict(list)

    for source_url in game.get("search_urls", []):
        query = canonical_query(source_url)
        if not query:
            continue
        try:
            for post in client.search(query):
                if not isinstance(post.get("id"), int) or not post.get("isPublished", True):
                    continue
                if relevance_score(post, game) <= 0:
                    continue
                post_id = int(post["id"])
                candidates.setdefault(post_id, post)
                origins[post_id].append(source_url)
        except Exception as exc:  # A failed public query is reported, not retried forever.
            errors.append(f"search {query!r}: {exc}")

    selected = select_posts(list(candidates.values()), game)
    post_rows = [post_record(post, game, list(dict.fromkeys(origins[int(post["id"])]))) for post in selected]
    comment_rows: list[dict[str, Any]] = []
    for index, post in enumerate(selected, start=1):
        post_id = int(post["id"])
        try:
            sampled = sample_comments(client.comments(post_id))
            comment_rows.extend(comment_record(comment, post_id, bucket, game) for comment, bucket in sampled)
        except Exception as exc:
            errors.append(f"comments for post {post_id}: {exc}")
        print(f"  {game['id']}: comments {index}/{len(selected)}", flush=True)

    manifest = {
        "game_id": game["id"],
        "canonical_title": game["title"],
        "aliases": game.get("aliases", []),
        "source_urls": game.get("all_urls", []),
        "scraped_at": datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        "selection_notes": {
            "candidate_count": len(candidates),
            "candidate_post_ids": sorted(candidates),
            "selected_post_ids": [row["post_id"] for row in post_rows],
            "selection_method": "Public DTF search candidates ranked chiefly by comment count; coverage slots are used for identifiable phases and material types when available.",
            "comment_sampling": "Deduplicated buckets: up to 40 top-rated, 20 early roots, 20 comments from the longest branches, and up to 20 negative/disagreeing roots; remaining capacity is filled by rating.",
            "author_privacy": "Public author IDs are replaced with SHA-256 hashes; names, profile URLs, and profile data are excluded.",
        },
        "errors": errors,
        "selected_post_count": len(post_rows),
        "sampled_comment_count": len(comment_rows),
        "completed": True,
    }
    write_jsonl(game_dir / "posts.jsonl", post_rows)
    write_jsonl(game_dir / "comments.jsonl", comment_rows)
    write_json(game_dir / "manifest.json", manifest)
    return {"candidates": len(candidates), "posts": len(post_rows), "comments": len(comment_rows), "errors": len(errors)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--games", nargs="*", help="One or more game IDs; omit for all games.")
    parser.add_argument("--delay", type=float, default=0.45, help="Minimum seconds between public API requests.")
    parser.add_argument("--skip-complete", action="store_true", help="Leave fully completed game folders untouched.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.delay < 0.1:
        raise SystemExit("--delay must be at least 0.1 seconds")
    config = json.loads(args.config.read_text(encoding="utf-8"))
    games = config.get("games", [])
    if args.games:
        requested = set(args.games)
        games = [game for game in games if game.get("id") in requested]
        missing = requested - {game.get("id") for game in games}
        if missing:
            raise SystemExit(f"Unknown game IDs: {', '.join(sorted(missing))}")
    args.output.mkdir(parents=True, exist_ok=True)
    client = PublicDtfClient(args.delay)
    summary: dict[str, Any] = {
        "started_at": datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        "config": str(args.config.name),
        "games": {},
    }
    for game_index, game in enumerate(games, start=1):
        game_dir = args.output / game["id"]
        if args.skip_complete and complete_game(game_dir):
            completed_manifest = json.loads((game_dir / "manifest.json").read_text(encoding="utf-8"))
            print(f"[{game_index}/{len(games)}] {game['id']}: skipped completed", flush=True)
            summary["games"][game["id"]] = {
                "skipped": True,
                "candidates": completed_manifest.get("selection_notes", {}).get("candidate_count", 0),
                "posts": completed_manifest.get("selected_post_count", 0),
                "comments": completed_manifest.get("sampled_comment_count", 0),
                "errors": len(completed_manifest.get("errors", [])),
            }
            continue
        print(f"[{game_index}/{len(games)}] {game['id']}: collecting public DTF corpus", flush=True)
        try:
            summary["games"][game["id"]] = scrape_game(client, game, args.output)
        except Exception as exc:
            summary["games"][game["id"]] = {"fatal_error": str(exc)}
            print(f"  {game['id']}: FAILED: {exc}", file=sys.stderr, flush=True)
    summary["finished_at"] = datetime.now(tz=timezone.utc).isoformat().replace("+00:00", "Z")
    write_json(args.output / "run-summary.json", summary)
    failures = [game_id for game_id, result in summary["games"].items() if "fatal_error" in result]
    print(f"finished: {len(games) - len(failures)}/{len(games)} games completed", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
