#!/usr/bin/env python3
"""Build the safe normalized candidate for KGMU Dentistry course 4 (groups 491-494).

The builder consumes only the committed mechanical source probe. It applies the
canonical cyclic-profile rules to source facts that are unambiguous and leaves
the C20 otorhinolaryngology one-day time exception in REVIEW_REQUIRED state.
No production storage, DB, ScheduleVersion or publication operation is touched.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERIOD = "2026-2027-semester-1"
PROBE_PATH = ROOT / "qa" / PERIOD / "dentistry-494.source-probe.json"
CATALOG_PATH = ROOT / "catalog" / "2026-2027-semester-1.json"
FIXTURE_DIR = ROOT / "fixtures" / PERIOD
QA_DIR = ROOT / "qa" / PERIOD
SOURCE_SHA256 = "2e945ca99ec75bfbe7f98402d0752ebe96afbd12780d29c7f5cdf32f7e22b265"
EXPECTED_GROUPS = ["491", "492", "493", "494"]
PARSER_RULES_VERSION = "kgmu-2026-08-27-v3"
SOURCE_ID = "dentistry"
SOURCE_ARTIFACT_ID = f"source-artifact-dentistry-491-494-{SOURCE_SHA256[:16]}"
PARSING_JOB_ID = f"parsing-job-dentistry-491-494-{SOURCE_SHA256[:16]}-v1"
DRAFT_ID = f"normalized-draft-dentistry-491-494-{SOURCE_SHA256[:16]}-v1"
SOURCE_OBJECT_KEY = f"qa-source-artifacts/kirov-gmu/{PERIOD}/dentistry-491-494/{SOURCE_SHA256}.xlsx"


def compact(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def column_number(name: str) -> int:
    value = 0
    for char in name:
        value = value * 26 + ord(char) - 64
    return value


def column_name(value: int) -> str:
    result = ""
    current = value
    while current > 0:
        current -= 1
        result = chr(65 + current % 26) + result
        current //= 26
    return result


def parse_coord(coord: str) -> tuple[int, int]:
    match = re.fullmatch(r"([A-Z]+)(\d+)", coord)
    if match is None:
        raise SystemExit(f"invalid source coordinate: {coord}")
    return column_number(match.group(1)), int(match.group(2))


def parse_range(value: str) -> dict:
    start, end = value.split(":")
    start_column, start_row = parse_coord(start)
    end_column, end_row = parse_coord(end)
    return {
        "range": value,
        "start": start,
        "startColumn": start_column,
        "startRow": start_row,
        "endColumn": end_column,
        "endRow": end_row,
    }


def normalize_clock(value: str) -> str:
    match = re.fullmatch(r"(\d{1,2})[.:](\d{2})", value.strip())
    if match is None:
        raise SystemExit(f"invalid source clock: {value}")
    return f"{int(match.group(1)):02d}:{match.group(2)}"


def parse_simple_time_range(value: str) -> tuple[str, str]:
    match = re.fullmatch(r"\s*(\d{1,2}[.:]\d{2})\s*-\s*(\d{1,2}[.:]\d{2})\s*", value)
    if match is None:
        raise SystemExit(f"time range is not simple: {value}")
    return normalize_clock(match.group(1)), normalize_clock(match.group(2))


def assessment_from_label(label: str, row: int, sheet_name: str) -> dict | None:
    normalized = compact(label)
    if not normalized:
        return None
    mapping = {"Зачёт": "credit", "Экзамен": "exam"}
    assessment_type = mapping.get(normalized)
    if assessment_type is None:
        raise SystemExit(f"unsupported assessment label at row {row}: {normalized}")
    return {
        "type": assessment_type,
        "label": normalized,
        "sourceRef": {"sourceId": SOURCE_ID, "locator": f"{sheet_name}!X{row}"},
    }


def event_id(event: dict) -> str:
    stable = json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "kgmu-" + hashlib.sha256(stable.encode("utf-8")).hexdigest()[:24]


def make_event(*, group: str, date: str, discipline: str, lesson_type: str,
               location: str | None, source_locator: str,
               start: str | None = None, end: str | None = None,
               assessment: dict | None = None, date_only: bool = False) -> dict:
    event = {
        "universityId": "kirov-gmu",
        "groupId": group,
        "academicPeriodId": PERIOD,
        "date": date,
        "startTime": None if date_only else start,
        "endTime": None if date_only else end,
        "timeSemantics": "date-only" if date_only else "floating",
        "discipline": discipline,
        "lessonType": lesson_type,
        "teacher": None,
        "location": location,
        "sourceRef": {"sourceId": SOURCE_ID, "locator": source_locator},
    }
    if assessment is not None:
        event["assessment"] = assessment
    return {"eventId": event_id(event), **event}


def main() -> None:
    probe = json.loads(PROBE_PATH.read_text(encoding="utf-8"))
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    source = probe["source"]
    if source["sha256"] != SOURCE_SHA256:
        raise SystemExit(f"official source hash changed: {source['sha256']}")
    if source.get("groups") != EXPECTED_GROUPS:
        raise SystemExit(f"source group scope mismatch: {source.get('groups')}")
    if len(source["sheets"]) != 1:
        raise SystemExit("Dentistry course 4 source must contain exactly one worksheet")

    dentistry = next(program for program in catalog["programs"] if program["programId"] == "dentistry")
    catalog_groups = next(course["groupIds"] for course in dentistry["courses"] if course["course"] == 4)
    if catalog_groups != EXPECTED_GROUPS:
        raise SystemExit(f"catalog group scope mismatch: {catalog_groups}")

    sheet = source["sheets"][0]
    sheet_name = sheet["title"]
    cells = {entry["coord"]: entry["value"] for entry in sheet["nonEmptyCells"]}
    merged = [parse_range(value) for value in sheet["mergedRanges"]]
    merged_by_start = {entry["start"]: entry for entry in merged}

    month_meta = {
        "Сентябрь": (2026, 9), "Октябрь": (2026, 10), "Ноябрь": (2026, 11),
        "Декабрь": (2026, 12), "Январь": (2027, 1),
    }
    month_spans = []
    for coord, value in cells.items():
        column, row = parse_coord(coord)
        if row == 11 and value in month_meta and coord in merged_by_start:
            rng = merged_by_start[coord]
            year, month = month_meta[value]
            month_spans.append((rng["startColumn"], rng["endColumn"], year, month))

    date_by_column: dict[int, str] = {}
    for coord, value in cells.items():
        column, row = parse_coord(coord)
        if row != 12 or not str(value).isdigit():
            continue
        month = next((entry for entry in month_spans if entry[0] <= column <= entry[1]), None)
        if month is None:
            raise SystemExit(f"no month span for {coord}")
        date_by_column[column] = dt.date(month[2], month[3], int(value)).isoformat()

    group_rows = {}
    for coord, value in cells.items():
        column, row = parse_coord(coord)
        if column == 2 and value in EXPECTED_GROUPS:
            group_rows[row] = value
    if sorted(group_rows.values()) != EXPECTED_GROUPS:
        raise SystemExit(f"group rows mismatch: {group_rows}")

    lower_row_by_grid_label = {
        "Хирургическая стоматология": 22,
        "Терапевтическая стоматология": 23,
        "Детская стоматология": 24,
        "Ортопедическая стоматология": 25,
        "Отбеливание зубов/ Худ. реставр зубов": 26,
        "Неврология": 27,
        "Офтальмология": 28,
        "Педиатрия": 29,
        "Инф. болезни": 30,
        "Оториноларингология": 31,
        "Общая хирургия, хирургические болезни": 32,
        "Менеджмент в здравоохранении": 33,
    }

    def lower_reference(row: int) -> dict:
        discipline = compact(cells.get(f"C{row}"))
        assessment_label = compact(cells.get(f"X{row}"))
        if row == 30 and not assessment_label:
            assessment_label = compact(cells.get("X29"))
        base = compact(cells.get(f"AS{row}"))
        address = compact(cells.get(f"BW{row}"))
        location = ", ".join(part for part in [base, address] if part) or None
        return {
            "discipline": discipline,
            "assessment": assessment_from_label(assessment_label, 29 if row == 30 else row, sheet_name),
            "location": location,
            "timeText": compact(cells.get(f"CE{row}")),
        }

    events = []
    unresolved = []
    source_blocks = []

    # C01/C08: one event per explicit calendar date in each group-local horizontal cycle block.
    for rng in merged:
        if rng["startRow"] not in group_rows or rng["endRow"] != rng["startRow"]:
            continue
        if rng["startColumn"] < column_number("C") or rng["startColumn"] >= column_number("DD"):
            continue
        source_label = compact(cells.get(rng["start"]))
        if not source_label:
            continue
        row = lower_row_by_grid_label.get(source_label)
        if row is None:
            raise SystemExit(f"unmapped source block {rng['start']}: {source_label}")
        ref = lower_reference(row)
        dates = [date_by_column[column] for column in range(rng["startColumn"], rng["endColumn"] + 1) if column in date_by_column]
        source_blocks.append({"locator": rng["start"], "groupId": group_rows[rng["startRow"]], "label": source_label, "dates": dates})
        if source_label == "Оториноларингология":
            unresolved.append({
                "rule": "C20",
                "locator": rng["start"],
                "groupId": group_rows[rng["startRow"]],
                "dates": dates,
                "sourceTimeText": ref["timeText"],
                "reason": "Source says one day is 09:00-12:55 but does not identify which date; C20 forbids guessing.",
            })
            continue
        start, end = parse_simple_time_range(ref["timeText"])
        for date in dates:
            events.append(make_event(
                group=group_rows[rng["startRow"]], date=date,
                discipline=ref["discipline"], lesson_type="practice",
                location=ref["location"], source_locator=f"{sheet_name}!{rng['start']}",
                start=start, end=end, assessment=ref["assessment"],
            ))

    if len(source_blocks) != 48:
        raise SystemExit(f"expected 48 group-local source blocks, got {len(source_blocks)}")
    if len(unresolved) != 4 or sum(len(item["dates"]) for item in unresolved) != 32:
        raise SystemExit(f"unexpected C20 scope: {unresolved}")

    # Common January management block: explicit source dates + lower-table time/place.
    management_range = merged_by_start.get("DD14")
    if management_range is None or management_range["endRow"] != 17:
        raise SystemExit("missing common DD14 management block")
    management = lower_reference(33)
    management_dates = [date_by_column[column] for column in range(management_range["startColumn"], management_range["endColumn"] + 1) if column in date_by_column]
    if management_dates != ["2027-01-12"]:
        raise SystemExit(f"unexpected common management dates: {management_dates}")
    management_start, management_end = parse_simple_time_range(management["timeText"])
    for group in EXPECTED_GROUPS:
        for date in management_dates:
            events.append(make_event(
                group=group, date=date, discipline=management["discipline"], lesson_type="practice",
                location=management["location"], source_locator=f"{sheet_name}!DD14",
                start=management_start, end=management_end, assessment=management["assessment"],
            ))

    # C07/C14: generic exam period is a service block, not synthetic events.
    exam_range = merged_by_start.get("DF14")
    exam_dates = [date_by_column[column] for column in range(exam_range["startColumn"], exam_range["endColumn"] + 1) if column in date_by_column]
    if exam_dates != ["2027-01-13", "2027-01-14", "2027-01-15", "2027-01-16"]:
        raise SystemExit(f"unexpected exam service dates: {exam_dates}")

    # Explicit all-groups practice period. Time/place are absent, so preserve as date-only rather than inventing them.
    practice_range = merged_by_start.get("DJ14")
    if practice_range is None or practice_range["endRow"] != 17:
        raise SystemExit("missing common DJ14 practice block")
    practice_dates = [date_by_column[column] for column in range(practice_range["startColumn"], practice_range["endColumn"] + 1) if column in date_by_column]
    if len(practice_dates) != 12 or practice_dates[0] != "2027-01-18" or practice_dates[-1] != "2027-01-30":
        raise SystemExit(f"unexpected practice dates: {practice_dates}")
    for group in EXPECTED_GROUPS:
        for date in practice_dates:
            events.append(make_event(
                group=group, date=date, discipline="Практика", lesson_type="practice",
                location=None, source_locator=f"{sheet_name}!DJ14", date_only=True,
            ))

    # C12: lower reference contains an independent physical-culture schedule for all workbook groups.
    physical = lower_reference(34)
    physical_text = physical["timeText"]
    expected_physical_text = "пятница 05.09-25.12.2026 14.30-16.00 доп. 18.12, 25.12 16.10-17.40"
    if physical_text != expected_physical_text:
        raise SystemExit(f"physical-culture source text changed: {physical_text}")
    period_start = dt.date(2026, 9, 5)
    period_end = dt.date(2026, 12, 25)
    regular_dates = []
    current = period_start
    while current <= period_end:
        if current.weekday() == 4:  # Friday; 05.09 is a range boundary, not an asserted occurrence.
            regular_dates.append(current.isoformat())
        current += dt.timedelta(days=1)
    if regular_dates[0] != "2026-09-11" or regular_dates[-1] != "2026-12-25" or len(regular_dates) != 16:
        raise SystemExit(f"unexpected Friday expansion: {regular_dates}")
    for group in EXPECTED_GROUPS:
        for date in regular_dates:
            events.append(make_event(
                group=group, date=date, discipline=physical["discipline"], lesson_type="practice",
                location=physical["location"], source_locator=f"{sheet_name}!CE34",
                start="14:30", end="16:00",
            ))
        for date in ["2026-12-18", "2026-12-25"]:
            events.append(make_event(
                group=group, date=date, discipline=physical["discipline"], lesson_type="practice",
                location=physical["location"], source_locator=f"{sheet_name}!CE34#additional",
                start="16:10", end="17:40",
            ))

    events.sort(key=lambda event: (
        event["groupId"], event["date"], event["startTime"] or "99:99",
        event["discipline"], event["sourceRef"]["locator"],
    ))
    if len(events) != 511:
        raise SystemExit(f"resolved event count mismatch: {len(events)}")
    counts_by_group = {group: sum(event["groupId"] == group for event in events) for group in EXPECTED_GROUPS}
    if counts_by_group != {"491": 128, "492": 128, "493": 128, "494": 127}:
        raise SystemExit(f"group event counts mismatch: {counts_by_group}")
    ids = [event["eventId"] for event in events]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate normalized event ids")

    # Timed overlap audit for the safe/resolved portion.
    overlap_count = 0
    by_group_date: dict[tuple[str, str], list[dict]] = {}
    for event in events:
        if event["timeSemantics"] != "floating":
            continue
        by_group_date.setdefault((event["groupId"], event["date"]), []).append(event)
    for day_events in by_group_date.values():
        ordered = sorted(day_events, key=lambda event: event["startTime"])
        for left, right in zip(ordered, ordered[1:]):
            if left["endTime"] > right["startTime"]:
                overlap_count += 1
    if overlap_count != 0:
        raise SystemExit(f"unexpected resolved timed overlaps: {overlap_count}")

    candidate_payload = json.dumps(events, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    candidate_digest = "sha256:" + hashlib.sha256(candidate_payload.encode("utf-8")).hexdigest()

    source_artifact = {
        "schema": "kgmu-source-artifact-evidence-v1",
        "sourceArtifactId": SOURCE_ARTIFACT_ID,
        "universityId": "kirov-gmu",
        "academicPeriodId": PERIOD,
        "sourceId": SOURCE_ID,
        "originUrl": source["url"],
        "sha256": SOURCE_SHA256,
        "byteLength": source["byteLength"],
        "mediaType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "sourceObjectKey": SOURCE_OBJECT_KEY,
        "expectedGroupIds": EXPECTED_GROUPS,
        "evidence": {"mechanicalProbeFile": str(PROBE_PATH.relative_to(ROOT))},
        "productionObjectStorageWritePerformed": False,
        "publicationPerformed": False,
    }
    parsing_job = {
        "jobId": PARSING_JOB_ID,
        "universityId": "kirov-gmu",
        "academicPeriodId": PERIOD,
        "sourceId": SOURCE_ID,
        "sourceArtifactId": SOURCE_ARTIFACT_ID,
        "sourceObjectKey": SOURCE_OBJECT_KEY,
        "sourceSha256": SOURCE_SHA256,
        "parserProfile": "cyclic",
        "parserRulesVersion": PARSER_RULES_VERSION,
        "expectedGroupIds": EXPECTED_GROUPS,
        "idempotencyKey": f"kirov-gmu:{PERIOD}:dentistry:course4:{SOURCE_SHA256}:{PARSER_RULES_VERSION}",
        "publicationRequested": False,
    }
    parsing_result = {
        "schema": "kgmu-parsing-result-v1",
        "jobId": PARSING_JOB_ID,
        "sourceArtifactId": SOURCE_ARTIFACT_ID,
        "sourceSha256": SOURCE_SHA256,
        "parserProfile": "cyclic",
        "parserRulesVersion": PARSER_RULES_VERSION,
        "status": "REVIEW_REQUIRED",
        "expectedGroupIds": EXPECTED_GROUPS,
        "sheetName": sheet_name,
        "logicalSourceBlockCount": 52,
        "groupLocalCycleBlockCount": 48,
        "eventBearingOccurrenceCount": 543,
        "resolvedOccurrenceCount": 511,
        "unresolvedOccurrenceCount": 32,
        "excludedServiceOccurrenceCount": 16,
        "diagnostics": unresolved,
        "serviceBlocks": [{"rule": "C07/C14", "locator": "DF14", "label": "экзамены", "dates": exam_dates}],
    }
    normalized_draft = {
        "schema": "kgmu-normalized-draft-v1",
        "draftId": DRAFT_ID,
        "parsingJobId": PARSING_JOB_ID,
        "sourceArtifactId": SOURCE_ARTIFACT_ID,
        "sourceSha256": SOURCE_SHA256,
        "parserProfile": "cyclic",
        "parserRulesVersion": PARSER_RULES_VERSION,
        "status": "REVIEW_REQUIRED",
        "coverage": "safe-resolved-subset",
        "candidateDigest": candidate_digest,
        "eventCount": len(events),
        "unresolvedEventOccurrenceCount": 32,
        "expectedGroupIds": EXPECTED_GROUPS,
        "eventCountsByGroup": counts_by_group,
        "events": events,
    }
    semantic_review = {
        "schema": "kgmu-semantic-review-v1",
        "sourceSha256": SOURCE_SHA256,
        "status": "REVIEW_REQUIRED",
        "parserProfile": "C",
        "sourceScope": {"program": "dentistry", "course": 4, "groupIds": EXPECTED_GROUPS},
        "ruleApplications": [
            {"rule": "C01/C08", "result": "PASS", "detail": "44 unambiguous group-local cycle blocks normalized from explicit calendar dates and lower reference rows."},
            {"rule": "C07/C14", "result": "PASS", "detail": "Generic 13-16 January exam period retained as service metadata only; no synthetic events."},
            {"rule": "C12", "result": "PASS", "detail": "Physical-culture lower-table schedule expanded to Fridays within 05.09-25.12.2026; 18.12 and 25.12 include explicit additional 16:10-17:40 sessions."},
            {"rule": "date-only contract", "result": "PASS", "detail": "Explicit all-groups Practice block 18-30 January retained as date-only events because source gives dates but no time/location."},
            {"rule": "C20", "result": "REVIEW_REQUIRED", "detail": "Each of four Otorhinolaryngology blocks has one unspecified 09:00-12:55 day; source does not identify its date."},
        ],
        "unresolved": unresolved,
        "publishEligible": False,
    }
    qa_report = {
        "schema": "kgmu-qa-report-v1",
        "sourceSha256": SOURCE_SHA256,
        "draftId": DRAFT_ID,
        "status": "REVIEW_REQUIRED",
        "publishEligible": False,
        "checks": [
            {"name": "official-source-hash", "status": "PASS", "detail": SOURCE_SHA256},
            {"name": "group-scope", "status": "PASS", "detail": EXPECTED_GROUPS},
            {"name": "parser-profile", "status": "PASS", "detail": "cyclic/C"},
            {"name": "logical-source-accounting", "status": "PASS", "detail": "52 logical blocks accounted for; exam service block intentionally excluded from events."},
            {"name": "safe-normalized-events", "status": "PASS", "detail": {"eventCount": 511, "byGroup": counts_by_group}},
            {"name": "date-only-practice", "status": "PASS", "detail": "48 date-only Practice events across groups 491-494."},
            {"name": "physical-culture-independent-schedule", "status": "PASS", "detail": "72 events across groups 491-494."},
            {"name": "duplicates", "status": "PASS", "detail": 0},
            {"name": "resolved-timed-overlaps", "status": "PASS", "detail": overlap_count},
            {"name": "C20-otorhinolaryngology-one-day-exception", "status": "REVIEW_REQUIRED", "detail": "32 occurrences across four blocks cannot be finalized until the one 09:00-12:55 date in each block is known."},
        ],
        "blockers": [
            "C20: the official XLSX states that one Otorhinolaryngology day is 09:00-12:55, but does not identify the date for any of groups 491-494. Canonical rules forbid guessing."
        ],
        "scheduleVersionReady": False,
        "publicationPerformed": False,
    }

    outputs = {
        FIXTURE_DIR / "dentistry-491-494.source-artifact.json": source_artifact,
        FIXTURE_DIR / "dentistry-491-494.parsing-job.json": parsing_job,
        QA_DIR / "dentistry-491-494.parsing-result.json": parsing_result,
        QA_DIR / "dentistry-491-494.normalized-draft.partial.json": normalized_draft,
        QA_DIR / "dentistry-491-494.semantic-review.json": semantic_review,
        QA_DIR / "dentistry-491-494.qa-report.json": qa_report,
    }
    for path, payload in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "status": "REVIEW_REQUIRED",
        "sourceSha256": SOURCE_SHA256,
        "groups": EXPECTED_GROUPS,
        "resolvedEvents": len(events),
        "unresolvedOccurrences": 32,
        "eventCountsByGroup": counts_by_group,
        "candidateDigest": candidate_digest,
        "publicationPerformed": False,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()