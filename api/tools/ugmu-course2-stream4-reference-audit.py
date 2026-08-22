#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

EXPECTED_SHA256 = "6b5f87dc7f565169105245a397996e61e94794dfe580529cc5f7398a62e21517"
EXPECTED_SOURCE_URL = "https://usma.ru/wp-content/uploads/2026/08/2%D0%9E%D0%9B%D0%94_4-%D0%BF%D0%BE%D1%82%D0%BE%D0%BA_%D0%BE%D1%81%D0%B5%D0%BD%D1%8C_26.pdf"
EXPECTED_GROUPS = [f"ОЛД {value}" for value in range(237, 249)]
EXPECTED_RAW_PATTERN_COUNT = 204


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


def extract_reference_rows(pdf_path: Path) -> list[dict[str, str]]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required") from error

    with pdfplumber.open(pdf_path) as document:
        if len(document.pages) < 2:
            raise RuntimeError("UGMU stream-IV source has no reference page")
        rows: list[dict[str, str]] = []
        for table in document.pages[1].extract_tables() or []:
            if not table or len(table[0]) < 4:
                continue
            header = [compact(value).lower() for value in table[0]]
            if len(header) < 4 or "дисциплина" not in header[1]:
                continue
            for row in table[1:]:
                discipline = compact(row[1] if len(row) > 1 else "")
                if not discipline:
                    continue
                rows.append({
                    "discipline": discipline,
                    "department": compact(row[2] if len(row) > 2 else ""),
                    "address": compact(row[3] if len(row) > 3 else ""),
                })
    if not rows:
        raise RuntimeError("UGMU stream-IV discipline reference table not found")
    titles = [row["discipline"] for row in rows]
    if len(titles) != len(set(titles)):
        raise RuntimeError("Duplicate literal discipline titles in source reference table")
    return rows


def candidate_for(source_title: str, reference_titles: list[str]) -> dict[str, Any]:
    source_literal = compact(source_title)
    literal = [title for title in reference_titles if compact(title).casefold() == source_literal.casefold()]
    if len(literal) == 1:
        return {"status": "literal-exact", "candidates": literal, "mappingApplied": False}
    if len(literal) > 1:
        return {"status": "ambiguous-literal", "candidates": literal, "mappingApplied": False}

    source_key = comparison_key(source_literal)
    normalized = [title for title in reference_titles if comparison_key(title) == source_key]
    if len(normalized) == 1:
        return {"status": "normalized-exact-candidate", "candidates": normalized, "mappingApplied": False}
    if len(normalized) > 1:
        return {"status": "ambiguous-normalized", "candidates": normalized, "mappingApplied": False}

    prefix = [
        title for title in reference_titles
        if source_key and (
            comparison_key(title).startswith(source_key)
            or source_key.startswith(comparison_key(title))
        )
    ]
    if len(prefix) == 1:
        return {"status": "unique-prefix-candidate", "candidates": prefix, "mappingApplied": False}
    if len(prefix) > 1:
        return {"status": "ambiguous-prefix", "candidates": prefix, "mappingApplied": False}
    return {"status": "unresolved", "candidates": [], "mappingApplied": False}


def build(raw_path: Path, pdf_path: Path) -> dict[str, Any]:
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    actual_sha = sha256_file(pdf_path)
    if actual_sha != EXPECTED_SHA256:
        raise RuntimeError(f"Unexpected source SHA-256: {actual_sha}; manual review required")
    if raw.get("mode") != "raw-weekly-patterns-only":
        raise RuntimeError(f"Unexpected raw mode: {raw.get('mode')}")
    if raw.get("course") != 2 or raw.get("stream") != 4:
        raise RuntimeError("Reference audit is restricted to UGMU medicine course 2 stream IV")
    if raw.get("source", {}).get("sha256") != EXPECTED_SHA256:
        raise RuntimeError("Raw source SHA-256 does not match approved stream-IV source")
    if raw.get("source", {}).get("url") != EXPECTED_SOURCE_URL:
        raise RuntimeError("Raw source URL does not match approved stream-IV source")
    if list(raw.get("groups", {}).keys()) != EXPECTED_GROUPS:
        raise RuntimeError("Raw group set/order changed; manual review required")

    patterns = [item for group in EXPECTED_GROUPS for item in raw["groups"][group]]
    if len(patterns) != EXPECTED_RAW_PATTERN_COUNT:
        raise RuntimeError(f"Expected {EXPECTED_RAW_PATTERN_COUNT} raw patterns, got {len(patterns)}")

    reference_rows = extract_reference_rows(pdf_path)
    reference_titles = [row["discipline"] for row in reference_rows]
    raw_title_counts = Counter(compact(item["sourceTitleRaw"]) for item in patterns)

    audit: list[dict[str, Any]] = []
    status_counts: Counter[str] = Counter()
    affected_pattern_counts: Counter[str] = Counter()
    for source_title, count in sorted(raw_title_counts.items(), key=lambda item: (-item[1], item[0])):
        result = candidate_for(source_title, reference_titles)
        status_counts[result["status"]] += 1
        affected_pattern_counts[result["status"]] += count
        audit.append({"sourceTitleRaw": source_title, "patternCount": count, **result})

    manual_review = [item for item in audit if item["status"] != "literal-exact"]

    return {
        "mode": "reference-audit-only",
        "university": "ugmu",
        "program": "medicine",
        "course": 2,
        "stream": 4,
        "source": {"url": EXPECTED_SOURCE_URL, "sha256": EXPECTED_SHA256},
        "referenceRowsLiteral": reference_rows,
        "titleAudit": audit,
        "manualReview": manual_review,
        "summary": {
            "groupCount": len(EXPECTED_GROUPS),
            "rawPatternCount": len(patterns),
            "uniqueRawTitleCount": len(raw_title_counts),
            "referenceRowCount": len(reference_rows),
            "statusCountsByUniqueTitle": dict(status_counts),
            "statusCountsByPattern": dict(affected_pattern_counts),
            "manualReviewUniqueTitleCount": len(manual_review),
            "semanticNormalizationPerformed": False,
            "referenceTableMappingApplied": False,
            "eventExpansionPerformed": False,
            "canonicalizationPerformed": False,
            "storageWritesPerformed": False,
            "publicationAllowed": False,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="UGMU course-2 stream-IV reference audit; no mappings are applied")
    parser.add_argument("--raw", required=True)
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = build(Path(args.raw), Path(args.pdf))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))
    print(json.dumps(result["manualReview"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
