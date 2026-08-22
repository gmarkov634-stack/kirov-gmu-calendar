#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

EXPECTED_SHA256 = "07675a77bdb80080ea018a73750f00f458cc100fcd01a63ecaf142430bca94bd"
EXPECTED_SOURCE_URL = "https://usma.ru/wp-content/uploads/2026/08/2%D0%9E%D0%9B%D0%94_2-%D0%BF%D0%BE%D1%82%D0%BE%D0%BA_%D0%BE%D1%81%D0%B5%D0%BD%D1%8C_26.pdf"
EXPECTED_GROUPS = [f"ОЛД {value}" for value in range(213, 225)]
EXPECTED_PATTERN_COUNT = 206
PERIOD_START = date(2026, 9, 1)
PERIOD_END = date(2026, 12, 23)
WEEK_I_START = date(2026, 9, 1)
WEEK_II_START = date(2026, 9, 7)

APPROVED_OVERLAP_GROUPS = {"ОЛД 213", "ОЛД 214"}
APPROVED_OVERLAP_TITLE = "Клиническая биохимия"
APPROVED_OVERLAP_START = "17:10"
APPROVED_OVERLAP_END = "18:40"
APPROVED_OVERLAP_MARKERS = {"Л. ДВ", "П. ДВ"}
APPROVED_OVERLAP_TYPES = {"lecture", "other"}
EXPECTED_APPROVED_OVERLAP_COUNT = 32


def minutes(value: str) -> int:
    parsed = datetime.strptime(value, "%H:%M")
    return parsed.hour * 60 + parsed.minute


def academic_week_label(value: date) -> str:
    if not PERIOD_START <= value <= PERIOD_END:
        raise RuntimeError(f"Date outside approved period: {value.isoformat()}")
    if value < WEEK_II_START:
        return "I"
    block = (value - WEEK_II_START).days // 7
    return "II" if block % 2 == 0 else "I"


def iter_period() -> list[date]:
    result: list[date] = []
    current = PERIOD_START
    while current <= PERIOD_END:
        result.append(current)
        current += timedelta(days=1)
    return result


def applies(pattern: dict[str, Any], value: date) -> bool:
    if value.weekday() != int(pattern["weekday"]):
        return False
    week_rule = str(pattern.get("weekRuleRaw") or "weekly")
    if week_rule not in {"weekly", "I", "II"}:
        raise RuntimeError(f"Unsupported week rule: {week_rule}")
    if week_rule != "weekly" and academic_week_label(value) != week_rule:
        return False
    active_months = pattern.get("activeMonths")
    if active_months is not None:
        months = [int(item) for item in active_months]
        if value.month not in months:
            return False
    return True


def event_key(event: dict[str, Any]) -> tuple[Any, ...]:
    return (
        event["group"],
        event["date"],
        event["startTime"],
        event["endTime"],
        event["titleSemantic"],
        event["lessonTypeSemantic"],
    )


def overlap_side(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "patternIndex": event["patternIndex"],
        "startTime": event["startTime"],
        "endTime": event["endTime"],
        "markerRaw": event.get("markerRaw"),
        "sourceTitleRaw": event["sourceTitleRaw"],
        "titleSemantic": event["titleSemantic"],
        "lessonTypeSemantic": event["lessonTypeSemantic"],
    }


def is_approved_source_overlap(overlap: dict[str, Any]) -> bool:
    if overlap["group"] not in APPROVED_OVERLAP_GROUPS:
        return False
    if date.fromisoformat(overlap["date"]).weekday() != 5:
        return False
    left = overlap["left"]
    right = overlap["right"]
    sides = (left, right)
    if any(side["startTime"] != APPROVED_OVERLAP_START for side in sides):
        return False
    if any(side["endTime"] != APPROVED_OVERLAP_END for side in sides):
        return False
    if any(side["titleSemantic"] != APPROVED_OVERLAP_TITLE for side in sides):
        return False
    if {side.get("markerRaw") for side in sides} != APPROVED_OVERLAP_MARKERS:
        return False
    if {side["lessonTypeSemantic"] for side in sides} != APPROVED_OVERLAP_TYPES:
        return False
    return True


