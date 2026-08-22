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
SPEC = importlib.util.spec_from_file_location("ugmu_weekly_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load UGMU weekly-grid base parser")
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)

SECOND_STREAM_GROUPS = [f"ОЛД {value}" for value in range(113, 125)]
REVIEWED_SOURCE_SHA256 = "722300a869f7ecb2939aaa240463ca7b8d6c566c60a98ae90181d67d2c7e44ca"

EXPECTED_EVENTS = {
    "ОЛД 113": 358,
    "ОЛД 114": 339,
    "ОЛД 115": 356,
    "ОЛД 116": 356,
    "ОЛД 117": 357,
    "ОЛД 118": 357,
    "ОЛД 119": 357,
    "ОЛД 120": 357,
    "ОЛД 121": 357,
    "ОЛД 122": 357,
    "ОЛД 123": 356,
    "ОЛД 124": 356,
}

STANDARD_PATTERN_COUNTS = {
    "Анатомия": 2,
    "Биология": 2,
    "Биоэтика": 2,
    "Иностранный язык": 1,
    "История России": 2,
    "Латинский язык": 1,
    "НИР: ЗОЖ в профессии врача": 1,
    "НИР: получение первичных навыков научно-исследовательской работы": 1,
    "Ознакомительная практика: Уход за больными терапевтического профиля": 1,
    "Основы Российской государственности": 2,
    "Основы военной подготовки": 2,
    "Социальные аспекты современной геронтологии": 1,
    "Физика, математика": 2,
    "Химия": 2,
    "Элективные курсы по физической культуре и спорту": 1,
}

SOURCE_SPECIFIC_TITLE_OVERRIDES = {
    ("ОЛД 118", 4, "08:50", "10:20", "Основы"): "Основы военной подготовки",
    ("ОЛД 119", 4, "08:40", "10:10", "Основы"): "Основы военной подготовки",
    ("ОЛД 120", 1, "12:10", "13:40", "Основы"): "Основы военной подготовки",
}

REFERENCE_OMISSION_KEY = (
    2,
    "08:50",
    "10:20",
    "Социальные аспекты современной геронтологии",
)


def compact(value: Any) -> str:
    return BASE.compact(value)


def repair_time_artifacts(value: str) -> str:
    value = compact(value)
    value = re.sub(r"(?<!\d)(\d{1,2})\s+:\s*(\d{2})(?!\d)", r"\1:\2", value)
    value = re.sub(r"(?<!\d)(\d{1,2}):(\d)\s+(\d)(?!\d)", r"\1:\2\3", value)
    return value


def header_group_centers(table, geometry) -> dict[str, float]:
    groups = [compact(value) for value in table[0][1:]]
    if groups != SECOND_STREAM_GROUPS:
        raise RuntimeError(f"Unexpected UGMU second-stream header: {groups}")
    centers: dict[str, float] = {}
    for column_index, group in enumerate(groups, start=1):
        cell = geometry.rows[0].cells[column_index]
        if not cell:
            raise RuntimeError(f"Missing UGMU header geometry for {group}")
        centers[group] = (cell[0] + cell[2]) / 2
    return centers


def extract_stream_group_lines(table, geometry, page, group: str) -> dict[str, list[str]]:
    if group not in SECOND_STREAM_GROUPS:
        raise RuntimeError(f"UGMU second-stream parser does not allow group {group}")

    centers = header_group_centers(table, geometry)
    target_center = centers[group]
    bounds = BASE.weekday_bounds(page, geometry)
    result = {day: [] for day in BASE.DAY_NAMES}

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

    key = (
        group,
        pattern["weekday"],
        pattern["startTime"],
        pattern["endTime"],
        pattern["sourceTitle"],
    )
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
        warning
        for warning in warnings
        if not warning.startswith("ambiguous discipline reference:")
        and not warning.startswith("no discipline reference:")
    ]
    decision = {
        "kind": "source-specific-title-resolution",
        "sourceSha256": source_sha256,
        "group": group,
        "weekday": pattern["weekday"],
        "startTime": pattern["startTime"],
        "endTime": pattern["endTime"],
        "rawTitle": pattern["sourceTitle"],
        "resolvedTitle": reference["title"],
        "evidence": [
            "exact reviewed PDF SHA-256",
            "same-document visual cell review",
            "same-document discipline reference",
            "cross-group second-stream discipline-count invariant",
        ],
    }
    return pattern, warnings, decision


