#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

BASE_PATH = Path(__file__).with_name("ugmu-parse-weekly-pdf.py")
SPEC = importlib.util.spec_from_file_location("ugmu_weekly_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load UGMU weekly-grid base parser")
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)

STREAMS = {
    "1": {
        "groups": [f"ОЛД {value}" for value in range(201, 213)],
        "sha256": "8b81f37b517dd037c090b0d980ba4d916557f36c872fe0fc37031d4ae8808c6a",
    },
    "2": {
        "groups": [f"ОЛД {value}" for value in range(213, 225)],
        "sha256": "07675a77bdb80080ea018a73750f00f458cc100fcd01a63ecaf142430bca94bd",
    },
    "3": {
        "groups": [f"ОЛД {value}" for value in range(225, 237)],
        "sha256": "b6cc586f29a20bd008b5da89129809db7fbed8b2a9224a9f2d4cd3e3a77a9b85",
    },
    "4": {
        "groups": [f"ОЛД {value}" for value in range(237, 249)],
        "sha256": "6b5f87dc7f565169105245a397996e61e94794dfe580529cc5f7398a62e21517",
    },
}


def compact(value: Any) -> str:
    return BASE.compact(value)


def repair_time_artifacts(value: str) -> str:
    value = compact(value)
    value = re.sub(r"(?<!\d)(\d{1,2})\s+:\s*(\d{2})(?!\d)", r"\1:\2", value)
    value = re.sub(r"(?<!\d)(\d{1,2}):(\d)\s+(\d)(?!\d)", r"\1:\2\3", value)
    return value


def stream_definition(stream: str) -> dict[str, Any]:
    definition = STREAMS.get(str(stream))
    if not definition:
        raise RuntimeError(f"Unsupported UGMU course-2 stream: {stream}")
    return definition


def normalize_course2_semester_period(
    stream: str,
    period_start: date,
    period_end: date,
) -> tuple[date, date, list[dict[str, str]]]:
    corrections: list[dict[str, str]] = []
    if (
        str(stream) == "4"
        and period_start == date(2026, 9, 1)
        and period_end == date(2027, 12, 23)
    ):
        corrected_end = date(2026, 12, 23)
        corrections.append({
            "field": "semesterPeriod.end",
            "sourceValue": period_end.isoformat(),
            "normalizedValue": corrected_end.isoformat(),
            "reason": (
                "source typo confirmed against the same 2026/2027 autumn semester "
                "and course-2 streams 1-3"
            ),
        })
        period_end = corrected_end
    return period_start, period_end, corrections


def header_group_centers(table, geometry, groups: list[str]) -> dict[str, float]:
    actual = [compact(value) for value in table[0][1:]]
    if actual != groups:
        raise RuntimeError(f"Unexpected UGMU course-2 header: {actual}; expected {groups}")
    centers: dict[str, float] = {}
    for column_index, group in enumerate(actual, start=1):
        cell = geometry.rows[0].cells[column_index]
        if not cell:
            raise RuntimeError(f"Missing UGMU header geometry for {group}")
        centers[group] = (cell[0] + cell[2]) / 2
    return centers


def course2_weekday_bounds(page, geometry) -> list[tuple[str, float, float]]:
    labels: dict[str, float] = {}
    for word in page.extract_words(extra_attrs=["upright"]):
        if word.get("upright", True):
            continue
        day = BASE.decode_rotated_day(word.get("text", ""))
        if day:
            labels[day] = (word["top"] + word["bottom"]) / 2

    present = [name for name in BASE.DAY_NAMES if name in labels]
    allowed = [BASE.DAY_NAMES, BASE.DAY_NAMES[:5]]
    if present not in allowed:
        raise RuntimeError(f"UGMU course-2 weekday labels incomplete: {present}")

    header_cell = geometry.rows[0].cells[0]
    footer_cell = geometry.rows[-1].cells[0]
    if not header_cell or not footer_cell:
        raise RuntimeError("UGMU course-2 weekly-grid header/footer geometry missing")

    centers = [labels[name] for name in present]
    cuts = [header_cell[3]]
    cuts.extend((centers[index] + centers[index + 1]) / 2 for index in range(len(centers) - 1))
    cuts.append(footer_cell[1])
    return [(present[index], cuts[index], cuts[index + 1]) for index in range(len(present))]


def extract_group_lines(table, geometry, page, group: str, groups: list[str]) -> dict[str, list[str]]:
    if group not in groups:
        raise RuntimeError(f"UGMU course-2 parser does not allow group {group}")

    centers = header_group_centers(table, geometry, groups)
    target_center = centers[group]
    bounds = course2_weekday_bounds(page, geometry)
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


