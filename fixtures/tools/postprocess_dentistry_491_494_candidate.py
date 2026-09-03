#!/usr/bin/env python3
"""Apply confirmed course-local semantic decisions for KGMU Dentistry course 4."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERIOD = "2026-2027-semester-1"
QA = ROOT / "qa" / PERIOD
FIXTURES = ROOT / "fixtures" / PERIOD
DRAFT_IN = QA / "dentistry-491-494.normalized-draft.partial.json"
DRAFT_OUT = QA / "dentistry-491-494.normalized-draft.json"
PARSING_RESULT = QA / "dentistry-491-494.parsing-result.json"
SEMANTIC_REVIEW = QA / "dentistry-491-494.semantic-review.json"
QA_REPORT = QA / "dentistry-491-494.qa-report.json"
PROBE = QA / "dentistry-494.source-probe.json"
DECISIONS = FIXTURES / "dentistry-491-494.user-decisions.json"
GROUPS = ["491", "492", "493", "494"]
EXPECTED_DIGEST = "sha256:73cb833fb0f175a449e488c0125153e94f5528f5eebd0d46f5dab7719341ac15"
EXPECTED_COUNTS = {"491": 133, "492": 133, "493": 133, "494": 132}
REPLACEMENT_DATES = {"2026-12-18", "2026-12-25"}
PE_CONFLICT_DATES = {
    "491": {"2026-09-25"},
    "492": {"2026-10-09"},
    "493": {"2026-09-18"},
    "494": {"2026-11-27"},
}


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def compact(value: str | None) -> str:
    return " ".join((value or "").split())


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
        "timeSemantics": "date-only" if date_only else "floating",
        "discipline": discipline,
        "lessonType": lesson_type,
        "teacher": None,
        "location": location,
        "sourceRef": {"sourceId": "dentistry", "locator": source_locator},
    }
    if not date_only:
        event["startTime"] = start
        event["endTime"] = end
    if assessment is not None:
        event["assessment"] = assessment
    return {"eventId": event_id(event), **event}


def digest(events):
    payload = json.dumps(events, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def timed_overlap_count(events):
    def minutes(value: str) -> int:
        return int(value[:2]) * 60 + int(value[3:])

    by_day = {}
    for event in events:
        if event["timeSemantics"] != "floating":
            continue
        by_day.setdefault((event["groupId"], event["date"]), []).append(event)
    overlaps = 0
    for day_events in by_day.values():
        ordered = sorted(day_events, key=lambda event: event["startTime"])
        for left, right in zip(ordered, ordered[1:]):
            if minutes(left["endTime"]) > minutes(right["startTime"]):
                overlaps += 1
    return overlaps


def main():
    draft = read(DRAFT_IN)
    parsing = read(PARSING_RESULT)
    review = read(SEMANTIC_REVIEW)
    qa = read(QA_REPORT)
    probe = read(PROBE)
    decisions = read(DECISIONS)

    if decisions.get("provenance") != "direct-user-confirmation" or decisions.get("confirmedOn") != "2026-09-03":
        raise SystemExit("course-4 direct user decisions are missing")
    by_id = {item["id"]: item for item in decisions["decisions"]}
    if by_id["ent-last-day-long"]["exceptionPlacement"] != "last-date-of-each-group-cycle":
        raise SystemExit("ENT decision changed")
    pe_decision = by_id["pe-friday-series-with-replacements-and-conflict-exclusions"]
    if set(pe_decision["replacementDates"]) != REPLACEMENT_DATES:
        raise SystemExit("PE replacement dates changed")
    if {group: set(dates) for group, dates in pe_decision["excludeBaseDatesByGroup"].items()} != PE_CONFLICT_DATES:
        raise SystemExit("PE conflict exclusions changed")
    if by_id["january-practice-all-day"]["timeSemantics"] != "date-only":
        raise SystemExit("Practice all-day decision changed")

    source_events = draft["events"]
    if len(source_events) != 511:
        raise SystemExit(f"expected pre-postprocessing 511 events, got {len(source_events)}")

    # Keep the source-explicit all-day Practice block. For PE, the user confirmed a
    # Friday recurrence, explicit 18/25 Dec replacement times, and omission of PE
    # on four group-specific ophthalmology conflict dates.
    removed_pe_replacements = []
    removed_pe_conflicts = []
    events = []
    for event in source_events:
        is_pe_base = (
            event["discipline"].startswith("Дисциплины по физической культуре")
            and event.get("startTime") == "14:30" and event.get("endTime") == "16:00"
            and event["sourceRef"]["locator"].endswith("!CE34")
        )
        if is_pe_base and event["date"] in REPLACEMENT_DATES:
            removed_pe_replacements.append(event)
            continue
        if is_pe_base and event["date"] in PE_CONFLICT_DATES[event["groupId"]]:
            removed_pe_conflicts.append(event)
            continue
        events.append(event)
    if len(removed_pe_replacements) != 8:
        raise SystemExit(f"expected 8 superseded PE base events, got {len(removed_pe_replacements)}")
    if len(removed_pe_conflicts) != 4:
        raise SystemExit(f"expected 4 conflict PE omissions, got {len(removed_pe_conflicts)}")

    # Resolve C20 by direct user confirmation: the last date of each ENT cycle is
    # the one that ends at 12:55; all preceding dates end at 12:05.
    sheet = probe["source"]["sheets"][0]
    sheet_name = sheet["title"]
    cells = {entry["coord"]: entry["value"] for entry in sheet["nonEmptyCells"]}
    if compact(cells.get("CE31")) != "9:00-12:05, один день 9:00-12:55":
        raise SystemExit("ENT source time text changed")
    ent_location = ", ".join(part for part in [compact(cells.get("AS31")), compact(cells.get("BW31"))] if part)
    ent_assessment = {
        "type": "credit",
        "label": compact(cells.get("X31")),
        "sourceRef": {"sourceId": "dentistry", "locator": f"{sheet_name}!X31"},
    }
    ent_diagnostics = [item for item in parsing.get("diagnostics", []) if item.get("rule") == "C20"]
    if len(ent_diagnostics) != 4 or sum(len(item["dates"]) for item in ent_diagnostics) != 32:
        raise SystemExit("unexpected ENT C20 scope")
    for item in ent_diagnostics:
        for index, date in enumerate(item["dates"]):
            events.append(make_event(
                group=item["groupId"],
                date=date,
                discipline=compact(cells.get("C31")),
                lesson_type="practice",
                location=ent_location,
                source_locator=f"{sheet_name}!{item['locator']}",
                start="09:00",
                end="12:55" if index == len(item["dates"]) - 1 else "12:05",
                assessment=ent_assessment,
            ))

    events.sort(key=lambda event: (
        event["groupId"], event["date"], event.get("startTime") or "99:99",
        event["discipline"], event["sourceRef"]["locator"],
    ))
    counts = dict(Counter(event["groupId"] for event in events))
    if len(events) != 531 or counts != EXPECTED_COUNTS:
        raise SystemExit(f"resolved candidate mismatch: {len(events)} {counts}")

    practice = [event for event in events if event["discipline"] == "Практика"]
    if len(practice) != 48 or not all(
        event["timeSemantics"] == "date-only"
        and "startTime" not in event
        and "endTime" not in event
        for event in practice
    ):
        raise SystemExit("Practice must be 48 all-day/date-only events without time keys")
    ent = [event for event in events if event["discipline"] == "Оториноларингология"]
    if len(ent) != 32:
        raise SystemExit("expected 32 ENT events")
    for group in GROUPS:
        group_ent = sorted((event for event in ent if event["groupId"] == group), key=lambda event: event["date"])
        if len(group_ent) != 8 or group_ent[-1]["endTime"] != "12:55" or any(event["endTime"] != "12:05" for event in group_ent[:-1]):
            raise SystemExit(f"ENT last-day decision not preserved for {group}")

    pe = [event for event in events if event["discipline"].startswith("Дисциплины по физической культуре")]
    pe_base = [event for event in pe if event.get("startTime") == "14:30"]
    pe_extra = [event for event in pe if event.get("startTime") == "16:10"]
    if len(pe_base) != 52 or len(pe_extra) != 8:
        raise SystemExit(f"unexpected PE counts: base={len(pe_base)} extra={len(pe_extra)}")
    if any(event["date"] in REPLACEMENT_DATES for event in pe_base):
        raise SystemExit("PE replacement date still has the base-time event")
    if any(event["date"] in PE_CONFLICT_DATES[event["groupId"]] for event in pe):
        raise SystemExit("PE leaked into an explicitly excluded conflict date")

    signatures = [(
        event["groupId"], event["date"], event.get("startTime"), event.get("endTime"),
        event["discipline"], event["lessonType"], event.get("location"),
    ) for event in events]
    duplicate_count = len(signatures) - len(set(signatures))
    overlap_count = timed_overlap_count(events)
    if duplicate_count != 0 or overlap_count != 0:
        raise SystemExit(f"final QA mismatch: duplicates={duplicate_count}, overlaps={overlap_count}")

    candidate_digest = digest(events)
    if candidate_digest != EXPECTED_DIGEST:
        raise SystemExit(f"candidate digest changed: {candidate_digest}")

    parsing.update({
        "status": "PASS",
        "resolvedOccurrenceCount": 531,
        "unresolvedOccurrenceCount": 0,
        "excludedByDecisionOccurrenceCount": 12,
        "diagnostics": [],
        "warnings": [],
        "postprocessing": {
            "mode": "course-local-user-resolved",
            "decisionFixture": str(DECISIONS.relative_to(ROOT)),
            "resolvedEntEvents": 32,
            "retainedPracticeAllDayEvents": 48,
            "retainedPeBaseEvents": 52,
            "supersededPeBaseEvents": 8,
            "omittedPeConflictEvents": 4,
            "retainedExplicitPeReplacementEvents": 8,
            "commonParserChanged": False,
        },
    })

    draft.update({
        "status": "PASS",
        "coverage": "user-resolved-source-bound-candidate",
        "candidateDigest": candidate_digest,
        "eventCount": 531,
        "unresolvedEventOccurrenceCount": 0,
        "eventCountsByGroup": counts,
        "reviewRequiredClassCount": 0,
        "events": events,
    })

    review.update({
        "status": "PASS",
        "ruleApplications": [
            {"rule": "C01/C08", "result": "PASS", "detail": "Unambiguous group-local source cycles remain source-bound."},
            {"rule": "C07/C14", "result": "PASS", "detail": "13-16 January exam period remains service metadata only; no synthetic events."},
            {"rule": "C01/G11/G12/G14", "result": "PASS", "detail": "Shared Management block on 12 January remains four timed events."},
            {"rule": "direct-user-confirmation/C20", "result": "PASS", "detail": "For each ENT cycle, the final source date is 09:00-12:55; preceding dates are 09:00-12:05."},
            {"rule": "direct-user-confirmation/G04/G21/C12", "result": "PASS", "detail": "PE recurs on Fridays; 18.12 and 25.12 replace base time with 16:10-17:40; PE is omitted on four confirmed ophthalmology-conflict dates."},
            {"rule": "direct-user-confirmation/G21", "result": "PASS", "detail": "Shared Practice 18-30 January is retained as source-date all-day/date-only events."},
        ],
        "unresolved": [],
        "publishEligible": True,
        "finalDeterministicEventCount": 531,
        "reviewRequiredClassCount": 0,
        "decisionFixture": str(DECISIONS.relative_to(ROOT)),
    })

    qa.update({
        "status": "PASS",
        "candidateDigest": candidate_digest,
        "publishEligible": True,
        "checks": [
            {"name": "official-source-hash", "status": "PASS", "detail": parsing["sourceSha256"]},
            {"name": "group-scope", "status": "PASS", "detail": GROUPS},
            {"name": "parser-profile", "status": "PASS", "detail": "existing cyclic/C; no common parser/core modification"},
            {"name": "normalized-events", "status": "PASS", "detail": {"eventCount": 531, "byGroup": counts}},
            {"name": "ENT-last-day-exception", "status": "PASS", "detail": "32 events; last date of each group cycle ends 12:55."},
            {"name": "PE-series", "status": "PASS", "detail": "52 base Friday events + 8 replacement-time events; 4 conflict dates omitted."},
            {"name": "January-Practice", "status": "PASS", "detail": "48 all-day/date-only events."},
            {"name": "duplicates", "status": "PASS", "detail": 0},
            {"name": "timed-overlaps", "status": "PASS", "detail": 0},
        ],
        "blockers": [],
        "scheduleVersionReady": True,
        "publicationPerformed": False,
        "decisionFixture": str(DECISIONS.relative_to(ROOT)),
    })

    write(PARSING_RESULT, parsing)
    write(DRAFT_OUT, draft)
    write(SEMANTIC_REVIEW, review)
    write(QA_REPORT, qa)
    print(json.dumps({
        "status": "PASS",
        "eventCount": 531,
        "eventCountsByGroup": counts,
        "candidateDigest": candidate_digest,
        "reviewRequiredClasses": 0,
        "scheduleVersionReady": True,
        "publicationPerformed": False,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
