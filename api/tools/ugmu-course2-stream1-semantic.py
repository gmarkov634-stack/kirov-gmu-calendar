#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

EXPECTED_SHA256 = "8b81f37b517dd037c090b0d980ba4d916557f36c872fe0fc37031d4ae8808c6a"
EXPECTED_SOURCE_URL = "https://usma.ru/wp-content/uploads/2026/08/2%D0%9E%D0%9B%D0%94_1%D0%BF%D0%BE%D1%82%D0%BE%D0%BA_%D0%BE%D1%81%D0%B5%D0%BD%D1%8C_26.pdf"
EXPECTED_GROUPS = [f"ОЛД {value}" for value in range(201, 213)]
EXPECTED_RAW_PATTERN_COUNT = 219

MONTH_SCOPES = {
    "сентябрь, октябрь": [9, 10],
    "ноябрь, декабрь": [11, 12],
}
MONTH_RE = re.compile(r"\s*\((?P<label>сентябрь,\s*октябрь|ноябрь,\s*декабрь)\)\s*$", re.IGNORECASE)


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip(" ,;")


def comparison_key(value: str) -> str:
    return re.sub(r"[^a-zа-яё0-9]+", "", value.lower().replace("ё", "е"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_reference_titles(pdf_path: Path) -> list[str]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required") from error

    with pdfplumber.open(pdf_path) as document:
        if len(document.pages) < 2:
            raise RuntimeError("UGMU stream-I source has no reference page")
        titles: list[str] = []
        for table in document.pages[1].extract_tables() or []:
            if not table or len(table[0]) < 4:
                continue
            if "дисциплина" not in compact(table[0][1]).lower():
                continue
            for row in table[1:]:
                title = compact(row[1] if len(row) > 1 else "")
                if title:
                    titles.append(title)
    if not titles:
        raise RuntimeError("UGMU stream-I discipline reference table not found")
    if len(titles) != len(set(titles)):
        raise RuntimeError("Duplicate discipline titles in source reference table")
    return titles


def split_month_qualifier(source_title: str) -> tuple[str, str | None, list[int] | None]:
    match = MONTH_RE.search(source_title)
    if not match:
        return source_title, None, None
    label = compact(match.group("label")).lower()
    base_title = compact(MONTH_RE.sub("", source_title))
    months = MONTH_SCOPES.get(label)
    if not months:
        raise RuntimeError(f"Unapproved month qualifier: {label}")
    return base_title, f"({label})", months


def resolve_reference(source_title: str, references: list[str]) -> tuple[str, str]:
    source_key = comparison_key(source_title)
    exact = [title for title in references if comparison_key(title) == source_key]
    if len(exact) == 1:
        return exact[0], "exact-reference"
    if len(exact) > 1:
        raise RuntimeError(f"Ambiguous exact discipline reference: {source_title}")

    prefix = [
        title for title in references
        if comparison_key(title).startswith(source_key) or source_key.startswith(comparison_key(title))
    ]
    if len(prefix) == 1:
        return prefix[0], "unique-reference-prefix"
    if not prefix:
        raise RuntimeError(f"No discipline reference for: {source_title}")
    raise RuntimeError(f"Ambiguous discipline reference for {source_title}: {prefix}")


def semantic_type(marker: str | None) -> tuple[str, str]:
    value = compact(marker)
    if value in {"Л.", "Л. ДВ"}:
        return "lecture", f"source marker {value}"
    if value == "П. ДВ":
        return "other", "П. ДВ preserved literally; user confirmed it must not be assumed to mean practice"
    if not value:
        return "other", "source has no explicit lesson-type marker"
    raise RuntimeError(f"Unknown source lesson marker: {value}")


def build(raw_path: Path, pdf_path: Path) -> dict[str, Any]:
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    pdf_sha = sha256_file(pdf_path)
    if pdf_sha != EXPECTED_SHA256:
        raise RuntimeError(f"Unexpected source SHA-256: {pdf_sha}; manual review required")
    if raw.get("mode") != "raw-weekly-patterns-only":
        raise RuntimeError(f"Unexpected raw mode: {raw.get('mode')}")
    if raw.get("course") != 2 or raw.get("stream") != 1:
        raise RuntimeError("Semantic reconciliation is restricted to UGMU medicine course 2 stream I")
    if raw.get("source", {}).get("sha256") != EXPECTED_SHA256:
        raise RuntimeError("Raw source SHA-256 does not match approved stream-I source")
    if raw.get("source", {}).get("url") != EXPECTED_SOURCE_URL:
        raise RuntimeError("Raw source URL does not match approved stream-I source")
    if list(raw.get("groups", {}).keys()) != EXPECTED_GROUPS:
        raise RuntimeError("Raw group set/order changed; manual review required")

    references = extract_reference_titles(pdf_path)
    semantic_groups: dict[str, list[dict[str, Any]]] = {}
    resolution_counts: Counter[str] = Counter()
    marker_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    month_counts: Counter[str] = Counter()
    reconciled_pairs: Counter[tuple[str, str]] = Counter()

    for group in EXPECTED_GROUPS:
        semantic_patterns: list[dict[str, Any]] = []
        for pattern in raw["groups"][group]:
            source_title_raw = compact(pattern["sourceTitleRaw"])
            base_title, month_qualifier_raw, active_months = split_month_qualifier(source_title_raw)
            reference_title, resolution = resolve_reference(base_title, references)
            marker_raw = compact(pattern.get("markerRaw")) or None
            lesson_type, type_evidence = semantic_type(marker_raw)

            resolution_counts[resolution] += 1
            marker_counts[marker_raw or "none"] += 1
            type_counts[lesson_type] += 1
            if month_qualifier_raw:
                month_counts[month_qualifier_raw] += 1
            if base_title != reference_title:
                reconciled_pairs[(base_title, reference_title)] += 1

            semantic_patterns.append({
                **pattern,
                "sourceTitleBase": base_title,
                "referenceTitle": reference_title,
                "titleSemantic": reference_title,
                "titleResolution": resolution,
                "monthQualifierRaw": month_qualifier_raw,
                "activeMonths": active_months,
                "lessonTypeSemantic": lesson_type,
                "lessonTypeEvidence": type_evidence,
            })
        semantic_groups[group] = semantic_patterns

    all_patterns = [item for values in semantic_groups.values() for item in values]
    if len(all_patterns) != EXPECTED_RAW_PATTERN_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_RAW_PATTERN_COUNT} semantic patterns, got {len(all_patterns)}")
    if dict(resolution_counts) != {"exact-reference": 188, "unique-reference-prefix": 31}:
        raise RuntimeError(f"Unexpected reference resolution counts: {dict(resolution_counts)}")
    if dict(month_counts) != {"(сентябрь, октябрь)": 12, "(ноябрь, декабрь)": 12}:
        raise RuntimeError(f"Unexpected month scopes: {dict(month_counts)}")
    if dict(type_counts) != {"other": 123, "lecture": 96}:
        raise RuntimeError(f"Unexpected semantic lesson-type counts: {dict(type_counts)}")

    reconciliations = [
        {"sourceTitleBase": source, "referenceTitle": target, "count": count}
        for (source, target), count in sorted(reconciled_pairs.items())
    ]

    return {
        "mode": "semantic-weekly-patterns-only",
        "university": "ugmu",
        "program": "medicine",
        "course": 2,
        "stream": 1,
        "source": {"url": EXPECTED_SOURCE_URL, "sha256": EXPECTED_SHA256},
        "referenceTitles": references,
        "groups": semantic_groups,
        "summary": {
            "groupCount": len(semantic_groups),
            "rawPatternCount": len(all_patterns),
            "semanticPatternCount": len(all_patterns),
            "titleResolutionCounts": dict(resolution_counts),
            "titleReconciliationPairs": reconciliations,
            "monthScopedPatterns": sum(month_counts.values()),
            "monthScopeCounts": dict(month_counts),
            "markerCounts": dict(marker_counts),
            "lessonTypeSemanticCounts": dict(type_counts),
            "unresolvedTitleReferences": 0,
            "ambiguousTitleReferences": 0,
            "eventExpansionPerformed": False,
            "canonicalizationPerformed": False,
            "storageWritesPerformed": False,
            "publicationAllowed": False,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="UGMU course-2 stream-I semantic reconciliation only")
    parser.add_argument("--raw", required=True)
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = build(Path(args.raw), Path(args.pdf))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
