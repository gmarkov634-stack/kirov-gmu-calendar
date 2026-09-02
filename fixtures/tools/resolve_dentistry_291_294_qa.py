#!/usr/bin/env python3
"""Resolve course-specific QA for Dentistry 291-294 without changing shared rules.

The candidate builder intentionally fails closed when R07-R09 count notes do not
match its broad first-pass search. This resolver applies the canonical R07-R09
semantics more narrowly: an "N занятий в <weekday>" note must be matched to
separate explicitly dated events of the same discipline *and same lesson type*.
Lectures are not counted as additional practical "занятия".

No ScheduleVersion is created and nothing is published.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERIOD = "2026-2027-semester-1"
FIXTURE_DIR = ROOT / "fixtures" / PERIOD
QA_DIR = ROOT / "qa" / PERIOD
NORMALIZED_PATH = FIXTURE_DIR / "normalized" / "dentistry-291-294.normalized.compact.json"
QA_PATH = QA_DIR / "dentistry-291-294.qa-report.json"
EVIDENCE_PATH = QA_DIR / "dentistry-291-294.evidence.json"
EXPECTED_GROUPS = {"291", "292", "293", "294"}
EXPLICIT_PROVENANCE = {"explicit-date", "explicit-date-time"}
TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
DATE_RE = re.compile(r"^202[67]-\d{2}-\d{2}$")


def read_json(path: Path):
    if not path.exists():
        raise SystemExit(f"required candidate artifact is missing: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def minutes(value: str) -> int:
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute


def validate_normalized(payload: dict) -> dict:
    expected_fields = [
        "eventId", "groupId", "date", "startTime", "endTime",
        "discipline", "lessonType", "location", "sourceLocator",
    ]
    if payload.get("tupleFields") != expected_fields:
        raise SystemExit("normalized tuple schema changed")
    events = payload.get("events")
    if not isinstance(events, list) or not events:
        raise SystemExit("normalized draft has no events")

    event_ids = set()
    logical = set()
    counts = Counter()
    for index, row in enumerate(events):
        if not isinstance(row, list) or len(row) != len(expected_fields):
            raise SystemExit(f"invalid normalized tuple at index {index}")
        item = dict(zip(expected_fields, row))
        if not isinstance(item["eventId"], str) or not item["eventId"].startswith("kgmu-"):
            raise SystemExit(f"invalid eventId at index {index}")
        if item["eventId"] in event_ids:
            raise SystemExit(f"duplicate eventId: {item['eventId']}")
        event_ids.add(item["eventId"])
        if item["groupId"] not in EXPECTED_GROUPS:
            raise SystemExit(f"unexpected group: {item['groupId']}")
        if not DATE_RE.match(item["date"]):
            raise SystemExit(f"invalid date: {item['date']}")
        if not TIME_RE.match(item["startTime"]) or not TIME_RE.match(item["endTime"]):
            raise SystemExit(f"invalid time at index {index}")
        if minutes(item["endTime"]) <= minutes(item["startTime"]):
            raise SystemExit(f"non-positive interval at index {index}")
        if not isinstance(item["discipline"], str) or not item["discipline"].strip():
            raise SystemExit(f"empty discipline at index {index}")
        if item["lessonType"] not in {"lecture", "practice", "other"}:
            raise SystemExit(f"unexpected lessonType at index {index}: {item['lessonType']}")
        if not isinstance(item["sourceLocator"], str) or not item["sourceLocator"].startswith("2 стомат.!"):
            raise SystemExit(f"invalid sourceLocator at index {index}")
        signature = (
            item["groupId"], item["date"], item["startTime"], item["endTime"],
            item["discipline"], item["lessonType"], item["location"],
        )
        if signature in logical:
            raise SystemExit(f"duplicate normalized logical event at index {index}: {signature}")
        logical.add(signature)
        counts[item["groupId"]] += 1

    if set(counts) != EXPECTED_GROUPS or any(counts[group] <= 0 for group in EXPECTED_GROUPS):
        raise SystemExit(f"normalized group coverage is incomplete: {dict(counts)}")
    if payload.get("eventCount") != len(events):
        raise SystemExit("normalized eventCount does not match tuple count")
    if payload.get("groupEventCounts") != dict(sorted(counts.items())):
        raise SystemExit("normalized groupEventCounts do not match tuples")
    return {
        "eventCount": len(events),
        "groupEventCounts": dict(sorted(counts.items())),
        "eventIdsUnique": True,
        "logicalEventsUnique": True,
        "tupleIntegrity": True,
    }


def main():
    normalized = read_json(NORMALIZED_PATH)
    qa = read_json(QA_PATH)
    evidence = read_json(EVIDENCE_PATH)

    integrity = validate_normalized(normalized)
    fragments = evidence.get("fragments", [])
    fragment_by_locator = {
        item.get("sourceLocator"): item
        for item in fragments
        if isinstance(item, dict) and isinstance(item.get("sourceLocator"), str)
    }

    resolved = []
    unresolved = []
    for expectation in evidence.get("crossDayExpectations", []):
        item = dict(expectation)
        if item.get("status") == "PASS":
            resolved.append(item)
            continue

        origin = fragment_by_locator.get(item.get("originLocator"))
        if not origin:
            unresolved.append(item)
            resolved.append(item)
            continue
        origin_type = origin.get("lessonType")
        candidates = []
        for candidate in item.get("matchedOccurrences", []):
            candidate_fragment = fragment_by_locator.get(candidate.get("sourceLocator"))
            if not candidate_fragment:
                continue
            if candidate_fragment.get("lessonType") != origin_type:
                continue
            if candidate.get("provenance") not in EXPLICIT_PROVENANCE:
                continue
            candidates.append(candidate)

        occurrence_count = len(candidates)
        interval_count = sum(int(candidate.get("intervalCount", 1)) for candidate in candidates)
        expected = int(item.get("expectedCount", -1))
        if occurrence_count == expected:
            count_mode = "explicit-same-lesson-type-occurrences"
        elif interval_count == expected:
            count_mode = "explicit-same-lesson-type-source-intervals-before-R12"
        else:
            unresolved.append({**item, "filteredCandidates": candidates})
            resolved.append(item)
            continue

        item.update({
            "status": "PASS",
            "countMode": count_mode,
            "matchedOccurrences": candidates,
            "occurrenceCount": occurrence_count,
            "sourceIntervalCount": interval_count,
            "resolution": {
                "rules": "R07-R09/R67",
                "filter": "same discipline + same lessonType + explicitly dated source event",
                "rationale": "The source says additional 'занятие', so separate lectures of the same discipline are not counted as the additional practical occurrence.",
            },
        })
        resolved.append(item)

    evidence["crossDayExpectations"] = resolved
    evidence["qaResolution"] = {
        "rules": "R07-R09/R67",
        "courseSpecific": True,
        "sharedParserChanged": False,
        "unresolvedCountNotes": len(unresolved),
        "normalizedIntegrity": integrity,
    }

    checks = qa.setdefault("checks", {})
    checks["crossDayCountNotesResolved"] = len(unresolved) == 0
    checks["normalizedTupleIntegrity"] = integrity["tupleIntegrity"]
    checks["noDuplicateNormalizedEvents"] = integrity["logicalEventsUnique"]

    warnings = []
    for warning in qa.get("warnings", []):
        if warning.startswith("REVIEW_REQUIRED: count note mismatch") and not unresolved:
            continue
        warnings.append(warning)
    if unresolved:
        warnings.append(f"REVIEW_REQUIRED: {len(unresolved)} R07-R09 count-note expectations remain unresolved after course-specific filtering")
    qa["warnings"] = warnings
    qa["qaResolution"] = evidence["qaResolution"]
    qa["status"] = "PASS" if all(checks.values()) and not warnings else "REVIEW_REQUIRED"

    EVIDENCE_PATH.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    QA_PATH.write_text(json.dumps(qa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "status": qa["status"],
        "eventCount": integrity["eventCount"],
        "groupEventCounts": integrity["groupEventCounts"],
        "unresolvedCountNotes": len(unresolved),
        "resolvedCountNotes": sum(1 for item in resolved if item.get("status") == "PASS"),
    }, ensure_ascii=False, indent=2))
    if qa["status"] != "PASS":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