def unresolved_reference_warnings(warnings: list[str]) -> list[str]:
    return [
        warning for warning in warnings
        if "ambiguous discipline reference:" in warning or "no discipline reference:" in warning
    ]


def structural_validation(schedule: dict[str, Any], stream: str) -> list[str]:
    errors: list[str] = []
    definition = stream_definition(stream)
    group = schedule["group"]["code"]
    source_sha256 = schedule["sources"][0].get("sha256")

    if group not in definition["groups"]:
        errors.append(f"group outside course-2 stream {stream}: {group}")
    if source_sha256 != definition["sha256"]:
        errors.append(f"source SHA-256 is not approved for course-2 stream {stream}")
    if not schedule["patterns"]:
        errors.append("no weekly patterns extracted")
    if not schedule["events"]:
        errors.append("no expanded events")

    keys = [(event["start"], event["end"], event["title"]) for event in schedule["events"]]
    if len(keys) != len(set(keys)):
        errors.append("duplicate expanded events")

    expected_period = {"start": "2026-09-01", "end": "2026-12-23"}
    if schedule["semesterPeriod"] != expected_period:
        errors.append(f"unexpected semester period: {schedule['semesterPeriod']}; expected {expected_period}")
    if schedule["weekAnchors"]["I"][:4] != "2026" or schedule["weekAnchors"]["II"][:4] != "2026":
        errors.append(f"unexpected week anchors: {schedule['weekAnchors']}")
    return errors


def parse_pdf(
    pdf_path: Path,
    stream: str,
    group: str,
    source_url: str | None,
    source_sha256: str | None,
) -> dict[str, Any]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required; install tools/requirements-ugmu.txt") from error

    definition = stream_definition(stream)
    warnings: list[str] = []
    with pdfplumber.open(pdf_path) as document:
        page = document.pages[0]
        all_text = "\n".join((item.extract_text() or "") for item in document.pages)
        period_start, period_end = BASE.parse_period(all_text)
        period_start, period_end, source_corrections = normalize_course2_semester_period(
            stream,
            period_start,
            period_end,
        )
        for correction in source_corrections:
            warnings.append(
                "source correction: "
                f"{correction['field']} {correction['sourceValue']} -> "
                f"{correction['normalizedValue']}: {correction['reason']}"
            )
        first_anchor = BASE.parse_week_anchor(all_text, "I", period_start.year)
        second_anchor = BASE.parse_week_anchor(all_text, "II", period_start.year)
        table, geometry = BASE.find_weekly_table(page)
        lines_by_day = extract_group_lines(table, geometry, page, group, definition["groups"])
        references = BASE.extract_reference_rows(document)

        patterns: list[dict[str, Any]] = []
        for day in BASE.DAY_NAMES:
            for segment in BASE.split_segments(lines_by_day[day]):
                pattern, pattern_warnings = BASE.parse_pattern(segment, BASE.DAY_INDEX[day], references)
                patterns.append(pattern)
                warnings.extend(f"{day}: {warning}" for warning in pattern_warnings)

    events = BASE.expand_patterns(
        patterns,
        period_start,
        period_end,
        first_anchor,
        second_anchor,
        group,
    )
    overlaps = overlap_records(events)
    unresolved = unresolved_reference_warnings(warnings)
    schedule = {
        "version": 1,
        "university": "ugmu",
        "universityName": "УГМУ",
        "program": "medicine",
        "course": 2,
        "stream": stream,
        "academicYear": "2026/2027",
        "semester": 1,
        "timezone": "Asia/Yekaterinburg",
        "group": {
            "id": f"ugmu:medicine:2:stream-{stream}:{group}",
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
            "status": "needs-semantic-review",
            "publicationAllowed": False,
            "patternCount": len(patterns),
            "sourceCorrections": source_corrections,
            "unresolvedReferences": unresolved,
            "sourceOverlaps": overlaps,
        },
        "patterns": patterns,
        "events": events,
        "importWarnings": warnings,
    }
    schedule["validationErrors"] = structural_validation(schedule, stream)
    return schedule


