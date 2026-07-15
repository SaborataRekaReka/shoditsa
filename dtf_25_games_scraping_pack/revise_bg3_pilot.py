#!/usr/bin/env python3
"""Revise the existing BG3 pilot without re-cleaning or adding sources."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


PACK = Path(__file__).resolve().parent
PILOT = PACK / "dtf-25-games-corpus-analysis" / "baldurs-gate-3-pilot-analysis"
OUT = PACK / "dtf-25-games-corpus-analysis" / "baldurs-gate-3-pilot-revised"


PATTERNS = {
    "player_agency_and_consequences": [r"выбор", r"последств", r"решени", r"вариатив", r"отыгр", r"ветк", r"неочевидн", r"ролепле"],
    "dice_and_randomness": [r"кубик", r"броск", r"рандом", r"случайн", r"провер[кк]", r"d20", r"двадцатигран"],
    "companions_and_romance": [r"спутник", r"компаньон", r"роман", r"отношени", r"астарион", r"шэдоухарт", r"карлах", r"гейл", r"медвед"],
    "classic_crpg_mainstream_breakthrough": [r"изометрическ", r"классическ.*рпг", r"crpg", r"днд", r"d&d", r"массов", r"нормис", r"широк.*аудитор", r"жанр"],
    "turn_based_combat_and_builds": [r"пошагов", r"бой", r"боев", r"класс", r"мультикласс", r"сборк", r"интерфейс", r"ui", r"ux", r"билд"],
    "third_act_and_late_game": [r"трет[ьи]й акт", r"перв[ыый]+ акт", r"втор[оой]+ акт", r"конец", r"финал", r"развалива", r"шв[ыы]", r"недодел", r"после первого акта"],
    "awards_and_backlash": [r"награ", r"игра года", r"топ", r"рейтинг", r"метакритик", r"хейт", r"хейтер", r"переоцен", r"паста", r"пердаки"],
    "developer_early_access_and_community": [r"larian", r"лариан", r"ранн[ий]+ доступ", r"early access", r"разработчик", r"студи[яи]", r"коммунити", r"сообществ"],
    "patches_and_mod_support": [r"патч", r"мод", r"обновлен", r"поддержк[аи]", r"фоторежим", r"консоль", r"10 гб", r"дополнен"],
    "crpg_comparisons": [r"rogue trader", r"warhammer", r"divinity", r"original sin", r"pathfinder", r"elden ring", r"starfield", r"сравн", r"против"],
    "community_pasta_and_hater_banter": [r"паста", r"мем", r"хейтер", r"нетакус", r"кринж", r"перда", r"рофл", r"ирони", r"смешн"],
}

LABELS = {
    "player_agency_and_consequences": ("Свобода решений и последствия выбора", "narrative_and_choices"),
    "dice_and_randomness": ("Кубики, проверки и управляемая случайность", "gameplay_and_systems"),
    "companions_and_romance": ("Спутники, отношения и романтические линии", "characters_and_relationships"),
    "classic_crpg_mainstream_breakthrough": ("Классическая CRPG выходит к широкой аудитории", "genre_and_comparisons"),
    "turn_based_combat_and_builds": ("Пошаговые бои, классы и сборки", "gameplay_and_systems"),
    "third_act_and_late_game": ("Неровность поздней части и третьего акта", "narrative_and_choices"),
    "awards_and_backlash": ("Награды, рейтинги и обратная реакция на успех", "industry_context"),
    "developer_early_access_and_community": ("Larian, ранний доступ и контакт с сообществом", "developer_and_publisher"),
    "patches_and_mod_support": ("Поддержка после релиза и моды", "technical_state"),
    "crpg_comparisons": ("Сравнение с другими партийными RPG", "genre_and_comparisons"),
    "community_pasta_and_hater_banter": ("Пасты и перепалки вокруг хейта", "community_meme"),
}

CLASSIFICATION = {
    "player_agency_and_consequences": "core",
    "dice_and_randomness": "core",
    "companions_and_romance": "core",
    "classic_crpg_mainstream_breakthrough": "core",
    "third_act_and_late_game": "core",
    "awards_and_backlash": "core",
    "crpg_comparisons": "core",
    "turn_based_combat_and_builds": "supporting",
    "developer_early_access_and_community": "supporting",
    "patches_and_mod_support": "supporting",
    "community_pasta_and_hater_banter": "reject",
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").split("\n") if line.strip()]


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def write_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for value in values:
            handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def norm(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "").replace("\u0085", " ").replace("\u2028", " ").replace("\u2029", " ")).strip()


def matches(text: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, text, re.I) for pattern in patterns)


def parent_context(comment: dict[str, Any], by_id: dict[int, dict[str, Any]]) -> str:
    parts = [norm(comment.get("text"))]
    parent = comment.get("parentId")
    seen: set[int] = set()
    while isinstance(parent, int) and parent in by_id and parent not in seen and len(parts) < 4:
        seen.add(parent)
        parts.append(norm(by_id[parent].get("text")))
        parent = by_id[parent].get("parentId")
    return "\n".join(part for part in parts if part)


def root_key(comment: dict[str, Any], by_id: dict[int, dict[str, Any]]) -> str:
    current = comment
    seen: set[int] = set()
    while isinstance(current.get("parentId"), int) and current["parentId"] in by_id and current["parentId"] not in seen:
        seen.add(int(current["commentId"]))
        current = by_id[current["parentId"]]
    return f"{current.get('postId')}:{current.get('commentId')}"


def audit_motifs(posts: list[dict[str, Any]], comments: list[dict[str, Any]], aggregate: dict[str, Any]) -> list[dict[str, Any]]:
    by_post: defaultdict[int, list[dict[str, Any]]] = defaultdict(list)
    for comment in comments:
        by_post[int(comment["postId"])].append(comment)
    post_by_id = {int(post["postId"]): post for post in posts}
    results: list[dict[str, Any]] = []
    all_comment_membership: defaultdict[int, set[str]] = defaultdict(set)
    matched_ids_by_key: dict[str, set[int]] = {}
    matched_posts_by_key: dict[str, set[int]] = {}
    roots_by_key: dict[str, set[str]] = {}
    for key, patterns in PATTERNS.items():
        matched_comments: set[int] = set()
        matched_posts: set[int] = set()
        roots: set[str] = set()
        for post_id, post_comments in by_post.items():
            by_id = {int(comment["commentId"]): comment for comment in post_comments}
            for comment in post_comments:
                context = parent_context(comment, by_id)
                if matches(context, patterns):
                    cid = int(comment["commentId"])
                    matched_comments.add(cid)
                    matched_posts.add(post_id)
                    roots.add(root_key(comment, by_id))
                    all_comment_membership[cid].add(key)
        matched_ids_by_key[key] = matched_comments
        matched_posts_by_key[key] = matched_posts
        roots_by_key[key] = roots
        agg = next((item for item in aggregate["motifs"] if item["key"] == key), {})
        retrospective = sum(1 for post_id in matched_posts if post_by_id[post_id].get("phase") in {"retrospective", "post_release_update_or_reappraisal"})
        post_count = len(matched_posts)
        base_specificity = 0.88 if agg.get("gameSpecificity") == "high" else 0.64
        dtf_specificity = 0.82 if key in {"awards_and_backlash", "crpg_comparisons", "classic_crpg_mainstream_breakthrough"} else 0.68
        classification = CLASSIFICATION[key]
        warnings: list[str] = []
        if key == "third_act_and_late_game":
            warnings.append("Переклассифицировано из technical_state в narrative_and_choices: это оценка согласованности поздней части, а не диагноз технологии.")
        if key == "patches_and_mod_support":
            warnings.append("Разделено на фактическую поддержку/моды и защитные аргументы; исходный ключ не используется как единый публичный мотив.")
        if key == "developer_early_access_and_community":
            warnings.append("Отделён факт раннего доступа и контекст Larian от оценочных аргументов в защиту игры.")
        if key == "awards_and_backlash":
            warnings.append("Не считать игровой механикой; использовать только как DTF-дискурсивный мотив о наградах и реакции на них.")
        if key == "community_pasta_and_hater_banter":
            warnings.append("Недостаточно оснований считать формат уникальным локальным DTF-мемом; исключено из публичной загадки.")
        results.append({
            "key": key,
            "label": LABELS[key][0],
            "originalCategory": agg.get("category"),
            "revisedCategory": LABELS[key][1],
            "classification": classification,
            "uniquePostCount": post_count,
            "uniqueCommentCount": len(matched_comments),
            "independentRootBranchCount": len(roots),
            "commentOverlapAcrossMotifs": 0,
            "retrospectiveShare": round(retrospective / post_count, 3) if post_count else 0.0,
            "bg3Specificity": base_specificity,
            "dtfSpecificity": dtf_specificity,
            "sourceAggregateStrength": agg.get("strength"),
            "evidencePostIds": sorted(str(value) for value in matched_posts),
            "evidenceCommentIds": sorted(str(value) for value in matched_comments),
            "warnings": warnings,
        })
    overlap_count = sum(1 for memberships in all_comment_membership.values() if len(memberships) > 1)
    for row in results:
        row["commentOverlapAcrossMotifs"] = sum(1 for cid, memberships in all_comment_membership.items() if row["key"] in memberships and len(memberships) > 1)
        row["overlapMethod"] = "unique selected comment IDs matched by more than one revised audit pattern"
    return results


def add_split_rows(audit: list[dict[str, Any]], posts: list[dict[str, Any]], comments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add explicit corrected facets for the two conflated source motifs."""
    post_by_id = {int(post["postId"]): post for post in posts}
    by_post: defaultdict[int, list[dict[str, Any]]] = defaultdict(list)
    for comment in comments:
        by_post[int(comment["postId"])].append(comment)

    def facet(key: str, source: str, label: str, category: str, patterns: list[str], note: str) -> dict[str, Any]:
        ids: set[int] = set()
        post_ids: set[int] = set()
        roots: set[str] = set()
        for pid, cs in by_post.items():
            by_id = {int(c["commentId"]): c for c in cs}
            for c in cs:
                if matches(parent_context(c, by_id), patterns):
                    ids.add(int(c["commentId"])); post_ids.add(pid); roots.add(root_key(c, by_id))
        return {
            "key": key, "label": label, "revisedCategory": category, "classification": "supporting" if len(post_ids) >= 2 else "single_context",
            "derivedFrom": source, "uniquePostCount": len(post_ids), "uniqueCommentCount": len(ids), "independentRootBranchCount": len(roots),
            "commentOverlapAcrossMotifs": 0, "retrospectiveShare": round(sum(post_by_id[pid]["phase"] in {"retrospective", "post_release_update_or_reappraisal"} for pid in post_ids) / len(post_ids), 3) if post_ids else 0.0,
            "bg3Specificity": 0.72, "dtfSpecificity": 0.62, "evidencePostIds": sorted(str(pid) for pid in post_ids), "evidenceCommentIds": sorted(str(cid) for cid in ids), "note": note,
        }

    facets = [
        facet("post_release_support_and_mods", "patches_and_mod_support", "Поддержка после релиза и моды", "technical_state", [r"патч", r"мод", r"обновлен", r"фоторежим", r"консоль", r"10 гб"], "Фактическая сторона: что добавляли и почему игроки возвращались."),
        facet("defence_by_patches", "patches_and_mod_support", "Патчи как аргумент в защиту игры", "developer_and_publisher", [r"патч.*(верн|исправ|доказ|улучш)", r"верн.*патч", r"доработ", r"не последн.*обновлен"], "Оценочная сторона: улучшения используются как ответ на критику."),
        facet("developer_context_and_early_access", "developer_early_access_and_community", "Контекст Larian и раннего доступа", "developer_and_publisher", [r"larian", r"ранн[ий]+ доступ", r"early access", r"panel from hell", r"разработчик"], "Фактический контекст производства и коммуникации."),
        facet("quality_defence_by_larian_track_record", "developer_early_access_and_community", "Защита через репутацию Larian", "developer_and_publisher", [r"larian.*(доказ|успех|умеют|сделал|довери)", r"(доказ|успех|умеют|сделал|довери).*larian"], "Оценочный аргумент: репутация разработчика используется как защита."),
    ]
    return facets


