#!/usr/bin/env python3
"""Normalize, deduplicate, score, and export the danetki corpus."""

from __future__ import annotations

import csv
import glob
import hashlib
import json
import math
import re
import shutil
import unicodedata
import zipfile
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors


ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "sources"
OUTPUT = ROOT / "danetki_dataset"


SOURCE_META = {
    "yesnogame": {
        "name": "YesNoGame",
        "homepage": "https://yesnogame.net/",
        "license": "unknown",
        "license_note": "No explicit dataset/content reuse license was found during collection.",
        "commercial_ready": False,
        "base_quality": 0.78,
    },
    "splat": {
        "name": "SPLAT",
        "homepage": "https://github.com/chenqi008/LateralThinking",
        "license": "unknown",
        "license_note": "Repository exposes the data but no explicit license file was found.",
        "commercial_ready": False,
        "base_quality": 0.84,
    },
    "lateval": {
        "name": "LatEval",
        "homepage": "https://github.com/THUKElab/LatEval",
        "license": "research_noncommercial",
        "license_note": "Paper is CC BY-NC 4.0 and states that source licenses were checked for non-profit academic research; repository data terms are not separately stated.",
        "commercial_ready": False,
        "base_quality": 0.92,
    },
    "turtlesoup_bench": {
        "name": "TurtleSoup-Bench",
        "homepage": "https://github.com/lin-ruo/TurtleSoup-Bench",
        "license": "unknown",
        "license_note": "Repository exposes the data but no explicit license file was found.",
        "commercial_ready": False,
        "base_quality": 0.95,
    },
    "turtlebench": {
        "name": "TurtleBench1.5k",
        "homepage": "https://huggingface.co/datasets/Duguce/TurtleBench1.5k",
        "license": "Apache-2.0",
        "license_note": "Dataset repository includes an Apache-2.0 license.",
        "commercial_ready": True,
        "base_quality": 0.82,
    },
    "deepturtle": {
        "name": "DeepTurtle",
        "homepage": "https://huggingface.co/datasets/YuiMax/DeepTurtle",
        "license": "MIT",
        "license_note": "Hugging Face dataset card declares MIT.",
        "commercial_ready": True,
        "base_quality": 0.90,
    },
}

SOURCE_PRIORITY = {
    "turtlesoup_bench": 60,
    "lateval": 55,
    "yesnogame": 50,
    "splat": 45,
    "turtlebench": 40,
    "deepturtle": 35,
}


