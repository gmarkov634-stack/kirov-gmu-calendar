#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from typing import Any

CORE_PATH = Path(__file__).with_name("ugmu-parse-course1-streams-3-4.py")
SPEC = importlib.util.spec_from_file_location("ugmu_course1_stream34_core", CORE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load UGMU course-1 streams 3/4 core parser")
CORE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CORE)
BASE = CORE.BASE


def reviewed_weekday_bounds(table, geometry) -> list[tuple[str, float, float]]:
    """Read weekday spans from exact table borders rather than label midpoints.

    In the exact stream-III/IV PDFs Friday is fragmented into several small cells,
    while the other five day labels are proper merged cells.  Their borders provide
    exact day boundaries; deriving the single Friday span prevents the common Monday
    anatomy lecture in stream IV from being shifted into Tuesday by midpoint logic.
    """
    spans: dict[str, tuple[float, float]] = {}
    for row_values, row_geometry in zip(table, geometry.rows):
        if not row_geometry.cells:
            continue
        cell = row_geometry.cells[0]
        if not cell:
            continue
        raw = row_values[0] if row_values else None
        day = BASE.decode_rotated_day(raw)
        if not day:
            continue
        top, bottom = cell[1], cell[3]
        if bottom - top >= 50:
            spans[day] = (top, bottom)

    missing = [day for day in BASE.DAY_NAMES if day not in spans]
    if missing != ["пятница"] or len(spans) != 5:
        raise RuntimeError(f"Unexpected UGMU weekday geometry: spans={spans}, missing={missing}")

    index = BASE.DAY_INDEX["пятница"]
    previous = BASE.DAY_NAMES[index - 1]
    following = BASE.DAY_NAMES[index + 1]
    top = spans[previous][1]
    bottom = spans[following][0]
    if not top < bottom:
        raise RuntimeError(f"Invalid derived Friday span: {top}-{bottom}")
    spans["пятница"] = (top, bottom)

    ordered = [(day, *spans[day]) for day in BASE.DAY_NAMES]
    for (_day, _top, end), (next_day, start, _next_end) in zip(ordered, ordered[1:]):
        if abs(end - start) > 0.05:
            raise RuntimeError(f"Non-contiguous weekday border before {next_day}: {end} vs {start}")
    return ordered


def reviewed_extract_group_lines(
    table,
    geometry,
    page,
    group: str,
    expected_groups: list[str],
) -> dict[str, list[str]]:
    centers = CORE.header_group_centers(table, geometry, expected_groups)
    if group not in centers:
        raise RuntimeError(f"Group outside reviewed stream: {group}")
    target_center = centers[group]
    bounds = reviewed_weekday_bounds(table, geometry)
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
            if raw_value is None or cell is None or not CORE.compact(raw_value):
                continue
            x0, _top, x1, _bottom = cell
            if not (x0 - 1e-6 <= target_center <= x1 + 1e-6):
                continue
            for raw_line in str(raw_value).splitlines():
                line = CORE.repair_line(raw_line)
                if line:
                    result[day].append(line)
    return result


# CORE.parse_pdf resolves this function from its own module globals at runtime.
CORE.extract_group_lines = reviewed_extract_group_lines


