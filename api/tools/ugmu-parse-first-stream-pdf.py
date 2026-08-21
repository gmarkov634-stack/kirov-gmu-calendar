#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

BASE_PATH = Path(__file__).with_name("ugmu-parse-weekly-pdf.py")
SPEC = importlib.util.spec_from_file_location("ugmu_weekly_pilot", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load UGMU weekly-grid base parser")
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)

FIRST_STREAM_GROUPS = [f"ОЛД {value}" for value in range(101, 113)]
REVIEWED_SOURCE_SHA256 = "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8"
EXPECTED_EVENTS = {
    "ОЛД 101": 357,
    "ОЛД 102": 358,
    "ОЛД 103": 357,
    "ОЛД 104": 357,
    "ОЛД 105": 358,
    "ОЛД 106": 357,
    "ОЛД 107": 357,
    "ОЛД 108": 357,
    "ОЛД 109": 357,
    "ОЛД 110": 357,
    "ОЛД 111": 357,
    "ОЛД 112": 357,
}
EXPECTED_PATTERN_COUNTS = {
    "Анатомия": 2,
    "Биология": 2,
    "Биоэтика": 2,
    "Иностранный язык": 1,
    "История России": 2,
    "Конфликтология и медиация в здравоохранении": 1,
    "Латинский язык": 1,
    "НИР: ЗОЖ в профессии врача": 1,
    "НИР: получение первичных навыков научно-исследовательской работы": 1,
    "Ознакомительная практика: Уход за больными терапевтического профиля": 1,
    "Основы Российской государственности": 2,
    "Основы военной подготовки": 2,
    "Физика, математика": 2,
    "Химия": 2,
    "Элективные курсы по физической культуре и спорту": 1,
}
SOURCE_SPECIFIC_TITLE_OVERRIDES = {
    ("ОЛД 111", 4, "10:30", "Основы"): "Основы военной подготовки",
    ("ОЛД 112", 3, "08:50", "Основы"): "Основы военной подготовки",
}


def compact(value: Any) -> str:
    return BASE.compact(value)


def repair_time_artifacts(value: str) -> str:
    value = compact(value)
    value = re.sub(r"(?<!\d)(\d{1,2})\s+:\s*(\d{2})(?!\d)", r"\1:\2", value)
    value = re.sub(r"(?<!\d)(\d{1,2}):(\d)\s+(\d)(?!\d)", r"\1:\2\3", value)
    return value


def header_group_centers(table, geometry) -> dict[str, float]:
    groups = [compact(value) for value in table[0][1:]]
    if groups != FIRST_STREAM_GROUPS:
        raise RuntimeError(f"Unexpected UGMU first-stream header: {groups}")
    centers: dict[str, float] = {}
    for column_index, group in enumerate(groups, start=1):
        cell = geometry.rows[0].cells[column_index]
        if not cell:
            raise RuntimeError(f"Missing UGMU header geometry for {group}")
        centers[group] = (cell[0] + cell[2]) / 2
    return centers


def extract_stream_group_lines(table, geometry, page, group: str) -> dict[str, list[str]]:
    if group not in FIRST_STREAM_GROUPS:
        raise RuntimeError(f"UGMU first-stream parser does not allow group {group}")

    centers = header_group_centers(table, geometry)
    target_center = centers[group]
    bounds = BASE.weekday_bounds(page, geometry)
    result = {day: [] for day in BASE.DAY_NAMES}

    # The official PDF heavily uses merged cells. pdfplumber places merged-cell
    # text in the left-most table slot and returns None for the covered slots.
    # We therefore map each non-empty extracted cell to the group centers covered
    # by its actual geometry instead of reading one fixed table column.
    for row_index, row_values in enumerate(table[1:-1], start=1):
        row_geometry = geometry.rows[row_index]
        center_y = BASE.smallest_cell_center(row_geometry)
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


def exact_reference(title: str, references: list[dict[str, str]]) -> dict[str, str]:
    matches = [row for row in references if BASE.normalized(row["title"]) == BASE.normalized(title)]
    if len(matches) != 1:
        raise RuntimeError(f"UGMU exact reference not unique: {title}")
    return matches[0]


