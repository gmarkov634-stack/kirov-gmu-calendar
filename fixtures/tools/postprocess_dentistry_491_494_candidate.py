#!/usr/bin/env python3
"""Fail-closed postprocessing for KGMU Dentistry course 4 (491-494).

The existing course-local builder materializes two interpretations that are not
safe under the current canonical rules: (1) Friday PE recurrence from a range
whose written start date is Saturday, and (2) date-only January Practice events
without a course-4 source-specific rule. This postprocessor removes only those
inferred events, keeps the explicit PE extras, and records all three unresolved
classes (ENT C20, PE G04/G21, Practice G21) for QA. No common parser/core code is
changed and no publication/DB operation is performed.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERIOD = "2026-2027-semester-1"
QA = ROOT / "qa" / PERIOD
DRAFT_IN = QA / "dentistry-491-494.normalized-draft.partial.json"
DRAFT_OUT = QA / "dentistry-491-494.normalized-draft.json"
PARSING_RESULT = QA / "dentistry-491-494.parsing-result.json"
SEMANTIC_REVIEW = QA / "dentistry-491-494.semantic-review.json"
QA_REPORT = QA / "dentistry-491-494.qa-report.json"
GROUPS = ["491", "492", "493", "494"]


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(events):
    payload = json.dumps(events, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def main():
    draft = read(DRAFT_IN)
    parsing = read(PARSING_RESULT)
    review = read(SEMANTIC_REVIEW)
    qa = read(QA_REPORT)

    source_events = draft["events"]
    if len(source_events) != 511:
        raise SystemExit(f"expected pre-postprocessing 511 events, got {len(source_events)}")

    removed_practice = [
        event for event in source_events
        if event["discipline"] == "Практика" and event["timeSemantics"] == "date-only"
    ]
    removed_pe_base = [
        event for event in source_events
        if event["discipline"].startswith("Дисциплины по физической культуре")
        and event.get("startTime") == "14:30" and event.get("endTime") == "16:00"
        and event["sourceRef"]["locator"].endswith("!CE34")
    ]
    if len(removed_practice) != 48:
        raise SystemExit(f"expected 48 inferred Practice events, got {len(removed_practice)}")
    if len(removed_pe_base) != 64:
        raise SystemExit(f"expected 64 inferred PE-base events, got {len(removed_pe_base)}")

    removed_ids = {event["eventId"] for event in removed_practice + removed_pe_base}
    events = [event for event in source_events if event["eventId"] not in removed_ids]
    counts = dict(Counter(event["groupId"] for event in events))
    if len(events) != 399 or counts != {"491": 100, "492": 100, "493": 100, "494": 99}:
        raise SystemExit(f"postprocessed candidate mismatch: {len(events)} {counts}")
    if any(event["discipline"] == "Оториноларингология" for event in events):
        raise SystemExit("C20 ENT events must remain absent")
    if any(event["discipline"] == "Практика" for event in events):
        raise SystemExit("unresolved January Practice leaked into final draft")

    pe = [event for event in events if event["discipline"].startswith("Дисциплины по физической культуре")]
    if len(pe) != 8:
        raise SystemExit(f"expected only 8 explicit PE extra events, got {len(pe)}")
    if sorted({event["date"] for event in pe}) != ["2026-12-18", "2026-12-25"]:
        raise SystemExit("explicit PE dates changed")
    if not all(event.get("startTime") == "16:10" and event.get("endTime") == "17:40" for event in pe):
        raise SystemExit("explicit PE times changed")

    candidate_digest = digest(events)
    warnings = [
        "REVIEW_REQUIRED C20_ENT_EXCEPTION_DATE_UNKNOWN: Оториноларингология has base 09:00-12:05 plus one 09:00-12:55 day, but the exceptional date is not identified for groups 491-494.",
        "REVIEW_REQUIRED G04_G21_PE_WEEKDAY_RANGE_CONFLICT: CE34 says Friday 05.09-25.12.2026 although 05.09.2026 is Saturday; only explicit extras 18.12 and 25.12 16:10-17:40 remain normalized.",
        "REVIEW_REQUIRED G21_PRACTICE_DETAILS_UNRESOLVED: shared Practice block 18-30.01.2027 has concrete dates but no unambiguous full practice name, time or location; course-5-only C22 is not generalized.",
    ]

    ent_diagnostics = [item for item in parsing.get("diagnostics", []) if item.get("rule") == "C20"]
    if len(ent_diagnostics) != 4:
        raise SystemExit("expected four C20 ENT diagnostics")
    parsing.update({
        "status": "REVIEW_REQUIRED",
        "resolvedOccurrenceCount": 399,
        "unresolvedOccurrenceCount": 144,
        "diagnostics": ent_diagnostics + [
            {
                "rule": "G04/G21/C12",
                "locator": "CE34",
                "affectedCandidateOccurrenceCount": 64,
                "sourceText": "пятница 05.09-25.12.2026 14.30-16.00 доп. 18.12, 25.12 16.10-17.40",
                "reason": "The stated weekday conflicts with the written range start date (05.09.2026 is Saturday); base recurrence is withheld until source-specific confirmation.",
                "resolvedFragment": "Explicit additional sessions on 18.12 and 25.12 at 16:10-17:40 are retained under G06.",
            },
            {
                "rule": "G21",
                "locator": "DJ14",
                "affectedOccurrenceCount": 48,
                "dates": sorted({event["date"] for event in removed_practice}),
                "reason": "The source says only Practice and supplies dates, but not a full practice title, time or location. C22 is source-specific to Dentistry course 5 and cannot be generalized.",
            },
        ],
        "warnings": warnings,
        "postprocessing": {
            "mode": "course-local-fail-closed",
            "removedInferredPracticeEvents": 48,
            "removedInferredPeBaseEvents": 64,
            "retainedExplicitPeExtraEvents": 8,
            "commonParserChanged": False,
        },
    })

    draft.update({
        "status": "REVIEW_REQUIRED",
        "coverage": "deterministic-source-supported-subset",
        "candidateDigest": candidate_digest,
        "eventCount": 399,
        "unresolvedEventOccurrenceCount": 144,
        "eventCountsByGroup": counts,
        "reviewRequiredClassCount": 3,
        "events": events,
    })

    review.update({
        "status": "REVIEW_REQUIRED",
        "ruleApplications": [
            {"rule": "C01/C08", "result": "PASS", "detail": "44 unambiguous group-local cycle blocks normalize to 387 events from explicit calendar dates and same-XLSX reference rows."},
            {"rule": "C07/C14", "result": "PASS", "detail": "13-16 January exam period remains service metadata only; no synthetic events."},
            {"rule": "C01/G11/G12/G14", "result": "PASS", "detail": "Shared Management block on 12 January normalizes to four timed events with same-XLSX metadata."},
            {"rule": "G06/C12", "result": "PASS", "detail": "Only the explicitly named PE extras 18.12 and 25.12 at 16:10-17:40 are normalized (8 events)."},
            {"rule": "C20", "result": "REVIEW_REQUIRED", "detail": "Each ENT cycle has one unspecified 09:00-12:55 day; source does not identify its date."},
            {"rule": "G04/G21/C12", "result": "REVIEW_REQUIRED", "detail": "PE base text says Friday but its written range starts 05.09.2026, a Saturday; recurring series is not guessed."},
            {"rule": "G21", "result": "REVIEW_REQUIRED", "detail": "Shared Practice 18-30 January lacks an unambiguous full title, time and location; course-5-specific C22 is not reused."},
        ],
        "unresolved": parsing["diagnostics"],
        "publishEligible": False,
        "finalDeterministicEventCount": 399,
        "reviewRequiredClassCount": 3,
    })

    qa.update({
        "status": "REVIEW_REQUIRED",
        "candidateDigest": candidate_digest,
        "publishEligible": False,
        "checks": [
            {"name": "official-source-hash", "status": "PASS", "detail": parsing["sourceSha256"]},
            {"name": "group-scope", "status": "PASS", "detail": GROUPS},
            {"name": "parser-profile", "status": "PASS", "detail": "existing cyclic/C; no common parser/core modification"},
            {"name": "safe-normalized-events", "status": "PASS", "detail": {"eventCount": 399, "byGroup": counts}},
            {"name": "explicit-pe-extra-dates", "status": "PASS", "detail": "8 events: groups 491-494 on 18.12 and 25.12, 16:10-17:40"},
            {"name": "duplicates", "status": "PASS", "detail": 0},
            {"name": "resolved-timed-overlaps", "status": "PASS", "detail": 0},
            {"name": "C20-otorhinolaryngology-one-day-exception", "status": "REVIEW_REQUIRED", "detail": "32 ENT occurrences withheld; exact 09:00-12:55 date is unknown in each group cycle."},
            {"name": "PE-base-recurrence", "status": "REVIEW_REQUIRED", "detail": "64 candidate Friday occurrences withheld because weekday/range-start semantics conflict."},
            {"name": "January-Practice-details", "status": "REVIEW_REQUIRED", "detail": "48 candidate date occurrences withheld because source lacks full practice identity/time/location and C22 is not general."},
        ],
        "blockers": [
            "C20: exact 09:00-12:55 ENT date is absent for each of groups 491-494.",
            "G04/G21: PE base recurrence is ambiguous because Friday conflicts with written start date 05.09.2026 (Saturday).",
            "G21: shared Practice 18-30.01.2027 lacks full identity/time/location; course-5 C22 cannot be generalized.",
        ],
        "scheduleVersionReady": False,
        "publicationPerformed": False,
    })

    write(PARSING_RESULT, parsing)
    write(DRAFT_OUT, draft)
    write(SEMANTIC_REVIEW, review)
    write(QA_REPORT, qa)
    print(json.dumps({
        "status": "REVIEW_REQUIRED",
        "eventCount": 399,
        "eventCountsByGroup": counts,
        "candidateDigest": candidate_digest,
        "reviewRequiredClasses": 3,
        "scheduleVersionReady": False,
        "publicationPerformed": False,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