def build_summary(schedules: list[dict[str, Any]], stream: str) -> dict[str, Any]:
    definition = stream_definition(stream)
    return {
        "course": 2,
        "stream": stream,
        "sourceSha256": definition["sha256"],
        "publicationAllowed": False,
        "groupCount": len(schedules),
        "structurallyValidGroups": sum(not item["validationErrors"] for item in schedules),
        "weeklyPatterns": sum(len(item["patterns"]) for item in schedules),
        "events": sum(len(item["events"]) for item in schedules),
        "lecturePatterns": sum(
            sum(pattern["lessonType"] == "lecture" for pattern in item["patterns"])
            for item in schedules
        ),
        "warnings": sum(len(item["importWarnings"]) for item in schedules),
        "sourceCorrections": sum(
            len(item["sourceReview"]["sourceCorrections"]) for item in schedules
        ),
        "unresolvedReferences": sum(
            len(item["sourceReview"]["unresolvedReferences"]) for item in schedules
        ),
        "overlaps": sum(len(item["sourceReview"]["sourceOverlaps"]) for item in schedules),
        "validationErrors": sum(len(item["validationErrors"]) for item in schedules),
        "groups": {
            item["group"]["code"]: {
                "patterns": len(item["patterns"]),
                "events": len(item["events"]),
                "warnings": len(item["importWarnings"]),
                "sourceCorrections": item["sourceReview"]["sourceCorrections"],
                "unresolvedReferences": item["sourceReview"]["unresolvedReferences"],
                "overlaps": item["sourceReview"]["sourceOverlaps"],
                "validationErrors": item["validationErrors"],
            }
            for item in schedules
        },
    }


def self_test() -> None:
    assert STREAMS["1"]["groups"] == [f"ОЛД {value}" for value in range(201, 213)]
    assert STREAMS["4"]["groups"][-1] == "ОЛД 248"
    assert sum(len(item["groups"]) for item in STREAMS.values()) == 48
    assert repair_time_artifacts("12 :10-13:40") == "12:10-13:40"
    assert repair_time_artifacts("11:20-14:0 0") == "11:20-14:00"

    start, end, corrections = normalize_course2_semester_period(
        "4",
        date(2026, 9, 1),
        date(2027, 12, 23),
    )
    assert start == date(2026, 9, 1)
    assert end == date(2026, 12, 23)
    assert corrections and corrections[0]["sourceValue"] == "2027-12-23"
    assert corrections[0]["normalizedValue"] == "2026-12-23"

    _start, unchanged_end, unchanged = normalize_course2_semester_period(
        "3",
        date(2026, 9, 1),
        date(2027, 12, 23),
    )
    assert unchanged_end == date(2027, 12, 23)
    assert unchanged == []
    print("UGMU course-2 stream parser self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--stream")
    parser.add_argument("--group")
    parser.add_argument("--source")
    parser.add_argument("--sha256")
    parser.add_argument("--output", default="data/imports/ugmu-course2/raw")
    parser.add_argument("--all-groups", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if not args.input:
        parser.error("--input is required")
    if not args.stream:
        parser.error("--stream is required")
    definition = stream_definition(args.stream)
    if not args.group and not args.all_groups:
        parser.error("--group or --all-groups is required")
    if args.group and args.all_groups:
        parser.error("--group and --all-groups are mutually exclusive")

    pdf_path = Path(args.input)
    output = Path(args.output)

    if args.all_groups:
        output.mkdir(parents=True, exist_ok=True)
        schedules = []
        for group in definition["groups"]:
            schedule = parse_pdf(pdf_path, args.stream, group, args.source, args.sha256)
            schedules.append(schedule)
            (output / f"{group.replace(' ', '-')}.json").write_text(
                json.dumps(schedule, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        summary = build_summary(schedules, args.stream)
        (output / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps({
            "stream": args.stream,
            "groups": summary["groupCount"],
            "structurallyValidGroups": summary["structurallyValidGroups"],
            "patterns": summary["weeklyPatterns"],
            "events": summary["events"],
            "warnings": summary["warnings"],
            "sourceCorrections": summary["sourceCorrections"],
            "unresolvedReferences": summary["unresolvedReferences"],
            "overlaps": summary["overlaps"],
            "validationErrors": summary["validationErrors"],
        }, ensure_ascii=False))
        if summary["validationErrors"]:
            raise SystemExit(2)
        return

    schedule = parse_pdf(pdf_path, args.stream, args.group, args.source, args.sha256)
    if output.suffix.lower() != ".json":
        output.mkdir(parents=True, exist_ok=True)
        output = output / f"{args.group.replace(' ', '-')}.json"
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "group": args.group,
        "patterns": len(schedule["patterns"]),
        "events": len(schedule["events"]),
        "warnings": len(schedule["importWarnings"]),
        "sourceCorrections": len(schedule["sourceReview"]["sourceCorrections"]),
        "unresolvedReferences": len(schedule["sourceReview"]["unresolvedReferences"]),
        "overlaps": len(schedule["sourceReview"]["sourceOverlaps"]),
        "validationErrors": len(schedule["validationErrors"]),
    }, ensure_ascii=False))
    if schedule["validationErrors"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