def apply_source_specific_resolution(
    pattern: dict[str, Any],
    warnings: list[str],
    references: list[dict[str, str]],
    group: str,
    source_sha256: str | None,
) -> tuple[dict[str, Any], list[str], dict[str, Any] | None]:
    if source_sha256 != REVIEWED_SOURCE_SHA256:
        return pattern, warnings, None
    key = (group, pattern["weekday"], pattern["startTime"], pattern["sourceTitle"])
    target = SOURCE_SPECIFIC_TITLE_OVERRIDES.get(key)
    if not target:
        return pattern, warnings, None

    reference = exact_reference(target, references)
    pattern = dict(pattern)
    pattern["title"] = reference["title"]
    pattern["department"] = reference["department"]
    if pattern["lessonType"] == "lecture":
        pattern["location"] = "Онлайн"
        pattern["locationNote"] = ""
    elif BASE.normalized(reference["address"]).startswith(BASE.normalized("место проведения занятий определяет")):
        pattern["location"] = ""
        pattern["locationNote"] = reference["address"]
    else:
        pattern["location"] = reference["address"]
        pattern["locationNote"] = ""

    warnings = [
        warning for warning in warnings
        if not warning.startswith("ambiguous discipline reference:")
        and not warning.startswith("no discipline reference:")
    ]
    decision = {
        "kind": "source-specific-title-resolution",
        "sourceSha256": source_sha256,
        "group": group,
        "weekday": pattern["weekday"],
        "startTime": pattern["startTime"],
        "rawTitle": pattern["sourceTitle"],
        "resolvedTitle": reference["title"],
        "evidence": [
            "exact reviewed PDF SHA-256",
            "same-document visual cell review",
            "cross-group first-stream discipline-count invariant",
        ],
    }
    return pattern, warnings, decision


def overlap_records(events: list[dict[str, Any]]) -> list[dict[str, str]]:
    by_date: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        by_date.setdefault(event["start"][:10], []).append(event)

    overlaps: list[dict[str, str]] = []
    for event_date, items in by_date.items():
        items.sort(key=lambda item: item["start"])
        for previous, current in zip(items, items[1:]):
            if datetime.fromisoformat(current["start"]) < datetime.fromisoformat(previous["end"]):
                overlaps.append({
                    "date": event_date,
                    "firstTitle": previous["title"],
                    "firstStart": previous["start"][11:16],
                    "firstEnd": previous["end"][11:16],
                    "secondTitle": current["title"],
                    "secondStart": current["start"][11:16],
                    "secondEnd": current["end"][11:16],
                })
    return overlaps


def known_old102_overlap(overlaps: list[dict[str, str]], source_sha256: str | None) -> bool:
    if source_sha256 != REVIEWED_SOURCE_SHA256 or len(overlaps) != 19:
        return False
    for item in overlaps:
        if (
            item["firstTitle"] != "История России"
            or item["firstStart"] != "13:50"
            or item["firstEnd"] != "15:20"
            or item["secondTitle"] != "НИР: ЗОЖ в профессии врача"
            or item["secondStart"] != "14:00"
            or item["secondEnd"] != "16:20"
        ):
            return False
        if datetime.fromisoformat(item["date"]).weekday() != 5:
            return False
    return True