def clean_text(value) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def norm(value: str) -> str:
    value = clean_text(value).casefold()
    value = re.sub(r"[^\w]+", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def sha(value: str, length: int = 16) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def split_numbered_clues(value: str) -> list[str]:
    clues = []
    for line in clean_text(value).splitlines():
        line = re.sub(r"^\s*\d+[.)、]?\s*", "", line).strip()
        if line:
            clues.append(line)
    return clues


def unique_texts(values, limit: int | None = None) -> list[str]:
    seen = set()
    result = []
    for value in values:
        value = clean_text(value)
        key = norm(value)
        if value and key not in seen:
            seen.add(key)
            result.append(value)
            if limit is not None and len(result) >= limit:
                break
    return result


def make_source_record(
    source: str,
    source_id,
    language: str,
    title: str,
    condition: str,
    solution: str,
    source_url: str,
    *,
    key_facts=None,
    tags=None,
    difficulty=None,
    quality=None,
    translations=None,
    dedupe_text_en=None,
    extra=None,
) -> dict:
    meta = SOURCE_META[source]
    record = {
        "source": source,
        "source_id": str(source_id),
        "language": language,
        "title": clean_text(title),
        "condition": clean_text(condition),
        "solution": clean_text(solution),
        "key_facts": unique_texts(key_facts or []),
        "tags": unique_texts(tags or []),
        "difficulty": int(difficulty) if difficulty is not None else None,
        "quality": round(float(quality if quality is not None else meta["base_quality"]), 4),
        "translations": translations or {},
        "dedupe_text_en": clean_text(dedupe_text_en or ""),
        "source_url": source_url,
        "extra": extra or {},
    }
    if not record["dedupe_text_en"] and language == "en":
        record["dedupe_text_en"] = " ".join(
            [record["title"], record["condition"], record["solution"]]
        )
    return record


def load_yesnogame() -> list[dict]:
    ru_rows = json.loads((SOURCES / "yesnogame/ru_stories.json").read_text(encoding="utf-8"))
    en_rows = json.loads((SOURCES / "yesnogame/en_stories.json").read_text(encoding="utf-8"))
    en_by_id = {str(row["source_id"]): row for row in en_rows}
    records = []
    for row in ru_rows:
        en = en_by_id.get(str(row["source_id"]))
        votes = row.get("rating_votes") or 0
        liked = row.get("liked_percent") or 65
        difficulty = row.get("difficulty_10")
        difficulty_component = 0.05
        if difficulty is not None:
            difficulty_component = 0.08 * (1 - abs(difficulty - 6) / 10)
        quality = (
            0.42
            + 0.36 * min(max(liked / 100, 0), 1)
            + 0.12 * min(math.log1p(votes) / math.log1p(3000), 1)
            + difficulty_component
        )
        translations = {}
        dedupe_text_en = ""
        if en:
            translations["en"] = {
                "title": clean_text(en["title"]),
                "condition": clean_text(en["condition"]),
                "solution": clean_text(en["solution"]),
                "source_url": en["source_url"],
            }
            dedupe_text_en = " ".join([en["title"], en["condition"], en["solution"]])
        records.append(
            make_source_record(
                "yesnogame",
                row["source_id"],
                "ru",
                row["title"],
                row["condition"],
                row["solution"],
                row["source_url"],
                tags=row.get("tags", []),
                difficulty=difficulty,
                quality=min(quality, 0.97),
                translations=translations,
                dedupe_text_en=dedupe_text_en,
                extra={
                    "liked_percent": liked,
                    "rating_votes": votes,
                    "solve_minutes": row.get("solve_minutes"),
                },
            )
        )
    return records


def load_splat() -> list[dict]:
    frame = pd.read_excel(SOURCES / "splat/puzzles.xlsx")
    records = []
    for index, row in frame.iterrows():
        difficulty_text = clean_text(row.get("level of difficulty"))
        match = re.search(r"(\d+)\s*/\s*10", difficulty_text)
        difficulty = int(match.group(1)) if match else None
        records.append(
            make_source_record(
                "splat",
                index,
                "en",
                row.get("title", ""),
                row.get("story", ""),
                row.get("answer", ""),
                "https://github.com/chenqi008/LateralThinking/blob/main/puzzles.xlsx",
                difficulty=difficulty,
                tags=[difficulty_text.split()[-1].lower()] if difficulty_text else [],
            )
        )
    return records


def load_lateval() -> list[dict]:
    records = []
    for language, filename in (("en", "english.json"), ("zh", "chinese.json")):
        rows = json.loads((SOURCES / "lateval" / filename).read_text(encoding="utf-8"))
        for row in rows:
            records.append(
                make_source_record(
                    "lateval",
                    f"{language}-{row['id']}",
                    language,
                    "",
                    row["question"],
                    row["answer"],
                    f"https://github.com/THUKElab/LatEval/blob/main/data/{filename}",
                    key_facts=split_numbered_clues(row.get("clue", "")),
                    tags=["curated", "key-clues"],
                )
            )
    return records


def load_turtlesoup_bench() -> list[dict]:
    records = []
    for en_path in sorted((SOURCES / "turtlesoup_bench/en").glob("*.json")):
        zh_path = SOURCES / "turtlesoup_bench/zh" / en_path.name
        en_rows = json.loads(en_path.read_text(encoding="utf-8"))
        zh_rows = json.loads(zh_path.read_text(encoding="utf-8"))
        category = en_path.stem
        if len(en_rows) != len(zh_rows):
            raise ValueError(f"Mismatched bilingual TurtleSoup category: {category}")
        for index, (en, zh) in enumerate(zip(en_rows, zh_rows)):
            translations = {
                "zh": {
                    "title": clean_text(zh.get("title", "")),
                    "condition": clean_text(zh["surface"]),
                    "solution": clean_text(zh["bottom"]),
                }
            }
            records.append(
                make_source_record(
                    "turtlesoup_bench",
                    f"{category}-{index}",
                    "en",
                    en.get("title", ""),
                    en["surface"],
                    en["bottom"],
                    f"https://github.com/lin-ruo/TurtleSoup-Bench/blob/main/data/en/{en_path.name}",
                    key_facts=en.get("tips", []),
                    tags=[category],
                    translations=translations,
                )
            )
    return records


def load_turtlebench() -> list[dict]:
    en_rows = json.loads((SOURCES / "turtlebench/en_stories.json").read_text(encoding="utf-8"))
    zh_rows = json.loads((SOURCES / "turtlebench/zh_stories.json").read_text(encoding="utf-8"))
    records = []
    for position, row in enumerate(en_rows):
        zh = zh_rows[position] if position < len(zh_rows) else None
        translations = {}
        if zh:
            translations["zh"] = {
                "title": clean_text(zh.get("title", "")),
                "condition": clean_text(zh["surface"]),
                "solution": clean_text(zh["bottom"]),
            }
        records.append(
            make_source_record(
                "turtlebench",
                row["index"],
                "en",
                row["title"],
                row["surface"],
                row["bottom"],
                "https://huggingface.co/datasets/Duguce/TurtleBench1.5k",
                tags=["real-user-guesses"],
                translations=translations,
            )
        )
    return records


def load_deepturtle() -> list[dict]:
    rows = json.loads((SOURCES / "deepturtle/deep_turtle.json").read_text(encoding="utf-8"))
    grouped = defaultdict(list)
    for row in rows:
        grouped[(clean_text(row["surface"]), clean_text(row["truth"]))].append(row)
    records = []
    for index, ((surface, truth), group) in enumerate(grouped.items()):
        first_row = group[0]
        profile = first_row.get("logic_profile", {})
        if isinstance(profile, str):
            try:
                profile = json.loads(profile)
            except json.JSONDecodeError:
                profile = {"raw": profile}
        milestones = profile.get("milestones", {}) if isinstance(profile, dict) else {}
        key_facts = list(milestones.keys()) if isinstance(milestones, dict) else []
        reviews = [row.get("review_data") for row in group if row.get("review_data")]
        records.append(
            make_source_record(
                "deepturtle",
                first_row.get("id", index),
                "zh",
                first_row.get("title", ""),
                surface,
                truth,
                "https://huggingface.co/datasets/YuiMax/DeepTurtle",
                key_facts=key_facts,
                tags=["logic-profile", "human-reviewed-failure"],
                extra={"logic_profile": profile, "review_data": reviews},
            )
        )
    return records


class UnionFind:
    def __init__(self, size: int):
        self.parent = list(range(size))

    def find(self, item: int) -> int:
        while self.parent[item] != item:
            self.parent[item] = self.parent[self.parent[item]]
            item = self.parent[item]
        return item

    def union(self, left: int, right: int) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root != right_root:
            self.parent[right_root] = left_root


def deduplicate(records: list[dict]) -> tuple[list[list[int]], list[tuple[int, int, float]]]:
    uf = UnionFind(len(records))
    exact = {}
    for index, record in enumerate(records):
        key = norm(record["condition"] + " " + record["solution"])
        if key in exact:
            uf.union(index, exact[key])
        else:
            exact[key] = index

    english_indices = [index for index, record in enumerate(records) if record["dedupe_text_en"]]
    english_texts = [records[index]["dedupe_text_en"] for index in english_indices]
    near_pairs = []
    if english_texts:
        matrix = TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(3, 5),
            min_df=2,
            max_features=160_000,
            sublinear_tf=True,
        ).fit_transform(english_texts)
        neighbors = NearestNeighbors(n_neighbors=min(10, len(english_texts)), metric="cosine", algorithm="brute")
        neighbors.fit(matrix)
        distances, indices = neighbors.kneighbors(matrix)
        for local_i, (row_distances, row_indices) in enumerate(zip(distances, indices)):
            global_i = english_indices[local_i]
            title_i = norm(records[global_i]["title"])
            for distance, local_j in zip(row_distances[1:], row_indices[1:]):
                global_j = english_indices[local_j]
                if global_j <= global_i:
                    continue
                similarity = 1.0 - float(distance)
                title_j = norm(records[global_j]["title"])
                same_specific_title = bool(title_i and title_i == title_j and len(title_i) >= 7)
                if similarity >= 0.94 or (same_specific_title and similarity >= 0.80):
                    uf.union(global_i, global_j)
                    near_pairs.append((global_i, global_j, round(similarity, 5)))

    groups = defaultdict(list)
    for index in range(len(records)):
        groups[uf.find(index)].append(index)
    clusters = sorted(groups.values(), key=lambda members: min(members))
    return clusters, near_pairs


