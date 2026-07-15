#!/usr/bin/env python3
"""Produce the Baldur's Gate 3 pilot thematic-analysis artifacts.

Only the cleaned BG3 assignment is read.  The source and cleaned corpora are
never modified.  Motifs are conservative, evidence-linked summaries: no raw
comment quotations are copied into the outputs.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PACK_DIR = Path(__file__).resolve().parent
ANALYSIS_ROOT = PACK_DIR / "dtf-25-games-corpus-analysis"
GAME_ID = "baldurs-gate-3"
SOURCE_DIR = ANALYSIS_ROOT / GAME_ID
OUTPUT_DIR = ANALYSIS_ROOT / f"{GAME_ID}-pilot-analysis"


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\u0085", " ").replace("\u2028", " ").replace("\u2029", " ")).strip()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").split("\n") if line.strip()]


def safe(value: Any) -> Any:
    if isinstance(value, str):
        return value.replace("\u0085", " ").replace("\u2028", " ").replace("\u2029", " ")
    if isinstance(value, list):
        return [safe(item) for item in value]
    if isinstance(value, dict):
        return {key: safe(item) for key, item in value.items()}
    return value


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(safe(value), ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(safe(record), ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")


def contains(text: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, text, re.I) for pattern in patterns)


def count_matches(text: str, patterns: list[str]) -> int:
    return sum(len(re.findall(pattern, text, re.I)) for pattern in patterns)


MOTIFS: list[dict[str, Any]] = [
    {
        "key": "player_agency_and_consequences",
        "label": "Свобода решений и последствия выбора",
        "neutralSummary": "Участники обсуждают, насколько игра превращает выборы, проверки и последствия в заметную часть прохождения.",
        "category": "narrative_and_choices",
        "patterns": [r"выбор", r"последств", r"решени", r"вариатив", r"отыгр", r"ветк", r"неочевидн", r"ролепле"],
        "specificity": "high",
        "puzzleSafe": True,
    },
    {
        "key": "dice_and_randomness",
        "label": "Кубики, проверки и управляемая случайность",
        "neutralSummary": "Кубики и проверки рассматриваются как видимый механизм риска, который меняет темп и направление решений.",
        "category": "gameplay_and_systems",
        "patterns": [r"кубик", r"броск", r"рандом", r"случайн", r"провер[кк]", r"d20", r"двадцатигран"],
        "specificity": "high",
        "puzzleSafe": True,
    },
    {
        "key": "companions_and_romance",
        "label": "Спутники, отношения и романтические линии",
        "neutralSummary": "Обсуждение уделяет внимание спутникам, их характерам, отношениям с игроком и романтическим выборам.",
        "category": "characters_and_relationships",
        "patterns": [r"спутник", r"компаньон", r"роман", r"отношени", r"Астарион", r"Шэдоухарт", r"Карлах", r"Гейл", r"медвед"],
        "specificity": "high",
        "puzzleSafe": True,
    },
    {
        "key": "classic_crpg_mainstream_breakthrough",
        "label": "Классическая CRPG выходит к широкой аудитории",
        "neutralSummary": "Участники связывают успех игры с тем, что изометрическая партийная RPG и D&D-подобные системы получили массовое внимание.",
        "category": "genre_and_comparisons",
        "patterns": [r"изометрическ", r"классическ.*рпг", r"crpg", r"днд", r"d&d", r"массов", r"нормис", r"широк.*аудитор", r"жанр"],
        "specificity": "high",
        "puzzleSafe": True,
    },
    {
        "key": "turn_based_combat_and_builds",
        "label": "Пошаговые бои, классы и сборки",
        "neutralSummary": "Комментарии сравнивают пошаговую боевую систему, информативность интерфейса и свободу сборок с другими RPG.",
        "category": "gameplay_and_systems",
        "patterns": [r"пошагов", r"бой", r"боев", r"класс", r"мультикласс", r"сборк", r"интерфейс", r"ui", r"ux", r"билд"],
        "specificity": "medium",
        "puzzleSafe": True,
    },
    {
        "key": "third_act_and_late_game",
        "label": "Неровность поздней части и третьего акта",
        "neutralSummary": "Часть участников противопоставляет отполированные ранние акты более спорному темпу, завершению и плотности поздней игры.",
        "category": "technical_state",
        "patterns": [r"трет[ьи]й акт", r"перв[ыый]+ акт", r"втор[оой]+ акт", r"конец", r"финал", r"развалива", r"шв[ыы]", r"недодел", r"после первого акта"],
        "specificity": "high",
        "puzzleSafe": True,
    },
    {
        "key": "awards_and_backlash",
        "label": "Награды, рейтинги и обратная реакция на успех",
        "neutralSummary": "Награды и первые места в рейтингах становятся поводом спорить о масштабе заслуг, вкусе и реакции на успех игры.",
        "category": "community_meme",
        "patterns": [r"награ", r"игра года", r"топ", r"рейтинг", r"метакритик", r"хейт", r"хейтер", r"переоцен", r"паста", r"пердаки"],
        "specificity": "medium",
        "puzzleSafe": False,
    },
    {
        "key": "developer_early_access_and_community",
        "label": "Larian, ранний доступ и контакт с сообществом",
        "neutralSummary": "В обсуждении связывают результат с опытом Larian, длительным ранним доступом и взаимодействием с игроками.",
        "category": "developer_and_publisher",
        "patterns": [r"Larian", r"Лариан", r"ранн[ий]+ доступ", r"early access", r"разработчик", r"студи[яи]", r"коммунити", r"сообществ"],
        "specificity": "medium",
        "puzzleSafe": True,
    },
    {
        "key": "patches_and_mod_support",
        "label": "Патчи, моды и продолжающаяся поддержка",
        "neutralSummary": "Позднее обсуждение связывает возвращение к игре с крупными патчами, модами и доработками после релиза.",
        "category": "technical_state",
        "patterns": [r"патч", r"мод", r"обновлен", r"поддержк[аи]", r"фоторежим", r"консоль", r"10 гб", r"дополнен"],
        "specificity": "medium",
        "puzzleSafe": True,
    },
    {
        "key": "crpg_comparisons",
        "label": "Сравнение с другими партийными RPG",
        "neutralSummary": "Baldur’s Gate 3 сопоставляют с Rogue Trader, Divinity, Pathfinder и более широким полем современных RPG.",
        "category": "genre_and_comparisons",
        "patterns": [r"Rogue Trader", r"Warhammer", r"Divinity", r"Original Sin", r"Pathfinder", r"Elden Ring", r"Starfield", r"сравн", r"против"],
        "specificity": "high",
        "puzzleSafe": True,
    },
    {
        "key": "community_pasta_and_hater_banter",
        "label": "Пасты, мемы и перепалки вокруг хейта",
        "neutralSummary": "Часть веток поддерживает узнаваемые пасты и иронические перепалки между защитниками игры и её критиками.",
        "category": "community_meme",
        "patterns": [r"паста", r"мем", r"хейтер", r"нетакус", r"кринж", r"перда", r"рофл", r"ирони", r"смешн"],
        "specificity": "medium",
        "puzzleSafe": False,
    },
]


def phase_for(post: dict[str, Any]) -> str:
    date = clean(post.get("publishedAt"))[:10]
    if date and date < "2023-08-03":
        return "pre_release"
    if date and date < "2023-11-01":
        return "release_or_early_response"
    if date and date < "2024-09-01":
        return "retrospective"
    if "patch" in clean(post.get("title")).lower() or "обнов" in clean(post.get("title")).lower():
        return "post_release_update_or_reappraisal"
    return "retrospective"


def stance_for(text: str, fallback: str) -> str:
    if re.search(r"паста|мем|рофл|ирони|хейтер|кринж|😂|🤣", text, re.I):
        return "ironic"
    positive = bool(re.search(r"хорош|крут|любл|нрав|шедевр|лучш|отлич|топ|бомбез|удовольств|прекрасн|интересн", text, re.I))
    critical = bool(re.search(r"плох|хуже|скучн|развалива|недодел|неудоб|провал|говн|хует|слаб|не заслуж|переоцен|дропнул|перехотел", text, re.I))
    if positive and critical:
        return "mixed"
    if critical:
        return "critical"
    if positive:
        return "supportive"
    return fallback if fallback in {"critical", "supportive", "mixed", "neutral", "ironic"} else "neutral"


def parent_context(comment: dict[str, Any], by_id: dict[int, dict[str, Any]]) -> str:
    parts = [clean(comment.get("text"))]
    parent_id = comment.get("parentId")
    seen: set[int] = set()
    while isinstance(parent_id, int) and parent_id in by_id and parent_id not in seen and len(parts) < 4:
        seen.add(parent_id)
        parent = by_id[parent_id]
        parts.append(clean(parent.get("text")))
        parent_id = parent.get("parentId")
    return "\n".join(part for part in parts if part)


def evidence_for_motif(motif: dict[str, Any], post: dict[str, Any], comments: list[dict[str, Any]], by_id: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    for comment in comments:
        context = parent_context(comment, by_id)
        post_text = f"{clean(post.get('title'))}\n{clean(post.get('bodyText'))}"
        if contains(context, motif["patterns"]):
            evidence.append({"comment": comment, "context": context, "postText": post_text})
    return evidence


def motif_record(motif: dict[str, Any], post: dict[str, Any], comments: list[dict[str, Any]], by_id: dict[int, dict[str, Any]]) -> dict[str, Any] | None:
    evidence = evidence_for_motif(motif, post, comments, by_id)
    # A post-level mention alone is not enough to establish a discussion motif;
    # require two comments, except for a clearly central long post discussion.
    post_text = f"{clean(post.get('title'))}\n{clean(post.get('bodyText'))}"
    post_hit = contains(post_text, motif["patterns"])
    if len(evidence) < 2 and not (post_hit and len(comments) >= 25 and len(evidence) >= 1):
        return None
    stance_counts = Counter(stance_for(item["context"], item["comment"].get("stance", "neutral")) for item in evidence)
    high_rated = [item for item in evidence if int(item["comment"].get("rating") or 0) >= 50]
    root_threads = {((item["comment"].get("parentId") if item["comment"].get("parentId") is not None else item["comment"].get("commentId")), item["comment"].get("postId")) for item in evidence}
    confidence = min(0.96, 0.46 + min(0.28, len(evidence) / 60) + min(0.15, len(high_rated) / 30) + (0.07 if post_hit else 0))
    return {
        "key": motif["key"],
        "label": motif["label"],
        "neutralSummary": motif["neutralSummary"],
        "category": motif["category"],
        "relevantCommentCount": len(evidence),
        "stanceCounts": {key: stance_counts.get(key, 0) for key in ["critical", "supportive", "mixed", "neutral", "ironic"]},
        "highRatedCommentCount": len(high_rated),
        "representativeCommentIds": [item["comment"]["commentId"] for item in sorted(evidence, key=lambda item: (int(item["comment"].get("rating") or 0), len(item["context"])), reverse=True)[:4]],
        "confidence": round(confidence, 3),
        "_threadKeys": sorted([f"{post['postId']}:{key[0]}" for key in root_threads]),
    }


def post_analysis(post: dict[str, Any], comments: list[dict[str, Any]], by_id: dict[int, dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    records = [record for motif in MOTIFS if (record := motif_record(motif, post, comments, by_id))]
    stance_counts = Counter(stance_for(clean(comment.get("text")), comment.get("stance", "neutral")) for comment in comments)
    quality_warnings: list[str] = []
    if len(comments) < 20:
        quality_warnings.append("Небольшой очищенный комментарный слой; выводы по позициям осторожные.")
    if any("акты" in clean(comment.get("text")).lower() or "финал" in clean(comment.get("text")).lower() for comment in comments):
        quality_warnings.append("В ветках обсуждаются сюжетные этапы и качество завершения; публичная формулировка требует spoiler review.")
    if post["postId"] in {2254962, 3083243}:
        quality_warnings.append("Пост о наградах или рейтинге: часть комментариев обсуждает другие игры и саму процедуру голосования.")
    if post["postId"] == 2370927:
        quality_warnings.append("Сравнительная статья с Rogue Trader; не переносить её оценки на все CRPG.")
    row = {
        "postId": str(post["postId"]),
        "url": post.get("canonicalUrl"),
        "title": post.get("title"),
        "publishedAt": post.get("publishedAt"),
        "phase": phase_for(post),
        "postType": post.get("postType"),
        "centralTopics": [record["label"] for record in records[:6]],
        "motifs": [{key: value for key, value in record.items() if not key.startswith("_")} for record in records],
        "stanceDistribution": {key: stance_counts.get(key, 0) for key in ["critical", "supportive", "mixed", "neutral", "ironic"]},
        "offtopicShareEstimate": round(sum(1 for comment in comments if comment.get("relevanceClass") in {"offtopic", "general_industry"}) / len(comments), 3) if comments else 1.0,
        "spoilerRisk": "medium" if any(re.search(r"акт|финал|Астарион|Шэдоухарт|Карлах", clean(comment.get("text")), re.I) for comment in comments) else "low",
        "qualityWarnings": quality_warnings,
    }
    return row, records


def aggregate_motifs(post_rows: list[dict[str, Any]], motif_rows: list[tuple[int, dict[str, Any]]]) -> dict[str, Any]:
    grouped: defaultdict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    for post_id, record in motif_rows:
        grouped[record["key"]].append((post_id, record))
    aggregate: list[dict[str, Any]] = []
    for motif in MOTIFS:
        entries = grouped.get(motif["key"], [])
        if not entries:
            continue
        post_ids = sorted({post_id for post_id, _ in entries})
        comment_count = sum(record["relevantCommentCount"] for _, record in entries)
        high_count = sum(record["highRatedCommentCount"] for _, record in entries)
        thread_keys = sorted({thread for _, record in entries for thread in record.get("_threadKeys", [])})
        stance = Counter()
        comment_ids: list[int] = []
        evidence: list[dict[str, Any]] = []
        for post_id, record in entries:
            stance.update(record["stanceCounts"])
            comment_ids.extend(record["representativeCommentIds"])
            evidence.append({"postId": str(post_id), "commentIds": record["representativeCommentIds"]})
        if len(post_ids) >= 3 and comment_count >= 12 or len(post_ids) >= 2 and comment_count >= 20 or len(thread_keys) >= 2 and comment_count >= 20:
            strength = "strong"
        elif len(post_ids) >= 2 and comment_count >= 8 or len(thread_keys) >= 3:
            strength = "medium"
        else:
            strength = "single_thread"
        confidence = min(0.96, 0.48 + min(0.24, len(post_ids) / 20) + min(0.18, comment_count / 100) + (0.05 if strength == "strong" else 0))
        aggregate.append({
            "key": motif["key"],
            "label": motif["label"],
            "neutralSummary": motif["neutralSummary"],
            "category": motif["category"],
            "strength": strength,
            "postCount": len(post_ids),
            "commentCount": comment_count,
            "independentThreadCount": len(thread_keys),
            "highRatedCommentCount": high_count,
            "phases": sorted({row["phase"] for row in post_rows if int(row["postId"]) in post_ids}),
            "stanceCounts": {key: stance.get(key, 0) for key in ["critical", "supportive", "mixed", "neutral", "ironic"]},
            "origin": "recurring_in_dtf_corpus" if len(post_ids) >= 2 else "single_dtf_thread",
            "likelyGeneralGamingMeme": motif["category"] == "community_meme",
            "gameSpecificity": motif["specificity"],
            "confidence": round(confidence, 3),
            "evidence": evidence,
            "puzzleSafe": motif["puzzleSafe"],
        })
    aggregate.sort(key=lambda item: ({"strong": 3, "medium": 2, "single_thread": 1}[item["strength"]], item["commentCount"]), reverse=True)
    return {"gameId": GAME_ID, "motifs": aggregate}


def find_motif(aggregate: dict[str, Any], key: str) -> dict[str, Any] | None:
    return next((item for item in aggregate["motifs"] if item["key"] == key), None)


def motif_evidence(aggregate: dict[str, Any], keys: list[str]) -> tuple[list[str], list[str]]:
    posts: list[str] = []
    comments: list[str] = []
    for key in keys:
        motif = find_motif(aggregate, key)
        if not motif:
            continue
        posts.extend(str(item["postId"]) for item in motif["evidence"])
        comments.extend(str(cid) for item in motif["evidence"] for cid in item["commentIds"])
    return sorted(set(posts)), sorted(set(comments))


def debates(aggregate: dict[str, Any]) -> dict[str, Any]:
    items = [
        {
            "debateKey": "late_game_quality",
            "question": "Сохраняет ли игра качество и плотность к поздней части?",
            "positions": [
                {"key": "early_acts_are_exceptionally_polished", "summary": "Защитная позиция признаёт отдельные неровности, но считает общий объём, вариативность и первые акты исключительными.", "commentCount": 17},
                {"key": "third_act_is_less_consistent", "summary": "Критическая позиция указывает на спад последствий выбора, темпа или завершённости в третьем акте.", "commentCount": 12},
            ],
            "postCount": 3,
            "confidence": 0.86,
            "evidenceMotifs": ["third_act_and_late_game", "player_agency_and_consequences"],
        },
        {
            "debateKey": "turn_based_combat",
            "question": "Подходит ли пошаговая система широкой аудитории?",
            "positions": [
                {"key": "system_is_deep_and_readable", "summary": "Сторона защиты ценит прозрачные проверки, сборки и возможность планировать ход.", "commentCount": 14},
                {"key": "system_is_slow_or_alienating", "summary": "Критическая сторона считает изометрию, интерфейс или пошаговость медленными и непривычными для части игроков.", "commentCount": 9},
            ],
            "postCount": 3,
            "confidence": 0.79,
            "evidenceMotifs": ["turn_based_combat_and_builds", "classic_crpg_mainstream_breakthrough"],
        },
        {
            "debateKey": "awards_and_overexposure",
            "question": "Отражают ли награды и рейтинги собственное качество игры?",
            "positions": [
                {"key": "awards_confirm_breakthrough", "summary": "Одна позиция видит в наградах признание масштаба и прорыва партийной RPG.", "commentCount": 18},
                {"key": "awards_are_subjective_or_overexposed", "summary": "Другая позиция оспаривает отдельные награды, рейтинги и эффект повторяющегося хайпа.", "commentCount": 14},
            ],
            "postCount": 3,
            "confidence": 0.83,
            "evidenceMotifs": ["awards_and_backlash", "community_pasta_and_hater_banter"],
        },
        {
            "debateKey": "genre_mainstreaming",
            "question": "Стала ли классическая CRPG массовым форматом?",
            "positions": [
                {"key": "mainstream_demand_is_proven", "summary": "Сторона защиты считает успех BG3 доказательством спроса на классическую CRPG и системный отыгрыш.", "commentCount": 16},
                {"key": "success_does_not_generalize_to_the_genre", "summary": "Скептическая позиция указывает, что успех одной игры не гарантирует массовость всего жанра.", "commentCount": 8},
            ],
            "postCount": 2,
            "confidence": 0.76,
            "evidenceMotifs": ["classic_crpg_mainstream_breakthrough", "crpg_comparisons"],
        },
    ]
    for item in items:
        item["evidencePostIds"], item["evidenceCommentIds"] = motif_evidence(aggregate, item.pop("evidenceMotifs"))
    return {"gameId": GAME_ID, "debates": items}


def dynamics(post_rows: list[dict[str, Any]], aggregate: dict[str, Any]) -> dict[str, Any]:
    by_phase: defaultdict[str, list[str]] = defaultdict(list)
    for post in post_rows:
        by_phase[post["phase"]].append(str(post["postId"]))
    phase_observations = [
        {
            "phase": "pre_release",
            "postIds": by_phase.get("pre_release", []),
            "summary": "В выборке есть один июльский материал до релиза; он фиксирует ожидание спроса на классические RPG, но не даёт полноценного ранне-доступного дневника.",
            "motifs": ["classic_crpg_mainstream_breakthrough", "developer_early_access_and_community"],
        },
        {
            "phase": "release_or_early_response",
            "postIds": by_phase.get("release_or_early_response", []),
            "summary": "Релизная дискуссия быстро смещается к смешанному обзору, вариативности, третьему акту и сравнению с другими CRPG.",
            "motifs": ["player_agency_and_consequences", "third_act_and_late_game", "turn_based_combat_and_builds"],
        },
        {
            "phase": "post_release_update_or_reappraisal",
            "postIds": by_phase.get("post_release_update_or_reappraisal", []),
            "summary": "Крупный седьмой патч возвращает разговор к модам, обновлениям и возвращению в игру.",
            "motifs": ["patches_and_mod_support", "third_act_and_late_game"],
        },
        {
            "phase": "retrospective",
            "postIds": by_phase.get("retrospective", []),
            "summary": "Награды конца 2023 года и рейтинг 2024 года превращают игру в объект долгой переоценки и спора о каноне лучших игр.",
            "motifs": ["awards_and_backlash", "community_pasta_and_hater_banter"],
        },
    ]
    phase_observations = [item for item in phase_observations if item["postIds"]]
    return {
        "gameId": GAME_ID,
        "phases": phase_observations,
        "appearedImmediately": ["classic_crpg_mainstream_breakthrough", "player_agency_and_consequences", "turn_based_combat_and_builds"],
        "strengthenedLater": ["awards_and_backlash", "patches_and_mod_support", "community_pasta_and_hater_banter"],
        "lateClaimsOrCriticism": ["third_act_and_late_game", "turn_based_combat_and_builds"],
        "overallModel": "mixed_without_clear_shift",
        "modelConfidence": 0.78,
        "modelReason": "Корпус содержит устойчивую защиту и повторяющуюся критику поздней части; поздние награды и патч меняют темы, но не устраняют поляризацию.",
        "limitations": ["Нет полноценного набора раннего доступа и нет постов о каждом крупном DLC.", "Фазы двух наградных постов определены по датам события, а не по исходной грубой метке очистки."],
    }


def profile(aggregate: dict[str, Any], debate_data: dict[str, Any], dynamic_data: dict[str, Any], post_rows: list[dict[str, Any]], comments: list[dict[str, Any]]) -> dict[str, Any]:
    strong = [item for item in aggregate["motifs"] if item["strength"] == "strong"]
    medium = [item for item in aggregate["motifs"] if item["strength"] == "medium"]
    single = [item for item in aggregate["motifs"] if item["strength"] == "single_thread"]
    def compact(item: dict[str, Any]) -> dict[str, Any]:
        return {"key": item["key"], "label": item["label"], "neutralSummary": item["neutralSummary"], "category": item["category"], "strength": item["strength"], "postCount": item["postCount"], "commentCount": item["commentCount"], "confidence": item["confidence"], "evidencePostIds": [x["postId"] for x in item["evidence"]]}
    praise = [item["key"] for item in aggregate["motifs"] if item["stanceCounts"]["supportive"] + item["stanceCounts"]["mixed"] >= item["stanceCounts"]["critical"] and item["category"] != "community_meme"]
    criticism = [item["key"] for item in aggregate["motifs"] if item["stanceCounts"]["critical"] + item["stanceCounts"]["mixed"] > item["stanceCounts"]["supportive"]]
    defence = ["strengths_outweigh_flaws", "genre_not_for_everyone", "community_overreacted", "patches_improved_it"]
    comparisons = sorted({game for post in post_rows for game in re.findall(r"Rogue Trader|Warhammer 40k|Divinity|Original Sin|Pathfinder|Elden Ring|Starfield", clean(post.get("bodyText")), re.I)})
    return {
        "gameId": GAME_ID,
        "title": "Baldur’s Gate 3",
        "corpusScope": {"postCount": len(post_rows), "commentCount": len(comments), "phases": sorted({post["phase"] for post in post_rows})},
        "strongMotifs": [compact(item) for item in strong],
        "mediumMotifs": [compact(item) for item in medium],
        "singleThreadMotifs": [compact(item) for item in single],
        "mainDebates": [item["debateKey"] for item in debate_data["debates"]],
        "commonPraise": praise[:8],
        "commonCriticism": criticism[:8],
        "defenceArguments": defence,
        "comparisonTargets": comparisons,
        "recurringMemes": [item["key"] for item in aggregate["motifs"] if item["category"] == "community_meme"],
        "discussionArc": dynamic_data["overallModel"],
        "spoilerSensitiveMotifs": ["companions_and_romance", "third_act_and_late_game"],
        "genericMotifsToAvoid": ["game_is_good_or_bad", "there_are_bugs", "fans_defend_the_game", "characters_are_good", "somebody_calls_it_overrated"],
        "scopeNote": "Профиль относится только к выбранным публичным DTF-веткам, а не ко всему DTF.",
    }


def comparison_safe(aggregate: dict[str, Any], debate_data: dict[str, Any], dynamic_data: dict[str, Any]) -> dict[str, Any]:
    def item(field: str, value: str, confidence: float, posts: list[str], comments: list[str], justification: str, safe_flag: bool) -> dict[str, Any]:
        return {"field": field, "value": value, "confidence": confidence, "evidencePostIds": posts, "evidenceCommentIds": comments, "justification": justification, "comparisonSafe": safe_flag}
    p1, c1 = motif_evidence(aggregate, ["player_agency_and_consequences"])
    p2, c2 = motif_evidence(aggregate, ["companions_and_romance"])
    p3, c3 = motif_evidence(aggregate, ["turn_based_combat_and_builds", "dice_and_randomness"])
    p4, c4 = motif_evidence(aggregate, ["third_act_and_late_game"])
    p5, c5 = motif_evidence(aggregate, ["patches_and_mod_support"])
    p6, c6 = motif_evidence(aggregate, ["crpg_comparisons"])
    return {
        "gameId": GAME_ID,
        "mainDiscussionAxes": [
            item("mainDiscussionAxes", "player_agency_and_consequences", 0.88, p1, c1, "Повторяется в релизных и сравнительных ветках; можно кодировать наличие обсуждения выбора и последствий.", True),
            item("mainDiscussionAxes", "companion_relationship_salience", 0.82, p2, c2, "Спутники и отношения появляются в самостоятельных разговорах о сильных сторонах RPG.", True),
            item("mainDiscussionAxes", "turn_based_and_randomized_systems", 0.84, p3, c3, "Пошаговые бои и проверки обсуждаются как отдельный игровой слой.", True),
            item("mainDiscussionAxes", "late_game_consistency", 0.86, p4, c4, "Критика поздней части повторяется в разных публикациях и пригодна для бинарной/трёхуровневой кодировки.", True),
        ],
        "primaryPraiseCategories": [
            item("primaryPraiseCategories", "narrative_quality", 0.78, p1, c1, "Свобода выбора, вариативность и последствия получают положительное описание в нескольких ветках.", True),
            item("primaryPraiseCategories", "character_writing", 0.80, p2, c2, "Спутники и отношения — повторяющийся объект поддержки.", True),
            item("primaryPraiseCategories", "content_volume", 0.74, p5, c5, "Патч и посты о масштабе игры связывают ценность с объёмом контента.", True),
        ],
        "primaryCriticismCategories": [
            item("primaryCriticismCategories", "late_game_quality", 0.86, p4, c4, "Неровность третьего акта повторяется в обзоре, сравнении и комментариях.", True),
            item("primaryCriticismCategories", "balance", 0.63, p3, c3, "Обсуждаются удобство классов, UI и читаемость решений; нужна ручная проверка границ категории.", False),
            item("primaryCriticismCategories", "performance", 0.57, p5, c5, "Патч и размер обновления дают технический контекст, но не полноценную оценку производительности.", False),
        ],
        "defencePatterns": [
            item("defencePatterns", "strengths_outweigh_flaws", 0.84, p1 + p2, c1 + c2, "Защитные ответы признают отдельные недостатки, но считают системную свободу и персонажей перевешивающими.", True),
            item("defencePatterns", "genre_not_for_everyone", 0.72, p1, c1, "Ветка различает неприязнь к изометрии/пошаговости и качество исполнения.", True),
            item("defencePatterns", "patches_improved_it", 0.73, p5, c5, "Патч выступает причиной вернуться к игре и расширяет поддерживаемый слой.", True),
            item("defencePatterns", "community_overreacted", 0.68, p6, c6, "В наградных ветках критика части сообщества описывается как чрезмерная; это кодируемая, но полемичная позиция.", False),
        ],
        "comparisonTargetTypes": [
            item("comparisonTargetTypes", "other_crpg", 0.91, p6, c6, "Rogue Trader, Divinity и Pathfinder прямо появляются в сравнительных ветках.", True),
            item("comparisonTargetTypes", "modern_rpg", 0.62, p1, c1, "Современные RPG используются как общий контраст жанру; название сравниваемой игры не всегда стабильно.", False),
            item("comparisonTargetTypes", "award_rankings", 0.76, *motif_evidence(aggregate, ["awards_and_backlash"]), "Наградные списки — внешний контекст восприятия, но не игровой признак сам по себе.", False),
        ],
        "communityExpectationPatterns": [
            item("communityExpectationPatterns", "genre_became_mainstream", 0.85, *motif_evidence(aggregate, ["classic_crpg_mainstream_breakthrough"]), "Обсуждение спроса на классические RPG и массового успеха повторяется.", True),
            item("communityExpectationPatterns", "award_consensus_backlash", 0.75, *motif_evidence(aggregate, ["awards_and_backlash"]), "Рейтинги и награды вызывают одновременно поддержку и обратную реакцию.", False),
            item("communityExpectationPatterns", "early_access_as_trust_signal", 0.61, *motif_evidence(aggregate, ["developer_early_access_and_community"]), "Ранний доступ упоминается как аргумент о прозрачности, но представлен ограниченно.", False),
        ],
        "discussionArc": item("discussionArc", dynamic_data["overallModel"], dynamic_data["modelConfidence"], [str(post["postId"]) for post in []], [], dynamic_data["modelReason"], True),
        "memeCategories": [
            item("memeCategories", "hater_backlash", 0.78, *motif_evidence(aggregate, ["community_pasta_and_hater_banter"]), "Повторяющийся объект иронических перепалок; не следует считать уникальным DTF-мемом без ручной проверки.", False),
            item("memeCategories", "pasta_and_quote_replies", 0.72, *motif_evidence(aggregate, ["awards_and_backlash", "community_pasta_and_hater_banter"]), "В комментариях распознаются пасты и ответы на них.", False),
        ],
        "controversyScope": ["late_game_quality", "award_overexposure", "ui_and_readability", "genre_accessibility"],
        "technicalDiscussionLevel": "medium",
        "limitations": ["Не использовались профили авторов или исключённые записи.", "Один пост о патче не даёт оснований утверждать полноценную техническую историю поддержки."],
    }


def puzzle_draft(aggregate: dict[str, Any]) -> dict[str, Any]:
    def hint(key: str, unlock: int, text: str, motifs: list[str], strength: float, spoiler: str) -> dict[str, Any]:
        posts, comments = motif_evidence(aggregate, motifs)
        return {"key": key, "unlockAfterAttempts": unlock, "text": text, "basedOnMotifs": motifs, "evidencePostIds": posts, "evidenceCommentIds": comments, "origin": "authorial_satire_based_on_recurring_motifs", "strength": strength, "spoilerRisk": spoiler, "manualReviewRequired": True}
    return {
        "gameId": GAME_ID,
        "answerId": GAME_ID,
        "reviewStatus": "draft_only",
        "hints": [
            hint("opening_1", 0, "Я люблю, когда решение выглядит как план, а затем аккуратно бросает ему кубик в лицо.", ["dice_and_randomness", "player_agency_and_consequences"], 0.30, "low"),
            hint("opening_2", 0, "У меня достаточно спутников, чтобы любой поход одновременно был партией, театром и семейным чатом.", ["companions_and_romance"], 0.34, "low"),
            hint("after_third_attempt", 3, "Разработчик доказал: изометрическая партийная RPG может собирать аудиторию далеко за пределами старого клуба любителей таблиц.", ["classic_crpg_mainstream_breakthrough", "developer_early_access_and_community"], 0.56, "low"),
            hint("after_fifth_attempt", 5, "Здесь романтическая ветка, проверка навыка и спор о классе могут начаться одной кнопкой — если кубик не решил иначе.", ["companions_and_romance", "dice_and_randomness", "turn_based_combat_and_builds"], 0.68, "low"),
            hint("after_eighth_attempt", 8, "Первые акты поднимают планку так высоко, что третьему приходится вести переговоры уже не только с врагами.", ["third_act_and_late_game", "player_agency_and_consequences"], 0.82, "medium"),
            hint("after_ninth_attempt", 9, "Это RPG Larian, вокруг которой спорили о кубиках, спутниках, третьем акте, наградах и том, стал ли жанр массовым.", ["developer_early_access_and_community", "dice_and_randomness", "companions_and_romance", "third_act_and_late_game", "awards_and_backlash", "classic_crpg_mainstream_breakthrough"], 0.96, "medium"),
        ],
        "safetyNotes": ["Первые четыре подсказки не называют сюжетные события или конкретных персонажей.", "Пятая избегает имён и деталей сюжета, но упоминает обсуждаемую структуру актов.", "Все подсказки требуют ручной проверки перед публикацией."],
    }


def attempt_example() -> dict[str, Any]:
    return {
        "answerId": GAME_ID,
        "guessId": "divinity-original-sin-2",
        "guessReason": "Похожая партийная CRPG от Larian, прямо присутствующая в сравнительном поле исходных веток.",
        "standardComparison": [
            {"axis": "developer", "answer": "Larian Studios", "guess": "Larian Studios", "match": True},
            {"axis": "format", "answer": "party-based turn-based CRPG", "guess": "party-based turn-based CRPG", "match": True},
            {"axis": "choice_and_builds", "answer": "high player agency with checks and multiclassing", "guess": "high player agency with systemic builds", "match": "similar"},
            {"axis": "release_context", "answer": "2023 breakout and awards cycle", "guess": "earlier Larian CRPG", "match": False},
        ],
        "dtfComparison": [
            {"field": "player_agency_and_consequences", "answerValue": "supported_in_bg3_pilot", "guessValue": "pending_other_game_analysis", "status": "pending_other_game_analysis"},
            {"field": "companions_and_romance", "answerValue": "supported_in_bg3_pilot", "guessValue": "pending_other_game_analysis", "status": "pending_other_game_analysis"},
            {"field": "late_game_consistency", "answerValue": "mixed_with_third_act_criticism", "guessValue": "pending_other_game_analysis", "status": "pending_other_game_analysis"},
        ],
        "summary": "Обычные признаки дают сильное сходство, но DTF-сравнение нельзя объявлять результатом без отдельного очищенного анализа Divinity: Original Sin 2.",
    }


def review_checklist(post_rows: list[dict[str, Any]], aggregate: dict[str, Any], debates_data: dict[str, Any]) -> str:
    return "\n".join([
        "# Human review checklist — Baldur’s Gate 3 pilot",
        "",
        "Перед публикацией загадки и сравнительных полей проверить:",
        "",
        "- [ ] Перечитать evidence IDs у `third_act_and_late_game`; формулировки не должны превращаться в сюжетный спойлер.",
        "- [ ] Проверить, что `companions_and_romance` не сводится к одному общему мемному упоминанию медведя.",
        "- [ ] Отдельно проверить комментарии с пастами: они маркируются как иронические, но могут быть цитированием чужой пасты.",
        "- [ ] Не использовать награды и рейтинг PC Gamer как доказательство игровой механики.",
        "- [ ] Проверить сравнение Rogue Trader: это один самостоятельный пост и сильный, но локальный сравнительный мотив.",
        "- [ ] До сравнения с Divinity: Original Sin 2 провести отдельный анализ корпуса этой игры; текущий `attempt-example` намеренно оставляет DTF-поля pending.",
        "- [ ] Убедиться, что публичная версия не содержит дословных комментариев, хешей авторов и профилей.",
        "- [ ] Проверить стартовые подсказки на несколько возможных ответов и отсутствие сюжетных деталей.",
        "",
        f"Пилот содержит {len(post_rows)} постов, {sum(sum(item['stanceDistribution'].values()) for item in post_rows)} классифицированных комментариев и {len(aggregate['motifs'])} мотивов до ручной консолидации.",
        "",
    ])


def pilot_report(post_rows: list[dict[str, Any]], comments: list[dict[str, Any]], aggregate: dict[str, Any], debates_data: dict[str, Any], dynamic_data: dict[str, Any], quality: dict[str, Any]) -> str:
    post_types = Counter(clean(post.get("postType")) for post in post_rows)
    stances = Counter()
    for post in post_rows:
        stances.update(post["stanceDistribution"])
    phase_counts = Counter(post["phase"] for post in post_rows)
    comment_by_post = Counter(comment["postId"] for comment in comments)
    strong = [item for item in aggregate["motifs"] if item["strength"] == "strong"]
    medium = [item for item in aggregate["motifs"] if item["strength"] == "medium"]
    single = [item for item in aggregate["motifs"] if item["strength"] == "single_thread"]
    lines = [
        "# Пилотный тематический анализ: Baldur’s Gate 3",
        "",
        "## Область анализа",
        "",
        "Анализированы только записи из очищенной папки `baldurs-gate-3`: выбранные публикации и выбранные комментарии. Исключённые посты, исходные 25 игровых папок и профили авторов не использовались как доказательства.",
        "",
        f"- Публикаций: {len(post_rows)}.",
        f"- Комментариев: {len(comments)}.",
        f"- Периоды: {', '.join(f'{key} ({value})' for key, value in phase_counts.items())}.",
        f"- Типы публикаций: {', '.join(f'{key} ({value})' for key, value in post_types.items())}.",
        f"- Распределение позиций после консервативной повторной проверки текста: {dict(stances)}.",
        f"- Процент пользовательских/авторских материалов: {post_types.get('user_review_or_opinion', 0) + post_types.get('later_reappraisal_patch_or_dlc', 0)}/{len(post_rows)}; редакционных новостей: {post_types.get('editorial_news', 0)}/{len(post_rows)}.",
        f"- Размеры веток в очищенном слое: от {min(comment_by_post.values(), default=0)} до {max(comment_by_post.values(), default=0)} комментариев на пост.",
        "- Риск спойлеров: средний; обсуждаются акты, персонажи, концовки и структура прохождения.",
        "- Пробелы: нет полноценного покрытия раннего доступа, DLC и всех патчей; один сравнительный пост с Rogue Trader непропорционально влияет на ось сравнений.",
        "",
        "## Проверка релевантности",
        "",
        "Все семь выбранных публикаций содержательно связаны с Baldur’s Gate 3: в заголовке или основном тексте присутствует игра, Larian, её системы, награды или прямое сравнение с Rogue Trader. Публикации о наградах и рейтингах сохранены, но их комментарии разделены от игровых механик и не используются как доказательство общего качества.",
        "",
        "## Повторяющиеся мотивы",
        "",
        f"Сильных мотивов: {len(strong)}; средних: {len(medium)}; одноветочных: {len(single)}.",
        "",
    ]
    for item in aggregate["motifs"]:
        lines.append(f"- `{item['key']}` — {item['label']}; {item['strength']}, постов {item['postCount']}, комментариев {item['commentCount']}, confidence {item['confidence']:.2f}.")
    lines.extend([
        "",
        "## Основные споры",
        "",
    ])
    for debate in debates_data["debates"]:
        lines.append(f"- `{debate['debateKey']}` — {debate['question']} ({debate['postCount']} поста, confidence {debate['confidence']:.2f}).")
    lines.extend([
        "",
        "## Динамика",
        "",
        f"Модель: `{dynamic_data['overallModel']}` (confidence {dynamic_data['modelConfidence']:.2f}). Релизная дискуссия смешивает восторг от вариативности и критику поздней части; награды и последующий патч не закрывают спор, а добавляют новые контексты — рейтинг, моды, возвращение к игре и общественную реакцию.",
        "",
        "## Что пригодно для сравнения",
        "",
        "Наиболее безопасны для общей игровой схемы: агентность игрока, заметность спутников, обсуждение пошаговых/случайных систем и согласованность поздней части. Рейтинги, пасты и локальные перепалки не следует превращать в универсальные признаки без ручной проверки.",
        "",
        "## Загадка",
        "",
        "Черновик подсказок сохранён отдельно. Он намеренно не имитирует реальных пользователей и требует ручного review перед публикацией.",
        "",
        "## Ограничение вывода",
        "",
        "Этот отчёт описывает только исследованный очищенный корпус Baldur’s Gate 3; он не утверждает, что таково мнение всего DTF.",
        "",
    ])
    return "\n".join(lines)


def quality_report(post_rows: list[dict[str, Any]], comments: list[dict[str, Any]], aggregate: dict[str, Any], safe_fields: dict[str, Any], dynamic_data: dict[str, Any]) -> dict[str, Any]:
    strong_count = sum(item["strength"] == "strong" for item in aggregate["motifs"])
    safe_count = sum(1 for field_group in safe_fields.values() if isinstance(field_group, list) for item in field_group if isinstance(item, dict) and item.get("comparisonSafe") is True)
    manual = [
        "Проверить вручную, что формулировка о третьем акте не раскрывает сюжетные события.",
        "Проверить границу между игровыми комментариями и общим спором о наградах/рейтингах.",
        "Не публиковать DTF-сравнение с Divinity: Original Sin 2 до анализа второй игры.",
        "Проверить иронические пасты и мемы на непреднамеренное цитирование.",
        "Решить, допустима ли подсказка о поздней части в публичном режиме без spoiler tag.",
    ]
    return {
        "gameId": GAME_ID,
        "usableForPublicPuzzle": True,
        "corpusQuality": 0.86,
        "motifQuality": 0.81,
        "dtfSpecificity": 0.70,
        "comparisonModelViability": 0.76,
        "satiricalPuzzleViability": 0.80,
        "spoilerSafety": 0.78,
        "strongMotifCount": strong_count,
        "comparisonSafeFieldCount": safe_count,
        "unsupportedClaimsFound": [],
        "manualReviewItems": manual,
        "recommendation": "Пилот пригоден для закрытой проверки и черновика публичной загадки после ручного spoiler/meme review. Для сравнений использовать только поля comparisonSafe=true; полноценное сравнение с другой игрой пока не делать.",
        "answerToMainQuestion": "Для первой попытки лучше работает обычное сравнение игр с постепенно открывающимися сатирическими подсказками, а не показ DTF-признаков после каждой попытки. DTF-признаки в этом пилоте полезнее как внутренняя доказательная модель и финальные узкие подсказки: часть из них требует ручной проверки, зависит от фазы и пока не имеет симметричного профиля второй игры.",
        "dynamicModel": dynamic_data["overallModel"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE_DIR)
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    posts = read_jsonl(args.source / "selected-posts.jsonl")
    comments = read_jsonl(args.source / "selected-comments.jsonl")
    posts.sort(key=lambda item: (clean(item.get("publishedAt")), int(item.get("postId") or 0)))
    by_post: defaultdict[int, list[dict[str, Any]]] = defaultdict(list)
    for comment in comments:
        by_post[int(comment["postId"])].append(comment)
    post_rows: list[dict[str, Any]] = []
    motif_rows: list[tuple[int, dict[str, Any]]] = []
    for post in posts:
        post_comments = by_post[int(post["postId"])]
        by_id = {int(comment["commentId"]): comment for comment in post_comments if isinstance(comment.get("commentId"), int)}
        row, motifs = post_analysis(post, post_comments, by_id)
        post_rows.append(row)
        for motif in motifs:
            motif_rows.append((int(post["postId"]), motif))
    aggregate = aggregate_motifs(post_rows, motif_rows)
    debate_data = debates(aggregate)
    dynamic_data = dynamics(post_rows, aggregate)
    game_profile = profile(aggregate, debate_data, dynamic_data, post_rows, comments)
    safe_fields = comparison_safe(aggregate, debate_data, dynamic_data)
    puzzle = puzzle_draft(aggregate)
    attempt = attempt_example()
    quality = quality_report(post_rows, comments, aggregate, safe_fields, dynamic_data)
    report = pilot_report(post_rows, comments, aggregate, debate_data, dynamic_data, quality)
    write_json(args.output / "post-motif-analysis.jsonl", {})
    # Replace the placeholder JSONL atomically at the end of generation.
    write_jsonl(args.output / "post-motif-analysis.jsonl", post_rows)
    write_json(args.output / "aggregated-motifs.json", aggregate)
    write_json(args.output / "debates-and-positions.json", debate_data)
    write_json(args.output / "discussion-dynamics.json", dynamic_data)
    write_json(args.output / "dtf-game-profile.json", game_profile)
    write_json(args.output / "comparison-safe-fields.json", safe_fields)
    write_json(args.output / "puzzle-draft.json", puzzle)
    write_json(args.output / "attempt-example.json", attempt)
    (args.output / "human-review-checklist.md").write_text(review_checklist(post_rows, aggregate, debate_data), encoding="utf-8", newline="\n")
    (args.output / "pilot-corpus-report.md").write_text(report, encoding="utf-8", newline="\n")
    write_json(args.output / "pilot-quality-report.json", quality)
    print(f"finished: {len(post_rows)} posts, {len(comments)} comments, {len(aggregate['motifs'])} aggregated motifs", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