def apply_biology_source_note(schedule: dict[str, Any]) -> None:
    stream = schedule["stream"]
    group = schedule["group"]["code"]
    source_sha = schedule["sources"][0].get("sha256")
    if source_sha != CORE.STREAMS[stream]["sha256"]:
        raise RuntimeError("Biology source-note handling requires the exact reviewed SHA-256")

    patterns = [
        pattern for pattern in schedule["patterns"]
        if pattern["title"] == "Биология"
        and pattern["lessonType"] == "lecture"
        and pattern["weekRule"] == "I"
        and pattern["startTime"] == "18:00"
        and pattern["endTime"] == "19:30"
        and "1 и 2 лекция очно" in pattern["sourceTitle"]
        and "актовый зал 3 корпус" in pattern["sourceTitle"]
    ]
    if len(patterns) != 1:
        raise RuntimeError(f"Expected one reviewed Biology annotation for {group}, got {len(patterns)}")

    biology_events = sorted(
        [
            event for event in schedule["events"]
            if event["title"] == "Биология"
            and event["lessonType"] == "lecture"
            and event["weekRule"] == "I"
            and event["start"][11:16] == "18:00"
            and event["end"][11:16] == "19:30"
        ],
        key=lambda event: event["start"],
    )
    if len(biology_events) < 2:
        raise RuntimeError(f"Expected at least two Biology lecture occurrences for {group}")

    first_two_ids = {event["id"] for event in biology_events[:2]}
    first_two_dates: list[str] = []
    for event in schedule["events"]:
        if event["id"] in first_two_ids:
            event["location"] = "3 корпус"
            event["locationNote"] = "актовый зал; очно (1-я и 2-я лекции)"
            first_two_dates.append(event["start"][:10])

    schedule["sourceReview"]["semanticDecisions"].append({
        "kind": "source-specific-first-two-lecture-location",
        "sourceSha256": source_sha,
        "group": group,
        "title": "Биология",
        "dates": sorted(first_two_dates),
        "location": "3 корпус",
        "locationNote": "актовый зал; очно (1-я и 2-я лекции)",
        "evidence": [
            "exact weekly-grid parenthetical explicitly states `1 и 2 лекция очно`",
            "same parenthetical explicitly states `актовый зал 3 корпус`",
        ],
    })
    schedule["sourceReview"]["sourceAmbiguities"] = [{
        "kind": "official-source-ambiguous-biology-time-note",
        "sourceSha256": source_sha,
        "group": group,
        "title": "Биология",
        "mainRowTime": "18:00-19:30",
        "rawParentheticalTimeFragment": "с 17.10-18.40",
        "action": "preserved-main-row-time-no-inferred-time-correction",
        "evidence": [
            "exact official grid prints 18:00-19:30 before the discipline title",
            "the same cell contains the unclear/conflicting fragment `с 17.10-18.40`",
        ],
    }]


def reviewed_validation(schedule: dict[str, Any]) -> list[str]:
    errors = list(schedule.get("validationErrors", []))
    stream = schedule["stream"]

    if len(schedule["sourceReview"].get("sourceAmbiguities", [])) != 1:
        errors.append("expected exactly one reviewed Biology time ambiguity")
    expected_decisions = 2 if stream == "4" else 1
    if len(schedule["sourceReview"]["semanticDecisions"]) != expected_decisions:
        errors.append(
            f"expected {expected_decisions} final semantic decisions, got "
            f"{len(schedule['sourceReview']['semanticDecisions'])}"
        )

    biology_events = sorted(
        [
            event for event in schedule["events"]
            if event["title"] == "Биология" and event["lessonType"] == "lecture"
        ],
        key=lambda event: event["start"],
    )
    if len(biology_events) < 2:
        errors.append("missing Biology lecture occurrences")
    elif any(event["location"] != "3 корпус" for event in biology_events[:2]):
        errors.append("first two Biology lectures do not preserve the reviewed in-person location")

    if stream == "4":
        anatomy = [
            pattern for pattern in schedule["patterns"]
            if pattern["title"] == "Анатомия"
            and pattern["lessonType"] == "lecture"
            and pattern["weekRule"] == "II"
        ]
        if len(anatomy) != 1 or anatomy[0]["weekday"] != 0:
            errors.append("stream-IV common Anatomy II-week lecture must be Monday")

        anthropology = [
            pattern for pattern in schedule["patterns"]
            if pattern["title"] == "Антропологические основы деятельности врача"
            and pattern["lessonType"] == "lecture"
        ]
        if (
            len(anthropology) != 1
            or anthropology[0]["location"] != "Репина, 3"
            or anthropology[0]["locationNote"] != "ауд. БА"
        ):
            errors.append("stream-IV anthropology lecture location mismatch")

    return errors