def content_flags(text: str) -> list[str]:
    folded = text.casefold()
    rules = {
        "death": r"\b(dead|death|died|dies|corpse|murder|killed|suicide)\b|\b(смерт|труп|умер|погиб|убит|самоубий|покончил)\w*|死|杀|尸",
        "violence": r"\b(gun|shot|knife|blood|attack|weapon)\b|\b(оруж|пистолет|выстрел|нож|кров|напал)\w*|枪|血|刀",
        "self_harm": r"\b(suicide|killed himself|kills herself)\b|\b(самоубий|покончил с собой|убил себя)\w*|自杀",
        "supernatural": r"\b(ghost|spirit|supernatural|demon|magic)\b|\b(призрак|дух|демон|мистик|магия)\w*|鬼|灵界",
        "medical": r"\b(doctor|hospital|surgery|disease|illness)\b|\b(врач|больниц|операц|болезн)\w*|医生|医院|病",
    }
    return [name for name, pattern in rules.items() if re.search(pattern, folded, re.IGNORECASE)]


def representative_score(record: dict) -> float:
    russian_bonus = 100 if record["language"] == "ru" else 0
    titled_bonus = 2 if record["title"] else 0
    key_fact_bonus = min(len(record["key_facts"]), 8) * 0.1
    return russian_bonus + SOURCE_PRIORITY[record["source"]] + titled_bonus + record["quality"] + key_fact_bonus