def analyze(events: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    duplicates: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    overlaps: list[dict[str, Any]] = []

    counts = Counter(event_key(event) for event in events)
    for key, count in counts.items():
        if count > 1:
            duplicates.append({
                "group": key[0],
                "date": key[1],
                "startTime": key[2],
                "endTime": key[3],
                "titleSemantic": key[4],
                "lessonTypeSemantic": key[5],
                "count": count,
            })

    by_group_date: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        start = minutes(event["startTime"])
        end = minutes(event["endTime"])
        if end <= start:
            invalid.append({
                "group": event["group"],
                "date": event["date"],
                "startTime": event["startTime"],
                "endTime": event["endTime"],
                "titleSemantic": event["titleSemantic"],
            })
            continue
        by_group_date[(event["group"], event["date"])].append(event)

    for (group, day), items in sorted(by_group_date.items()):
        ordered = sorted(
            items,
            key=lambda item: (
                minutes(item["startTime"]),
                minutes(item["endTime"]),
                item["titleSemantic"],
                str(item.get("markerRaw") or ""),
            ),
        )
        for index, left in enumerate(ordered):
            left_start, left_end = minutes(left["startTime"]), minutes(left["endTime"])
            for right in ordered[index + 1:]:
                right_start, right_end = minutes(right["startTime"]), minutes(right["endTime"])
                if right_start >= left_end:
                    break
                if left_start < right_end and right_start < left_end:
                    overlaps.append({
                        "group": group,
                        "date": day,
                        "left": overlap_side(left),
                        "right": overlap_side(right),
                    })
    return duplicates, invalid, overlaps


def build(semantic_path: Path) -> dict[str, Any]:
    semantic = json.loads(semantic_path.read_text(encoding="utf-8"))
    if semantic.get("mode") != "semantic-weekly-patterns-only":
        raise RuntimeError(f"Unexpected semantic mode: {semantic.get('mode')}")
    if semantic.get("course") != 2 or semantic.get("stream") != 2:
        raise RuntimeError("Date expansion is restricted to UGMU medicine course 2 stream II")
    if semantic.get("source", {}).get("sha256") != EXPECTED_SHA256:
        raise RuntimeError("Semantic source SHA-256 changed; manual review required")
    if semantic.get("source", {}).get("url") != EXPECTED_SOURCE_URL:
        raise RuntimeError("Semantic source URL changed; manual review required")
    if list(semantic.get("groups", {}).keys()) != EXPECTED_GROUPS:
        raise RuntimeError("Semantic group set/order changed; manual review required")
    if semantic.get("summary", {}).get("semanticPatternCount") != EXPECTED_PATTERN_COUNT:
        raise RuntimeError("Semantic pattern count changed; manual review required")
    if semantic.get("summary", {}).get("unresolvedTitleReferences") != 0:
        raise RuntimeError("Unresolved semantic title references remain")
    if semantic.get("summary", {}).get("ambiguousTitleReferences") != 0:
        raise RuntimeError("Ambiguous semantic title references remain")

    all_dates = iter_period()
    groups: dict[str, list[dict[str, Any]]] = {}
    lesson_type_counts: Counter[str] = Counter()
    week_rule_event_counts: Counter[str] = Counter()

    for group in EXPECTED_GROUPS:
        group_events: list[dict[str, Any]] = []
        for pattern_index, pattern in enumerate(semantic["groups"][group], start=1):
            if int(pattern.get("weekday", -1)) not in range(0, 6):
                raise RuntimeError(f"Unexpected weekday for {group}: {pattern.get('weekday')}")
            if pattern.get("monthQualifierRaw") not in (None, ""):
                raise RuntimeError("Unexpected month qualifier in stream II; manual review required")
            for current in all_dates:
                if not applies(pattern, current):
                    continue
                event = {
                    "group": group,
                    "date": current.isoformat(),
                    "weekday": current.weekday(),
                    "academicWeekRuleResolved": academic_week_label(current),
                    "patternIndex": pattern_index,
                    "startTime": pattern["startTime"],
                    "endTime": pattern["endTime"],
                    "markerRaw": pattern.get("markerRaw") or None,
                    "sourceTitleRaw": pattern["sourceTitleRaw"],
                    "titleSemantic": pattern["titleSemantic"],
                    "titleResolution": pattern.get("titleResolution"),
                    "lessonTypeSemantic": pattern["lessonTypeSemantic"],
                    "weekRuleRaw": pattern.get("weekRuleRaw", "weekly"),
                    "referenceDiscipline": pattern.get("referenceDiscipline"),
                    "referenceDepartment": pattern.get("referenceDepartment"),
                    "referenceAddressRaw": pattern.get("referenceAddressRaw"),
                }
                group_events.append(event)
                lesson_type_counts[event["lessonTypeSemantic"]] += 1
                week_rule_event_counts[event["weekRuleRaw"]] += 1
        group_events.sort(
            key=lambda item: (
                item["date"],
                item["startTime"],
                item["endTime"],
                item["titleSemantic"],
                str(item.get("markerRaw") or ""),
            )
        )
        groups[group] = group_events

    events = [event for group_events in groups.values() for event in group_events]
    duplicates, invalid_intervals, overlaps = analyze(events)
    approved_source_overlaps = [overlap for overlap in overlaps if is_approved_source_overlap(overlap)]
    unresolved_overlaps = [overlap for overlap in overlaps if not is_approved_source_overlap(overlap)]

    if len(approved_source_overlaps) != EXPECTED_APPROVED_OVERLAP_COUNT:
        raise RuntimeError(
            "Approved stream-II overlap count changed; new source/geometry review required: "
            f"expected {EXPECTED_APPROVED_OVERLAP_COUNT}, got {len(approved_source_overlaps)}"
        )

    review_required = bool(duplicates or invalid_intervals or unresolved_overlaps)

    return {
        "mode": "dated-events-review-only",
        "university": "ugmu",
        "program": "medicine",
        "course": 2,
        "stream": 2,
        "source": {"url": EXPECTED_SOURCE_URL, "sha256": EXPECTED_SHA256},
        "effectivePeriod": {"start": PERIOD_START.isoformat(), "end": PERIOD_END.isoformat()},
        "weekAnchors": {"I": WEEK_I_START.isoformat(), "II": WEEK_II_START.isoformat()},
        "groups": groups,
        "review": {
            "duplicates": duplicates,
            "invalidIntervals": invalid_intervals,
            "overlaps": overlaps,
            "approvedSourceOverlaps": approved_source_overlaps,
            "unresolvedOverlaps": unresolved_overlaps,
            "approvedSourceOverlapPolicy": {
                "sourceSha256": EXPECTED_SHA256,
                "reason": "User-approved preservation of two distinct official PDF rows; do not infer a correction or month split.",
                "groups": sorted(APPROVED_OVERLAP_GROUPS),
                "weekday": "суббота",
                "startTime": APPROVED_OVERLAP_START,
                "endTime": APPROVED_OVERLAP_END,
                "titleSemantic": APPROVED_OVERLAP_TITLE,
                "markers": sorted(APPROVED_OVERLAP_MARKERS),
                "expectedOverlapCount": EXPECTED_APPROVED_OVERLAP_COUNT,
                "newSourceShaRequiresReview": True,
            },
        },
        "summary": {
            "groupCount": len(groups),
            "semanticPatternCount": EXPECTED_PATTERN_COUNT,
            "eventCount": len(events),
            "eventsByGroup": {group: len(group_events) for group, group_events in groups.items()},
            "lessonTypeEventCounts": dict(lesson_type_counts),
            "weekRuleEventCounts": dict(week_rule_event_counts),
            "duplicateCount": len(duplicates),
            "invalidIntervalCount": len(invalid_intervals),
            "overlapCount": len(overlaps),
            "approvedSourceOverlapCount": len(approved_source_overlaps),
            "unresolvedOverlapCount": len(unresolved_overlaps),
            "reviewRequired": review_required,
            "canonicalizationPerformed": False,
            "storageWritesPerformed": False,
            "icsGenerated": False,
            "publicationAllowed": False,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="UGMU course-2 stream-II date expansion for review only")
    parser.add_argument("--semantic", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = build(Path(args.semantic))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
