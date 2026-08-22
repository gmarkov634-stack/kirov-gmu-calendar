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
DAY_NAMES = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота"]
SOURCE_DAY_NAMES = DAY_NAMES[:5]
DAY_INDEX = {name: index for index, name in enumerate(DAY_NAMES)}
TIME_RE = re.compile(
    r"^(?P<marker>[ЛП]\.\s*(?:ДВ\s*)?)?"
    r"(?P<start>\d{1,2}:\d{2})\s*[-–]\s*(?P<end>\d{1,2}:\d{2})\s*(?P<rest>.*)$",
    re.IGNORECASE,
)
EMBEDDED_TIME_SPLIT_RE = re.compile(
    r"\s+(?=[ЛП]\.\s*(?:ДВ\s*)?\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})",
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
    raise RuntimeError("UGMU course-2 stream-IV weekly-grid table with exact header was not found")


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
    if present != SOURCE_DAY_NAMES:
        raise RuntimeError(f"Unexpected stream-IV weekday geometry: {present}; manual review required")
    header_cell = geometry.rows[0].cells[0]
    footer_cell = geometry.rows[-1].cells[0]
    if not header_cell or not footer_cell:
        raise RuntimeError("Weekly-grid header/footer geometry is missing")
    centers = [labels[name] for name in SOURCE_DAY_NAMES]
    cuts = [header_cell[3]]
    cuts.extend((centers[index] + centers[index + 1]) / 2 for index in range(len(centers) - 1))
    cuts.append(footer_cell[1])
    return [(SOURCE_DAY_NAMES[index], cuts[index], cuts[index + 1]) for index in range(len(SOURCE_DAY_NAMES))]


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


def split_embedded_times(segment: str) -> tuple[list[str], bool]:
    parts = [compact(part) for part in EMBEDDED_TIME_SPLIT_RE.split(segment) if compact(part)]
    return parts, len(parts) > 1


def split_segments(lines: list[str]) -> tuple[list[str], list[str], list[dict[str, Any]]]:
    initial_segments: list[str] = []
    orphan_lines: list[str] = []
    current: list[str] = []
    for line in lines:
        if TIME_RE.match(line):
            if current:
                initial_segments.append(" ".join(current))
            current = [line]
        elif current:
            current.append(line)
        else:
            orphan_lines.append(line)
    if current:
        initial_segments.append(" ".join(current))

    segments: list[str] = []
    embedded_review: list[dict[str, Any]] = []
    for segment in initial_segments:
        split_parts, was_split = split_embedded_times(segment)
        if was_split:
            embedded_review.append({"segmentRawBeforeSplit": segment, "segmentsRawAfterSplit": split_parts})
        segments.extend(split_parts)
    return segments, orphan_lines, embedded_review


def parse_raw_pattern(segment: str, day: str) -> dict[str, Any]:
    match = TIME_RE.match(segment)
    if not match:
        raise RuntimeError(f"Invalid raw segment: {segment}")
    source_title = compact(match.group("rest"))
    if not source_title:
        raise RuntimeError(f"Empty source title in segment: {segment}")
    week_matches = list(WEEK_RE.finditer(source_title))
    if len(week_matches) > 1:
        raise RuntimeError(f"Multiple week markers in one segment require review: {segment}")
    week_rule = week_matches[0].group("week").upper() if week_matches else "weekly"
    title_without_week = compact(WEEK_RE.sub("", source_title)) if week_matches else source_title
    month_match = MONTH_QUALIFIER_RE.search(title_without_week)
    month_qualifier_raw = compact(month_match.group(0)) if month_match else None
    return {
        "weekday": DAY_INDEX[day],
        "weekdayName": day,
        "startTime": match.group("start"),
        "endTime": match.group("end"),
        "markerRaw": compact(match.group("marker")),
        "sourceTitleRaw": title_without_week,
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
    if source_url != EXPECTED_SOURCE_URL:
        raise RuntimeError(f"Unexpected source URL: {source_url}; manual review required")

    with pdfplumber.open(path) as document:
        page = document.pages[0]
        table, geometry = find_weekly_table(page)
        periods, anchors = literal_source_metadata(document)
        groups: dict[str, list[dict[str, Any]]] = {}
        orphan_review: list[dict[str, Any]] = []
        embedded_review: list[dict[str, Any]] = []
        geometry_artifact_review: list[dict[str, Any]] = []
        for group in EXPECTED_GROUPS:
            lines = extract_group_lines(table, geometry, page, group)
            patterns: list[dict[str, Any]] = []
            for day in DAY_NAMES:
                segments, orphan_lines, embedded_splits = split_segments(lines[day])
                if group == "ОЛД 247" and day == "понедельник" and orphan_lines == ["цитология"]:
                    geometry_artifact_review.append({
                        "group": group,
                        "weekdayName": day,
                        "ignoredForeignContinuation": "цитология",
                        "belongsToGroup": "ОЛД 248",
                        "evidence": (
                            "The merged PDF cell spans OLD 247-248, but the literal word 'цитология' is positioned "
                            "inside the OLD 248 column and completes its preceding 08:50-10:20 title; "
                            "10:30-12:00 starts the shared OLD 247-248 Economics lesson."
                        ),
                    })
                    orphan_lines = []
                if orphan_lines:
                    orphan_review.append({"group": group, "weekdayName": day, "lines": orphan_lines})
                for split in embedded_splits:
                    embedded_review.append({"group": group, "weekdayName": day, **split})
                patterns.extend(parse_raw_pattern(segment, day) for segment in segments)
            groups[group] = patterns

    if orphan_review:
        raise RuntimeError(f"Orphan source lines require manual review: {json.dumps(orphan_review, ensure_ascii=False)}")
    if len(geometry_artifact_review) != 1:
        raise RuntimeError(
            f"Expected exactly one approved exact-SHA merged-cell geometry artifact, got {len(geometry_artifact_review)}"
        )

    all_patterns = [pattern for patterns in groups.values() for pattern in patterns]
    marker_counts = Counter(pattern["markerRaw"] for pattern in all_patterns)
    week_counts = Counter(pattern["weekRuleRaw"] for pattern in all_patterns)
    counts_by_group = {group: len(patterns) for group, patterns in groups.items()}
    month_qualifiers = Counter(pattern["monthQualifierRaw"] for pattern in all_patterns if pattern["monthQualifierRaw"])

    if not all_patterns:
        raise RuntimeError("No raw weekly patterns extracted")
    if any(group not in groups or not groups[group] for group in EXPECTED_GROUPS):
        raise RuntimeError("One or more expected groups have no extracted weekly patterns")

    return {
        "mode": "raw-weekly-patterns-only",
        "university": "ugmu",
        "program": "medicine",
        "course": 2,
        "stream": 4,
        "source": {"url": source_url, "sha256": actual_sha},
        "periodsLiteral": periods,
        "weekAnchorsLiteral": anchors,
        "groups": groups,
        "review": {
            "sourceWeekdayLabels": SOURCE_DAY_NAMES,
            "sourceHasSaturdayBlock": False,
            "orphanSourceLines": orphan_review,
            "embeddedTimeSplits": embedded_review,
            "geometryArtifacts": geometry_artifact_review,
        },
        "summary": {
            "groupCount": len(groups),
            "rawPatternCount": len(all_patterns),
            "rawPatternsByGroup": counts_by_group,
            "markerCounts": dict(marker_counts),
            "weekRuleCounts": dict(week_counts),
            "monthQualifierCounts": dict(month_qualifiers),
            "orphanSourceLineCount": len(orphan_review),
            "embeddedTimeSplitCount": len(embedded_review),
            "geometryArtifactRepairCount": len(geometry_artifact_review),
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
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = build(Path(args.input), args.source)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