def accept_reference_omission(
    pattern: dict[str, Any],
    warnings: list[str],
    group: str,
    source_sha256: str | None,
) -> tuple[list[str], dict[str, Any] | None]:
    if source_sha256 != REVIEWED_SOURCE_SHA256:
        return warnings, None

    key = (
        pattern["weekday"],
        pattern["startTime"],
        pattern["endTime"],
        pattern["sourceTitle"],
    )
    if key != REFERENCE_OMISSION_KEY or pattern["lessonType"] != "lecture":
        return warnings, None

    expected_warning = f"no discipline reference: {pattern['sourceTitle']}"
    if expected_warning not in warnings:
        return warnings, None

    warnings = [warning for warning in warnings if warning != expected_warning]
    omission = {
        "kind": "source-reference-omission",
        "sourceSha256": source_sha256,
        "group": group,
        "weekday": pattern["weekday"],
        "startTime": pattern["startTime"],
        "endTime": pattern["endTime"],
        "rawTitle": pattern["sourceTitle"],
        "preservedTitle": pattern["title"],
        "location": "Онлайн",
        "department": "",
        "evidence": [
            "title is fully visible in the exact official weekly grid",
            "lecture row is common to the stream",
            "page-2 discipline reference omits this title",
            "lecture-location note states that lectures are online",
        ],
    }
    return warnings, omission


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


def expected_pattern_counts(group: str) -> dict[str, int]:
    result = dict(STANDARD_PATTERN_COUNTS)
    if group == "ОЛД 114":
        result.pop("НИР: получение первичных навыков научно-исследовательской работы")
    return result


