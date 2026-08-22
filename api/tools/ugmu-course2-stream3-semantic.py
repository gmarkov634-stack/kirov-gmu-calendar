#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

EXPECTED_SHA256 = "b6cc586f29a20bd008b5da89129809db7fbed8b2a9224a9f2d4cd3e3a77a9b85"
EXPECTED_SOURCE_URL = "https://usma.ru/wp-content/uploads/2026/08/2%D0%9E%D0%9B%D0%94_3-%D0%BF%D0%BE%D1%82%D0%BE%D0%BA_%D0%BE%D1%81%D0%B5%D0%BD%D1%8C_26.pdf"
EXPECTED_GROUPS = [f"ОЛД {value}" for value in range(225, 237)]
EXPECTED_PATTERN_COUNT = 204

APPROVED_TITLE_DECISIONS: dict[str, dict[str, str | None]] = {
    "Биохими": {
        "semanticTitle": "Биохимия",
        "referenceDiscipline": "Биохимия",
        "resolution": "user-approved-reference-title",
    },
    "Научно-исследовательская работа": {
        "semanticTitle": "Научно-исследовательская работа (получение первичных навыков научно-исследовательской работы)*",
        "referenceDiscipline": "Научно-исследовательская работа (получение первичных навыков научно-исследовательской работы)*",
        "resolution": "user-approved-reference-title",
    },
    "Лекарственные растения и основы фармакогнозии.": {
        "semanticTitle": "Лекарственные растения и основы фармакогнозии",
        "referenceDiscipline": "Лекарственные растения и основы фармакогнозии",
        "resolution": "user-approved-reference-title",
    },
    "Гистология, эмбриология цитология": {
        "semanticTitle": "Гистология, эмбриология, цитология",
        "referenceDiscipline": "Гистология, эмбриология, цитология",
        "resolution": "user-approved-reference-title",
    },
    "Гистология эмбриология цитология": {
        "semanticTitle": "Гистология, эмбриология, цитология",
        "referenceDiscipline": "Гистология, эмбриология, цитология",
        "resolution": "user-approved-reference-title",
    },
    "Гистология, эмбриология": {
        "semanticTitle": "Гистология, эмбриология, цитология",
        "referenceDiscipline": "Гистология, эмбриология, цитология",
        "resolution": "user-approved-reference-title",
    },
    "Современная научная картина мира.": {
        "semanticTitle": "Современная научная картина мира.",
        "referenceDiscipline": None,
        "resolution": "user-approved-no-reference",
    },
}

EXPECTED_RESOLUTION_COUNTS = {
    "literal-exact": 156,
    "user-approved-reference-title": 44,
    "user-approved-no-reference": 4,
}
EXPECTED_TYPE_COUNTS = {"lecture": 96, "other": 108}


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip(" ,;")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extract_reference_rows(pdf_path: Path) -> list[dict[str, str]]:
    import pdfplumber  # type: ignore

    with pdfplumber.open(pdf_path) as document:
        if len(document.pages) < 2:
            raise RuntimeError("UGMU stream-III source has no reference page")
        rows: list[dict[str, str]] = []
        for table in document.pages[1].extract_tables() or []:
            if not table or len(table[0]) < 4:
                continue
            header = [compact(value).lower() for value in table[0]]
            if len(header) < 4 or "дисциплина" not in header[1]:
                continue
            for row in table[1:]:
                discipline = compact(row[1] if len(row) > 1 else "")
                if discipline:
                    rows.append({
                        "discipline": discipline,
                        "department": compact(row[2] if len(row) > 2 else ""),
                        "addressRaw": compact(row[3] if len(row) > 3 else ""),
                    })
    if not rows:
        raise RuntimeError("UGMU stream-III discipline reference table not found")
    titles = [row["discipline"] for row in rows]
    if len(titles) != len(set(titles)):
        raise RuntimeError("Duplicate literal discipline titles in source reference table")
    return rows


def semantic_type(marker: str | None) -> tuple[str, str]:
    value = compact(marker)
    if value in {"Л.", "Л. ДВ"}:
        return "lecture", f"source marker {value}"
    if not value:
        return "other", "source has no explicit lesson-type marker"
    if value == "П. ДВ":
        return "other", "П. ДВ preserved literally; no practice meaning is inferred"
    raise RuntimeError(f"Unknown source lesson marker: {value}")


def resolve_title(source_title: str, references: dict[str, dict[str, str]]) -> dict[str, Any]:
    if source_title in references:
        row = references[source_title]
        return {
            "semanticTitle": source_title,
            "referenceDiscipline": source_title,
            "referenceDepartment": row["department"] or None,
            "referenceAddressRaw": row["addressRaw"] or None,
            "titleResolution": "literal-exact",
        }

    decision = APPROVED_TITLE_DECISIONS.get(source_title)
    if not decision:
        raise RuntimeError(f"No approved stream-III title decision for: {source_title}")

    reference_discipline = decision["referenceDiscipline"]
    if reference_discipline is None:
        return {
            "semanticTitle": decision["semanticTitle"],
            "referenceDiscipline": None,
            "referenceDepartment": None,
            "referenceAddressRaw": None,
            "titleResolution": decision["resolution"],
        }

    row = references.get(reference_discipline)
    if not row:
        raise RuntimeError(f"Approved reference row disappeared for {source_title}: {reference_discipline}")
    return {
        "semanticTitle": decision["semanticTitle"],
        "referenceDiscipline": reference_discipline,
        "referenceDepartment": row["department"] or None,
        "referenceAddressRaw": row["addressRaw"] or None,
        "titleResolution": decision["resolution"],
    }


