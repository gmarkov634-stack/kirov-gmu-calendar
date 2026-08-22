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
DAY_INDEX = {name: index for index, name in enumerate(DAY_NAMES)}
TIME_RE = re.compile(
    r"^(?P<marker>[ЛП]\.\s*(?:ДВ\s*)?)?"
    r"(?P<start>\d{1,2}:\d{2})\s*[-–]\s*(?P<end>\d{1,2}:\d{2})\s*(?P<rest>.*)$",
    re.IGNORECASE,
)
WEEK_RE = re.compile(r"(?<![A-Za-zА-Яа-яЁё])(?P<week>I|II)\s*нед\.?", re.IGNORECASE)
MONTH_QUALIFIER_RE = re.compile(r"\([^()]+\)\s*$")
PERIOD_RE = re.compile(r"\b\d{2}\.\d{2}\.\d{4}\s*[-–—]\s*\d{2}\.\d{2}\.\d{4}\b")
ANCHOR_RE = re.compile(r"\b(?P<week>I|II)\s*нед\.?\s*начинается\s*с\s*(?P<date>\d{1,2}\s+[А-Яа-яЁё]+)", re.IGNORECASE)


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip(" ,;")


def repair_time_artifacts(value: str) -> str:
    value = compact(value)
    value = re.sub(r"(?<!\d)(\d{1,2})\s+:\s*(\d{2})(?!\d)", r"\1:\2", value)
    value = re.sub(r"(?<!\d)(\d{1,2}):(\d)\s+(\d)(?!\d)", r"\1:\2\3", value)
    return value


def decode_rotated_day(value: str) -> str | None:
    letters = re.sub(r"[^А-Яа-яЁё]", "", str(value or "")).lower()
    for candidate in (letters, letters[::-1]):
        if candidate in DAY_INDEX:
            return candidate
    return None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_weekly_table(page):
    tables = page.extract_tables() or []
    geometries = page.find_tables() or []
    for table, geometry in zip(tables, geometries):
        if not table or not table[0]:
            continue
        header = [compact(value) for value in table[0][1:]]
        if header == EXPECTED_GROUPS:
            return table, geometry
    raise RuntimeError("UGMU course-2 stream-1 weekly-grid table with exact header was not found")


def header_group_centers(table, geometry) -> dict[str, float]:
    centers: dict[str, float] = {}
    for column_index, group in enumerate(EXPECTED_GROUPS, start=1):
        cell = geometry.rows[0].cells[column_index]
        if not cell:
            raise RuntimeError(f"Missing header geometry for {group}")
        centers[group] = (cell[0] + cell[2]) / 2
    return centers


def smallest_cell_center(row) -> float:
    cells = [cell for cell in row.cells if cell]
    if not cells:
        return 0.0
    cell = min(cells, key=lambda item: item[3] - item[1])
    return (cell[1] + cell[3]) / 2


def weekday_bounds(page, geometry) -> list[tuple[str, float, float]]:
    labels: dict[str, float] = {}
    for word in page.extract_words(extra_attrs=["upright"]):
        if word.get("upright", True):
            continue
        day = decode_rotated_day(word.get("text", ""))
        if day:
            labels[day] = (word["top"] + word["bottom"]) / 2
    present = [name for name in DAY_NAMES if name in labels]
    if present != DAY_NAMES:
        raise RuntimeError(f"Weekday geometry is incomplete: {present}")
    header_cell = geometry.rows[0].cells[0]
    footer_cell = geometry.rows[-1].cells[0]
    if not header_cell or not footer_cell:
        raise RuntimeError("Weekly-grid header/footer geometry is missing")
    centers = [labels[name] for name in DAY_NAMES]
    cuts = [header_cell[3]]
    cuts.extend((centers[index] + centers[index + 1]) / 2 for index in range(5))
    cuts.append(footer_cell[1])
    return [(DAY_NAMES[index], cuts[index], cuts[index + 1]) for index in range(6)]


def extract_group_lines(table, geometry, page, group: str) -> dict[str, list[str]]:
    group_centers = header_group_centers(table, geometry)
    target_center = group_centers[group]
    bounds = weekday_bounds(page, geometry)
    result = {day: [] for day in DAY_NAMES}
    for row_index, row_values in enumerate(table[1:-1], start=1):
        row_geometry = geometry.rows[row_index]
        center_y = smallest_cell_center(row_geometry)
        day = next((name for name, top, bottom in bounds if top <= center_y < bottom), None)
        if not day:
            continue
        for column_index in range(1, min(len(row_values), len(row_geometry.cells))):
            raw_value = row_values[column_index]
            cell = row_geometry.cells[column_index]
            if raw_value is None or cell is None or not compact(raw_value):
                continue
            x0, _top, x1, _bottom = cell
            if not (x0 - 1e-6 <= target_center <= x1 + 1e-6):
                continue
            for raw_line in str(raw_value).splitlines():
                line = repair_time_artifacts(raw_line)
                if line:
                    result[day].append(line)
    return result


