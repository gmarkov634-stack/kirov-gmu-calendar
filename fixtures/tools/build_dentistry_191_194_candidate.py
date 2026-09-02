#!/usr/bin/env python3
"""Build Dentistry 191-194 normalized draft from operator-authored explicit decisions.

This tool performs only deterministic postprocessing/QA. It does not infer semantics
from XLSX text. Every semantic segment, date, group, time, discipline and location
comes from dentistry-191-194.decisions.json and is pinned to the current source hash.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERIOD = ROOT / "fixtures" / "2026-2027-semester-1"
QA = ROOT / "qa" / "2026-2027-semester-1"
SOURCE = PERIOD / "dentistry-191-194.source.json"
SOURCE_ARTIFACT = PERIOD / "dentistry-191-194.source-artifact.json"
PARSING_JOB = PERIOD / "dentistry-191-194.parsing-job.json"
DECISIONS = PERIOD / "dentistry-191-194.decisions.json"
PROBE = QA / "dentistry-191-194.source-probe.json"
NORMALIZED = PERIOD / "normalized" / "dentistry-191-194.normalized.json"
EVIDENCE = QA / "dentistry-191-194.evidence.json"
SEMANTIC_REVIEW = QA / "dentistry-191-194.semantic-review.json"
QA_REPORT = QA / "dentistry-191-194.qa-report.json"

EXPECTED_GROUPS = ["191", "192", "193", "194"]
SERVICE_INTERVALS = [
    ("2026-09-01", "2026-09-05"), ("2026-09-07", "2026-09-12"),
    ("2026-09-14", "2026-09-19"), ("2026-09-21", "2026-09-26"),
    ("2026-09-28", "2026-10-03"), ("2026-10-05", "2026-10-10"),
    ("2026-10-12", "2026-10-17"), ("2026-10-19", "2026-10-24"),
    ("2026-10-26", "2026-10-31"), ("2026-11-02", "2026-11-07"),
    ("2026-11-09", "2026-11-14"), ("2026-11-16", "2026-11-21"),
    ("2026-11-23", "2026-11-28"), ("2026-11-30", "2026-12-05"),
    ("2026-12-07", "2026-12-12"), ("2026-12-14", "2026-12-19"),
    ("2026-12-21", "2026-12-26"), ("2026-12-28", "2026-12-30"),
    ("2027-01-11", "2027-01-16"),
]


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def stable_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def service_dates() -> set[str]:
    out: set[str] = set()
    for start, end in SERVICE_INTERVALS:
        current = date.fromisoformat(start)
        last = date.fromisoformat(end)
        while current <= last:
            out.add(current.isoformat())
            current += timedelta(days=1)
    return out


def minutes(value: str) -> int:
    h, m = map(int, value.split(":"))
    return h * 60 + m


def validate_cross_check(check, decisions_by_id):
    selected = []
    for decision_id in check["decisionIds"]:
        if decision_id not in decisions_by_id:
            raise AssertionError(f"cross-check {check['code']}: missing decision {decision_id}")
        decision = decisions_by_id[decision_id]
        for group_id in decision["groupIds"]:
            for event_date in decision["dates"]:
                selected.append((group_id, event_date, decision))
    if "discipline" in check:
        assert all(item[2]["discipline"] == check["discipline"] for item in selected), check["code"]
    if "lessonType" in check:
        assert all(item[2]["lessonType"] == check["lessonType"] for item in selected), check["code"]
    if "weekday" in check:
        assert all(date.fromisoformat(item[1]).isoweekday() == check["weekday"] for item in selected), check["code"]
    if "expectedTotal" in check:
        assert len(selected) == check["expectedTotal"], (check["code"], len(selected))
    if "expectedCount" in check:
        filtered = [item for item in selected if item[0] == check["groupId"]]
        assert len(filtered) == check["expectedCount"], (check["code"], len(filtered))
    if "expectedCountPerGroup" in check:
        counts = Counter(item[0] for item in selected)
        for group_id in check["groupIds"]:
            assert counts[group_id] == check["expectedCountPerGroup"], (check["code"], group_id, counts[group_id])


def main() -> None:
    source = load(SOURCE)
    source_artifact = load(SOURCE_ARTIFACT)
    parsing_job = load(PARSING_JOB)
    decisions = load(DECISIONS)
    probe = load(PROBE)

    source_meta = source["source"]
    probe_source = probe["source"]
    assert source_meta["sha256"] == decisions["sourceSha256"] == source_artifact["sha256"]
    assert source_meta["sha256"] == probe_source["sha256"]
    assert source_meta["url"] == source_artifact["originUrl"] == probe_source["url"]
    assert source_meta["byteLength"] == source_artifact["byteLength"] == probe_source["byteLength"]
    assert parsing_job["sourceObjectKey"] == source_artifact["sourceObjectKey"]
    assert parsing_job["expectedGroupIds"] == EXPECTED_GROUPS == source["expectedGroupIds"]
    assert parsing_job["parserRulesVersion"] == decisions["parserRulesVersion"] == source["parserRulesVersion"]

    sheet = next(item for item in probe_source["sheets"] if item["title"] == decisions["sheetName"])
    probe_cells = {item["coord"]: item["value"] for item in sheet["nonEmptyCells"]}
    source_main_cells = {
        coord for coord, value in probe_cells.items()
        if coord[0] in "BCDE" and 10 <= int(coord[1:]) <= 49 and value.strip()
    }
    decision_cells = {item["sourceCell"] for item in decisions["decisions"]}
    unresolved_cells = {item["sourceCell"] for item in decisions["unresolved"]}
    assert len(source_main_cells) == decisions["logicalMainTableSourceCellCount"] == 77
    assert len(decision_cells) == decisions["resolvedMainTableSourceCellCount"] == 76
    assert decision_cells.isdisjoint(unresolved_cells)
    assert source_main_cells == decision_cells | unresolved_cells

    for item in decisions["decisions"]:
        assert item["sourceCell"] in probe_cells, item["sourceCell"]
        assert sha_text(probe_cells[item["sourceCell"]]) == item["sourceCellSha256"], item["sourceCell"]
        assert item["groupIds"] and set(item["groupIds"]).issubset(EXPECTED_GROUPS), item["id"]
        assert item["dates"], item["id"]
        assert minutes(item["startTime"]) < minutes(item["endTime"]), item["id"]
    for item in decisions["assessmentMetadata"]:
        assert sha_text(probe_cells[item["sourceCell"]]) == item["sourceCellSha256"], item["sourceCell"]
    for item in decisions["unresolved"]:
        assert sha_text(probe_cells[item["sourceCell"]]) == item["sourceCellSha256"], item["sourceCell"]
        assert sha_text(probe_cells[item["weekGridCell"]]) == item["weekGridCellSha256"], item["weekGridCell"]

    allowed_dates = service_dates()
    events = []
    for item in decisions["decisions"]:
        for group_id in item["groupIds"]:
            for event_date in item["dates"]:
                assert event_date in allowed_dates, (item["id"], event_date)
                key = "|".join([
                    group_id, event_date, item["startTime"], item["endTime"],
                    item["discipline"], item["sourceLocator"],
                ])
                event = {
                    "eventId": "kgmu-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:24],
                    "universityId": "kirov-gmu",
                    "academicPeriodId": "2026-2027-semester-1",
                    "groupId": group_id,
                    "date": event_date,
                    "startTime": item["startTime"],
                    "endTime": item["endTime"],
                    "timeSemantics": "floating",
                    "discipline": item["discipline"],
                    "lessonType": item["lessonType"],
                    "location": item["location"],
                    "teacher": None,
                    "sourceRef": {"sourceId": "dentistry", "locator": item["sourceLocator"]},
                }
                for optional in ("facultativeId", "notes", "assessment"):
                    if optional in item:
                        event[optional] = item[optional]
                events.append(event)

    events.sort(key=lambda item: (
        item["groupId"], item["date"], item["startTime"], item["endTime"],
        item["discipline"], item["sourceRef"]["locator"],
    ))
    duplicate_signatures = Counter((
        item["groupId"], item["date"], item["startTime"], item["endTime"],
        item["discipline"], item.get("facultativeId"),
    ) for item in events)
    duplicates = [signature for signature, count in duplicate_signatures.items() if count > 1]
    assert not duplicates, duplicates[:5]

    decisions_by_id = {item["id"]: item for item in decisions["decisions"]}
    assert len(decisions_by_id) == len(decisions["decisions"])
    for check in decisions["crossChecks"]:
        validate_cross_check(check, decisions_by_id)

    overlaps = []
    by_group_date = defaultdict(list)
    for event in events:
        by_group_date[(event["groupId"], event["date"])].append(event)
    for (group_id, event_date), day_events in sorted(by_group_date.items()):
        ordered = sorted(day_events, key=lambda item: (minutes(item["startTime"]), minutes(item["endTime"])))
        for left_index, left in enumerate(ordered):
            for right in ordered[left_index + 1:]:
                if minutes(right["startTime"]) >= minutes(left["endTime"]):
                    break
                if minutes(left["startTime"]) < minutes(right["endTime"]):
                    overlaps.append({
                        "groupId": group_id,
                        "date": event_date,
                        "left": left["sourceRef"]["locator"],
                        "right": right["sourceRef"]["locator"],
                    })

    counts = Counter(item["groupId"] for item in events)
    candidate_core = {
        "schema": "kgmu-normalized-draft-v1",
        "fixtureId": decisions["fixtureId"],
        "sourceFixtureId": source["fixtureId"],
        "sourceSha256": decisions["sourceSha256"],
        "parserRulesVersion": decisions["parserRulesVersion"],
        "status": "REVIEW_REQUIRED" if decisions["unresolved"] else "NORMALIZED",
        "assessmentMetadata": decisions["assessmentMetadata"],
        "events": events,
    }
    digest = "sha256:" + hashlib.sha256(stable_json(candidate_core).encode("utf-8")).hexdigest()
    candidate = {**candidate_core, "candidateDigest": digest}

    semantic_review = {
        "schema": "kgmu-semantic-review-v1",
        "fixtureId": decisions["fixtureId"],
        "sourceSha256": decisions["sourceSha256"],
        "status": "REVIEW_REQUIRED" if decisions["unresolved"] else "RESOLVED",
        "items": decisions["unresolved"],
    }
    checks = [
        {"code": "source-identity-coherent", "status": "pass", "message": "source fixture, SourceArtifact, ParsingJob and mechanical probe resolve to the same current official XLSX hash"},
        {"code": "main-table-content-accounted-for", "status": "pass", "message": f"{len(decision_cells)}/{len(source_main_cells)} main-table cells are normalized; {len(unresolved_cells)} cell is explicitly represented in semantic review rather than silently omitted"},
        {"code": "source-cell-hashes-match-probe", "status": "pass", "message": f"all {len(decisions['decisions'])} explicit decision segments remain pinned to exact current source-cell text"},
        {"code": "groups-match-expected", "status": "pass", "message": "groups 191-194 only"},
        {"code": "dates-within-service-grid", "status": "pass", "message": f"all {len(events)} normalized base events fall inside B50 service-week intervals"},
        {"code": "hard-count-cross-checks", "status": "pass", "message": f"all {len(decisions['crossChecks'])} R07/R08/R83 cross-checks match explicit source events"},
        {"code": "assessment-metadata-lossless", "status": "pass", "message": f"{len(decisions['assessmentMetadata'])} source-explicit assessment metadata mappings are preserved"},
        {"code": "duplicate-events-resolved", "status": "pass", "message": "0 duplicate normalized event signatures"},
        {"code": "source-backed-overlaps-preserved", "status": "warning" if overlaps else "pass", "message": f"{len(overlaps)} overlap pairs remain visible for G16/R69 audit; no automatic time shifting or deletion was performed"},
        {"code": "unresolved-ambiguities-zero-before-pass", "status": "fail" if decisions["unresolved"] else "pass", "message": f"{len(decisions['unresolved'])} unresolved semantic item(s); R90 blocks facultative expansion and publication until manual periodicity confirmation" if decisions["unresolved"] else "0 unresolved semantic ambiguities"},
        {"code": "publication-not-performed", "status": "pass", "message": "QA-only draft; no ScheduleVersion publish, production persistence, subscription or opaque ICS URL mutation"},
    ]
    qa_decision = "review-required" if decisions["unresolved"] else "pass"
    qa_report = {
        "qaReportId": "qa-kgmu-2026-2027-s1-dentistry-191-194-719d8081-v1",
        "parsingJobId": parsing_job["jobId"],
        "candidateDigest": digest,
        "decision": qa_decision,
        "checks": checks,
        "eventCount": len(events),
        "eventCountByGroup": dict(sorted(counts.items())),
        "overlapPairCount": len(overlaps),
        "unresolvedSemanticItemCount": len(decisions["unresolved"]),
        "readyForScheduleVersion": not decisions["unresolved"],
        "publicationPerformed": False,
    }
    evidence = {
        "schema": "kgmu-dentistry-191-194-evidence-v1",
        "fixtureId": decisions["fixtureId"],
        "sourceSha256": decisions["sourceSha256"],
        "sourceArtifactId": source_artifact["sourceArtifactId"],
        "parsingJobId": parsing_job["jobId"],
        "candidateDigest": digest,
        "logicalMainTableSourceCellCount": len(source_main_cells),
        "resolvedMainTableSourceCellCount": len(decision_cells),
        "normalizedBaseEventCount": len(events),
        "eventCountByGroup": dict(sorted(counts.items())),
        "duplicateSignatureCount": len(duplicates),
        "overlapPairs": overlaps,
        "assessmentMetadataCount": len(decisions["assessmentMetadata"]),
        "crossCheckCount": len(decisions["crossChecks"]),
        "unresolved": decisions["unresolved"],
    }

    NORMALIZED.parent.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    NORMALIZED.write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    EVIDENCE.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    SEMANTIC_REVIEW.write_text(json.dumps(semantic_review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    QA_REPORT.write_text(json.dumps(qa_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({
        "candidateDigest": digest,
        "eventCount": len(events),
        "eventCountByGroup": dict(sorted(counts.items())),
        "duplicateSignatureCount": len(duplicates),
        "overlapPairCount": len(overlaps),
        "resolvedMainTableSourceCellCount": len(decision_cells),
        "logicalMainTableSourceCellCount": len(source_main_cells),
        "unresolvedSemanticItemCount": len(decisions["unresolved"]),
        "qaDecision": qa_decision,
        "readyForScheduleVersion": not decisions["unresolved"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