def build(raw_path: Path, pdf_path: Path) -> dict[str, Any]:
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    actual_sha = sha256_file(pdf_path)
    if actual_sha != EXPECTED_SHA256:
        raise RuntimeError(f"Unexpected source SHA-256: {actual_sha}; manual review required")
    if raw.get("mode") != "raw-weekly-patterns-only" or raw.get("course") != 2 or raw.get("stream") != 3:
        raise RuntimeError("Unexpected raw payload; stream-III review required")
    if raw.get("source", {}).get("sha256") != EXPECTED_SHA256 or raw.get("source", {}).get("url") != EXPECTED_SOURCE_URL:
        raise RuntimeError("Raw source identity changed; manual review required")
    if list(raw.get("groups", {}).keys()) != EXPECTED_GROUPS:
        raise RuntimeError("Raw group set/order changed; manual review required")

    reference_rows = extract_reference_rows(pdf_path)
    references = {row["discipline"]: row for row in reference_rows}
    if "Современная научная картина мира." in references or "Современная научная картина мира" in references:
        raise RuntimeError("Previously missing Modern scientific picture reference now exists; manual review required")

    semantic_groups: dict[str, list[dict[str, Any]]] = {}
    resolution_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    reconciliation_counts: Counter[tuple[str, str, str | None, str]] = Counter()

    for group in EXPECTED_GROUPS:
        values: list[dict[str, Any]] = []
        for pattern in raw["groups"][group]:
            if pattern.get("monthQualifierRaw") not in (None, ""):
                raise RuntimeError("Unexpected month qualifier in stream III; manual review required")
            source_title = compact(pattern["sourceTitleRaw"])
            resolved = resolve_title(source_title, references)
            marker_raw = compact(pattern.get("markerRaw")) or None
            lesson_type, type_evidence = semantic_type(marker_raw)
            resolution_counts[resolved["titleResolution"]] += 1
            type_counts[lesson_type] += 1
            if resolved["titleResolution"] != "literal-exact":
                reconciliation_counts[(source_title, resolved["semanticTitle"], resolved["referenceDiscipline"], resolved["titleResolution"])] += 1
            values.append({
                **pattern,
                "titleSemantic": resolved["semanticTitle"],
                "titleResolution": resolved["titleResolution"],
                "referenceDiscipline": resolved["referenceDiscipline"],
                "referenceDepartment": resolved["referenceDepartment"],
                "referenceAddressRaw": resolved["referenceAddressRaw"],
                "lessonTypeSemantic": lesson_type,
                "lessonTypeEvidence": type_evidence,
            })
        semantic_groups[group] = values

    patterns = [item for values in semantic_groups.values() for item in values]
    if len(patterns) != EXPECTED_PATTERN_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_PATTERN_COUNT} semantic patterns, got {len(patterns)}")
    if dict(resolution_counts) != EXPECTED_RESOLUTION_COUNTS:
        raise RuntimeError(f"Unexpected title resolution counts: {dict(resolution_counts)}")
    if dict(type_counts) != EXPECTED_TYPE_COUNTS:
        raise RuntimeError(f"Unexpected lesson type counts: {dict(type_counts)}")

    reconciliations = [
        {
            "sourceTitleRaw": source,
            "titleSemantic": semantic,
            "referenceDiscipline": reference,
            "titleResolution": resolution,
            "patternCount": count,
        }
        for (source, semantic, reference, resolution), count in sorted(reconciliation_counts.items(), key=lambda item: (-item[1], item[0][0]))
    ]

    return {
        "mode": "semantic-weekly-patterns-only",
        "university": "ugmu",
        "program": "medicine",
        "course": 2,
        "stream": 3,
        "source": {"url": EXPECTED_SOURCE_URL, "sha256": EXPECTED_SHA256},
        "groups": semantic_groups,
        "review": {
            "userApprovedTitleDecisions": APPROVED_TITLE_DECISIONS,
            "referenceRowsLiteral": reference_rows,
            "eventExpansionAllowed": False,
            "canonicalizationAllowed": False,
            "storageWritesAllowed": False,
            "publicationAllowed": False,
        },
        "summary": {
            "groupCount": len(semantic_groups),
            "rawPatternCount": len(patterns),
            "semanticPatternCount": len(patterns),
            "titleResolutionCounts": dict(resolution_counts),
            "titleReconciliations": reconciliations,
            "patternsWithoutReferenceRow": resolution_counts["user-approved-no-reference"],
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
    parser = argparse.ArgumentParser(description="UGMU course-2 stream-III user-approved semantic reconciliation only")
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
