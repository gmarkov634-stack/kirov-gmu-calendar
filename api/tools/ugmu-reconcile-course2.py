#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any


def key(value: str) -> str:
    return re.sub(r"[^a-zа-яё0-9]+", " ", value.lower().replace("ё", "е")).strip()


def event_id(group: str, event_date: str, start_time: str, title: str) -> str:
    digest = hashlib.sha256(title.encode("utf-8")).hexdigest()[:10]
    normalized_group = re.sub(r"\s+", "", group).lower()
    return f"ugmu-{normalized_group}-{event_date}-{start_time.replace(':', '')}-{digest}"


# Every item below is anchored in one of the four SHA-locked official course-2 PDFs.
# The aliases repair PDF extraction / cross-stream reference-table omissions only;
# timetable dates and times are never changed here.
REFERENCE_FIXES: dict[str, dict[str, str]] = {
    key("Научно- исследователь ская работа"): {
        "title": "Научно-исследовательская работа (получение первичных навыков научно-исследовательской работы)*",
        "department": "Дерматовенерологии и безопасности жизнедеятельности",
        "location": "",
        "locationNote": "место проведения занятий определяет кафера",
        "evidence": "same official course-2 reference row in streams 1-3",
    },
    key("Клиническая П. ДВ 17:10-18:40 Клиническая"): {
        "title": "Клиническая биохимия",
        "department": "Биохимии",
        "location": "Онлайн",
        "locationNote": "",
        "evidence": "stream-2 official reference row: Клиническая биохимия; stream-1 timetable spells the full title",
    },
    key("Лекарственные растения и основы фармакогнозии."): {
        "title": "Лекарственные растения и основы фармакогнозии",
        "department": "Фармации",
        "location": "Онлайн",
        "locationNote": "",
        "evidence": "same official course-2 timetable/reference row in stream 3",
    },
    key("Современная научная картина мира."): {
        "title": "Современная научная картина мира",
        "department": "Медицинской физики и цифровой технологии",
        "location": "Онлайн",
        "locationNote": "",
        "evidence": "stream-4 timetable title plus stream-4 reference row containing source typo «найчная»",
    },
}


def is_reference_warning(value: str) -> bool:
    return "ambiguous discipline reference:" in value or "no discipline reference:" in value


def warning_source_title(value: str) -> str | None:
    for marker in ("ambiguous discipline reference: ", "no discipline reference: "):
        if marker in value:
            return value.split(marker, 1)[1].strip()
    return None


def expected_confirmed_overlap(group: str, item: dict[str, Any]) -> bool:
    return (
        group in {"ОЛД 247", "ОЛД 248"}
        and item.get("firstTitle") == "Микробиология, вирусология, иммунология"
        and item.get("firstStart") == "16:20"
        and item.get("firstEnd") == "18:40"
        and item.get("secondTitle") == "Микробиология, вирусология, иммунология"
        and item.get("secondStart") == "18:00"
        and item.get("secondEnd") == "19:30"
    )


def reconcile_schedule(schedule: dict[str, Any]) -> dict[str, Any]:
    group = schedule["group"]["code"]
    review = schedule["sourceReview"]
    corrections: list[dict[str, str]] = []

    unresolved_titles = {
        title
        for warning in review.get("unresolvedReferences", [])
        if (title := warning_source_title(warning))
    }

    for pattern in schedule.get("patterns", []):
        source_title = pattern.get("sourceTitle", "")
        if source_title not in unresolved_titles:
            continue
        fix = REFERENCE_FIXES.get(key(source_title))
        if not fix:
            continue
        pattern["title"] = fix["title"]
        pattern["department"] = fix["department"]
        pattern["location"] = fix["location"]
        pattern["locationNote"] = fix["locationNote"]
        corrections.append({
            "sourceTitle": source_title,
            "normalizedTitle": fix["title"],
            "evidence": fix["evidence"],
        })

    if corrections:
        correction_by_source = {item["sourceTitle"]: item for item in corrections}
        for event in schedule.get("events", []):
            correction = correction_by_source.get(event.get("sourceTitle", ""))
            if not correction:
                continue
            fix = REFERENCE_FIXES[key(event["sourceTitle"])]
            event["title"] = fix["title"]
            event["department"] = fix["department"]
            event["location"] = fix["location"]
            event["locationNote"] = fix["locationNote"]
            event_date = event["start"][:10]
            start_time = event["start"][11:16]
            event["id"] = event_id(group, event_date, start_time, fix["title"])

    remaining_warnings: list[str] = []
    for warning in schedule.get("importWarnings", []):
        title = warning_source_title(warning)
        if title and key(title) in REFERENCE_FIXES:
            continue
        remaining_warnings.append(warning)
    for correction in corrections:
        remaining_warnings.append(
            "course2 reference correction: "
            f"{correction['sourceTitle']} -> {correction['normalizedTitle']} ({correction['evidence']})"
        )
    schedule["importWarnings"] = remaining_warnings
    review["referenceCorrections"] = corrections
    review["unresolvedReferences"] = [
        warning for warning in remaining_warnings if is_reference_warning(warning)
    ]

    overlaps = review.get("sourceOverlaps", [])
    if overlaps and all(expected_confirmed_overlap(group, item) for item in overlaps):
        review["overlapStatus"] = "confirmed-in-official-source"
        review["confirmedSourceOverlapCount"] = len(overlaps)
    elif overlaps:
        review["overlapStatus"] = "needs-review"
        review["confirmedSourceOverlapCount"] = 0
    else:
        review["overlapStatus"] = "none"
        review["confirmedSourceOverlapCount"] = 0

    review["status"] = (
        "source-anomalies-reviewed"
        if not review["unresolvedReferences"] and review["overlapStatus"] != "needs-review"
        else "needs-semantic-review"
    )
    # Publication remains fail-closed until the canonical package promotion step.
    review["publicationAllowed"] = False
    return schedule