def merge_cluster(records: list[dict], member_indices: list[int], cluster_no: int) -> dict:
    members = [records[index] for index in member_indices]
    selected = max(members, key=representative_score)
    selected_meta = SOURCE_META[selected["source"]]
    title_candidates = [selected["title"]] + [record["title"] for record in members]
    title = next((value for value in title_candidates if clean_text(value)), "")
    if not title:
        title = ("Без названия" if selected["language"] == "ru" else "Untitled") + f" #{cluster_no:04d}"

    translations = dict(selected.get("translations", {}))
    for record in members:
        if record["language"] != selected["language"] and record["language"] not in translations:
            translations[record["language"]] = {
                "title": record["title"],
                "condition": record["condition"],
                "solution": record["solution"],
            }
        for language, translation in record.get("translations", {}).items():
            translations.setdefault(language, translation)
    translations.pop(selected["language"], None)

    key_facts = unique_texts(fact for record in members for fact in record["key_facts"])
    tags = unique_texts(tag for record in members for tag in record["tags"])
    difficulties = [record["difficulty"] for record in members if record["difficulty"] is not None]
    difficulty = round(sum(difficulties) / len(difficulties)) if difficulties else None
    sources = sorted({record["source"] for record in members})
    quality = min(0.99, max(record["quality"] for record in members) + 0.01 * (len(sources) - 1))

    provenance = []
    for record in members:
        meta = SOURCE_META[record["source"]]
        provenance.append(
            {
                "source": record["source"],
                "source_name": meta["name"],
                "source_id": record["source_id"],
                "url": record["source_url"],
                "language": record["language"],
                "license": meta["license"],
                "license_note": meta["license_note"],
            }
        )

    alternate_formulations = []
    for record in sorted(members, key=representative_score, reverse=True):
        if record is selected:
            continue
        if norm(record["condition"] + record["solution"]) == norm(selected["condition"] + selected["solution"]):
            continue
        alternate_formulations.append(
            {
                "language": record["language"],
                "condition": record["condition"],
                "solution": record["solution"],
                "source": record["source"],
            }
        )
        if len(alternate_formulations) == 3:
            break

    canonical = norm(selected["condition"] + " " + selected["solution"])
    record_id = "dnk_" + sha(canonical)
    split_bucket = int(hashlib.sha256(record_id.encode("utf-8")).hexdigest()[:8], 16) % 100
    split = "train" if split_bucket < 90 else ("validation" if split_bucket < 95 else "test")

    merged = {
        "id": record_id,
        "title": title,
        "condition": selected["condition"],
        "solution": selected["solution"],
        "language": selected["language"],
        "translations": translations,
        "key_facts": key_facts,
        "difficulty_10": difficulty,
        "tags": tags,
        "content_flags": content_flags(selected["condition"] + " " + selected["solution"]),
        "quality_score": round(quality, 4),
        "training_roles": unique_texts(
            ["writer_reference"]
            + (["critic_reference"] if key_facts else [])
            + (["host_evaluation"] if any(record["source"] in {"turtlebench", "deepturtle"} for record in members) else [])
        ),
        "split": split,
        "selected_text_license": selected_meta["license"],
        "selected_text_commercial_ready": selected_meta["commercial_ready"],
        "provenance": provenance,
        "source_count": len(sources),
        "duplicate_cluster_size": len(members),
        "alternate_formulations": alternate_formulations,
    }

    selected_extra = selected.get("extra", {})
    if selected_extra:
        merged["source_metrics"] = {
            key: value
            for key, value in selected_extra.items()
            if key not in {"logic_profile", "review_data"} and value is not None
        }
    logic_profiles = [record.get("extra", {}).get("logic_profile") for record in members if record.get("extra", {}).get("logic_profile")]
    reviews = [
        review
        for record in members
        for review in record.get("extra", {}).get("review_data", [])
        if review
    ]
    if logic_profiles:
        merged["logic_profile"] = logic_profiles[0]
    if reviews:
        merged["review_data"] = reviews
    return merged


