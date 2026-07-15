#!/usr/bin/env python3
"""First-pass cleaning of the public DTF 25-game corpus.

This program does not mutate the source corpus.  It discovers game folders at
runtime, deduplicates posts and comments globally, scores each game/post pair,
then emits a separate analysis directory with reproducible rule-based labels.

The labels are estimates rather than a claim about a community-wide opinion;
each record retains a short evidence-based reason and an ``unclear`` outcome
where the available public sample cannot support a stronger decision.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlsplit, urlunsplit


PACK_DIR = Path(__file__).resolve().parent
DEFAULT_SOURCE = PACK_DIR / "dtf-25-games-corpus"
DEFAULT_OUTPUT = PACK_DIR / "dtf-25-games-corpus-analysis"


# Manifest aliases alone are intentionally not sufficient for reliable
# relevance classification.  The small context catalogue supplies only stable
# franchise/developer names and disambiguation warnings; it never identifies
# authors or infers private information.
GAME_CONTEXT: dict[str, dict[str, Any]] = {
    "cyberpunk-2077": {"terms": ["CD Projekt Red", "CDPR", "Phantom Liberty", "Edgerunners", "Найт-Сити", "Night City"], "series": ["Cyberpunk"], "developers": ["CD Projekt Red", "CDPR"]},
    "starfield": {"terms": ["Bethesda", "Тодд Говард", "Todd Howard", "Creation Engine", "Shattered Space", "Созвездие", "Constellation"], "series": [], "developers": ["Bethesda"]},
    "atomic-heart": {"terms": ["Mundfish", "ВК Плей", "VK Play", "Предприятие 3826", "Близняшки"], "series": [], "developers": ["Mundfish"]},
    "the-last-of-us-part-ii": {"terms": ["Naughty Dog", "Элли", "Эбби", "Джоэл", "TLOU", "Одни из нас", "HBO"], "series": ["The Last of Us", "Одни из нас"], "developers": ["Naughty Dog"], "warning": "Материалы о сериале HBO, первой части и ремастере не равны обсуждению Part II; возможны сюжетные спойлеры."},
    "baldurs-gate-3": {"terms": ["Larian", "BG3", "D&D", "Фаэрун", "Faerun", "Балдура"], "series": ["Baldur's Gate"], "developers": ["Larian"]},
    "death-stranding": {"terms": ["Kojima", "Кодзима", "Kojima Productions", "Сэм Портер", "DS2"], "series": ["Death Stranding"], "developers": ["Kojima Productions"], "warning": "Отделяйте обсуждения второй части от первой, если связь не пояснена."},
    "elden-ring": {"terms": ["FromSoftware", "Миядзаки", "Miyazaki", "Shadow of the Erdtree", "Эрдтри", "соулс"], "series": ["Souls"], "developers": ["FromSoftware"]},
    "bloodborne": {"terms": ["FromSoftware", "Ярнам", "Yharnam", "Миядзаки", "Miyazaki", "PS4"], "series": ["Souls"], "developers": ["FromSoftware"], "warning": "Сравнения с другими Souls-играми не всегда относятся к Bloodborne как к самостоятельному объекту."},
    "red-dead-redemption-2": {"terms": ["Rockstar", "RDR2", "Артур Морган", "Arthur Morgan", "Red Dead Online"], "series": ["Red Dead Redemption"], "developers": ["Rockstar"]},
    "the-witcher-3": {"terms": ["CD Projekt Red", "CDPR", "Геральт", "Geralt", "Дикая Охота", "Wild Hunt"], "series": ["Ведьмак", "The Witcher"], "developers": ["CD Projekt Red", "CDPR"], "warning": "Посты о сериале, книгах и четвёртой части отделяются от Wild Hunt."},
    "disco-elysium": {"terms": ["ZA/UM", "Заум", "Гарри Дюбуа", "Harry Du Bois", "Ревашоль", "Revachol"], "series": [], "developers": ["ZA/UM"]},
    "skyrim": {"terms": ["Bethesda", "Довакин", "Dragonborn", "TES V", "The Elder Scrolls"], "series": ["The Elder Scrolls", "TES"], "developers": ["Bethesda"], "warning": "Материалы о TES в целом и других частях серии не принимаются за материалы именно о Skyrim."},
    "fallout-76": {"terms": ["Bethesda", "Wastelanders", "Аппалачия", "Appalachia", "Фоллаут 76"], "series": ["Fallout", "Фоллаут"], "developers": ["Bethesda"], "warning": "Серия Fallout и сериал Fallout не эквивалентны Fallout 76."},
    "no-mans-sky": {"terms": ["Hello Games", "Шон Мюррей", "Sean Murray", "экспедиции", "Expeditions"], "series": [], "developers": ["Hello Games"]},
    "grand-theft-auto-v": {"terms": ["Rockstar", "GTA Online", "Лос-Сантос", "Los Santos", "GTA 5"], "series": ["GTA", "Grand Theft Auto"], "developers": ["Rockstar"], "warning": "Посты о GTA VI и GTA Online отдельно маркируются, если GTA V не является темой."},
    "stalker-2": {"terms": ["GSC Game World", "Heart of Chornobyl", "Зона", "Zone", "S.T.A.L.K.E.R. 2"], "series": ["S.T.A.L.K.E.R.", "Сталкер"], "developers": ["GSC Game World"], "warning": "Посты о классической трилогии и модах на неё не считаются автоматически релевантными второй части."},
    "hogwarts-legacy": {"terms": ["Avalanche Software", "Wizarding World", "Хогвартс", "Гарри Поттер", "Harry Potter"], "series": ["Harry Potter", "Wizarding World"], "developers": ["Avalanche Software"], "warning": "Новости франшизы Harry Potter без Legacy требуют отдельного подтверждения."},
    "helldivers-2": {"terms": ["Arrowhead", "Super Earth", "Супер-Земля", "PSN", "Sony"], "series": ["Helldivers"], "developers": ["Arrowhead"]},
    "dragon-age-the-veilguard": {"terms": ["BioWare", "Veilguard", "Вейлгард", "Dragon Age"], "series": ["Dragon Age"], "developers": ["BioWare"], "warning": "Серия Dragon Age и ранние части не смешиваются с Veilguard без явного сравнения."},
    "the-day-before": {"terms": ["Fntastic", "Mytona", "The Day Before", "Дэй Бефор"], "series": [], "developers": ["Fntastic"]},
    "concord": {"terms": ["Firewalk", "Firewalk Studios", "Concord", "PlayStation", "Sony"], "series": [], "developers": ["Firewalk Studios"], "warning": "Concord — обычное английское слово; одиночное совпадение без Firewalk, PlayStation или игры считается неоднозначным."},
    "assassins-creed-shadows": {"terms": ["Ubisoft", "Yasuke", "Ясукэ", "Наоэ", "Naoe", "AC Shadows"], "series": ["Assassin's Creed", "Ассасин"], "developers": ["Ubisoft"], "warning": "Новости всей серии Assassin's Creed не равны материалу о Shadows."},
    "silent-hill-2-remake": {"terms": ["Bloober", "Konami", "James Sunderland", "Джеймс Сандерленд", "Maria", "Мария", "SH2"], "series": ["Silent Hill", "Сайлент Хилл"], "developers": ["Bloober Team"], "warning": "Оригинал Silent Hill 2 и ремейк считаются разными объектами; имя Maria само по себе неоднозначно."},
    "kingdom-come-deliverance-ii": {"terms": ["Warhorse", "KCD2", "Kingdom Come 2", "Генри", "Henry", "Богемия", "Bohemia"], "series": ["Kingdom Come"], "developers": ["Warhorse Studios"], "warning": "Первая часть Kingdom Come не считается второй частью без явного сравнения."},
    "clair-obscur-expedition-33": {"terms": ["Sandfall", "Expedition 33", "Экспедиция 33", "Гюстав", "Gustave", "Маэль", "Maelle"], "series": ["Clair Obscur"], "developers": ["Sandfall Interactive"]},
}

SHOWCASE_RE = re.compile(r"\b(шоукейс|showcase|презентац|gamescom|game awards|summer game|xbox games|state of play|nintendo direct|дайджест|главное с|что показали|подборк)\b", re.I)
COMPARISON_RE = re.compile(r"\b(сравн|похож|как в|лучше|хуже|vs\.?|против|аналог|клон)\b", re.I)
GAMEPLAY_RE = re.compile(r"\b(игр[аы]|геймпле|сюжет|квест|персонаж|механик|боев|мир|локац|мод|патч|релиз|dlc|дополнен|график|оптимизац|баг|прохожд|ролев|rpg|онлайн)\b", re.I)
DEVELOPER_RE = re.compile(r"\b(разработчик|студи[яи]|движок|production|разработк|dev|создател)\b", re.I)
PUBLISHER_RE = re.compile(r"\b(издател|publisher|монетизац|продаж|бюджет|цен[аы]|маркетинг|инвестор|акционер)\b", re.I)
PLATFORM_RE = re.compile(r"\b(ps[45]|playstation|xbox|switch|steam|epic|pc|пк|консол|эксклюзив|psn|желез)\b", re.I)
ADAPTATION_RE = re.compile(r"\b(сериал|фильм|аниме|книг[аи]|комикс|адаптац)\b", re.I)
INDUSTRY_RE = re.compile(r"\b(индустри|геймдев|рынок|aaa|трипл-?а|игроки|разработчик|издател)\b", re.I)
OFFTOPIC_RE = re.compile(r"^(?:\W|\b(первый|жду|лол|кек|жиза|база|согласен|точно|класс|плюс|минус|ну да|да|нет)\b){1,}$", re.I)
IRONIC_RE = re.compile(r"\b(ирон|сарказ|лол|кек|ахаха|рофл|мем|/s)\b|[😂🤣😄]", re.I)
SUPPORT_RE = re.compile(r"\b(отличн|хорош|крут|любл|нрав|шедевр|топ|удачн|супер|лучш)\b", re.I)
CRITICAL_RE = re.compile(r"\b(плох|ужас|провал|разочар|скучн|баг|слом|хуже|мусор|говн|ненавиж|посредств)\b", re.I)
REPLY_AGREEMENT_RE = re.compile(r"\b(согласен|соглы|точно|верно|именно|поддерживаю|не согласен)\b", re.I)


def normalize_space(value: Any) -> str:
    text = str(value or "")
    return re.sub(r"\s+", " ", text.replace("\u0085", " ").replace("\u2028", " ").replace("\u2029", " ")).strip()


def normalized_url(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    parts = urlsplit(value)
    if not parts.scheme or not parts.netloc:
        return value.strip().rstrip("/").lower() or None
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), "", ""))


def term_pattern(term: str) -> re.Pattern[str]:
    escaped = re.escape(normalize_space(term))
    return re.compile(rf"(?<![\w]){escaped}(?![\w])", re.I)


def has_term(text: str, terms: Iterable[str]) -> bool:
    return any(term_pattern(term).search(text) for term in terms if normalize_space(term))


def count_term_hits(text: str, terms: Iterable[str]) -> int:
    return sum(len(term_pattern(term).findall(text)) for term in terms if normalize_space(term))


def split_units(text: str) -> list[str]:
    units = [normalize_space(unit) for unit in re.split(r"(?:\n+|(?<=[.!?])\s+)", text)]
    return [unit for unit in units if len(unit) >= 3]


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return round(max(low, min(high, value)), 3)


def safe_json_value(value: Any) -> Any:
    if isinstance(value, str):
        return value.replace("\u0085", " ").replace("\u2028", " ").replace("\u2029", " ")
    if isinstance(value, list):
        return [safe_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: safe_json_value(item) for key, item in value.items()}
    return value


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(safe_json_value(value), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(safe_json_value(record), ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")
    temporary.replace(path)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for number, raw_line in enumerate(path.read_text(encoding="utf-8").split("\n"), start=1):
        if raw_line.strip():
            try:
                records.append(json.loads(raw_line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{number}: invalid JSONL: {exc}") from exc
    return records


@dataclass
class GameSource:
    game_id: str
    directory: Path
    manifest: dict[str, Any]
    posts: list[dict[str, Any]]
    comments: list[dict[str, Any]]
    terms: list[str] = field(default_factory=list)
    contextual_terms: list[str] = field(default_factory=list)
    developer_terms: list[str] = field(default_factory=list)
    warning: str | None = None


def discover_games(source_root: Path) -> list[GameSource]:
    summary_path = source_root / "run-summary.json"
    if not summary_path.is_file():
        raise FileNotFoundError(f"Missing {summary_path}")
    run_summary = json.loads(summary_path.read_text(encoding="utf-8"))
    summary_game_ids = set((run_summary.get("games") or {}).keys())
    games: list[GameSource] = []
    for directory in sorted(path for path in source_root.iterdir() if path.is_dir()):
        files = {"manifest.json", "posts.jsonl", "comments.jsonl"}
        if not all((directory / item).is_file() for item in files):
            continue
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        game_id = directory.name
        aliases = [manifest.get("canonical_title", "")] + list(manifest.get("aliases") or [])
        context = GAME_CONTEXT.get(game_id, {})
        terms = list(dict.fromkeys(normalize_space(value) for value in aliases if len(normalize_space(value)) >= 3))
        contextual = list(dict.fromkeys(normalize_space(value) for value in context.get("terms", []) if len(normalize_space(value)) >= 3))
        developers = list(dict.fromkeys(normalize_space(value) for value in context.get("developers", []) if len(normalize_space(value)) >= 3))
        source = GameSource(
            game_id=game_id,
            directory=directory,
            manifest=manifest,
            posts=read_jsonl(directory / "posts.jsonl"),
            comments=read_jsonl(directory / "comments.jsonl"),
            terms=terms,
            contextual_terms=contextual,
            developer_terms=developers,
            warning=context.get("warning"),
        )
        games.append(source)
        if summary_game_ids and game_id not in summary_game_ids:
            print(f"warning: {game_id} exists on disk but is absent from run-summary.json")
    if not games:
        raise RuntimeError("No game folders with manifest.json, posts.jsonl, comments.jsonl were found")
    return games


def post_identity(post: dict[str, Any]) -> str:
    post_id = post.get("post_id")
    if post_id not in (None, ""):
        return f"id:{post_id}"
    for url_key in ("canonical_url", "url"):
        url = normalized_url(post.get(url_key))
        if url:
            return f"url:{url}"
    fallback = "|".join((normalize_space(post.get("title")).lower(), str(post.get("published_at") or ""), normalize_space(post.get("body_text")).lower()))
    return "fallback:" + hashlib.sha256(fallback.encode("utf-8")).hexdigest()


def global_registries(games: list[GameSource]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[tuple[str, int], bool]]:
    post_rows: dict[str, dict[str, Any]] = {}
    comment_rows: dict[int, dict[str, Any]] = {}
    shared_lookup: dict[tuple[str, int], bool] = {}
    for game in games:
        for post in game.posts:
            key = post_identity(post)
            current = post_rows.setdefault(
                key,
                {
                    "postId": post.get("post_id"),
                    "canonicalUrl": normalized_url(post.get("canonical_url")),
                    "title": post.get("title") or "",
                    "publishedAt": post.get("published_at"),
                    "appearsInGameCorpora": [],
                    "_post_keys": [],
                },
            )
            current["appearsInGameCorpora"].append(game.game_id)
            current["_post_keys"].append((game.game_id, int(post.get("post_id") or 0)))
        for comment in game.comments:
            comment_id = comment.get("comment_id")
            if not isinstance(comment_id, int):
                continue
            current = comment_rows.setdefault(
                comment_id,
                {"commentId": comment_id, "postIds": [], "appearsInGameCorpora": []},
            )
            current["postIds"].append(comment.get("post_id"))
            current["appearsInGameCorpora"].append(game.game_id)
    registry: list[dict[str, Any]] = []
    for current in post_rows.values():
        corpora = sorted(set(current.pop("appearsInGameCorpora")))
        duplicate_count = len(corpora)
        for game_id, post_id in current.pop("_post_keys"):
            shared_lookup[(game_id, post_id)] = duplicate_count > 1
        current["appearsInGameCorpora"] = corpora
        current["duplicateCount"] = duplicate_count
        current["isSharedPost"] = duplicate_count > 1
        registry.append(current)
    comment_registry: list[dict[str, Any]] = []
    for current in comment_rows.values():
        corpora = sorted(set(current["appearsInGameCorpora"]))
        current["postIds"] = sorted(set(item for item in current["postIds"] if item is not None))
        current["appearsInGameCorpora"] = corpora
        current["duplicateCount"] = len(corpora)
        current["isSharedComment"] = len(corpora) > 1
        comment_registry.append(current)
    registry.sort(key=lambda item: (str(item.get("publishedAt") or ""), str(item.get("postId") or "")))
    comment_registry.sort(key=lambda item: item["commentId"])
    return registry, comment_registry, shared_lookup


def other_game_matches(text: str, game: GameSource, games: list[GameSource]) -> list[str]:
    matched: list[str] = []
    for candidate in games:
        if candidate.game_id == game.game_id:
            continue
        # Canonical names and manifest aliases only; developer/context terms
        # such as Sony or Bethesda would create misleading comparisons.
        candidates = [term for term in candidate.terms if len(term) >= 4 and term.casefold() not in {"the day before", "concord"}]
        if has_term(text, candidates):
            matched.append(candidate.game_id)
    return matched


def assess_post(game: GameSource, post: dict[str, Any], games: list[GameSource], shared: bool) -> dict[str, Any]:
    title = normalize_space(post.get("title"))
    body = normalize_space(post.get("body_text"))
    title_target = has_term(title, game.terms)
    body_target_hits = count_term_hits(body, game.terms)
    context_hits = count_term_hits(f"{title} {body}", game.contextual_terms)
    all_text = f"{title}\n{body}"
    units = split_units(body)
    target_units = [unit for unit in units if has_term(unit, game.terms) or has_term(unit, game.contextual_terms)]
    text_share = clamp(len(target_units) / len(units)) if units else 0.0
    other_games = other_game_matches(all_text, game, games)
    showcase = bool(SHOWCASE_RE.search(title))
    comparison = bool(COMPARISON_RE.search(all_text)) and bool(other_games)
    body_long = len(body) >= 280

    if not title_target and body_target_hits == 0 and context_hits == 0:
        relevance_class, score, reason = "irrelevant", 0.02, "В заголовке, тексте и игровом контексте нет надёжного совпадения с целью."
    elif showcase:
        if (body_target_hits >= 3 or context_hits >= 2) and text_share >= 0.10:
            relevance_class, score, reason = "showcase_segment", clamp(0.48 + text_share * 1.7 + min(0.12, body_target_hits * 0.02)), "Общий шоукейс, но целевой игре посвящён самостоятельный сегмент текста."
        elif title_target and body_target_hits >= 2:
            relevance_class, score, reason = "showcase_segment", 0.56, "Общий шоукейс с прямым упоминанием игры, однако её доля ограничена."
        else:
            relevance_class, score, reason = "incidental", 0.18, "Общий шоукейс: игра упомянута без заметного самостоятельного сегмента."
    elif title_target and (body_target_hits >= 1 or context_hits >= 1):
        if comparison and len(other_games) <= 3:
            relevance_class, score, reason = "comparative", clamp(0.72 + text_share * 0.2), "Целевая игра вынесена в заголовок и обсуждается в прямом сравнении."
        else:
            relevance_class, score, reason = "primary", clamp(0.80 + min(0.16, text_share * 0.25 + context_hits * 0.025)), "Целевая игра названа в заголовке и подтверждена текстом или игровым контекстом."
    elif comparison and (body_target_hits >= 2 or context_hits >= 2) and text_share >= 0.13:
        relevance_class, score, reason = "comparative", clamp(0.60 + text_share * 0.8), "Игра подробно присутствует в сравнительном материале с другой центральной игрой."
    elif (body_target_hits >= 3 or context_hits >= 3) and text_share >= 0.25 and body_long:
        relevance_class, score, reason = "primary", clamp(0.66 + text_share * 0.55), "Целевая игра занимает существенную часть самостоятельного текста."
    elif body_target_hits >= 1 or context_hits >= 1:
        relevance_class, score, reason = "incidental", clamp(0.12 + min(0.22, text_share * 0.8 + body_target_hits * 0.02)), "Есть упоминание или слабый контекст, но недостаточно признаков самостоятельной темы."
    else:
        relevance_class, score, reason = "unclear", 0.35, "Публичного текста недостаточно для надёжной тематической атрибуции."

    return {
        "gameId": game.game_id,
        "postId": post.get("post_id"),
        "url": post.get("canonical_url"),
        "title": title,
        "relevanceClass": relevance_class,
        "relevanceScore": score,
        "targetTextShareEstimate": text_share,
        "targetCommentShareEstimate": 0.0,
        "sharedWithOtherGames": shared,
        "otherCentralGames": other_games[:5],
        "reason": reason,
        "keepForAnalysis": relevance_class in {"primary", "comparative", "showcase_segment"} and score >= 0.5,
        "sourcePhase": post.get("discussion_phase") or "general_discussion",
        "sourcePostType": post.get("post_type") or "unknown",
        "sourceCommentCount": int(post.get("comment_count") or 0),
        "targetTermHits": body_target_hits + (1 if title_target else 0),
        "contextTermHits": context_hits,
        "isGeneralShowcase": showcase,
    }


def classify_stance(text: str, parent_stance: str | None = None) -> str:
    if IRONIC_RE.search(text):
        return "ironic"
    positive = len(SUPPORT_RE.findall(text))
    negative = len(CRITICAL_RE.findall(text))
    if positive and negative:
        return "mixed"
    if negative:
        return "critical"
    if positive:
        return "supportive"
    if parent_stance in {"critical", "supportive"} and REPLY_AGREEMENT_RE.search(text):
        return parent_stance
    if len(text) >= 40:
        return "neutral"
    return "unclear"


def classify_comments_for_post(game: GameSource, post: dict[str, Any], assessment: dict[str, Any], games: list[GameSource]) -> list[dict[str, Any]]:
    source_comments = [item for item in game.comments if item.get("post_id") == post.get("post_id")]
    by_id = {int(item["comment_id"]): item for item in source_comments if isinstance(item.get("comment_id"), int)}
    ordered = sorted(source_comments, key=lambda item: (int(item.get("depth") or 0), str(item.get("published_at") or ""), int(item.get("comment_id") or 0)))
    classifications: dict[int, dict[str, Any]] = {}
    result: list[dict[str, Any]] = []

    def context_for(item: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        chain: list[dict[str, Any]] = []
        parent_id = item.get("parent_id")
        seen: set[int] = set()
        while isinstance(parent_id, int) and parent_id in by_id and parent_id not in seen and len(chain) < 4:
            seen.add(parent_id)
            parent = by_id[parent_id]
            chain.append(parent)
            parent_id = parent.get("parent_id")
        text = "\n".join([normalize_space(item.get("text"))] + [normalize_space(parent.get("text")) for parent in chain])
        return text, chain

    for item in ordered:
        comment_id = item.get("comment_id")
        if not isinstance(comment_id, int):
            continue
        text = normalize_space(item.get("text"))
        context_text, chain = context_for(item)
        parent_label = classifications.get(item.get("parent_id")) if isinstance(item.get("parent_id"), int) else None
        parent_stance = parent_label.get("stance") if parent_label else None
        direct_target = has_term(context_text, game.terms) or has_term(context_text, game.contextual_terms)
        other_games = other_game_matches(context_text, game, games)
        deleted = bool(item.get("is_deleted")) or not text or text == "Комментарий недоступен"
        short_reaction = len(text) < 18 or bool(OFFTOPIC_RE.match(text))
        post_is_target = assessment["relevanceClass"] in {"primary", "comparative", "showcase_segment"}

        if deleted:
            relevance_class, score, keep, reason = "unclear", 0.0, False, "Удалённый или недоступный текст не используется."
        elif direct_target and other_games and COMPARISON_RE.search(context_text):
            relevance_class, score, keep, reason = "comparison", 0.86, True, "Комментарий прямо связывает целевую игру с другой игрой."
        elif direct_target and DEVELOPER_RE.search(context_text):
            relevance_class, score, keep, reason = "developer_context", 0.82, True, "Комментарий о разработчике, производстве или движке в контексте игры."
        elif direct_target and PUBLISHER_RE.search(context_text):
            relevance_class, score, keep, reason = "publisher_context", 0.77, True, "Комментарий об издательском или коммерческом контексте игры."
        elif direct_target and PLATFORM_RE.search(context_text):
            relevance_class, score, keep, reason = "platform_context", 0.76, True, "Комментарий о платформе или эксклюзивности в прямой связи с игрой."
        elif direct_target and ADAPTATION_RE.search(context_text):
            relevance_class, score, keep, reason = "adaptation_or_franchise_context", 0.73, True, "Контекст серии или адаптации прямо связан с обсуждаемой игрой."
        elif direct_target:
            relevance_class, score, keep, reason = "target_game", 0.90, True, "В комментарии или доступной родительской цепочке прямо названа игра либо её игровой контекст."
        elif parent_label and parent_label.get("relevanceClass") in {"target_game", "comparison", "developer_context", "publisher_context", "platform_context", "adaptation_or_franchise_context"} and not short_reaction:
            relevance_class, score, keep, reason = "target_game", 0.62, True, "Содержательный ответ наследует игровой контекст доступной родительской ветки."
        elif post_is_target and GAMEPLAY_RE.search(text) and len(text) >= 35 and not INDUSTRY_RE.search(text):
            relevance_class, score, keep, reason = "target_game", 0.61, True, "Содержательный комментарий о механиках, релизе или опыте в тематическом посте."
        elif post_is_target and PLATFORM_RE.search(text) and len(text) >= 30:
            relevance_class, score, keep, reason = "platform_context", 0.56, True, "Содержательный платформенный контекст в тематической ветке."
        elif INDUSTRY_RE.search(text) and len(text) >= 30:
            relevance_class, score, keep, reason = "general_industry", 0.32, False, "Общий спор об индустрии без достаточной связи с игрой."
        elif short_reaction:
            relevance_class, score, keep, reason = "offtopic", 0.12, False, "Короткая реакция без достаточного игрового контекста."
        elif assessment["relevanceClass"] in {"incidental", "irrelevant"}:
            relevance_class, score, keep, reason = "offtopic", 0.16, False, "Ветка исходного поста не подтверждает связь с целевой игрой."
        else:
            relevance_class, score, keep, reason = "unclear", 0.40, False, "Недостаточно явного игрового или родительского контекста."

        record = {
            "gameId": game.game_id,
            "postId": item.get("post_id"),
            "commentId": comment_id,
            "parentId": item.get("parent_id"),
            "depth": int(item.get("depth") or 0),
            "publishedAt": item.get("published_at"),
            "rating": int(item.get("rating") or 0),
            "samplingBucket": item.get("sampling_bucket"),
            "relevanceClass": relevance_class,
            "relevanceScore": score,
            "stance": classify_stance(text, parent_stance),
            "text": text,
            "keepForAnalysis": keep,
            "reason": reason,
        }
        classifications[comment_id] = record
        result.append(record)
    return result


def refine_post_with_comments(assessment: dict[str, Any], classified_comments: list[dict[str, Any]]) -> None:
    usable = [item for item in classified_comments if item["relevanceClass"] not in {"offtopic", "unclear"}]
    non_deleted = [item for item in classified_comments if item["relevanceScore"] > 0]
    share = clamp(len(usable) / len(non_deleted)) if non_deleted else 0.0
    assessment["targetCommentShareEstimate"] = share
    if assessment["relevanceClass"] == "showcase_segment" and share < 0.12:
        assessment.update({"relevanceClass": "incidental", "relevanceScore": min(assessment["relevanceScore"], 0.32), "keepForAnalysis": False, "reason": "Общий материал не получил подтверждения релевантными комментариями целевой игры."})
    elif assessment["relevanceClass"] == "primary" and share < 0.08 and assessment["targetTextShareEstimate"] < 0.20:
        assessment.update({"relevanceClass": "unclear", "relevanceScore": min(assessment["relevanceScore"], 0.49), "keepForAnalysis": False, "reason": "Заголовок содержит игру, но текст и сохранённые комментарии не подтверждают самостоятельную тематическую ветку."})
    elif assessment["keepForAnalysis"]:
        assessment["relevanceScore"] = clamp(assessment["relevanceScore"] * 0.82 + share * 0.18)


def select_posts(assessments: list[dict[str, Any]]) -> tuple[list[int], dict[int, str]]:
    priority = {"primary": 5, "comparative": 4, "showcase_segment": 3, "unclear": 2, "incidental": 1, "irrelevant": 0}
    candidates = [item for item in assessments if item["keepForAnalysis"]]
    ranked = sorted(candidates, key=lambda item: (priority[item["relevanceClass"]], item["relevanceScore"], item["targetCommentShareEstimate"], item["sourceCommentCount"]), reverse=True)
    selected = ranked[:10]
    # The contract asks for 5--10 posts. Do not fill with incidental/irrelevant
    # entries merely to hit five; record the insufficiency as a quality warning.
    reasons: dict[int, str] = {}
    selected_ids = {int(item["postId"]) for item in selected}
    for item in assessments:
        post_id = int(item["postId"])
        if post_id in selected_ids:
            reasons[post_id] = "selected_for_analysis"
        elif item["relevanceClass"] == "irrelevant":
            reasons[post_id] = "irrelevant"
        elif item["relevanceClass"] == "incidental":
            reasons[post_id] = "incidentalMention"
        elif item["isGeneralShowcase"]:
            reasons[post_id] = "generalShowcase"
        elif item["targetCommentShareEstimate"] < 0.12:
            reasons[post_id] = "commentsDiscussAnotherTopic"
        else:
            reasons[post_id] = "lower_relevance_or_duplicate_event"
    return [int(item["postId"]) for item in selected], reasons


def choose_balanced_comments(records: list[dict[str, Any]], selected_post_ids: set[int]) -> list[dict[str, Any]]:
    allowed = {
        "target_game",
        "comparison",
        "developer_context",
        "publisher_context",
        "platform_context",
        "adaptation_or_franchise_context",
    }
    candidates = [item for item in records if item["postId"] in selected_post_ids and item["keepForAnalysis"] and item["relevanceClass"] in allowed]
    # An exact canonical-text cap prevents a repeated punchline from swamping a
    # game's cleaned sample even if it appeared in different reply branches.
    by_text: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in candidates:
        key = re.sub(r"[^\w]+", "", item["text"].casefold())[:500] or f"id:{item['commentId']}"
        by_text[key].append(item)
    deduped: list[dict[str, Any]] = []
    for items in by_text.values():
        deduped.extend(sorted(items, key=lambda item: (item["relevanceScore"], item["rating"], len(item["text"])), reverse=True)[:20])

    bucket_bonus = {"top_rated": 0.10, "early_root": 0.08, "long_thread": 0.07, "negative_or_disagreeing_root": 0.09, "coverage_fill": 0.04}
    def rank(item: dict[str, Any]) -> tuple[float, int, int]:
        value = item["relevanceScore"] + bucket_bonus.get(str(item.get("samplingBucket")), 0.0) + min(0.12, math.log1p(max(0, item["rating"])) / 100)
        # Keep substantive material ahead of short agreement replies.
        return (value, min(400, len(item["text"])), item["rating"])

    by_post: defaultdict[int, list[dict[str, Any]]] = defaultdict(list)
    for item in deduped:
        by_post[int(item["postId"])].append(item)
    selected: list[dict[str, Any]] = []
    selected_ids: set[int] = set()
    # Coverage pass: each retained post gets its strongest relevant material.
    for post_id in sorted(by_post):
        for item in sorted(by_post[post_id], key=rank, reverse=True)[:30]:
            if item["commentId"] not in selected_ids:
                selected.append(item)
                selected_ids.add(item["commentId"])
    # Fill to a maximum of 800 across posts, never over 120 per post.
    counts = Counter(item["postId"] for item in selected)
    for item in sorted(deduped, key=rank, reverse=True):
        if len(selected) >= 800:
            break
        if item["commentId"] in selected_ids or counts[item["postId"]] >= 120:
            continue
        selected.append(item)
        selected_ids.add(item["commentId"])
        counts[item["postId"]] += 1
    return sorted(selected, key=lambda item: (str(item.get("publishedAt") or ""), item["commentId"]))


def selected_post_row(game: GameSource, post: dict[str, Any], assessment: dict[str, Any]) -> dict[str, Any]:
    return {
        "gameId": game.game_id,
        "postId": post.get("post_id"),
        "canonicalUrl": post.get("canonical_url"),
        "title": post.get("title"),
        "publishedAt": post.get("published_at"),
        "section": post.get("section"),
        "tags": post.get("tags") or [],
        "views": int(post.get("views") or 0),
        "commentCount": int(post.get("comment_count") or 0),
        "reactionCounts": post.get("reaction_counts") or {},
        "postType": post.get("post_type"),
        "discussionPhase": assessment["sourcePhase"],
        "bodyText": normalize_space(post.get("body_text")),
        "mediaUrls": post.get("media_urls") or [],
        "relevanceClass": assessment["relevanceClass"],
        "relevanceScore": assessment["relevanceScore"],
        "targetTextShareEstimate": assessment["targetTextShareEstimate"],
        "targetCommentShareEstimate": assessment["targetCommentShareEstimate"],
        "sharedWithOtherGames": assessment["sharedWithOtherGames"],
        "otherCentralGames": assessment["otherCentralGames"],
        "reason": assessment["reason"],
        "keepForAnalysis": True,
        "spoiler": bool(post.get("spoiler")),
    }


def excluded_post_row(game: GameSource, post: dict[str, Any], assessment: dict[str, Any], exclusion_reason: str) -> dict[str, Any]:
    return {
        "gameId": game.game_id,
        "postId": post.get("post_id"),
        "canonicalUrl": post.get("canonical_url"),
        "title": post.get("title"),
        "publishedAt": post.get("published_at"),
        "relevanceClass": assessment["relevanceClass"],
        "relevanceScore": assessment["relevanceScore"],
        "targetTextShareEstimate": assessment["targetTextShareEstimate"],
        "targetCommentShareEstimate": assessment["targetCommentShareEstimate"],
        "sharedWithOtherGames": assessment["sharedWithOtherGames"],
        "reason": assessment["reason"],
        "exclusionReason": exclusion_reason,
        "keepForAnalysis": False,
    }


def quality_report_markdown(summary: dict[str, Any]) -> str:
    warnings = summary["warnings"] or ["Явных предупреждений по механической очистке нет."]
    phase_text = ", ".join(summary["phaseCoverage"]) or "не подтверждено"
    return "\n".join(
        [
            f"# {summary['canonicalTitle']}",
            "",
            "## Итог очистки",
            "",
            f"- Исходных постов: {summary['sourcePosts']}; оставлено: {summary['selectedPosts']}.",
            f"- Исходных комментариев: {summary['sourceComments']}; оставлено: {summary['selectedComments']}.",
            f"- Основных публикаций: {summary['primaryPosts']}; сравнительных: {summary['comparativePosts']}; сегментов шоукейсов: {summary['showcasePosts']}.",
            f"- Фазы обсуждения: {phase_text}.",
            f"- Оценка качества первого прохода: {summary['qualityScore']:.3f}.",
            "",
            "## Предупреждения",
            "",
            *[f"- {warning}" for warning in warnings],
            "",
            "Классы и оценки сформированы воспроизводимыми правилами по доступному тексту и родительской цепочке комментариев; это не тематический анализ и не вывод о мнении DTF.",
            "",
        ]
    )


def analyze_game(game: GameSource, games: list[GameSource], shared_lookup: dict[tuple[str, int], bool], output_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    posts_by_id = {int(post["post_id"]): post for post in game.posts if isinstance(post.get("post_id"), int)}
    assessments: list[dict[str, Any]] = []
    classified_comments: list[dict[str, Any]] = []
    for post_id, post in posts_by_id.items():
        assessment = assess_post(game, post, games, shared_lookup.get((game.game_id, post_id), False))
        comment_labels = classify_comments_for_post(game, post, assessment, games)
        refine_post_with_comments(assessment, comment_labels)
        assessments.append(assessment)
        classified_comments.extend(comment_labels)

    selected_ids_list, reasons = select_posts(assessments)
    selected_ids = set(selected_ids_list)
    assessments.sort(key=lambda item: int(item["postId"]))
    assessment_by_id = {int(item["postId"]): item for item in assessments}
    selected_posts = [selected_post_row(game, posts_by_id[post_id], assessment_by_id[post_id]) for post_id in selected_ids_list]
    selected_posts.sort(key=lambda item: (str(item.get("publishedAt") or ""), int(item["postId"])))
    selected_comments = choose_balanced_comments(classified_comments, selected_ids)
    excluded = [excluded_post_row(game, posts_by_id[post_id], assessment_by_id[post_id], reasons[post_id]) for post_id in posts_by_id if post_id not in selected_ids]
    excluded.sort(key=lambda item: (str(item.get("publishedAt") or ""), int(item["postId"])))

    exclusion_counts = Counter(item["exclusionReason"] for item in excluded)
    source_phase = [item["discussionPhase"] for item in selected_posts]
    phases = sorted(set(phase for phase in source_phase if phase and phase != "general_discussion"))
    selected_classes = Counter(item["relevanceClass"] for item in selected_posts)
    source_classes = Counter(item["relevanceClass"] for item in assessments)
    comment_classes = Counter(item["relevanceClass"] for item in classified_comments)
    selected_stances = Counter(item["stance"] for item in selected_comments if item["stance"] not in {"unclear"})
    stance_diversity = clamp(len(selected_stances) / 5) if selected_comments else 0.0
    shared_selected = sum(1 for item in selected_posts if item["sharedWithOtherGames"])
    off_topic = comment_classes["offtopic"] + comment_classes["general_industry"]
    off_topic_rate = clamp(off_topic / len(classified_comments)) if classified_comments else 0.0
    warnings: list[str] = []
    if len(selected_posts) < 5:
        warnings.append("Меньше пяти постов прошли порог релевантности; для расширения корпуса нужен дополнительный скрапинг.")
    if len(phases) < 2:
        warnings.append("Подтверждено меньше двух фаз обсуждения среди отобранных публикаций.")
    if shared_selected >= max(3, len(selected_posts) // 2):
        warnings.append("Значимая доля сохранённых публикаций общая с другими игровыми папками; назначения проверены отдельно для этой игры.")
    if off_topic_rate > 0.45:
        warnings.append("Высока доля индустриального или платформенного офтопа среди исходной выборки комментариев.")
    if game.warning:
        warnings.append(game.warning)
    if not game.contextual_terms:
        warnings.append("Для игры нет дополнительного контекстного словаря; использованы только название и алиасы из манифеста.")

    primary_ratio = selected_classes["primary"] / len(selected_posts) if selected_posts else 0.0
    quality_score = clamp(
        0.32 * min(1.0, len(selected_posts) / 8)
        + 0.25 * primary_ratio
        + 0.18 * min(1.0, len(selected_comments) / 500)
        + 0.12 * min(1.0, len(phases) / 3)
        + 0.08 * stance_diversity
        + 0.05 * (1 - off_topic_rate)
    )
    summary = {
        "gameId": game.game_id,
        "canonicalTitle": game.manifest.get("canonical_title"),
        "sourcePosts": len(game.posts),
        "selectedPosts": len(selected_posts),
        "sourceComments": len(game.comments),
        "selectedComments": len(selected_comments),
        "primaryPosts": selected_classes["primary"],
        "comparativePosts": selected_classes["comparative"],
        "showcasePosts": selected_classes["showcase_segment"],
        "phaseCoverage": phases,
        "stanceDiversity": stance_diversity,
        "offtopicRate": off_topic_rate,
        "sharedSelectedPosts": shared_selected,
        "qualityScore": quality_score,
        "warnings": warnings,
        "sourcePostClasses": dict(sorted(source_classes.items())),
        "sourceCommentClasses": dict(sorted(comment_classes.items())),
    }
    report = {
        "gameId": game.game_id,
        "canonicalTitle": game.manifest.get("canonical_title"),
        "aliasesFromManifest": game.manifest.get("aliases") or [],
        "contextTermsUsed": game.contextual_terms,
        "developerTermsUsed": game.developer_terms,
        "warnings": warnings,
        "posts": assessments,
    }
    game_output = output_root / game.game_id
    write_json(game_output / "relevance-report.json", report)
    write_jsonl(game_output / "selected-posts.jsonl", selected_posts)
    write_jsonl(game_output / "selected-comments.jsonl", selected_comments)
    write_jsonl(game_output / "excluded-posts.jsonl", excluded)
    write_json(game_output / "exclusion-summary.json", dict(sorted(exclusion_counts.items())))
    (game_output / "cleaning-quality-report.md").write_text(quality_report_markdown(summary), encoding="utf-8", newline="\n")
    return summary, {"selectedPosts": selected_posts, "selectedComments": selected_comments, "assessments": assessments}


def motif_potential(summary: dict[str, Any]) -> str:
    if summary["selectedPosts"] >= 8 and summary["selectedComments"] >= 500 and len(summary["phaseCoverage"]) >= 2 and summary["stanceDiversity"] >= 0.6:
        return "high"
    if summary["selectedPosts"] >= 5 and summary["selectedComments"] >= 300:
        return "medium"
    return "low"


def spoiler_risk(game: GameSource) -> str:
    if any(bool(post.get("spoiler")) for post in game.posts):
        return "high"
    if game.game_id in {"silent-hill-2-remake", "the-witcher-3", "death-stranding", "disco-elysium"}:
        return "medium"
    return "low"


def build_ranking(games: list[GameSource], summaries: list[dict[str, Any]]) -> dict[str, Any]:
    source_by_id = {game.game_id: game for game in games}
    records: list[dict[str, Any]] = []
    for summary in summaries:
        score = clamp(summary["qualityScore"] * 0.72 + min(1.0, summary["selectedComments"] / 650) * 0.12 + min(1.0, len(summary["phaseCoverage"]) / 3) * 0.08 + summary["stanceDiversity"] * 0.08)
        reasons = [
            f"Сохранено {summary['selectedPosts']} релевантных публикаций и {summary['selectedComments']} комментариев.",
            f"Подтверждено фаз обсуждения: {len(summary['phaseCoverage'])}.",
            f"Разнообразие позиций в очищенной выборке: {summary['stanceDiversity']:.2f}.",
        ]
        risks = list(summary["warnings"])
        if summary["sharedSelectedPosts"]:
            risks.append(f"Общих с другими папками сохранённых постов: {summary['sharedSelectedPosts']}.")
        records.append(
            {
                "gameId": summary["gameId"],
                "score": score,
                "selectedPostCount": summary["selectedPosts"],
                "selectedCommentCount": summary["selectedComments"],
                "phaseDiversity": len(summary["phaseCoverage"]),
                "stanceDiversity": summary["stanceDiversity"],
                "estimatedUniqueMotifPotential": motif_potential(summary),
                "spoilerRisk": spoiler_risk(source_by_id[summary["gameId"]]),
                "reasons": reasons,
                "risks": risks,
            }
        )
    records.sort(key=lambda item: (item["score"], item["selectedCommentCount"], item["selectedPostCount"]), reverse=True)
    return {"generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "ranking": records}


def corpus_report(summary: dict[str, Any], ranking: dict[str, Any]) -> str:
    games = summary["games"]
    strong = [item["gameId"] for item in games if item["qualityScore"] >= 0.72]
    needs_scrape = [item["gameId"] for item in games if item["selectedPosts"] < 5 or item["qualityScore"] < 0.55]
    missing_phases = [item["gameId"] for item in games if len(item["phaseCoverage"]) < 2]
    platform_noise = [item["gameId"] for item in games if item["offtopicRate"] > 0.45]
    top = ranking["ranking"][:5]
    return "\n".join(
        [
            "# Очистка корпуса DTF по 25 играм",
            "",
            "## Объём",
            "",
            f"- Обработано игр: {summary['gamesProcessed']}.",
            f"- Исходных назначений постов: {summary['sourcePosts']}; уникальных постов: {summary['uniqueSourcePosts']}; общих постов: {summary['sharedPosts']}.",
            f"- Отобранных назначений постов: {summary['selectedPostAssignments']}.",
            f"- Исходных назначений комментариев: {summary['sourceComments']}; уникальных комментариев: {summary['uniqueSourceComments']}; отобранных назначений: {summary['selectedCommentAssignments']}.",
            "",
            "## Диагностика",
            "",
            f"- Сильный первый проход: {', '.join(strong) if strong else 'нет'}.",
            f"- Требуют дополнительного скрапинга или ручной проверки: {', '.join(needs_scrape) if needs_scrape else 'нет'}.",
            f"- Недостаточно подтверждённых фаз: {', '.join(missing_phases) if missing_phases else 'нет'}.",
            f"- Повышенная доля общего индустриального или платформенного офтопа: {', '.join(platform_noise) if platform_noise else 'нет'}.",
            "",
            "## Первые кандидаты для тематического пилота",
            "",
            *[f"- {item['gameId']}: {item['score']:.3f}; постов {item['selectedPostCount']}, комментариев {item['selectedCommentCount']}, фаз {item['phaseDiversity']}." for item in top],
            "",
            "Оценки фиксируют качество и тематическую связность доступной выборки. Они не формулируют мнение сообщества и не извлекают мотивы или сатирические подсказки.",
            "",
        ]
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    games = discover_games(args.source)
    args.output.mkdir(parents=True, exist_ok=True)
    post_registry, comment_registry, shared_lookup = global_registries(games)
    write_jsonl(args.output / "global-post-registry.jsonl", post_registry)
    write_jsonl(args.output / "global-comment-registry.jsonl", comment_registry)
    summaries: list[dict[str, Any]] = []
    for index, game in enumerate(games, start=1):
        print(f"[{index}/{len(games)}] {game.game_id}: analysing", flush=True)
        summary, _ = analyze_game(game, games, shared_lookup, args.output)
        summaries.append(summary)
    summaries.sort(key=lambda item: item["gameId"])
    shared_posts = sum(1 for item in post_registry if item["isSharedPost"])
    selected_posts = sum(item["selectedPosts"] for item in summaries)
    selected_comments = sum(item["selectedComments"] for item in summaries)
    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "gamesProcessed": len(games),
        "sourcePosts": sum(len(game.posts) for game in games),
        "uniqueSourcePosts": len(post_registry),
        "sharedPosts": shared_posts,
        "selectedPostAssignments": selected_posts,
        "sourceComments": sum(len(game.comments) for game in games),
        "uniqueSourceComments": len(comment_registry),
        "selectedCommentAssignments": selected_comments,
        "games": summaries,
        "method": "Rule-based first-pass classification with title/text/context signals, comment parent chains, conservative unclear outcomes, and no source-corpus mutation.",
    }
    ranking = build_ranking(games, summaries)
    write_json(args.output / "corpus-cleaning-summary.json", summary)
    write_json(args.output / "candidate-pilot-ranking.json", ranking)
    (args.output / "corpus-cleaning-report.md").write_text(corpus_report(summary, ranking), encoding="utf-8", newline="\n")
    print(f"finished: {len(games)} games, {selected_posts} selected posts, {selected_comments} selected comments", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