def split_segments(lines: list[str]) -> list[str]:
    result: list[str] = []
    current: list[str] = []
    for line in lines:
        if TIME_RE.match(line):
            if current:
                result.append(" ".join(current))
            current = [line]
        elif current:
            current.append(line)
    if current:
        result.append(" ".join(current))
    return result


def parse_raw_pattern(segment: str, day: str) -> dict[str, Any]:
    match = TIME_RE.match(segment)
    if not match:
        raise RuntimeError(f"Invalid raw segment: {segment}")
    source_title = compact(match.group("rest"))
    week_match = WEEK_RE.search(source_title)
    week_rule = week_match.group("week").upper() if week_match else "weekly"
    if week_match:
        source_title = compact(WEEK_RE.sub("", source_title))
    month_match = MONTH_QUALIFIER_RE.search(source_title)
    month_qualifier_raw = compact(month_match.group(0)) if month_match else None
    return {
        "weekday": DAY_INDEX[day],
        "weekdayName": day,
        "startTime": match.group("start"),
        "endTime": match.group("end"),
        "markerRaw": compact(match.group("marker")),
        "sourceTitleRaw": source_title,
        "monthQualifierRaw": month_qualifier_raw,
        "weekRuleRaw": week_rule,
        "segmentRaw": segment,
    }


def literal_source_metadata(document) -> tuple[list[str], dict[str, str]]:
    text = "\n".join((page.extract_text() or "") for page in document.pages)
    periods = list(dict.fromkeys(PERIOD_RE.findall(text)))
    anchors: dict[str, str] = {}
    for match in ANCHOR_RE.finditer(text):
        anchors[match.group("week").upper()] = compact(match.group("date"))
    return periods, anchors


def build(path: Path, source_url: str | None) -> dict[str, Any]:
    import pdfplumber  # type: ignore

    actual_sha = sha256_file(path)
    if actual_sha != EXPECTED_SHA256:
        raise RuntimeError(f"Unexpected source SHA-256: {actual_sha}; manual review required")

    with pdfplumber.open(path) as document:
        page = document.pages[0]
        table, geometry = find_weekly_table(page)
        periods, anchors = literal_source_metadata(document)
        groups: dict[str, list[dict[str, Any]]] = {}
        for group in EXPECTED_GROUPS:
            lines = extract_group_lines(table, geometry, page, group)
            patterns: list[dict[str, Any]] = []
            for day in DAY_NAMES:
                patterns.extend(parse_raw_pattern(segment, day) for segment in split_segments(lines[day]))
            groups[group] = patterns

    all_patterns = [pattern for patterns in groups.values() for pattern in patterns]
    marker_counts = Counter(pattern["markerRaw"] for pattern in all_patterns)
    week_counts = Counter(pattern["weekRuleRaw"] for pattern in all_patterns)
    counts_by_group = {group: len(patterns) for group, patterns in groups.items()}

    expected_group_counts = {
        "ОЛД 201": 18, "ОЛД 202": 18, "ОЛД 203": 17, "ОЛД 204": 19,
        "ОЛД 205": 19, "ОЛД 206": 20, "ОЛД 207": 20, "ОЛД 208": 18,
        "ОЛД 209": 18, "ОЛД 210": 17, "ОЛД 211": 17, "ОЛД 212": 18,
    }
    if counts_by_group != expected_group_counts:
        raise RuntimeError(f"Raw pattern counts changed: {counts_by_group}; manual review required")
    if len(all_patterns) != 219:
        raise RuntimeError(f"Expected 219 raw patterns, got {len(all_patterns)}")
    if dict(marker_counts) != {"": 111, "Л.": 84, "Л. ДВ": 12, "П. ДВ": 12}:
        raise RuntimeError(f"Unexpected raw marker counts: {dict(marker_counts)}")
    if dict(week_counts) != {"weekly": 147, "I": 36, "II": 36}:
        raise RuntimeError(f"Unexpected raw week-rule counts: {dict(week_counts)}")

    return {
        "mode": "raw-weekly-patterns-only",
        "university": "ugmu",
        "program": "medicine",
        "course": 2,
        "stream": 1,
        "source": {"url": source_url, "sha256": actual_sha},
        "periodsLiteral": periods,
        "weekAnchorsLiteral": anchors,
        "groups": groups,
        "summary": {
            "groupCount": len(groups),
            "rawPatternCount": len(all_patterns),
            "rawPatternsByGroup": counts_by_group,
            "markerCounts": dict(marker_counts),
            "weekRuleCounts": dict(week_counts),
            "semanticNormalizationPerformed": False,
            "referenceTableMappingPerformed": False,
            "eventExpansionPerformed": False,
            "canonicalizationPerformed": False,
            "storageWritesPerformed": False,
            "publicationAllowed": False,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--source")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = build(Path(args.input), args.source)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
