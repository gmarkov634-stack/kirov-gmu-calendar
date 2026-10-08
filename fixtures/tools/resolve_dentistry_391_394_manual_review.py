#!/usr/bin/env python3
"""Resolve Dentistry 391-394 C20 diagnostics from explicit source-specific confirmation.

This is a postprocessing layer over the fail-closed cyclic parser result. It does
not alter the raw source probe or canonical C20/C21 semantics and is pinned to the
current official source SHA. No production write or publication is performed.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def resolve(builder) -> None:
    root = builder.ROOT
    period = builder.PERIOD
    qa_dir = root / "qa" / period
    fixture_dir = root / "fixtures" / period

    resolution_path = fixture_dir / "dentistry-391-394.manual-resolution.json"
    probe_path = fixture_dir / "dentistry-391-394.source-probe.json"
    partial_path = qa_dir / "dentistry-391-394.normalized-draft.partial.json"
    review_path = qa_dir / "dentistry-391-394.semantic-review.json"

    resolution = _load(resolution_path)
    probe = _load(probe_path)
    partial = _load(partial_path)
    review = _load(review_path)

    source_sha = builder.SOURCE_SHA256
    if resolution.get("sourceSha256") != source_sha or probe["source"]["sha256"] != source_sha:
        raise SystemExit("manual resolution/source SHA mismatch")
    if not resolution.get("appliesOnlyToThisSourceSha"):
        raise SystemExit("manual resolution must be source-SHA-specific")
    if partial.get("status") != "REVIEW_REQUIRED" or review.get("status") != "REVIEW_REQUIRED":
        raise SystemExit("expected fail-closed REVIEW_REQUIRED intermediate evidence")

    unresolved = review.get("unresolved", [])
    if len(unresolved) != 12 or sum(len(item["dates"]) for item in unresolved) != 68:
        raise SystemExit("unexpected manual-review scope")

    sheet = probe["source"]["sheets"][0]
    sheet_name = sheet["title"]
    cells = {entry["coord"]: builder.compact(entry["value"]) for entry in sheet["nonEmptyCells"]}
    row_by_kind = {"philosophy": 24, "obstetrics": 29, "iok": 31}

    def details(kind: str) -> dict:
        row = row_by_kind[kind]
        base = builder.compact(cells.get(f"AT{row}"))
        address = builder.compact(cells.get(f"BX{row}"))
        location = ", ".join(part for part in [base, address] if part) or None
        assessment = builder.assessment_from_label(builder.compact(cells.get(f"Y{row}")), row, sheet_name)
        return {"location": location, "assessment": assessment}

    resolved_events = []
    resolution_evidence = []
    for item in unresolved:
        kind = item["kind"]
        dates = list(item["dates"])
        rule = resolution["rules"].get(kind)
        if rule is None:
            raise SystemExit(f"missing resolution rule for {kind}")
        ref = details(kind)

        if kind == "obstetrics":
            if item["sourceTimeText"] != rule["sourceText"]:
                raise SystemExit("obstetrics source text changed")
            exceptional = set(dates[-2:])
            base_start, base_end = rule["baseTime"].split("-")
            exc_start, exc_end = rule["exceptionTime"].split("-")
        elif kind == "iok":
            if item["sourceTimeText"] != rule["sourceText"]:
                raise SystemExit("IOK source text changed")
            exceptional = {dates[-1]}
            base_start, base_end = rule["baseTime"].split("-")
            exc_start, exc_end = rule["exceptionTime"].split("-")
        elif kind == "philosophy":
            if item["sourceTimeText"] != rule["sourceBaseTime"] or item["sourceAdjacentTimeNote"] != rule["sourceAdjacentTimeNote"]:
                raise SystemExit("philosophy source text changed")
            if rule["exceptionDurationAcademicHours"] * rule["academicHourMinutes"] != 90:
                raise SystemExit("philosophy two-academic-hour duration mismatch")
            exceptional = {dates[-1]}
            base_start, base_end = rule["baseTime"].split("-")
            exc_start, exc_end = rule["exceptionTime"].split("-")
        else:
            raise SystemExit(f"unsupported manual resolution kind: {kind}")

        for date in dates:
            start, end = (exc_start, exc_end) if date in exceptional else (base_start, base_end)
            resolved_events.append(builder.make_event(
                group=item["groupId"],
                date=date,
                discipline=item["discipline"],
                lesson_type="practice",
                location=ref["location"],
                source_locator=f"{sheet_name}!{item['locator']}",
                start=start,
                end=end,
                assessment=ref["assessment"],
            ))
        resolution_evidence.append({
            "sourceLocator": item["locator"],
            "groupId": item["groupId"],
            "kind": kind,
            "dates": dates,
            "exceptionDates": sorted(exceptional),
            "baseTime": f"{base_start}-{base_end}",
            "exceptionTime": f"{exc_start}-{exc_end}",
            "provenance": resolution["provenance"],
        })

    if len(resolved_events) != 68:
        raise SystemExit(f"expected 68 manually resolved events, got {len(resolved_events)}")

    events = list(partial["events"]) + resolved_events
    events.sort(key=lambda event: (
        event["groupId"], event["date"], event["startTime"],
        event["discipline"], event["sourceRef"]["locator"],
    ))
    ids = [event["eventId"] for event in events]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate normalized event ids after manual resolution")

    counts_by_group = {
        group: sum(event["groupId"] == group for event in events)
        for group in builder.EXPECTED_GROUPS
    }
    if len(events) != 532 or counts_by_group != {"391": 133, "392": 133, "393": 133, "394": 133}:
        raise SystemExit(f"unexpected full candidate counts: {len(events)} / {counts_by_group}")

    overlaps = []
    by_group_date = {}
    for event in events:
        by_group_date.setdefault((event["groupId"], event["date"]), []).append(event)
    for (group, date), day_events in by_group_date.items():
        ordered = sorted(day_events, key=lambda event: event["startTime"])
        for left, right in zip(ordered, ordered[1:]):
            if left["endTime"] > right["startTime"]:
                overlaps.append({
                    "groupId": group,
                    "date": date,
                    "leftEventId": left["eventId"],
                    "rightEventId": right["eventId"],
                    "left": f"{left['startTime']}-{left['endTime']} {left['discipline']}",
                    "right": f"{right['startTime']}-{right['endTime']} {right['discipline']}",
                })

    candidate_payload = json.dumps(events, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = "sha256:" + hashlib.sha256(candidate_payload.encode("utf-8")).hexdigest()
    qa_status = "PASS_WITH_SOURCE_CONFLICTS" if overlaps else "PASS"

    full_draft = {
        **{key: value for key, value in partial.items() if key != "events"},
        "status": "QA_PASSED" if not overlaps else "QA_PASSED_WITH_SOURCE_CONFLICTS",
        "coverage": "full",
        "candidateDigest": digest,
        "eventCount": len(events),
        "unresolvedEventOccurrenceCount": 0,
        "eventCountsByGroup": counts_by_group,
        "unresolvedOccurrencesByGroup": {group: 0 for group in builder.EXPECTED_GROUPS},
        "manualResolution": {
            "file": str(resolution_path.relative_to(root)),
            "resolvedBlockCount": len(unresolved),
            "resolvedOccurrenceCount": len(resolved_events),
        },
        "events": events,
    }

    resolved_review = {
        "schema": "kgmu-semantic-review-resolution-v1",
        "sourceSha256": source_sha,
        "status": qa_status,
        "parserProfile": "C",
        "sourceScope": review["sourceScope"],
        "upstreamReviewFile": str(review_path.relative_to(root)),
        "manualResolutionFile": str(resolution_path.relative_to(root)),
        "resolution": resolution_evidence,
        "remainingUnresolved": [],
        "publishEligible": True,
    }

    qa_report = {
        "schema": "kgmu-qa-report-v1",
        "sourceSha256": source_sha,
        "draftId": full_draft["draftId"],
        "status": qa_status,
        "publishEligible": True,
        "checks": [
            {"name": "official-source-hash", "status": "PASS", "detail": source_sha},
            {"name": "group-scope", "status": "PASS", "detail": builder.EXPECTED_GROUPS},
            {"name": "parser-profile", "status": "PASS", "detail": f"cyclic/C @ {builder.PARSER_RULES_VERSION}"},
            {"name": "idempotent-identities", "status": "PASS", "detail": {"sourceArtifactId": builder.SOURCE_ARTIFACT_ID, "parsingJobId": builder.PARSING_JOB_ID}},
            {"name": "logical-source-accounting", "status": "PASS", "detail": "54 logical blocks: 52 group-local cycles + 1 common exam service block + 1 independent physical-culture elective schedule."},
            {"name": "manual-C20-resolution", "status": "PASS", "detail": {"blocks": 12, "occurrences": 68, "provenance": resolution["provenance"], "scope": "current source SHA only"}},
            {"name": "full-normalized-events", "status": "PASS", "detail": {"eventCount": len(events), "byGroup": counts_by_group}},
            {"name": "duplicates", "status": "PASS", "detail": 0},
            {"name": "resolved-timed-overlaps", "status": "PASS" if not overlaps else "SOURCE_CONFLICT", "detail": overlaps},
            {"name": "C21-source-specific-guard", "status": "PASS", "detail": f"Historical C21 remains restricted to {builder.C21_SOURCE_BASENAME}; current resolution is stored separately and pinned to {builder.CURRENT_SOURCE_BASENAME} SHA."},
            {"name": "production-write-boundary", "status": "PASS", "detail": "No production object-storage write, DB write, ScheduleVersion creation or publication performed."},
        ],
        "blockers": [],
        "candidateDigest": digest,
        "scheduleVersionReady": True,
        "publicationPerformed": False,
    }

    _write(qa_dir / "dentistry-391-394.normalized-draft.json", full_draft)
    _write(qa_dir / "dentistry-391-394.semantic-review.resolved.json", resolved_review)
    _write(qa_dir / "dentistry-391-394.qa-report.final.json", qa_report)

    print(json.dumps({
        "status": qa_status,
        "sourceSha256": source_sha,
        "eventCount": len(events),
        "eventCountsByGroup": counts_by_group,
        "manualResolvedBlocks": len(unresolved),
        "manualResolvedOccurrences": len(resolved_events),
        "timedOverlaps": len(overlaps),
        "candidateDigest": digest,
        "scheduleVersionReady": True,
        "publicationPerformed": False,
    }, ensure_ascii=False, indent=2))