def parse_pdf(
    pdf_path: Path,
    stream: str,
    group: str,
    source_url: str | None,
    source_sha256: str | None,
) -> dict[str, Any]:
    schedule = CORE.parse_pdf(pdf_path, stream, group, source_url, source_sha256)
    apply_biology_source_note(schedule)
    schedule["validationErrors"] = reviewed_validation(schedule)
    if schedule["validationErrors"]:
        schedule["sourceReview"]["status"] = "needs-review"
    elif schedule["sourceReview"]["sourceDefects"]:
        schedule["sourceReview"]["status"] = (
            f"semantic-reviewed-stream-{stream}-with-source-defect-and-ambiguity"
        )
    else:
        schedule["sourceReview"]["status"] = f"semantic-reviewed-stream-{stream}-with-source-ambiguity"
    schedule["sourceReview"]["publicationAllowed"] = False
    return schedule


def build_summary(stream: str, schedules: list[dict[str, Any]]) -> dict[str, Any]:
    summary = CORE.build_summary(stream, schedules)
    summary["sourceAmbiguities"] = sum(
        len(item["sourceReview"].get("sourceAmbiguities", [])) for item in schedules
    )
    return summary


def self_test() -> None:
    CORE.self_test()
    assert BASE.DAY_INDEX["понедельник"] == 0
    assert BASE.DAY_INDEX["пятница"] == 4
    print("UGMU streams III/IV reviewed-layer self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--stream", choices=["3", "4"])
    parser.add_argument("--group")
    parser.add_argument("--source")
    parser.add_argument("--sha256")
    parser.add_argument("--output", default="data/imports/ugmu-course1-streams-3-4-reviewed")
    parser.add_argument("--all-groups", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if not args.input or not args.stream:
        parser.error("--input and --stream are required")
    if not args.group and not args.all_groups:
        parser.error("--group or --all-groups is required")
    if args.group and args.all_groups:
        parser.error("--group and --all-groups are mutually exclusive")

    pdf_path = Path(args.input)
    output = Path(args.output)
    groups = CORE.STREAMS[args.stream]["groups"] if args.all_groups else [args.group]
    schedules = [
        parse_pdf(pdf_path, args.stream, group, args.source, args.sha256)
        for group in groups
    ]

    if args.all_groups:
        output.mkdir(parents=True, exist_ok=True)
        for schedule in schedules:
            slug = schedule["group"]["code"].replace(" ", "-")
            (output / f"{slug}.json").write_text(
                json.dumps(schedule, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        summary = build_summary(args.stream, schedules)
        (output / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(
            f"UGMU stream {args.stream}: {summary['validatedGroups']}/{summary['groupCount']} groups validated; "
            f"{summary['weeklyPatterns']} patterns ({summary['validExpansionPatterns']} expandable) -> "
            f"{summary['events']} events"
        )
        print(
            f"Source defects: {summary['sourceDefects']}; source ambiguities: {summary['sourceAmbiguities']}; "
            f"overlaps: {summary['sourceOverlaps']}; reference omissions: {summary['sourceReferenceOmissions']}; "
            f"semantic decisions: {summary['semanticDecisions']}; validation errors: {summary['validationErrors']}"
        )
        if summary["validationErrors"]:
            raise SystemExit(2)
    else:
        schedule = schedules[0]
        if output.suffix.lower() != ".json":
            output.mkdir(parents=True, exist_ok=True)
            output = output / f"{schedule['group']['code'].replace(' ', '-')}.json"
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(schedule, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(
            f"UGMU {schedule['group']['code']}: {len(schedule['patterns'])} patterns -> "
            f"{len(schedule['events'])} events"
        )
        print(f"Validation errors: {len(schedule['validationErrors'])}")
        if schedule["validationErrors"]:
            raise SystemExit(2)


if __name__ == "__main__":
    main()