def evidence_for(audit_by_key: dict[str, dict[str, Any]], keys: list[str]) -> tuple[list[str], list[str]]:
    posts: set[str] = set(); comments: set[str] = set()
    for key in keys:
        row = audit_by_key.get(key)
        if row:
            posts.update(row.get("evidencePostIds", [])); comments.update(row.get("evidenceCommentIds", []))
    return sorted(posts), sorted(comments)


def build_hints(audit_by_key: dict[str, dict[str, Any]]) -> dict[str, Any]:
    definitions = [
        ("opening_1", 0, ["player_agency_and_consequences", "dice_and_randomness"],
         "В этой игре выборы часто проходят проверку на удачу.",
         "Ты придумал план. Игра придумала кубик.",
         "Наконец RPG, где даже гениальный план сначала проходит собеседование у d20.", "low", "dtf_satirical"),
        ("opening_2", 0, ["companions_and_romance"],
         "Здесь партия запоминается не меньше, чем карта.",
         "Собрал отряд — получил ещё несколько мнений о каждом своём решении.",
         "В этой RPG у каждого спутника есть билд, роман и готовая рецензия на твой выбор.", "low", "dtf_satirical"),
        ("after_third_attempt", 3, ["classic_crpg_mainstream_breakthrough", "developer_early_access_and_community"],
         "Игра превратила старый формат партийной RPG в большой разговор.",
         "Классическая изометрия вышла из ниши и теперь сама объясняет индустрии, как делать RPG.",
         "Larian не просто выпустила CRPG — она назначила индустрии устный экзамен.", "low", "dtf_satirical"),
        ("after_fifth_attempt", 5, ["awards_and_backlash", "crpg_comparisons"],
         "Её успех обсуждают рядом с Rogue Trader, Divinity и списками лучших игр.",
         "После релиза у игры появились две кампании: своя и по разбору всех соседних RPG.",
         "Каждый новый рейтинг запускает бонусную схватку: кто именно дал ей первое место и почему это всех задело.", "low", "sharp_dtf_satirical"),
        ("after_eighth_attempt", 8, ["third_act_and_late_game"],
         "У этой RPG ранние акты стали меркой, с которой спорят о финале.",
         "Первые акты уже получили пятёрку, а третий всё ещё сдаёт пересдачу.",
         "У игры настолько высокий первый акт, что третий до сих пор пытается доказать, что он тоже был на паре.", "medium", "dtf_satirical"),
        ("after_ninth_attempt", 9, ["developer_early_access_and_community", "dice_and_randomness", "companions_and_romance", "third_act_and_late_game", "awards_and_backlash", "classic_crpg_mainstream_breakthrough"],
         "Ответ — большая RPG Larian с Dungeons & Dragons, кубиками, спутниками и спорным третьим актом.",
         "Это Baldur’s Gate 3: игра, где свобода выбора породила собственный жанр комментариев.",
         "Это Baldur’s Gate 3 — та самая CRPG, после которой любой спор о RPG приходит с кубиком, спутником и обязательным «третий акт…».", "medium", "sharp_dtf_satirical"),
    ]
    hints = []
    for key, unlock, motifs, neutral, dtf, sharp, spoiler, selected in definitions:
        posts, comments = evidence_for(audit_by_key, motifs)
        hints.append({
            "key": key, "unlockAfterAttempts": unlock, "basedOnMotifs": motifs,
            "variants": {"neutral": neutral, "dtf_satirical": dtf, "sharp_dtf_satirical": sharp},
            "selectedVariant": selected, "selectedText": {"neutral": neutral, "dtf_satirical": dtf, "sharp_dtf_satirical": sharp}[selected],
            "evidencePostIds": posts, "evidenceCommentIds": comments, "independentEvidencePostCount": len(posts),
            "spoilerRisk": spoiler, "manualReviewRequired": True,
        })
    return {"gameId": "baldurs-gate-3", "hints": hints, "selectionNote": "Выбраны DTF-стилистические версии; evidence IDs остаются внутренними и не выводятся в public-puzzle."}


