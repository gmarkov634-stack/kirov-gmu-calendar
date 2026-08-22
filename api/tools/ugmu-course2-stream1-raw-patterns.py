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
EXPECTED_GROUPS = [f"ОЛД {value}" for value in range(201, 213)]
DAY_NAMES = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота"]

PERIOD_RE = re.compile(r"\b\d{2}\.\d{2}\.\d{4}\s*[-–—]\s*\d{2}\.\d{2}\.\d{4}\b")
START_RE = re.compile(
    r"^(?P<marker>[ЛП]\.\s*(?:ДВ\s*)?)?"
    r"(?P<start>\d{1,2}:\d{2})\s*[-–—]\s*(?P<end>\d{1,2}:\d{2})"
    r"(?:\s+(?P<rest>.*))?$",
    re.IGNORECASE,
)
WEEK_RE = re.compile(r"(?<![A-Za-zА-Яа-яЁё])(?P<label>I|II)\s*нед\.?", re.IGNORECASE)
MONTH_QUALIFIER_RE = re.compile(r"\([^()]+\)\s*$")


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decode_rotated_day(value: str) -> str | None:
    letters = re.sub(r"[^А-Яа-яЁё]", "", str(value or "")).lower()
    for candidate in (letters, letters[::-1]):
        if candidate in DAY_NAMES:
            return candidate
    return None


def smallest_cell_center(row: Any) -> float | None:
    cells = [cell for cell in row.cells if cell]
    if not cells:
        return None
    cell = min(cells, key=lambda item: item[3] - item[1])
    return (cell[1] + cell[3]) / 2


def find_exact_table(page: Any) -> tuple[list[list[Any]], Any]:
    for table, geometry in zip(page.extract_tables() or [], page.find_tables() or []):
        if not table or not geometry.rows:
            continue
        header = [compact(value) for value in table[0][1:]]
        if header == EXPECTED_GROUPS:
            return table, geometry
    raise RuntimeError("Exact ОЛД 201-212 weekly grid not found")


def group_centers(table: list[list[Any]], geometry: Any) -> dict[str, float]:
    header = [compact(value) for value in table[0][1:]]
    if header != EXPECTED_GROUPS:
        raise RuntimeError(f"Unexpected group header: {header}")
    centers: dict[str, float] = {}
    for column_index, group in enumerate(header, start=1):
        cell = geometry.rows[0].cells[column_index]
        if not cell:
            raise RuntimeError(f"Missing header geometry for {group}")
        centers[group] = (cell[0] + cell[2]) / 2
    return centers


def weekday_bounds(page: Any, geometry: Any) -> list[tuple[str, float, float]]:
    labels: dict[str, float] = {}
    for word in page.extract_words(extra_attrs=["upright"]):
        if word.get("upright", True):
            continue
        day = decode_rotated_day(word.get("text", ""))
        if day:
            labels[day] = (word["top"] + word["bottom"]) / 2
    if set(labels) != set(DAY_NAMES):
        raise RuntimeError(f"Weekday labels incomplete: {labels}")

    header_cell = geometry.rows[0].cells[0]
    footer_cell = geometry.rows[-1].cells[0]
    if not header_cell or not footer_cell:
        raise RuntimeError("Weekly grid header/footer geometry missing")

    centers = [labels[name] for name in DAY_NAMES]
    cuts = [header_cell[3]]
    cuts.extend((centers[index] + centers[index + 1]) / 2 for index in range(len(centers) - 1))
    cuts.append(footer_cell[1])
    return [(DAY_NAMES[index], cuts[index], cuts[index + 1]) for index in range(len(DAY_NAMES))]


def collect_lines(table: list[list[Any]], geometry: Any, page: Any) -> dict[str, dict[str, list[dict[str, Any]]]]:
    centers = group_centers(table, geometry)
    bounds = weekday_bounds(page, geometry)
    result = {group: {day: [] for day in DAY_NAMES} for group in EXPECTED_GROUPS}

    for row_index, row_values in enumerate(table[1:-1], start=1):
        row_geometry = geometry.rows[row_index]
        center_y = smallest_cell_center(row_geometry)
        if center_y is None:
            continue
        day = next((name for name, top, bottom in bounds if top <= center_y < bottom), None)
        if not day:
            continue

        for column_index in range(1, min(len(row_values), len(row_geometry.cells))):
            raw_value = row_values[column_index]
            cell = row_geometry.cells[column_index]
            if raw_value is None or cell is None or not compact(raw_value):
                continue
            x0, _top, x1, _bottom = cell
            covered_groups = [
                group for group, center_x in centers.items()
                if x0 - 1e-6 <= center_x <= x1 + 1e-6
            ]
            if not covered_groups:
                raise RuntimeError(f"Non-empty source cell at row {row_index} covers no known group")
            for raw_line in str(raw_value).splitlines():
                line = compact(raw_line)
                if not line:
                    continue
                for group in covered_groups:
                    result[group][day].append({"row": row_index, "text": line})
    return result