def validate_stream_schedule(schedule: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    group = schedule["group"]["code"]
    source_sha256 = schedule["sources"][0].get("sha256")

    if group not in SECOND_STREAM_GROUPS:
        errors.append(f"group outside reviewed second stream: {group}")
    if source_sha256 != REVIEWED_SOURCE_SHA256:
        errors.append("source SHA-256 is not approved for second-stream semantic rules")

    expected_patterns = 22 if group == "ОЛД 114" else 23
    if len(schedule["patterns"]) != expected_patterns:
        errors.append(f"expected {expected_patterns} weekly patterns, got {len(schedule['patterns'])}")

    expected_events = EXPECTED_EVENTS.get(group)
    if expected_events is not None and len(schedule["events"]) != expected_events:
        errors.append(f"expected {expected_events} expanded events, got {len(schedule['events'])}")

    pattern_counts = Counter(pattern["title"] for pattern in schedule["patterns"])
    expected_counts = expected_pattern_counts(group)
    if dict(pattern_counts) != expected_counts:
        errors.append(f"discipline pattern invariant mismatch: {dict(pattern_counts)}")

    if sum(pattern["lessonType"] == "lecture" for pattern in schedule["patterns"]) != 9:
        errors.append("expected 9 lecture patterns")

    unresolved = [
        warning
        for warning in schedule["importWarnings"]
        if "ambiguous discipline reference:" in warning or "no discipline reference:" in warning
    ]
    if unresolved:
        errors.append(f"unresolved discipline references: {unresolved}")

    keys = [(event["start"], event["end"], event["title"]) for event in schedule["events"]]
    if len(keys) != len(set(keys)):
        errors.append("duplicate expanded events")

    if schedule["sourceReview"]["sourceOverlaps"]:
        errors.append(f"unexpected time overlaps: {schedule['sourceReview']['sourceOverlaps']}")

    expected_decisions = 1 if group in {"ОЛД 118", "ОЛД 119", "ОЛД 120"} else 0
    if len(schedule["sourceReview"]["semanticDecisions"]) != expected_decisions:
        errors.append(
            f"expected {expected_decisions} semantic decisions, "
            f"got {len(schedule['sourceReview']['semanticDecisions'])}"
        )

    if len(schedule["sourceReview"]["sourceReferenceOmissions"]) != 1:
        errors.append(
            "expected exactly one reviewed source-reference omission "
            "for the common gerontology lecture"
        )

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
    source_reference_omissions: list[dict[str, Any]] = []

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
                pattern_warnings, omission = accept_reference_omission(
                    pattern,
                    pattern_warnings,
                    group,
                    source_sha256,
                )
                patterns.append(pattern)
                warnings.extend(f"{day}: {warning}" for warning in pattern_warnings)
                if decision:
                    semantic_decisions.append(decision)
                if omission:
                    source_reference_omissions.append(omission)

    events = BASE.expand_patterns(
        patterns,
        period_start,
        period_end,
        first_anchor,
        second_anchor,
        group,
    )
    overlaps = overlap_records(events)
    schedule = {
        "version": 1,
        "university": "ugmu",
        "universityName": "УГМУ",
        "program": "medicine",
        "course": 1,
        "stream": "2",
        "academicYear": "2026/2027",
        "semester": 1,
        "timezone": "Asia/Yekaterinburg",
        "group": {
            "id": f"ugmu:medicine:1:stream-2:{group}",
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
            "status": "semantic-reviewed-second-stream",
            "publicationAllowed": False,
            "patternCount": len(patterns),
            "semanticDecisions": semantic_decisions,
            "sourceReferenceOmissions": source_reference_omissions,
            "sourceOverlaps": overlaps,
        },
        "patterns": patterns,
        "events": events,
        "importWarnings": warnings,
    }
    schedule["validationErrors"] = validate_stream_schedule(schedule)
    if schedule["validationErrors"]:
        schedule["sourceReview"]["status"] = "needs-review"
    return schedule


def self_test() -> None:
    assert SECOND_STREAM_GROUPS[0] == "ОЛД 113"
    assert SECOND_STREAM_GROUPS[-1] == "ОЛД 124"
    assert sum(EXPECTED_EVENTS.values()) == 4263
    assert sum(STANDARD_PATTERN_COUNTS.values()) == 23
    assert sum(expected_pattern_counts("ОЛД 114").values()) == 22
    assert repair_time_artifacts("12 :10-13:40") == "12:10-13:40"
    assert repair_time_artifacts("11:20-14:0 0") == "11:20-14:00"
    print("UGMU second-stream parser self-test passed")


def build_summary(schedules: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "sourceSha256": REVIEWED_SOURCE_SHA256,
        "groupCount": len(schedules),
        "approvedGroups": sum(not item["validationErrors"] for item in schedules),
        "weeklyPatterns": sum(len(item["patterns"]) for item in schedules),
        "events": sum(len(item["events"]) for item in schedules),
        "lecturePatterns": sum(
            sum(pattern["lessonType"] == "lecture" for pattern in item["patterns"])
            for item in schedules
        ),
        "semanticDecisions": sum(
            len(item["sourceReview"]["semanticDecisions"]) for item in schedules
        ),
        "sourceReferenceOmissions": sum(
            len(item["sourceReview"]["sourceReferenceOmissions"]) for item in schedules
        ),
        "overlaps": sum(
            len(item["sourceReview"]["sourceOverlaps"]) for item in schedules
        ),
        "validationErrors": sum(len(item["validationErrors"]) for item in schedules),
        "groups": {
            item["group"]["code"]: {
                "patterns": len(item["patterns"]),
                "events": len(item["events"]),
                "validationErrors": item["validationErrors"],
            }
            for item in schedules
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--group")
    parser.add_argument("--source")
    parser.add_argument("--sha256")
    parser.add_argument("--output", default="data/imports/ugmu-second-stream")
    parser.add_argument("--all-groups", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if not args.input:
        parser.error("--input is required")
    if not args.group and not args.all_groups:
        parser.error("--group or --all-groups is required")
    if args.group and args.all_groups:
        parser.error("--group and --all-groups are mutually exclusive")

    pdf_path = Path(args.input)
    output = Path(args.output)

    if args.all_groups:
        output.mkdir(parents=True, exist_ok=True)
        schedules = []
        for group in SECOND_STREAM_GROUPS:
            schedule = parse_pdf(pdf_path, group, args.source, args.sha256)
            schedules.append(schedule)
            group_slug = group.replace(" ", "-")
            (output / f"{group_slug}.json").write_text(
                json.dumps(schedule, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        summary = build_summary(schedules)
        (output / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(
            f"UGMU second stream: {summary['approvedGroups']}/{summary['groupCount']} groups approved; "
            f"{summary['weeklyPatterns']} patterns -> {summary['events']} events"
        )
        print(
            f"Semantic decisions: {summary['semanticDecisions']}; "
            f"reference omissions: {summary['sourceReferenceOmissions']}; "
            f"overlaps: {summary['overlaps']}; validation errors: {summary['validationErrors']}"
        )
        if summary["validationErrors"]:
            raise SystemExit(2)
        return

    schedule = parse_pdf(pdf_path, args.group, args.source, args.sha256)
    if output.suffix.lower() != ".json":
        output.mkdir(parents=True, exist_ok=True)
        output = output / f"{args.group.replace(' ', '-')}.json"
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"UGMU {args.group}: {len(schedule['patterns'])} patterns -> {len(schedule['events'])} events")
    print(f"Warnings: {len(schedule['importWarnings'])}")
    print(f"Validation errors: {len(schedule['validationErrors'])}")
    print(f"Output: {output}")
    if schedule["validationErrors"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
