"""Reproducible dictionary, vector comparison, and private semantic game pack."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys
import time

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(os.environ.get("SHODITSA_SEMANTIC_CACHE", str(ROOT / "archive/local/semantic-models")))
OUT = ROOT / "data/semantic/generated"
RUNTIME = ROOT / "data/semantic/runtime"
EDITORIAL = ROOT / "data/semantic/editorial"
VERSION = 1
CYRILLIC = re.compile(r"^[а-яё]{3,24}$")
BAD = re.compile(r"^(?:хуй|хуя|хуе|хуё|пизд|бляд|блят|ёб|еба|ебл|ебн|уёб|заёб|выёб|проёб|долбо|говн|муд[ао]|залуп|шлюх|дроч|жоп)|^(?:сука|сучка)$")
PROPER = {"Name", "Surn", "Patr", "Geox", "Orgn", "Trad", "Abbr"}
POS = {"NOUN", "ADJF", "INFN", "ADVB"}
PROBES = [
    ("кофе", ["чай", "напиток", "капучино"], ["кирпич", "трамвай", "квадрат"]),
    ("кошка", ["кот", "котёнок", "собака"], ["самолёт", "цемент", "календарь"]),
    ("дерево", ["ветка", "ствол", "берёза"], ["телефон", "суп", "аккорд"]),
    ("море", ["океан", "волна", "берег"], ["тетрадь", "карандаш", "кухня"]),
    ("хлеб", ["булка", "булочка", "выпечка"], ["космос", "колесо", "компас"]),
    ("школа", ["учитель", "ученик", "урок"], ["тигр", "молоко", "ракета"]),
    ("больница", ["врач", "пациент", "лечение"], ["пляж", "скрипка", "комета"]),
    ("поезд", ["вагон", "железнодорожный", "локомотив"], ["вишня", "бабочка", "сахар"]),
    ("книга", ["роман", "автор", "читатель"], ["пылесос", "огурец", "болото"]),
    ("музыка", ["песня", "мелодия", "концерт"], ["картофель", "кирпич", "чайник"]),
    ("зима", ["снег", "мороз", "холод"], ["компьютер", "библиотека", "артист"]),
    ("дождь", ["ливень", "зонт", "капля"], ["сыр", "журнал", "такси"]),
    ("самолёт", ["лётчик", "аэропорт", "вертолёт"], ["конфета", "ромашка", "скатерть"]),
    ("кухня", ["плита", "кастрюля", "готовить"], ["звезда", "пингвин", "конверт"]),
    ("собака", ["щенок", "пёс", "овчарка"], ["компот", "квартира", "линейка"]),
    ("лес", ["дерево", "сосна", "чаща"], ["телевизор", "капуста", "паспорт"]),
    ("велосипед", ["педаль", "велосипедист", "колесо"], ["поэт", "сметана", "туман"]),
    ("цветок", ["роза", "ромашка", "букет"], ["двигатель", "ноутбук", "шахматы"]),
    ("рыба", ["карась", "щука", "окунь"], ["стул", "краситель", "воротник"]),
    ("дом", ["квартира", "здание", "жилище"], ["медуза", "петрушка", "теорема"]),
]


def key(word: str) -> str:
    return word.lower().strip().replace("ё", "е")


def save(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    temp.replace(path)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def lexicon(limit: int = 32000) -> None:
    from wordfreq import top_n_list, zipf_frequency
    import pymorphy3
    morph = pymorphy3.MorphAnalyzer()
    words = {}
    aliases = defaultdict(set)
    rejected = Counter()
    source = top_n_list("ru", 300000)
    extra = [word for target, positive, negative in PROBES for word in [target, *positive, *negative]]
    targets = json.loads((EDITORIAL / "targets.json").read_text(encoding="utf-8"))["words"]
    for index, form in enumerate(dict.fromkeys([*source, *extra, *targets])):
        if not CYRILLIC.fullmatch(form) or BAD.search(form):
            rejected["format_or_excluded"] += 1
            continue
        parses = [p for p in morph.parse(form) if p.is_known and p.tag.POS in POS and not (set(p.tag.grammemes) & PROPER)]
        if not parses:
            rejected["unknown_or_proper_or_part_of_speech"] += 1
            continue
        # Prefer the analyzer's first known interpretation; ambiguous input forms
        # are recorded below and are not silently mapped at runtime.
        p = parses[0]
        lemma = p.normal_form
        if not CYRILLIC.fullmatch(lemma) or BAD.search(lemma):
            rejected["lemma_format_or_excluded"] += 1
            continue
        frequency = max(zipf_frequency(form, "ru"), zipf_frequency(lemma, "ru"))
        if frequency < 2.3 and form not in extra and form not in targets:
            rejected["rare"] += 1
            continue
        canonical = key(lemma)
        old = words.get(canonical)
        if old is None or frequency > old["frequency"]:
            words[canonical] = {"word": lemma, "key": canonical, "pos": p.tag.POS, "frequency": round(frequency, 3)}
        for parse in parses:
            if CYRILLIC.fullmatch(parse.normal_form):
                aliases[key(form)].add(key(parse.normal_form))
        if index and index % 50000 == 0:
            print(f"Dictionary: {index:,} forms, {len(words):,} lemmas", flush=True)
    mandatory = {key(p.normal_form) for w in [*extra, *targets] for p in morph.parse(w)[:1] if CYRILLIC.fullmatch(p.normal_form)}
    selected = sorted(words.values(), key=lambda r: (-r["frequency"], r["key"]))
    keep = {r["key"] for r in selected[:limit]} | (mandatory & words.keys())
    selected = sorted([r for r in selected if r["key"] in keep], key=lambda r: r["key"])
    accepted_aliases = {}
    ambiguous = 0
    for form, lemmas in aliases.items():
        candidates = sorted(lemmas & keep)
        if len(candidates) == 1 and form not in keep:
            accepted_aliases[form] = candidates[0]
        elif len(candidates) > 1 and form not in keep:
            ambiguous += 1
    save(OUT / "lexicon.json", {"schemaVersion": VERSION, "words": selected, "aliases": dict(sorted(accepted_aliases.items()))})
    save(OUT / "lexicon-audit.json", {"sourceForms": len(source), "lemmas": len(selected), "aliases": len(accepted_aliases), "ambiguousFormsNotMapped": ambiguous, "rejected": dict(rejected), "policy": "Known common lemmas; noun/adjective/infinitive/adverb; no proper names. Explicit exclusion filter is not a claim of exhaustive moderation.", "packages": {name: importlib.metadata.version(name) for name in ["navec", "wordfreq", "pymorphy3", "pymorphy3-dicts-ru", "numpy"]}, "frequencySource": "https://github.com/rspeer/wordfreq", "frequencyLicense": "CC-BY-SA-4.0", "morphologySource": "https://github.com/pymorphy2-fork/pymorphy3-dicts-ru"})
    print(f"Dictionary ready: {len(selected)} lemmas, {len(accepted_aliases)} aliases", flush=True)


def vectors(model: str) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    vocabulary = json.loads((OUT / "lexicon.json").read_text(encoding="utf-8"))["words"]
    vocabulary_hash = digest(OUT / "lexicon.json")
    target = CACHE / f"{model}-{vocabulary_hash[:16]}.npz"
    if target.exists():
        print(f"Cached projected vectors: {target.name}", flush=True)
        return
    matrix = np.zeros((len(vocabulary), 300), dtype=np.float32)
    found = np.zeros(len(vocabulary), dtype=bool)
    lookup = {row["word"]: i for i, row in enumerate(vocabulary)}
    if model == "navec":
        from navec import Navec
        source = Navec.load(CACHE / "navec_hudlit_v1_12B_500K_300d_100q.tar")
        for word, i in lookup.items():
            if word in source:
                matrix[i] = source[word]
                found[i] = True
    else:
        # Stream the compressed text file; never expand its multi-GB contents
        # to disk and never load the full two-million-word matrix into RAM.
        with gzip.open(CACHE / "cc.ru.300.vec.gz", "rt", encoding="utf-8", errors="strict") as stream:
            expected_rows, dimensions = map(int, next(stream).split())
            if dimensions != 300:
                raise ValueError("Unexpected fastText dimensions")
            count = 0
            for line in stream:
                count += 1
                word, _, values = line.partition(" ")
                i = lookup.get(word)
                if i is not None:
                    vector = np.fromstring(values, sep=" ", dtype=np.float32)
                    if vector.shape != (300,):
                        raise ValueError(f"Malformed vector: {word}")
                    matrix[i] = vector
                    found[i] = True
                if count % 250000 == 0:
                    print(f"fastText projection: {count:,}/{expected_rows:,}, matched {int(found.sum()):,}", flush=True)
            if count != expected_rows:
                raise ValueError("fastText row count mismatch")
    norms = np.linalg.norm(matrix, axis=1)
    found &= np.isfinite(matrix).all(axis=1) & (norms > 1e-9)
    matrix[found] /= norms[found, None]
    np.savez(target, matrix=matrix, found=found)
    save(OUT / f"{model}-projection.json", {"model": model, "lexiconSha256": vocabulary_hash, "count": int(found.sum()), "missing": int((~found).sum()), "dimensions": 300, "source": json.loads((CACHE / ("navec_hudlit_v1_12B_500K_300d_100q.tar.source.json" if model == "navec" else "cc.ru.300.vec.gz.source.json")).read_text(encoding="utf-8"))})
    print(f"{model} vectors ready: {int(found.sum())}/{len(found)}", flush=True)


def load_models():
    lex = json.loads((OUT / "lexicon.json").read_text(encoding="utf-8"))
    fingerprint = digest(OUT / "lexicon.json")[:16]
    models = {name: np.load(CACHE / f"{name}-{fingerprint}.npz") for name in ["navec", "fasttext"]}
    return lex, models


def evaluate() -> None:
    lex, models = load_models()
    shared = models["navec"]["found"] & models["fasttext"]["found"]
    indices = np.flatnonzero(shared)
    words = [lex["words"][i]["word"] for i in indices]
    lookup = {key(w): i for i, w in enumerate(words)}
    reports = {}
    for name, model in models.items():
        matrix = model["matrix"][indices]
        tests = []
        wins = comparisons = 0
        reciprocal = []
        for target, positive, negative in PROBES:
            if key(target) not in lookup:
                continue
            scores = matrix @ matrix[lookup[key(target)]]
            order = np.argsort(-scores, kind="stable")
            ranks = np.empty(len(words), dtype=np.int32)
            ranks[order] = np.arange(1, len(words) + 1)
            p = {w: int(ranks[lookup[key(w)]]) for w in positive if key(w) in lookup}
            n = {w: int(ranks[lookup[key(w)]]) for w in negative if key(w) in lookup}
            for a in p.values():
                reciprocal.append(1 / a)
                for b in n.values():
                    comparisons += 1
                    wins += a < b
            tests.append({"target": target, "positiveRanks": p, "negativeRanks": n, "neighbors": [{"word": words[i], "rank": int(ranks[i]), "similarity": round(float(scores[i]), 4)} for i in order if i != lookup[key(target)]][:12]})
        reports[name] = {"coverage": int(model["found"].sum()), "sharedVocabulary": len(words), "pairwiseOrderingCorrect": wins, "pairwiseOrderingTotal": comparisons, "pairwiseAccuracy": round(wins / comparisons, 5), "meanPositiveReciprocalRank": round(float(np.mean(reciprocal)), 5), "probes": tests}
    # These are editorial probes, not a standardized benchmark or evidence of
    # human-rated game quality. Preserve both models and all results for review.
    selected = max(reports, key=lambda name: (reports[name]["pairwiseAccuracy"], reports[name]["meanPositiveReciprocalRank"]))
    save(OUT / "comparison.json", {"schemaVersion": VERSION, "method": "20 original editorial targets; positive/negative ordering on identical shared vocabulary. No training or fine-tuning. Not a standardized quality benchmark or human playtest.", "selectedModel": selected, "models": reports})
    print(json.dumps({"selected": selected, "models": {k: {p: v for p, v in r.items() if p != "probes"} for k, r in reports.items()}}, ensure_ascii=False), flush=True)


def pack(expected: int) -> None:
    lex, models = load_models()
    comparison = json.loads((OUT / "comparison.json").read_text(encoding="utf-8"))
    selected = comparison["selectedModel"]
    model = models[selected]
    alias_overrides = {"молока": "молоко", "леса": "лес", "жары": "жара", "лета": "лето", "скал": "скала"}
    indices = np.array([i for i in np.flatnonzero(model["found"]) if lex["words"][i]["key"] not in alias_overrides])
    words = [lex["words"][i] for i in indices]
    if len(words) >= 65535:
        raise ValueError("Uint16 rank capacity exceeded")
    lookup = {row["key"]: i for i, row in enumerate(words)}
    matrix = model["matrix"][indices]
    candidates = json.loads((EDITORIAL / "targets.json").read_text(encoding="utf-8"))["words"]
    exclusions_file = EDITORIAL / "excluded-targets.json"
    excluded = set(json.loads(exclusions_file.read_text(encoding="utf-8"))["words"]) if exclusions_file.exists() else set()
    categories = json.loads((EDITORIAL / "categories.json").read_text(encoding="utf-8"))
    groups = {}
    seen = set()
    for category, entries in categories["groups"].items():
        eligible = [key(w) for w in entries if key(w) in lookup and key(w) not in excluded and key(w) not in seen and words[lookup[key(w)]]["pos"] == "NOUN"][:categories["quota"]]
        if len(eligible) != categories["quota"]:
            raise ValueError(f"Insufficient covered words in category {category}: {len(eligible)}")
        seen.update(eligible)
        groups[category] = eligible
    targets = [group[i] for i in range(categories["quota"]) for group in groups.values()]
    if len(targets) != expected:
        raise ValueError(f"Expected {expected} admitted targets, found {len(targets)}")
    RUNTIME.mkdir(parents=True, exist_ok=True)
    review = []
    rank_file = RUNTIME / "ranks.u16"
    with rank_file.open("wb") as out:
        for target in targets:
            index = lookup[target]
            scores = matrix @ matrix[index]
            # Self is explicitly first, with deterministic lexical tie-breaks.
            scores[index] = 2
            order = np.argsort(-scores, kind="stable")
            ranks = np.empty(len(words), dtype="<u2")
            ranks[order] = np.arange(1, len(words) + 1, dtype=np.uint16)
            ranks.tofile(out)
            review.append({"word": words[index]["word"], "id": f"word:{target}", "neighbors": [words[i]["word"] for i in order[1:13]]})
    canonical = canonical_keys = {row["key"] for row in words}
    aliases = {a: w for a, w in lex["aliases"].items() if w in canonical and a not in canonical}
    aliases.update({alias: canonical for alias, canonical in alias_overrides.items() if canonical in canonical_keys})
    runtime_words = [row["word"] for row in words]
    save(RUNTIME / "vocabulary.json", {"schemaVersion": VERSION, "words": runtime_words, "aliases": aliases})
    sources = [json.loads((OUT / f"{selected}-projection.json").read_text(encoding="utf-8"))["source"]]
    manifest = {"schemaVersion": VERSION, "engine": "semantic_word", "model": selected, "vocabularyCount": len(words), "targetCount": len(targets), "rankEncoding": "uint16-little-endian; target-major; ranks start at 1", "targets": targets, "files": {p.name: {"bytes": p.stat().st_size, "sha256": digest(p)} for p in [rank_file, RUNTIME / "vocabulary.json"]}, "sources": sources, "lexiconSources": [{"name": "wordfreq", "url": "https://github.com/rspeer/wordfreq", "license": "CC-BY-SA-4.0"}, {"name": "OpenCorpora via pymorphy3-dicts-ru", "url": "https://github.com/pymorphy2-fork/pymorphy3-dicts-ru", "license": "CC-BY-SA-3.0"}], "editorial": "Original answer shortlist; neighbor review stored separately"}
    save(RUNTIME / "manifest.json", manifest)
    save(OUT / "target-review.json", {"model": selected, "categories": groups, "targets": review})
    fingerprint = digest(RUNTIME / "manifest.json")
    items = [{"id": f"word:{w}", "mode": "word", "titleRu": words[lookup[w]]["word"], "titleOriginal": "", "alternativeTitles": [], "popularityScore": round(words[lookup[w]]["frequency"] * 10), "allowedInGame": True, "contentStatus": "ready", "semanticDatasetHash": fingerprint, "semanticWordKey": w, "plotHint": "Найди загаданное слово по смысловой близости."} for w in targets]
    save(ROOT / "public/data/libraries/words/items.json", items)
    version_dir = RUNTIME / fingerprint
    version_dir.mkdir(exist_ok=True)
    for name in ["manifest.json", "vocabulary.json", "ranks.u16"]:
        source = RUNTIME / name
        destination = version_dir / name
        if destination.exists():
            if digest(destination) != digest(source):
                raise ValueError("Immutable pack collision")
            source.unlink()
        else:
            source.replace(destination)
    save(OUT / "pack-audit.json", {"schemaVersion": VERSION, "model": selected, "vocabularyCount": len(words), "targetCount": len(targets), "aliases": len(aliases), "manifestSha256": fingerprint, "rankBytes": (version_dir / "ranks.u16").stat().st_size, "noRuntimeModelInference": True, "selfRank": 1, "tieBreak": "lexical vocabulary order", "rankUniverse": "This pack's filtered vocabulary; comparable only within this dataset version"})
    print(f"Runtime ready: {len(words):,} words, {len(aliases):,} aliases, {len(targets)} answers, {selected}", flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["lexicon", "navec", "fasttext", "evaluate", "pack"])
    parser.add_argument("--targets", type=int, default=180)
    args = parser.parse_args()
    if args.stage == "lexicon":
        lexicon()
    elif args.stage in {"navec", "fasttext"}:
        vectors(args.stage)
    elif args.stage == "evaluate":
        evaluate()
    else:
        pack(args.targets)