def validate_stream_schedule(schedule: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    group = schedule["group"]["code"]
    source_sha256 = schedule["sources"][0].get("sha256")

    if group not in FIRST_STREAM_GROUPS:
        errors.append(f"group outside reviewed first stream: {group}")
    if source_sha256 != REVIEWED_SOURCE_SHA256:
        errors.append("source SHA-256 is not approved for first-stream semantic rules")
    if len(schedule["patterns"]) != 23:
        errors.append(f"expected 23 weekly patterns, got {len(schedule['patterns'])}")
    expected_events = EXPECTED_EVENTS.get(group)
    if expected_events is not None and len(schedule["events"]) != expected_events:
        errors.append(f"expected {expected_events} expanded events, got {len(schedule['events'])}")

    pattern_counts = Counter(pattern["title"] for pattern in schedule["patterns"])
    if dict(pattern_counts) != EXPECTED_PATTERN_COUNTS:
        errors.append(f"discipline pattern invariant mismatch: {dict(pattern_counts)}")
    if sum(pattern["lessonType"] == "lecture" for pattern in schedule["patterns"]) != 9:
        errors.append("expected 9 lecture patterns")

    unresolved = [
        warning for warning in schedule["importWarnings"]
        if "ambiguous discipline reference:" in warning or "no discipline reference:" in warning
    ]
    if unresolved:
        errors.append(f"unresolved discipline references: {unresolved}")

    keys = [(event["start"], event["end"], event["title"]) for event in schedule["events"]]
    if len(keys) != len(set(keys)):
        errors.append("duplicate expanded events")

    overlaps = schedule["sourceReview"]["sourceOverlaps"]
    if group == "ОЛД 102":
        if not known_old102_overlap(overlaps, source_sha256):
            errors.append(f"unexpected OLD 102 overlap set: {overlaps}")
    elif overlaps:
        errors.append(f"unexpected time overlaps: {overlaps}")
    return errors


def parse_pdf(
    pdf_path: Path,
    group: str,
    source_url: str | None,
    source_sha256: str | None,
) -> dict[str, Any]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required; install tools/requirements-ugmu.txt") from error

    warnings: list[str] = []
    semantic_decisions: list[dict[str, Any]] = []
    with pdfplumber.open(pdf_path) as document:
        page = document.pages[0]
        all_text = "\n".join((item.extract_text() or "") for item in document.pages)
        period_start, period_end = BASE.parse_period(all_text)
        first_anchor = BASE.parse_week_anchor(all_text, "I", period_start.year)
        second_anchor = BASE.parse_week_anchor(all_text, "II", period_start.year)
        table, geometry = BASE.find_weekly_table(page)
        lines_by_day = extract_stream_group_lines(table, geometry, page, group)
        references = BASE.extract_reference_rows(document)

        patterns: list[dict[str, Any]] = []
        for day in BASE.DAY_NAMES:
            for segment in BASE.split_segments(lines_by_day[day]):
                pattern, pattern_warnings = BASE.parse_pattern(segment, BASE.DAY_INDEX[day], references)
                pattern, pattern_warnings, decision = apply_source_specific_resolution(
                    pattern,
                    pattern_warnings,
                    references,
                    group,
                    source_sha256,
                )
                patterns.append(pattern)
                warnings.extend(f"{day}: {warning}" for warning in pattern_warnings)
                if decision:
                    semantic_decisions.append(decision)

    events = BASE.expand_patterns(patterns, period_start, period_end, first_anchor, second_anchor, group)
    overlaps = overlap_records(events)
    source_anomalies: list[dict[str, Any]] = []
    if group == "ОЛД 102" and known_old102_overlap(overlaps, source_sha256):
        source_anomalies.append({
            "kind": "official-source-time-overlap",
            "sourceSha256": source_sha256,
            "group": group,
            "weekday": "суббота",
            "occurrenceCount": len(overlaps),
            "first": {"title": "История России", "time": "13:50-15:20"},
            "second": {"title": "НИР: ЗОЖ в профессии врача", "time": "14:00-16:20"},
            "evidence": "visually confirmed in the exact official PDF; preserved instead of silently altering source data",
        })

    schedule = {
        "version": 2,
        "university": "ugmu",
        "universityName": "УГМУ",
        "program": "medicine",
        "course": 1,
        "stream": "1",
        "academicYear": "2026/2027",
        "semester": 1,
        "timezone": "Asia/Yekaterinburg",
        "group": {
            "id": f"ugmu:medicine:1:stream-1:{group}",
            "code": group,
            "displayName": f"Группа {group}",
        },
        "semesterPeriod": {
            "start": period_start.isoformat(),
            "end": period_end.isoformat(),
        },
        "weekAnchors": {
            "I": first_anchor.isoformat(),
            "II": second_anchor.isoformat(),
        },
        "sources": [{
            "url": source_url,
            "sha256": source_sha256,
            "part": "combined",
            "parserShape": "weekly-grid",
        }],
        "sourceReview": {
            "status": "pending-validation",
            "publicationAllowed": False,
            "scope": "first-stream",
            "patternCount": len(patterns),
            "sourceOverlaps": overlaps,
            "sourceAnomalies": source_anomalies,
            "semanticDecisions": semantic_decisions,
        },
        "patterns": patterns,
        "events": events,
        "importWarnings": warnings,
    }
    schedule["validationErrors"] = validate_stream_schedule(schedule)
    schedule["sourceReview"]["status"] = (
        "semantic-reviewed-first-stream" if not schedule["validationErrors"] else "needs-review"
    )
    return schedule


def self_test() -> None:
    assert repair_time_artifacts("12 :10-13:40") == "12:10-13:40"
    assert repair_time_artifacts("11:20-14:0 0") == "11:20-14:00"
    assert FIRST_STREAM_GROUPS[0] == "ОЛД 101"
    assert FIRST_STREAM_GROUPS[-1] == "ОЛД 112"
    assert sum(EXPECTED_EVENTS.values()) == 4286
    assert sum(EXPECTED_PATTERN_COUNTS.values()) == 23
    print("UGMU first-stream parser self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--group", default="ОЛД 101")
    parser.add_argument("--source")
    parser.add_argument("--sha256")
    parser.add_argument("--output")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if not args.input:
        parser.error("--input is required")
    if args.group not in FIRST_STREAM_GROUPS:
        parser.error(f"--group must be one of: {', '.join(FIRST_STREAM_GROUPS)}")

    output = Path(args.output or f"data/imports/ugmu-first-stream/{args.group.replace(' ', '-')}.json")
    schedule = parse_pdf(Path(args.input), args.group, args.source, args.sha256)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"UGMU {args.group}: {len(schedule['patterns'])} patterns -> {len(schedule['events'])} events")
    print(f"Warnings: {len(schedule['importWarnings'])}")
    print(f"Source overlaps: {len(schedule['sourceReview']['sourceOverlaps'])}")
    print(f"Semantic decisions: {len(schedule['sourceReview']['semanticDecisions'])}")
    print(f"Validation errors: {len(schedule['validationErrors'])}")
    print(f"Output: {output}")
    if schedule["validationErrors"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