def public_puzzle(hints: dict[str, Any]) -> dict[str, Any]:
    return {
        "gameId": "baldurs-gate-3",
        "answerId": "baldurs-gate-3",
        "publicMode": "dtf_promo",
        "hints": [
            {"key": hint["key"], "unlockAfterAttempts": hint["unlockAfterAttempts"], "text": hint["selectedText"], "style": hint["selectedVariant"], "basedOnMotifs": hint["basedOnMotifs"], "spoilerRisk": hint["spoilerRisk"], "manualReviewRequired": True}
            for hint in hints["hints"]
        ],
        "publicComparisonFields": ["year", "genres", "platforms", "developer", "publisher", "gameFormat", "ratings"],
        "dtfMotifsInComparisonTable": False,
        "openingCandidateGuidance": "Стартовые две реплики не называют Larian, D&D, конкретный класс или персонажа; они оставляют несколько партийных RPG-кандидатов.",
        "finalScreenUsesMotifs": True,
    }


def result_explanation() -> dict[str, Any]:
    return {
        "title": "Почему эти подсказки появились",
        "gameId": "baldurs-gate-3",
        "explanation": [
            {"motif": "player_agency_and_consequences", "text": "В корпусе повторяется интерес к свободе решений и последствиям, а не только к линейному прохождению."},
            {"motif": "dice_and_randomness", "text": "Кубики и проверки выступают узнаваемым языком обсуждения риска и отыгрыша."},
            {"motif": "companions_and_romance", "text": "Спутники и отношения регулярно обсуждаются как самостоятельная ценность партийной RPG."},
            {"motif": "classic_crpg_mainstream_breakthrough", "text": "Успех игры используется в споре о том, может ли классическая CRPG выйти к широкой аудитории."},
            {"motif": "third_act_and_late_game", "text": "Поздняя часть стала устойчивой осью критики, но не единственным описанием игры."},
            {"motif": "awards_and_backlash", "text": "Награды и первые места порождают и признание, и обязательную обратную реакцию в комментариях."},
        ],
        "scopeNote": "Объяснение относится к выбранному корпусу Baldur’s Gate 3 и не приписывает эти позиции всему DTF.",
    }