def write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def build_host_qa() -> list[dict]:
    output = []
    for language, filename in (("en", "en_data.jsonl"), ("zh", "zh_data.jsonl")):
        label_map = {
            "Correct": "yes",
            "Incorrect": "no",
            "Unknown": "irrelevant",
            "T": "yes",
            "F": "no",
            "N": "irrelevant",
        }
        with (SOURCES / "turtlebench" / filename).open(encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, start=1):
                row = json.loads(line)
                answer = label_map.get(row["label"], str(row["label"]).casefold())
                item = {
                    "id": "qa_" + sha(f"turtlebench:{language}:{line_no}:{row['user_guess']}", 20),
                    "language": language,
                    "condition": clean_text(row["surface"]),
                    "solution": clean_text(row["bottom"]),
                    "question_or_guess": clean_text(row["user_guess"]),
                    "answer": answer,
                    "source": "turtlebench",
                    "source_license": "Apache-2.0",
                }
                output.append(item)
    return output


def make_sft_rows(records: list[dict]) -> list[dict]:
    rows = []
    for record in records:
        if record["split"] != "train":
            continue
        difficulty = record["difficulty_10"] or 6
        tags = ", ".join(record["tags"][:5]) or "свободная тема"
        prompt = (
            f"Создай качественную данетку на языке {record['language']}. "
            f"Ориентировочная сложность: {difficulty}/10. Темы или механики: {tags}. "
            "Верни JSON с полями title, condition, solution, key_facts, difficulty_10 и tags."
        )
        answer = {
            "title": record["title"],
            "condition": record["condition"],
            "solution": record["solution"],
            "key_facts": record["key_facts"],
            "difficulty_10": record["difficulty_10"],
            "tags": record["tags"],
        }
        rows.append(
            {
                "messages": [
                    {
                        "role": "system",
                        "content": "Ты автор логичных и оригинальных данеток. Строго соблюдай заданный язык и JSON-формат.",
                    },
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": json.dumps(answer, ensure_ascii=False)},
                ]
            }
        )
    return rows


