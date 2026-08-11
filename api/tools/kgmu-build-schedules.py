#!/usr/bin/env python3
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

TIMEZONE = "Europe/Moscow"
MOSCOW = ZoneInfo(TIMEZONE)
UTC = dt.timezone.utc


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def utc_iso(date_text, time_text):
    local = dt.datetime.fromisoformat(f"{date_text}T{time_text}:00").replace(tzinfo=MOSCOW)
    return local.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def event_id(source_file, group, source_cell, date_text, start, end, title):
    payload = "|".join(
        str(value or "")
        for value in [source_file, group, source_cell, date_text, start, end, title]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def source_index(download_report):
    return {
        item.get("filename"): {
            "type": "official-xlsx",
            "label": item.get("label"),
            "url": item.get("url"),
            "pageUrl": item.get("pageUrl"),
            "sha256": item.get("sha256"),
        }
        for item in download_report.get("files", [])
        if item.get("filename")
    }


def schedule_shell(report, group, source):
    program = report.get("program")
    course = int(report.get("course"))
    group_id = f"kgmu:{program}:{course}:{group}"
    return {
        "version": 1,
        "university": "kgmu",
        "universityName": "КГМУ",
        "program": program,
        "course": course,
        "group": {
            "id": group_id,
            "code": str(group),
            "displayName": f"Группа {group}",
        },
        "timezone": TIMEZONE,
        "academicYear": report.get("academicYear"),
        "semester": int(report.get("semester")),
        "sources": [source] if source else [],
        "events": [],
        "qa": {
            "archiveReferenceOnly": bool(report.get("archiveReferenceOnly")),
            "commercialTargetPeriod": bool(report.get("commercialTargetPeriod")),
            "blockingIssues": [],
            "informationalMarkers": [],
        },
    }


def weekly_schedule(report, group, group_data, source):
    schedule = schedule_shell(report, group, source)
    for raw_event in group_data.get("events", []):
        try:
            start = utc_iso(raw_event["date"], raw_event["start"])
            end = utc_iso(raw_event["date"], raw_event["end"])
        except (KeyError, TypeError, ValueError):
            schedule["qa"]["blockingIssues"].append(
                {
                    "type": "invalid-event-time",
                    "sourceCell": raw_event.get("sourceCell"),
                    "raw": raw_event.get("raw"),
                }
            )
            continue
        schedule["events"].append(
            {
                "id": raw_event.get("id") or event_id(
                    report.get("sourceFile"), group, raw_event.get("sourceCell"),
                    raw_event.get("date"), raw_event.get("start"), raw_event.get("end"), raw_event.get("title"),
                ),
                "start": start,
                "end": end,
                "title": raw_event.get("title") or "Занятие",
                "location": raw_event.get("locationText") or "",
                "description": "Источник: официальное расписание КГМУ.",
                "sourceType": "official-xlsx",
                "sourceFile": report.get("sourceFile"),
                "sourceCell": raw_event.get("sourceCell"),
            }
        )

    for issue in group_data.get("unresolved", []):
        schedule["qa"]["blockingIssues"].append(
            {
                "type": "unresolved-source-segment",
                "reason": issue.get("reason"),
                "sourceCell": issue.get("sourceCell"),
                "raw": issue.get("raw"),
            }
        )
    for issue in group_data.get("partial", []):
        schedule["qa"]["blockingIssues"].append(
            {
                "type": "partial-source-segment",
                "warnings": issue.get("warnings", []),
                "sourceCell": issue.get("sourceCell"),
                "raw": issue.get("raw"),
            }
        )
    return finalize_schedule(schedule)


def resolved_block_times(block):
    timing = block.get("timing") or {}
    dates = block.get("dates") or []
    if timing.get("status") != "resolved" or not dates:
        return []
    if timing.get("allDatesTime"):
        value = timing["allDatesTime"]
        return [(date_text, value.get("start"), value.get("end")) for date_text in dates]
    if timing.get("firstDateTime") and timing.get("remainingDatesTime"):
        first = timing["firstDateTime"]
        remaining = timing["remainingDatesTime"]
        result = [(dates[0], first.get("start"), first.get("end"))]
        result.extend((date_text, remaining.get("start"), remaining.get("end")) for date_text in dates[1:])
        return result
    return []


def calendar_schedule(report, group, group_data, source):
    schedule = schedule_shell(report, group, source)
    for block in group_data.get("blocks", []):
        kind = block.get("kind")
        status = block.get("status")
        if kind != "discipline-cycle":
            marker = {
                "type": kind,
                "raw": block.get("raw"),
                "startDate": block.get("startDate"),
                "endDate": block.get("endDate"),
                "sourceCell": block.get("sourceCell"),
            }
            if block.get("requiresReview"):
                marker["blocking"] = True
                schedule["qa"]["blockingIssues"].append({"type": "review-marker", **marker})
            else:
                schedule["qa"]["informationalMarkers"].append(marker)
            continue

        if status != "matched":
            schedule["qa"]["blockingIssues"].append(
                {
                    "type": "calendar-block-not-fully-resolved",
                    "status": status,
                    "reasons": block.get("reviewReasons", []),
                    "sourceCell": block.get("sourceCell"),
                    "raw": block.get("raw"),
                }
            )
            continue

        occurrences = resolved_block_times(block)
        if not occurrences:
            schedule["qa"]["blockingIssues"].append(
                {
                    "type": "calendar-block-time-not-expandable",
                    "sourceCell": block.get("sourceCell"),
                    "raw": block.get("raw"),
                }
            )
            continue
        title = block.get("metadataMatch") or block.get("raw") or "Занятие"
        description_parts = ["Источник: официальное расписание КГМУ."]
        if block.get("practiceBase"):
            description_parts.append(f"База практической подготовки: {block['practiceBase']}")
        for date_text, local_start, local_end in occurrences:
            if not local_start or not local_end:
                schedule["qa"]["blockingIssues"].append(
                    {
                        "type": "calendar-block-invalid-occurrence",
                        "sourceCell": block.get("sourceCell"),
                        "date": date_text,
                    }
                )
                continue
            schedule["events"].append(
                {
                    "id": event_id(
                        report.get("sourceFile"), group, block.get("sourceCell"),
                        date_text, local_start, local_end, title,
                    ),
                    "start": utc_iso(date_text, local_start),
                    "end": utc_iso(date_text, local_end),
                    "title": title,
                    "location": block.get("address") or "",
                    "description": "\n".join(description_parts),
                    "sourceType": "official-xlsx",
                    "sourceFile": report.get("sourceFile"),
                    "sourceCell": block.get("sourceCell"),
                }
            )
    return finalize_schedule(schedule)


def finalize_schedule(schedule):
    unique = {}
    for event in schedule.get("events", []):
        key = (event.get("start"), event.get("end"), event.get("title"), event.get("location"))
        unique[key] = event
    schedule["events"] = sorted(unique.values(), key=lambda item: (item["start"], item["title"]))
    qa = schedule["qa"]
    qa["eventCount"] = len(schedule["events"])
    qa["blockingIssueCount"] = len(qa["blockingIssues"])
    qa["informationalMarkerCount"] = len(qa["informationalMarkers"])
    qa["passed"] = bool(schedule["events"]) and qa["blockingIssueCount"] == 0
    schedule["publishable"] = bool(qa["commercialTargetPeriod"] and qa["passed"])
    return schedule


def build_schedules(weekly_report, calendar_report, download_report):
    sources = source_index(download_report)
    schedules = []
    for report in weekly_report.get("reports", []):
        if report.get("status") != "parsed":
            continue
        source = sources.get(report.get("sourceFile"))
        for group, group_data in report.get("groups", {}).items():
            schedules.append(weekly_schedule(report, group, group_data, source))
    for report in calendar_report.get("reports", []):
        if report.get("status") != "parsed":
            continue
        source = sources.get(report.get("sourceFile"))
        for group, group_data in report.get("groups", {}).items():
            schedules.append(calendar_schedule(report, group, group_data, source))
    return schedules


def self_test():
    assert utc_iso("2026-06-01", "13:45") == "2026-06-01T10:45:00.000Z"
    block = {
        "dates": ["2026-02-02", "2026-02-03"],
        "timing": {
            "status": "resolved",
            "rule": "first-date-shift-2-then-shift-1",
            "firstDateTime": {"start": "12:00", "end": "15:05"},
            "remainingDatesTime": {"start": "08:30", "end": "11:35"},
        },
    }
    assert resolved_block_times(block) == [
        ("2026-02-02", "12:00", "15:05"),
        ("2026-02-03", "08:30", "11:35"),
    ]
    archive = {
        "program": "pediatrics", "course": 1, "academicYear": "2025/2026", "semester": 2,
        "archiveReferenceOnly": True, "commercialTargetPeriod": False,
    }
    shell = schedule_shell(archive, "132", None)
    shell["events"] = [{"id": "x", "start": "2026-01-26T05:00:00.000Z", "end": "2026-01-26T06:30:00.000Z", "title": "Тест", "location": ""}]
    shell = finalize_schedule(shell)
    assert shell["qa"]["passed"] is True
    assert shell["publishable"] is False
    print("kgmu schedule builder self-test: OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weekly-report")
    parser.add_argument("--calendar-report")
    parser.add_argument("--download-report")
    parser.add_argument("--output-dir")
    parser.add_argument("--summary")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    for name in ["weekly_report", "calendar_report", "download_report", "output_dir"]:
        if not getattr(args, name):
            parser.error(f"--{name.replace('_', '-')} is required")
    weekly = load_json(args.weekly_report)
    calendar = load_json(args.calendar_report)
    downloads = load_json(args.download_report)
    schedules = build_schedules(weekly, calendar, downloads)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    for schedule in schedules:
        group = schedule["group"]["code"]
        program = schedule["program"]
        course = schedule["course"]
        target = output_dir / f"{program}-course-{course}-group-{group}.json"
        target.write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {
        "version": 1,
        "scheduleCount": len(schedules),
        "eventCount": sum(len(item.get("events", [])) for item in schedules),
        "qaPassedGroupCount": sum(bool(item.get("qa", {}).get("passed")) for item in schedules),
        "blockedGroupCount": sum(not bool(item.get("qa", {}).get("passed")) for item in schedules),
        "archiveReferenceOnlyGroupCount": sum(bool(item.get("qa", {}).get("archiveReferenceOnly")) for item in schedules),
        "publishableGroupCount": sum(bool(item.get("publishable")) for item in schedules),
        "groups": [
            {
                "program": item["program"],
                "course": item["course"],
                "group": item["group"]["code"],
                "events": len(item.get("events", [])),
                "blockingIssues": item.get("qa", {}).get("blockingIssueCount"),
                "qaPassed": item.get("qa", {}).get("passed"),
                "publishable": item.get("publishable"),
            }
            for item in schedules
        ],
    }
    summary_path = Path(args.summary) if args.summary else output_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"KGMU normalized schedules: {summary['scheduleCount']}")
    print(f"Events: {summary['eventCount']}")
    print(f"QA-passed groups: {summary['qaPassedGroupCount']}")
    print(f"Blocked groups: {summary['blockedGroupCount']}")
    print(f"Publishable groups: {summary['publishableGroupCount']}")


if __name__ == "__main__":
    main()