def summarize(schedules: list[dict[str, Any]], stream: str, source_sha256: str) -> dict[str, Any]:
    return {
        "course": 2,
        "stream": stream,
        "sourceSha256": source_sha256,
        "publicationAllowed": False,
        "groupCount": len(schedules),
        "structurallyValidGroups": sum(not item.get("validationErrors") for item in schedules),
        "weeklyPatterns": sum(len(item.get("patterns", [])) for item in schedules),
        "events": sum(len(item.get("events", [])) for item in schedules),
        "lecturePatterns": sum(
            sum(pattern.get("lessonType") == "lecture" for pattern in item.get("patterns", []))
            for item in schedules
        ),
        "warnings": sum(len(item.get("importWarnings", [])) for item in schedules),
        "sourceCorrections": sum(
            len(item["sourceReview"].get("sourceCorrections", [])) for item in schedules
        ),
        "referenceCorrections": sum(
            len(item["sourceReview"].get("referenceCorrections", [])) for item in schedules
        ),
        "unresolvedReferences": sum(
            len(item["sourceReview"].get("unresolvedReferences", [])) for item in schedules
        ),
        "overlaps": sum(len(item["sourceReview"].get("sourceOverlaps", [])) for item in schedules),
        "confirmedOverlaps": sum(
            item["sourceReview"].get("confirmedSourceOverlapCount", 0) for item in schedules
        ),
        "unresolvedOverlaps": sum(
            len(item["sourceReview"].get("sourceOverlaps", []))
            if item["sourceReview"].get("overlapStatus") == "needs-review" else 0
            for item in schedules
        ),
        "validationErrors": sum(len(item.get("validationErrors", [])) for item in schedules),
        "groups": {
            item["group"]["code"]: {
                "patterns": len(item.get("patterns", [])),
                "events": len(item.get("events", [])),
                "warnings": len(item.get("importWarnings", [])),
                "sourceCorrections": item["sourceReview"].get("sourceCorrections", []),
                "referenceCorrections": item["sourceReview"].get("referenceCorrections", []),
                "unresolvedReferences": item["sourceReview"].get("unresolvedReferences", []),
                "overlaps": item["sourceReview"].get("sourceOverlaps", []),
                "overlapStatus": item["sourceReview"].get("overlapStatus"),
                "validationErrors": item.get("validationErrors", []),
            }
            for item in schedules
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="data/imports/ugmu-course2/raw")
    args = parser.parse_args()
    root = Path(args.root)

    total_unresolved = 0
    total_unresolved_overlaps = 0
    total_reference_corrections = 0
    total_confirmed_overlaps = 0

    for stream in "1234":
        stream_dir = root / f"stream-{stream}"
        summary_path = stream_dir / "summary.json"
        old_summary = json.loads(summary_path.read_text(encoding="utf-8"))
        schedules: list[dict[str, Any]] = []
        for path in sorted(stream_dir.glob("ОЛД-*.json")):
            schedule = json.loads(path.read_text(encoding="utf-8"))
            schedule = reconcile_schedule(schedule)
            path.write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            schedules.append(schedule)

        summary = summarize(schedules, stream, old_summary["sourceSha256"])
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        total_unresolved += summary["unresolvedReferences"]
        total_unresolved_overlaps += summary["unresolvedOverlaps"]
        total_reference_corrections += summary["referenceCorrections"]
        total_confirmed_overlaps += summary["confirmedOverlaps"]
        print(json.dumps({
            "stream": stream,
            "referenceCorrections": summary["referenceCorrections"],
            "unresolvedReferences": summary["unresolvedReferences"],
            "confirmedOverlaps": summary["confirmedOverlaps"],
            "unresolvedOverlaps": summary["unresolvedOverlaps"],
        }, ensure_ascii=False))

    if total_unresolved or total_unresolved_overlaps:
        raise SystemExit(
            f"course2 semantic reconciliation incomplete: refs={total_unresolved}, overlaps={total_unresolved_overlaps}"
        )
    print(json.dumps({
        "course2SemanticReview": "pass",
        "referenceCorrections": total_reference_corrections,
        "confirmedSourceOverlaps": total_confirmed_overlaps,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