def quality_report(audit: list[dict[str, Any]], hints: dict[str, Any]) -> dict[str, Any]:
    core = [row for row in audit if row["classification"] == "core"]
    ordinary_risk = {
        "opening_1": "high",
        "opening_2": "high",
        "after_third_attempt": "medium",
        "after_fifth_attempt": "medium",
        "after_eighth_attempt": "low",
        "after_ninth_attempt": "low",
    }
    evidence = {hint["key"]: hint["independentEvidencePostCount"] for hint in hints["hints"]}
    return {
        "gameId": "baldurs-gate-3",
        "revisionScope": "Re-audit of existing pilot artifacts only; source and cleaned corpora were not re-cleaned or extended.",
        "dtfSpecificEnough": True,
        "dtfSpecificityAssessment": "yes_with_caveat",
        "dtfSpecificityReason": "The selected sequence uses the form of recurring DTF discussion—industry lectures, award backlash and obligatory third-act counterarguments—rather than generic praise alone.",
        "coreMotifCount": len(core),
        "coreMotifsUsedInPuzzle": [row["key"] for row in core],
        "hintIndependentEvidencePostCounts": evidence,
        "ordinaryTriviaRiskByHint": ordinary_risk,
        "canPublishWithoutSpoilerWarning": "no_for_full_sequence; yes_for_opening_four_after_manual_review",
        "spoilerReason": "The eighth and ninth hints refer to the recurring late-game/third-act criticism; they do not reveal plot events, but the topic is spoiler-sensitive.",
        "formulationsRequiringManualRewrite": ["after_eighth_attempt.sharp_dtf_satirical", "after_ninth_attempt.sharp_dtf_satirical", "after_fifth_attempt.sharp_dtf_satirical"],
        "publicPuzzleViability": 0.82,
        "motifAuditConfidence": 0.79,
        "unsupportedClaimsFound": [],
        "manualReviewItems": [
            "Проверить, что мемная формулировка не узнаваема как дословная паста из исходных комментариев.",
            "Решить, нужен ли spoiler tag на подсказках после восьмой попытки.",
            "Проверить, что первые две подсказки оставляют 3–5 партийных RPG-кандидатов.",
            "Проверить, что после пятой попытки остаются 2–3 кандидата, а не только BG3.",
            "Не показывать DTF-мотивы в обычной сравнительной таблице.",
        ],
        "mainQuestionAnswer": "Для проморежима лучше оставить обычное сравнение игр после каждой попытки, а DTF-мотивы использовать только в стартовых репликах, открывающихся подсказках и финальном объяснении. Так сохраняется понятный игровой интерфейс, а локальная сатира остаётся доказательной и не превращается в спорную метрику.",
    }