def write_knowledge_files(records: list[dict], chunk_size: int = 800) -> list[Path]:
    paths = []
    for chunk_no, start in enumerate(range(0, len(records), chunk_size), start=1):
        subset = records[start : start + chunk_size]
        path = OUTPUT / f"custom_gpt_knowledge_part_{chunk_no:03d}.md"
        with path.open("w", encoding="utf-8") as handle:
            handle.write("# Корпус данеток — справочный материал\n\n")
            handle.write(
                "Используйте примеры для анализа структуры и механизмов. "
                "Не копируйте персонажей, предметы и причинные цепочки.\n\n"
            )
            for record in subset:
                handle.write(f"## {record['id']} — {record['title']}\n\n")
                handle.write(f"Язык: {record['language']}  \n")
                handle.write(f"Качество: {record['quality_score']}  \n")
                if record["difficulty_10"] is not None:
                    handle.write(f"Сложность: {record['difficulty_10']}/10  \n")
                if record["tags"]:
                    handle.write(f"Теги: {', '.join(record['tags'])}  \n")
                handle.write(f"\n**Условие:** {record['condition']}\n\n")
                handle.write(f"**Разгадка:** {record['solution']}\n\n")
                if record["key_facts"]:
                    handle.write("**Ключевые факты:**\n\n")
                    for fact in record["key_facts"]:
                        handle.write(f"- {fact}\n")
                    handle.write("\n")
        paths.append(path)
    return paths


