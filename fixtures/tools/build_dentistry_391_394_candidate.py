#!/usr/bin/env python3
"""Build the safe normalized candidate for KGMU Dentistry course 3 (groups 391-394).

This builder consumes only the committed mechanical source probe. It applies the
canonical cyclic profile to facts that are unambiguous. Source-specific rule C21
is deliberately NOT applied because it names a different historical XLSX. The
current 2026/27 source therefore remains fail-closed under C20 for cycle-time
exceptions that specify only a number of days without identifying their dates.

No production storage, database, ScheduleVersion or publication operation is
performed by this script.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERIOD = "2026-2027-semester-1"
PROBE_PATH = ROOT / "fixtures" / PERIOD / "dentistry-391-394.source-probe.json"
CATALOG_PATH = ROOT / "catalog" / "2026-2027-semester-1.json"
FIXTURE_DIR = ROOT / "fixtures" / PERIOD
QA_DIR = ROOT / "qa" / PERIOD
SOURCE_SHA256 = "82fcb873776634553f9dcc5bf3da581654d59f4ef10db5ad6a779aa6d53f950d"
EXPECTED_GROUPS = ["391", "392", "393", "394"]
PARSER_RULES_VERSION = "kgmu-2026-08-30-v4"
SOURCE_ID = "dentistry"
SOURCE_ARTIFACT_ID = f"source-artifact-dentistry-391-394-{SOURCE_SHA256[:16]}"
PARSING_JOB_ID = f"parsing-job-dentistry-391-394-{SOURCE_SHA256[:16]}-v1"
DRAFT_ID = f"normalized-draft-dentistry-391-394-{SOURCE_SHA256[:16]}-v1"
SOURCE_OBJECT_KEY = f"qa-source-artifacts/kirov-gmu/{PERIOD}/dentistry-391-394/{SOURCE_SHA256}.xlsx"
CURRENT_SOURCE_BASENAME = "3_stomat-24-08-2026-14.xlsx"
C21_SOURCE_BASENAME = "3_kurs_stomatologicheskiy_fakultet-19-01-2026-15.xlsx"


def compact(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def column_number(name: str) -> int:
    value = 0
    for char in name:
        value = value * 26 + ord(char) - 64
    return value


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
        "sourceRef": {"sourceId": SOURCE_ID, "locator": f"{sheet_name}!Y{row}"},
    }


def event_id(event: dict) -> str:
    stable = json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "kgmu-" + hashlib.sha256(stable.encode("utf-8")).hexdigest()[:24]


def make_event(*, group: str, date: str, discipline: str, lesson_type: str,
               location: str | None, source_locator: str,
               start: str, end: str, assessment: dict | None = None) -> dict:
    event = {
        "universityId": "kirov-gmu",
        "groupId": group,
        "academicPeriodId": PERIOD,
        "date": date,
        "startTime": start,
        "endTime": end,
        "timeSemantics": "floating",
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
    if not source["url"].endswith("/" + CURRENT_SOURCE_BASENAME):
        raise SystemExit(f"unexpected current source URL: {source['url']}")
    if CURRENT_SOURCE_BASENAME == C21_SOURCE_BASENAME:
        raise SystemExit("C21 guard is invalid: current source unexpectedly equals historical source")
    if len(source["sheets"]) != 1:
        raise SystemExit("Dentistry course 3 source must contain exactly one worksheet")

    dentistry = next(program for program in catalog["programs"] if program["programId"] == "dentistry")
    catalog_groups = next(course["groupIds"] for course in dentistry["courses"] if course["course"] == 3)
    if catalog_groups != EXPECTED_GROUPS:
        raise SystemExit(f"catalog group scope mismatch: {catalog_groups}")

    sheet = source["sheets"][0]
    sheet_name = sheet["title"]
    cells = {entry["coord"]: compact(entry["value"]) for entry in sheet["nonEmptyCells"]}
    merged = [parse_range(value) for value in sheet["mergedRanges"]]
    merged_by_start = {entry["start"]: entry for entry in merged}

    # Calendar grid: month row 10, concrete date row 11.
    month_meta = {
        "Сентябрь": (2026, 9), "Октябрь": (2026, 10), "Ноябрь": (2026, 11),
        "Декабрь": (2026, 12), "Январь": (2027, 1),
    }
    month_spans = []
    for coord, value in cells.items():
        _column, row = parse_coord(coord)
        if row == 10 and value in month_meta and coord in merged_by_start:
            rng = merged_by_start[coord]
            year, month = month_meta[value]
            month_spans.append((rng["startColumn"], rng["endColumn"], year, month))
    if len(month_spans) != 5:
        raise SystemExit(f"expected five month spans, got {month_spans}")

    date_by_column: dict[int, str] = {}
    for coord, value in cells.items():
        column, row = parse_coord(coord)
        if row != 11 or not value.isdigit():
            continue
        month = next((entry for entry in month_spans if entry[0] <= column <= entry[1]), None)
        if month is None:
            raise SystemExit(f"no month span for {coord}")
        date_by_column[column] = dt.date(month[2], month[3], int(value)).isoformat()
    if not date_by_column:
        raise SystemExit("no explicit calendar dates found")

    group_rows = {}
    for coord, value in cells.items():
        column, row = parse_coord(coord)
        if column == 2 and value in EXPECTED_GROUPS:
            group_rows[row] = value
    if sorted(group_rows.values()) != EXPECTED_GROUPS:
        raise SystemExit(f"group rows mismatch: {group_rows}")

    # The upper grid uses several abbreviations; C08 maps them to the lower-table full names.
    lower_row_by_grid_label = {
        "Хирургическая стоматология": 20,
        "Терапевтическая стоматология": 21,
        "Профилактика и коммунальная стоматология": 22,
        "Ортопедическая стоматология": 23,
        "Философия": 24,
        "Биоэтика": 25,
        "Фармакология": 26,
        "Лучевая диагностика": 27,
        "Внутренние болезни, клиническая фармакология": 28,
        "Акушерство": 29,
        "Общая хирургия, хирургич. болезни": 30,
        "ИОК врача-стоматолога": 31,
        "Физическая подготовка": 32,
    }

    def lower_reference(row: int) -> dict:
        discipline = compact(cells.get(f"D{row}"))
        assessment_label = compact(cells.get(f"Y{row}"))
        base = compact(cells.get(f"AT{row}"))
        address = compact(cells.get(f"BX{row}"))
        location = ", ".join(part for part in [base, address] if part) or None
        return {
            "discipline": discipline,
            "assessment": assessment_from_label(assessment_label, row, sheet_name),
            "location": location,
            "timeText": compact(cells.get(f"CF{row}")),
            "adjacentTimeNote": compact(cells.get(f"CK{row}")),
        }

    events = []
    unresolved = []
    source_blocks = []
    unresolved_by_kind = {"philosophy": 0, "obstetrics": 0, "iok": 0}

    # C01/C08 + C20. One upper-grid merged block becomes one event per explicit date.
    for rng in merged:
        if rng["startRow"] not in group_rows or rng["endRow"] != rng["startRow"]:
            continue
        if rng["startColumn"] < column_number("C") or rng["startColumn"] >= column_number("DM"):
            continue
        source_label = compact(cells.get(rng["start"]))
        if not source_label:
            continue
        lower_row = lower_row_by_grid_label.get(source_label)
        if lower_row is None:
            raise SystemExit(f"unmapped source block {rng['start']}: {source_label}")
        ref = lower_reference(lower_row)
        dates = [
            date_by_column[column]
            for column in range(rng["startColumn"], rng["endColumn"] + 1)
            if column in date_by_column
        ]
        if not dates:
            raise SystemExit(f"source block has no explicit dates: {rng['start']}")
        source_blocks.append({
            "locator": rng["start"], "groupId": group_rows[rng["startRow"]],
            "label": source_label, "normalizedDiscipline": ref["discipline"], "dates": dates,
        })

        ambiguity_kind = None
        reason = None
        if lower_row == 24 and ref["adjacentTimeNote"]:
            ambiguity_kind = "philosophy"
            reason = (
                f"Source gives base time '{ref['timeText']}' plus '{ref['adjacentTimeNote']}' "
                "without identifying the calendar date or an exact replacement clock interval."
            )
        elif lower_row == 29 and "два дня" in ref["timeText"].lower():
            ambiguity_kind = "obstetrics"
            reason = (
                f"Source gives '{ref['timeText']}' but does not identify which two dates use "
                "the exceptional 09:00-12:55 interval."
            )
        elif lower_row == 31 and "один день" in ref["timeText"].lower():
            ambiguity_kind = "iok"
            reason = (
                f"Source gives '{ref['timeText']}' but does not identify which date uses "
                "the exceptional 09:00-13:40 interval."
            )

        if ambiguity_kind is not None:
            unresolved_by_kind[ambiguity_kind] += 1
            unresolved.append({
                "rule": "C20",
                "c21Applicable": False,
                "c21Reason": f"C21 is source-specific to {C21_SOURCE_BASENAME}, not {CURRENT_SOURCE_BASENAME}.",
                "kind": ambiguity_kind,
                "locator": rng["start"],
                "groupId": group_rows[rng["startRow"]],
                "discipline": ref["discipline"],
                "dates": dates,
                "sourceTimeText": ref["timeText"],
                "sourceAdjacentTimeNote": ref["adjacentTimeNote"] or None,
                "reason": reason,
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

    if len(source_blocks) != 52:
        raise SystemExit(f"expected 52 group-local source blocks, got {len(source_blocks)}")
    if unresolved_by_kind != {"philosophy": 4, "obstetrics": 4, "iok": 4}:
        raise SystemExit(f"unexpected C20 block scope: {unresolved_by_kind}")

    # C07/C14: generic all-groups exam period is service metadata, not synthetic events.
    exam_range = merged_by_start.get("DM13")
    if exam_range is None or exam_range["endRow"] != 16 or compact(cells.get("DM13")) != "Экзамены":
        raise SystemExit("missing common DM13:DT16 exam service block")
    exam_dates = [
        date_by_column[column]
        for column in range(exam_range["startColumn"], exam_range["endColumn"] + 1)
        if column in date_by_column
    ]
    if not exam_dates:
        raise SystemExit("exam service block has no explicit dates")

    # C12: independent physical-culture elective schedule from the lower reference table.
    elective = lower_reference(33)
    elective_text = elective["timeText"]
    expected_elective_text = "вторник 15.10-16.40 01.09.2026-12.01.2027"
    if elective_text != expected_elective_text:
        raise SystemExit(f"physical elective source text changed: {elective_text}")
    elective_match = re.fullmatch(
        r"вторник\s+(\d{1,2}[.:]\d{2})-(\d{1,2}[.:]\d{2})\s+"
        r"(\d{2})\.(\d{2})\.(\d{4})-(\d{2})\.(\d{2})\.(\d{4})",
        elective_text,
        flags=re.IGNORECASE,
    )
    if elective_match is None:
        raise SystemExit(f"cannot parse physical elective schedule: {elective_text}")
    elective_start_time = normalize_clock(elective_match.group(1))
    elective_end_time = normalize_clock(elective_match.group(2))
    period_start = dt.date(int(elective_match.group(5)), int(elective_match.group(4)), int(elective_match.group(3)))
    period_end = dt.date(int(elective_match.group(8)), int(elective_match.group(7)), int(elective_match.group(6)))
    elective_dates = []
    current = period_start
    while current <= period_end:
        if current.weekday() == 1:  # Tuesday
            elective_dates.append(current.isoformat())
        current += dt.timedelta(days=1)
    if len(elective_dates) != 20 or elective_dates[0] != "2026-09-01" or elective_dates[-1] != "2027-01-12":
        raise SystemExit(f"unexpected elective Tuesday expansion: {elective_dates}")
    for group in EXPECTED_GROUPS:
        for date in elective_dates:
            events.append(make_event(
                group=group, date=date, discipline=elective["discipline"], lesson_type="practice",
                location=elective["location"], source_locator=f"{sheet_name}!CF33",
                start=elective_start_time, end=elective_end_time, assessment=elective["assessment"],
            ))

    events.sort(key=lambda event: (
        event["groupId"], event["date"], event["startTime"],
        event["discipline"], event["sourceRef"]["locator"],
    ))
    ids = [event["eventId"] for event in events]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate normalized event ids")

    counts_by_group = {group: sum(event["groupId"] == group for event in events) for group in EXPECTED_GROUPS}
    unresolved_occurrences = sum(len(item["dates"]) for item in unresolved)
    unresolved_by_group = {
        group: sum(len(item["dates"]) for item in unresolved if item["groupId"] == group)
        for group in EXPECTED_GROUPS
    }

    # Resolved timed overlap audit. C13 says explicit source conflicts are preserved, but QA must report them.
    overlaps = []
    by_group_date: dict[tuple[str, str], list[dict]] = {}
    for event in events:
        by_group_date.setdefault((event["groupId"], event["date"]), []).append(event)
    for (group, date), day_events in by_group_date.items():
        ordered = sorted(day_events, key=lambda event: event["startTime"])
        for left, right in zip(ordered, ordered[1:]):
            if left["endTime"] > right["startTime"]:
                overlaps.append({
                    "groupId": group, "date": date,
                    "leftEventId": left["eventId"], "rightEventId": right["eventId"],
                    "left": f"{left['startTime']}-{left['endTime']} {left['discipline']}",
                    "right": f"{right['startTime']}-{right['endTime']} {right['discipline']}",
                })

    candidate_payload = json.dumps(events, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    candidate_digest = "sha256:" + hashlib.sha256(candidate_payload.encode("utf-8")).hexdigest()

    source_config = {
        "schema": "kgmu-source-config-v1",
        "universityId": "kirov-gmu",
        "academicPeriodId": PERIOD,
        "program": "dentistry",
        "course": 3,
        "expectedGroupIds": EXPECTED_GROUPS,
        "originUrl": source["url"],
        "sha256": SOURCE_SHA256,
        "parserProfile": "cyclic",
        "profileLayer": "C",
        "parserRulesVersion": PARSER_RULES_VERSION,
        "idempotency": {"reuseIfShaMatches": True, "sourceArtifactIdentity": "originUrl+sha256"},
        "publicationRequested": False,
    }
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
        "productionDatabaseWritePerformed": False,
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
        "idempotencyKey": f"kirov-gmu:{PERIOD}:dentistry:course3:{SOURCE_SHA256}:{PARSER_RULES_VERSION}",
        "publicationRequested": False,
        "productionDatabaseWritePerformed": False,
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
        "logicalSourceBlockCount": 54,
        "groupLocalCycleBlockCount": len(source_blocks),
        "independentScheduleBlockCount": 1,
        "serviceBlockCount": 1,
        "resolvedOccurrenceCount": len(events),
        "unresolvedOccurrenceCount": unresolved_occurrences,
        "excludedServiceOccurrenceCount": len(exam_dates) * len(EXPECTED_GROUPS),
        "eventBearingOccurrenceCount": len(events) + unresolved_occurrences,
        "diagnostics": unresolved,
        "serviceBlocks": [{"rule": "C07/C14", "locator": "DM13", "label": "Экзамены", "dates": exam_dates}],
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
        "unresolvedEventOccurrenceCount": unresolved_occurrences,
        "expectedGroupIds": EXPECTED_GROUPS,
        "eventCountsByGroup": counts_by_group,
        "unresolvedOccurrencesByGroup": unresolved_by_group,
        "events": events,
    }
    semantic_review = {
        "schema": "kgmu-semantic-review-v1",
        "sourceSha256": SOURCE_SHA256,
        "status": "REVIEW_REQUIRED",
        "parserProfile": "C",
        "sourceScope": {"program": "dentistry", "course": 3, "groupIds": EXPECTED_GROUPS},
        "ruleApplications": [
            {"rule": "C01/C08", "result": "PASS", "detail": "52 group-local merged cycle blocks identified; unambiguous blocks expanded by explicit calendar columns and normalized through the lower reference table."},
            {"rule": "C07/C14", "result": "PASS", "detail": "Common DM13:DT16 exam period retained as service metadata only; no synthetic exam events."},
            {"rule": "C12", "result": "PASS", "detail": f"Independent physical-culture elective schedule expanded to {len(elective_dates)} Tuesdays for each of four groups ({len(elective_dates) * 4} events)."},
            {"rule": "C20", "result": "REVIEW_REQUIRED", "detail": f"12 current-source cycles contain day-count-only time exceptions; {unresolved_occurrences} event occurrences are withheld rather than guessed."},
            {"rule": "C21", "result": "NOT_APPLICABLE", "detail": f"Canonical C21 is explicitly source-specific to {C21_SOURCE_BASENAME}; current source is {CURRENT_SOURCE_BASENAME}."},
        ],
        "unresolved": unresolved,
        "publishEligible": False,
    }
    qa_status = "REVIEW_REQUIRED" if unresolved else ("PASS_WITH_SOURCE_CONFLICTS" if overlaps else "PASS")
    qa_report = {
        "schema": "kgmu-qa-report-v1",
        "sourceSha256": SOURCE_SHA256,
        "draftId": DRAFT_ID,
        "status": qa_status,
        "publishEligible": False,
        "checks": [
            {"name": "official-source-hash", "status": "PASS", "detail": SOURCE_SHA256},
            {"name": "group-scope", "status": "PASS", "detail": EXPECTED_GROUPS},
            {"name": "parser-profile", "status": "PASS", "detail": f"cyclic/C @ {PARSER_RULES_VERSION}"},
            {"name": "idempotent-identities", "status": "PASS", "detail": {"sourceArtifactId": SOURCE_ARTIFACT_ID, "parsingJobId": PARSING_JOB_ID}},
            {"name": "logical-source-accounting", "status": "PASS", "detail": "54 logical blocks: 52 group-local cycles + 1 common exam service block + 1 independent physical-culture elective schedule."},
            {"name": "safe-normalized-events", "status": "PASS", "detail": {"eventCount": len(events), "byGroup": counts_by_group}},
            {"name": "physical-culture-independent-schedule", "status": "PASS", "detail": {"dates": len(elective_dates), "events": len(elective_dates) * 4}},
            {"name": "duplicates", "status": "PASS", "detail": 0},
            {"name": "resolved-timed-overlaps", "status": "PASS" if not overlaps else "SOURCE_CONFLICT", "detail": overlaps},
            {"name": "C20-current-source-time-exceptions", "status": "REVIEW_REQUIRED", "detail": {"blocks": len(unresolved), "occurrences": unresolved_occurrences, "byKind": unresolved_by_kind}},
            {"name": "C21-source-specific-guard", "status": "PASS", "detail": f"C21 not transplanted from {C21_SOURCE_BASENAME} to {CURRENT_SOURCE_BASENAME}."},
            {"name": "production-write-boundary", "status": "PASS", "detail": "No production object-storage write, DB write, ScheduleVersion creation or publication performed."},
        ],
        "blockers": [
            "C20: the current official XLSX contains 12 cycle blocks whose exceptional-time days are specified only by count, not by calendar date. Canonical C21 applies only to a different historical XLSX, so these dates cannot be inferred automatically."
        ],
        "scheduleVersionReady": False,
        "publicationPerformed": False,
    }

    outputs = {
        FIXTURE_DIR / "dentistry-391-394.source.json": source_config,
        FIXTURE_DIR / "dentistry-391-394.source-artifact.json": source_artifact,
        FIXTURE_DIR / "dentistry-391-394.parsing-job.json": parsing_job,
        QA_DIR / "dentistry-391-394.parsing-result.json": parsing_result,
        QA_DIR / "dentistry-391-394.normalized-draft.partial.json": normalized_draft,
        QA_DIR / "dentistry-391-394.semantic-review.json": semantic_review,
        QA_DIR / "dentistry-391-394.qa-report.json": qa_report,
    }
    for path, payload in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "status": qa_status,
        "sourceSha256": SOURCE_SHA256,
        "groups": EXPECTED_GROUPS,
        "groupLocalBlocks": len(source_blocks),
        "resolvedEvents": len(events),
        "unresolvedBlocks": len(unresolved),
        "unresolvedOccurrences": unresolved_occurrences,
        "eventCountsByGroup": counts_by_group,
        "resolvedTimedOverlaps": len(overlaps),
        "candidateDigest": candidate_digest,
        "scheduleVersionReady": False,
        "publicationPerformed": False,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