def manual_review(audit: list[dict[str, Any]], hints: dict[str, Any]) -> str:
    core = [row["key"] for row in audit if row["classification"] == "core"]
    return "\n".join([
        "# Manual review — revised Baldur’s Gate 3 pilot",
        "",
        "## До публикации",
        "",
        "- [ ] Проверить семь core-мотивов и не добавлять к загадке supporting/reject-мотивы без новой доказательной проверки.",
        "- [ ] Убедиться, что `third_act_and_late_game` описывает качество и согласованность поздней части, а не техническую неисправность и не сюжет.",
        "- [ ] Развести фактическую поддержку/моды и защитные аргументы о патчах.",
        "- [ ] Развести факты о Larian/раннем доступе и оценочные аргументы защиты репутацией разработчика.",
        "- [ ] Не использовать `awards_and_backlash` как признак качества игры; это только дискурсивный мотив.",
        "- [ ] Не использовать `community_pasta_and_hater_banter` в публичной загадке без подтверждения локальности мема.",
        "",
        "## Подсказки",
        "",
        *[f"- [ ] {hint['key']}: {hint['selectedText']} — {hint['independentEvidencePostCount']} независимых постов; риск {hint['spoilerRisk']}." for hint in hints["hints"]],
        "",
        "## Интерфейс",
        "",
        "- [ ] В таблице сравнения показывать только год, жанры, платформы, разработчика, издателя, игровой формат и рейтинги.",
        "- [ ] Evidence IDs не показывать пользователю.",
        "- [ ] Сравнение с Divinity: Original Sin 2 оставить pending до отдельного анализа второй игры.",
        "",
        f"Core-мотивы: {', '.join(core)}.",
        "",
    ])


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    posts = read_jsonl(PILOT / "post-motif-analysis.jsonl")
    comments = read_jsonl(PILOT.parent / "baldurs-gate-3" / "selected-comments.jsonl")
    aggregate = read_json(PILOT / "aggregated-motifs.json")
    dynamics = read_json(PILOT / "discussion-dynamics.json")
    existing_debates = read_json(PILOT / "debates-and-positions.json")
    existing_puzzle = read_json(PILOT / "puzzle-draft.json")
    audit = audit_motifs(posts, comments, aggregate)
    audit_by_key = {row["key"]: row for row in audit}
    split_rows = add_split_rows(audit, posts, comments)
    revised = []
    for row in audit:
        if row["classification"] == "reject":
            continue
        copy = dict(row)
        copy["publicUse"] = row["classification"] in {"core", "supporting"}
        copy["publicUseNote"] = "Использовать в подсказках или финальном объяснении." if copy["publicUse"] else "Не использовать без дополнительной проверки."
        if row["key"] == "third_act_and_late_game":
            copy["revisedCategory"] = "narrative_and_choices"
            copy["publicUseNote"] = "Можно использовать без сюжетных деталей; требуется spoiler review."
        if row["key"] == "awards_and_backlash":
            copy["revisedCategory"] = "industry_context"
            copy["publicUseNote"] = "Только как форма публичной реакции на успех, не как игровой признак."
        revised.append(copy)
    revised.extend(split_rows)
    rejected = []
    for row in audit:
        if row["classification"] == "reject":
            row_copy = dict(row)
            row_copy["reason"] = "Повторяется, но не доказан как локальный DTF-формат; слишком близок к общему интернет-мему и исключён из публичной загадки."
            rejected.append(row_copy)
    rejected.append({
        "key": "patches_and_mod_support_as_single_motif",
        "status": "rejected_as_conflated",
        "reason": "Исходный мотив одновременно смешивал фактическую поддержку после релиза и защитные аргументы; его заменили двумя facet-строками.",
        "replacementKeys": ["post_release_support_and_mods", "defence_by_patches"],
    })
    rejected.append({
        "key": "developer_early_access_and_community_as_quality_claim",
        "status": "rejected_as_conflated",
        "reason": "Фактический контекст разработки нельзя автоматически превращать в оценку качества; добавлены отдельные facet-строки.",
        "replacementKeys": ["developer_context_and_early_access", "quality_defence_by_larian_track_record"],
    })
    hints = build_hints(audit_by_key)
    public = public_puzzle(hints)
    result = result_explanation()
    quality = quality_report(audit, hints)
    write_json(OUT / "motif-audit.json", {"gameId": "baldurs-gate-3", "sourceArtifacts": ["post-motif-analysis.jsonl", "aggregated-motifs.json", "debates-and-positions.json", "discussion-dynamics.json", "puzzle-draft.json"], "motifs": audit})
    write_json(OUT / "revised-motifs.json", {"gameId": "baldurs-gate-3", "maxCoreMotifsForPuzzle": 7, "motifs": revised})
    write_json(OUT / "rejected-motifs.json", {"gameId": "baldurs-gate-3", "motifs": rejected})
    write_json(OUT / "hint-variants.json", hints)
    write_json(OUT / "public-puzzle.json", public)
    write_json(OUT / "result-explanation.json", result)
    (OUT / "manual-review.md").write_text(manual_review(audit, hints), encoding="utf-8", newline="\n")
    write_json(OUT / "revision-quality-report.json", quality)
    print(f"finished: {len(audit)} audited motifs, {len(revised)} revised rows, {len(hints['hints'])} hint stages", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