def write_fingerprints(records: list[dict]) -> Path:
    path = OUTPUT / "plot_fingerprints.md"
    with path.open("w", encoding="utf-8") as handle:
        handle.write("# Сюжетные отпечатки для проверки повторов\n\n")
        handle.write("Сравнивайте новые идеи с условием и ключевой причинной цепочкой каждой записи.\n\n")
        for record in records:
            solution = re.sub(r"\s+", " ", record["solution"])
            if len(solution) > 420:
                solution = solution[:417].rsplit(" ", 1)[0] + "..."
            handle.write(
                f"- **{record['id']} | {record['title']} | {record['language']}** — "
                f"{record['condition']} → {solution}\n"
            )
    return path


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)

    source_records = (
        load_yesnogame()
        + load_splat()
        + load_lateval()
        + load_turtlesoup_bench()
        + load_turtlebench()
        + load_deepturtle()
    )
    source_counts = Counter(record["source"] for record in source_records)
    clusters, near_pairs = deduplicate(source_records)
    merged = [merge_cluster(source_records, members, cluster_no) for cluster_no, members in enumerate(clusters, start=1)]
    merged.sort(key=lambda row: (-row["quality_score"], row["id"]))

    full_path = OUTPUT / "danetki_puzzles_full.jsonl"
    write_jsonl(full_path, merged)
    part_paths = []
    for part_no, start in enumerate(range(0, len(merged), 1000), start=1):
        path = OUTPUT / f"danetki_puzzles_part_{part_no:03d}.jsonl"
        write_jsonl(path, merged[start : start + 1000])
        part_paths.append(path)
    for split in ("train", "validation", "test"):
        write_jsonl(OUTPUT / f"danetki_puzzles_{split}.jsonl", [row for row in merged if row["split"] == split])

    host_qa = build_host_qa()
    write_jsonl(OUTPUT / "danetki_host_qa_full.jsonl", host_qa)
    write_jsonl(OUTPUT / "danetki_writer_sft_train.jsonl", make_sft_rows(merged))
    knowledge_paths = write_knowledge_files(merged)
    fingerprint_path = write_fingerprints(merged)

    custom_gpt_instructions = """# Инструкция для Custom GPT «Редактор данеток»

Ты — редакционная система для создания оригинальных данеток.

Используй загруженные файлы как справочный корпус для изучения структуры,
сложности, сюжетных механизмов и типичных причинно-следственных цепочек.

Запрещено воспроизводить конкретных персонажей, предметы, формулировки и
причинные цепочки из корпуса. Перед выдачей результата сравни каждую идею с
`plot_fingerprints.md` и отклоняй смысловые, переводные и декорационные повторы.

При запросе на N данеток выполни внутренний процесс:

1. Создай не менее 3N коротких концепций.
2. Удали концепции, совпадающие с известными сюжетами.
3. Проверь причинность, однозначность разгадки и честность условия.
4. Убедись, что ключевые факты можно установить вопросами «Да», «Нет» и «Неважно».
5. Оцени оригинальность, логику, игровую раскрываемость и качество формулировки.
6. Разработай N лучших концепций полностью.
7. Смоделируй для каждой 10–20 вопросов игрока и исправь обнаруженные противоречия.

Выдавай каждую готовую данетку в JSON:

```json
{
  "title": "",
  "condition": "",
  "solution": "",
  "key_facts": [],
  "hidden_assumption": "",
  "mechanisms": [],
  "difficulty_10": 1,
  "expected_questions": [
    {"question": "", "answer": "yes|no|irrelevant"}
  ],
  "quality_scores": {
    "originality": 0,
    "logic": 0,
    "fairness": 0,
    "playability": 0
  },
  "similarity_risks": [],
  "originality_explanation": ""
}
```

Не показывай отброшенные внутренние концепции и скрытые рассуждения. Показывай
только итог, краткий отчёт о проверке и найденные риски совпадения.
"""
    (OUTPUT / "CUSTOM_GPT_INSTRUCTIONS.md").write_text(custom_gpt_instructions, encoding="utf-8")

    license_rows = []
    for key, meta in SOURCE_META.items():
        license_rows.append(
            {
                "source": key,
                "name": meta["name"],
                "homepage": meta["homepage"],
                "raw_records": source_counts.get(key, 0),
                "license": meta["license"],
                "commercial_ready": meta["commercial_ready"],
                "note": meta["license_note"],
            }
        )
    with (OUTPUT / "sources_and_licenses.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=license_rows[0].keys())
        writer.writeheader()
        writer.writerows(license_rows)

    split_counts = Counter(row["split"] for row in merged)
    language_counts = Counter(row["language"] for row in merged)
    selected_license_counts = Counter(row["selected_text_license"] for row in merged)
    source_cluster_counts = Counter(
        provenance["source"] for row in merged for provenance in row["provenance"]
    )
    stats = {
        "build_date": date.today().isoformat(),
        "raw_puzzle_records": len(source_records),
        "unique_puzzles": len(merged),
        "duplicates_merged": len(source_records) - len(merged),
        "near_duplicate_edges": len(near_pairs),
        "host_qa_rows": len(host_qa),
        "source_raw_counts": dict(sorted(source_counts.items())),
        "source_provenance_counts_after_merge": dict(sorted(source_cluster_counts.items())),
        "language_counts": dict(sorted(language_counts.items())),
        "split_counts": dict(sorted(split_counts.items())),
        "selected_text_license_counts": dict(sorted(selected_license_counts.items())),
        "commercial_ready_selected_texts": sum(row["selected_text_commercial_ready"] for row in merged),
        "knowledge_files": [path.name for path in knowledge_paths],
        "jsonl_parts": [path.name for path in part_paths],
    }
    (OUTPUT / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    readme = f"""# Данетки: объединённый корпус

Дата сборки: {stats['build_date']}

## Состав

- Сырых карточек: **{stats['raw_puzzle_records']}**
- Уникальных карточек после дедупликации: **{stats['unique_puzzles']}**
- Объединено повторов: **{stats['duplicates_merged']}**
- Пар вопрос/ответ ведущего: **{stats['host_qa_rows']}**
- Train/validation/test: **{split_counts['train']} / {split_counts['validation']} / {split_counts['test']}**

## Главные файлы

- `danetki_puzzles_full.jsonl` — канонический полный корпус.
- `danetki_puzzles_part_001.jsonl` и последующие — тот же корпус частями по 1000 записей.
- `danetki_writer_sft_train.jsonl` — тренировочный JSONL в формате `messages`.
- `danetki_host_qa_full.jsonl` — вопросы/догадки игроков и ответы `yes/no/irrelevant`.
- `custom_gpt_knowledge_part_*.md` — файлы, подготовленные для Knowledge в Custom GPT.
- `plot_fingerprints.md` — компактный индекс для проверки смысловых повторов.
- `sources_and_licenses.csv` — происхождение и режим использования источников.
- `stats.json` — точная статистика сборки.

## Рекомендуемая загрузка в Custom GPT

Загрузите все `custom_gpt_knowledge_part_*.md`, `plot_fingerprints.md` и этот README.
Полный JSONL нужен для программной обработки, обучения открытой модели и повторной фильтрации.

## Поля канонической записи

`id`, `title`, `condition`, `solution`, `language`, `translations`, `key_facts`,
`difficulty_10`, `tags`, `content_flags`, `quality_score`, `training_roles`, `split`,
`selected_text_license`, `selected_text_commercial_ready`, `provenance`,
`duplicate_cluster_size`, `alternate_formulations`.

## Дедупликация

Точные повторы объединены после нормализации Unicode и пунктуации. Англоязычные записи,
включая английские параллельные версии YesNoGame, дополнительно сгруппированы по
символьному TF-IDF с консервативным порогом 0.94. Исходники кластера сохранены в
`provenance`, а альтернативные формулировки — в `alternate_formulations`.

## Ограничения

Метки лицензий относятся к выбранным публичным источникам и не являются юридическим
заключением. Для коммерческого использования фильтруйте
`selected_text_commercial_ready=true` и самостоятельно проверяйте происхождение записей.
Автоматическая дедупликация может пропускать сильно перефразированные межъязыковые сюжеты.
"""
    (OUTPUT / "README.md").write_text(readme, encoding="utf-8")

    manifest_files = sorted(path for path in OUTPUT.iterdir() if path.is_file() and path.name != "manifest.json")
    manifest = {
        "build_date": stats["build_date"],
        "files": [
            {"name": path.name, "bytes": path.stat().st_size, "sha256": file_hash(path)}
            for path in manifest_files
        ],
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    archive = ROOT / "danetki_dataset_bundle.zip"
    if archive.exists():
        archive.unlink()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(OUTPUT.iterdir()):
            if path.is_file():
                zf.write(path, arcname=f"danetki_dataset/{path.name}")
        zf.write(ROOT / "scripts/collect_sources.py", arcname="scripts/collect_sources.py")
        zf.write(ROOT / "scripts/build_dataset.py", arcname="scripts/build_dataset.py")

    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print(f"archive: {archive} ({archive.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