def parse_segment(group: str, day: str, lines: list[dict[str, Any]]) -> dict[str, Any]:
    raw_text = " ".join(item["text"] for item in lines)
    match = START_RE.match(raw_text)
    if not match:
        raise RuntimeError(f"Invalid raw segment for {group} {day}: {raw_text}")

    remainder = compact(match.group("rest"))
    week_match = WEEK_RE.search(remainder)
    week_label_raw = compact(week_match.group(0)) if week_match else None
    subject_raw = compact(WEEK_RE.sub("", remainder)) if week_match else remainder
    month_match = MONTH_QUALIFIER_RE.search(subject_raw)
    month_qualifier_raw = compact(month_match.group(0)) if month_match else None

    return {
        "group": group,
        "weekdayRaw": day,
        "startTimeRaw": match.group("start"),
        "endTimeRaw": match.group("end"),
        "markerRaw": compact(match.group("marker")) or None,
        "subjectRaw": subject_raw,
        "weekLabelRaw": week_label_raw,
        "monthQualifierRaw": month_qualifier_raw,
        "rawText": raw_text,
        "sourceRows": sorted({item["row"] for item in lines}),
    }


def segment_lines(lines_by_group: dict[str, dict[str, list[dict[str, Any]]]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    patterns: list[dict[str, Any]] = []
    orphan_lines: list[dict[str, Any]] = []

    for group in EXPECTED_GROUPS:
        for day in DAY_NAMES:
            current: list[dict[str, Any]] = []
            for item in lines_by_group[group][day]:
                if START_RE.match(item["text"]):
                    if current:
                        patterns.append(parse_segment(group, day, current))
                    current = [item]
                elif current:
                    current.append(item)
                else:
                    orphan_lines.append({"group": group, "weekdayRaw": day, **item})
            if current:
                patterns.append(parse_segment(group, day, current))
    return patterns, orphan_lines


def reference_titles(document: Any) -> list[str]:
    if len(document.pages) < 2:
        return []
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
    return titles


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only UGMU course-2 stream-I raw weekly-pattern extractor")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    pdf_path = Path(args.input)
    actual_sha256 = sha256_file(pdf_path)
    if actual_sha256 != EXPECTED_SHA256:
        raise SystemExit(f"Source SHA mismatch: {actual_sha256}")

    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise SystemExit("pdfplumber is required") from error

    with pdfplumber.open(pdf_path) as document:
        if len(document.pages) != 2:
            raise SystemExit(f"Expected 2 pages, got {len(document.pages)}")
        page = document.pages[0]
        all_text = "\n".join((item.extract_text() or "") for item in document.pages)
        periods = list(dict.fromkeys(PERIOD_RE.findall(all_text)))
        if periods != ["01.09.2026 – 23.12.2026"]:
            raise SystemExit(f"Unexpected literal semester period: {periods}")
        table, geometry = find_exact_table(page)
        lines = collect_lines(table, geometry, page)
        patterns, orphans = segment_lines(lines)
        references = reference_titles(document)

    if orphans:
        raise SystemExit(f"Orphan source lines found: {orphans[:10]}")
    if any(not pattern["subjectRaw"] for pattern in patterns):
        raise SystemExit("At least one raw pattern has an empty subject")

    keys = [
        (
            pattern["group"], pattern["weekdayRaw"], pattern["startTimeRaw"],
            pattern["endTimeRaw"], pattern["markerRaw"], pattern["subjectRaw"], pattern["weekLabelRaw"],
        )
        for pattern in patterns
    ]
    if len(keys) != len(set(keys)):
        raise SystemExit("Duplicate raw weekly-pattern keys found")

    counts = Counter(pattern["group"] for pattern in patterns)
    marker_counts = Counter(pattern["markerRaw"] or "none" for pattern in patterns)
    week_counts = Counter(pattern["weekLabelRaw"] or "none" for pattern in patterns)
    subject_counts = Counter(pattern["subjectRaw"] for pattern in patterns)

    result = {
        "mode": "read-only-raw-weekly-patterns",
        "university": "ugmu",
        "program": "medicine",
        "course": 2,
        "stream": 1,
        "sourceSha256": actual_sha256,
        "sourcePeriodLiteral": periods[0],
        "groups": EXPECTED_GROUPS,
        "parserSemanticsApplied": False,
        "referenceNormalizationApplied": False,
        "eventsProduced": False,
        "storageWritesPerformed": False,
        "referenceTitlesObserved": references,
        "patternCount": len(patterns),
        "patternsPerGroup": dict(counts),
        "markerCounts": dict(marker_counts),
        "weekLabelCounts": dict(week_counts),
        "distinctSubjectRaw": dict(subject_counts),
        "patterns": patterns,
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "sourceSha256": actual_sha256,
        "patternCount": len(patterns),
        "patternsPerGroup": dict(counts),
        "markerCounts": dict(marker_counts),
        "weekLabelCounts": dict(week_counts),
        "distinctSubjectCount": len(subject_counts),
        "eventsProduced": False,
        "storageWritesPerformed": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
