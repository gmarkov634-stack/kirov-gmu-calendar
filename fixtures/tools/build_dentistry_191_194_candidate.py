#!/usr/bin/env python3
"""Deterministic postprocessing/QA for operator-authored Dentistry 191-194 decisions.

No semantic inference is performed here. The complete XLSX is pinned by the official
source SHA-256; decision locators must cover every non-empty timetable source cell.
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
    ("2026-09-01","2026-09-05"),("2026-09-07","2026-09-12"),("2026-09-14","2026-09-19"),
    ("2026-09-21","2026-09-26"),("2026-09-28","2026-10-03"),("2026-10-05","2026-10-10"),
    ("2026-10-12","2026-10-17"),("2026-10-19","2026-10-24"),("2026-10-26","2026-10-31"),
    ("2026-11-02","2026-11-07"),("2026-11-09","2026-11-14"),("2026-11-16","2026-11-21"),
    ("2026-11-23","2026-11-28"),("2026-11-30","2026-12-05"),("2026-12-07","2026-12-12"),
    ("2026-12-14","2026-12-19"),("2026-12-21","2026-12-26"),("2026-12-28","2026-12-30"),
    ("2027-01-11","2027-01-16"),
]


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def stable_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def minutes(value):
    h, m = map(int, value.split(":"))
    return h * 60 + m


def service_dates():
    result = set()
    for start, end in SERVICE_INTERVALS:
        current, last = date.fromisoformat(start), date.fromisoformat(end)
        while current <= last:
            result.add(current.isoformat())
            current += timedelta(days=1)
    return result


def strip_bad_cell_hash_metadata(decisions):
    """Remove non-canonical per-cell hashes from an earlier draft write.

    The immutable XLSX is already pinned by the source-level SHA-256 and probe.
    Source-cell coverage is validated by locator against that exact workbook.
    """
    for item in decisions["decisions"]:
        item.pop("sourceCellSha256", None)
    for item in decisions["assessmentMetadata"]:
        item.pop("sourceCellSha256", None)
    for item in decisions["unresolved"]:
        item.pop("sourceCellSha256", None)
        item.pop("weekGridCellSha256", None)
    decisions["sourceEvidenceMode"] = "source-sha256-plus-complete-cell-locator-coverage"
    DECISIONS.write_text(json.dumps(decisions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def validate_cross_check(check, by_id):
    selected = []
    for decision_id in check["decisionIds"]:
        decision = by_id[decision_id]
        for group_id in decision["groupIds"]:
            for event_date in decision["dates"]:
                selected.append((group_id, event_date, decision))
    if "discipline" in check:
        assert all(x[2]["discipline"] == check["discipline"] for x in selected), check["code"]
    if "lessonType" in check:
        assert all(x[2]["lessonType"] == check["lessonType"] for x in selected), check["code"]
    if "weekday" in check:
        assert all(date.fromisoformat(x[1]).isoweekday() == check["weekday"] for x in selected), check["code"]
    if "expectedTotal" in check:
        assert len(selected) == check["expectedTotal"], (check["code"], len(selected))
    if "expectedCount" in check:
        actual = sum(1 for x in selected if x[0] == check["groupId"])
        assert actual == check["expectedCount"], (check["code"], actual)
    if "expectedCountPerGroup" in check:
        counts = Counter(x[0] for x in selected)
        for group_id in check["groupIds"]:
            assert counts[group_id] == check["expectedCountPerGroup"], (check["code"], group_id, counts[group_id])


def main():
    source, artifact, job = load(SOURCE), load(SOURCE_ARTIFACT), load(PARSING_JOB)
    decisions, probe = load(DECISIONS), load(PROBE)
    source_meta, probe_source = source["source"], probe["source"]
    assert source_meta["sha256"] == decisions["sourceSha256"] == artifact["sha256"] == probe_source["sha256"]
    assert source_meta["url"] == artifact["originUrl"] == probe_source["url"]
    assert source_meta["byteLength"] == artifact["byteLength"] == probe_source["byteLength"]
    assert job["sourceObjectKey"] == artifact["sourceObjectKey"]
    assert job["expectedGroupIds"] == source["expectedGroupIds"] == EXPECTED_GROUPS
    assert job["parserRulesVersion"] == decisions["parserRulesVersion"] == source["parserRulesVersion"]

    sheet = next(x for x in probe_source["sheets"] if x["title"] == decisions["sheetName"])
    probe_cells = {x["coord"]: x["value"] for x in sheet["nonEmptyCells"]}
    source_cells = {coord for coord, value in probe_cells.items() if coord[0] in "BCDE" and 10 <= int(coord[1:]) <= 49 and value.strip()}
    decision_cells = {x["sourceCell"] for x in decisions["decisions"]}
    unresolved_cells = {x["sourceCell"] for x in decisions["unresolved"]}
    assert len(source_cells) == decisions["logicalMainTableSourceCellCount"] == 77
    assert len(decision_cells) == decisions["resolvedMainTableSourceCellCount"] == 76
    assert source_cells == decision_cells | unresolved_cells and decision_cells.isdisjoint(unresolved_cells)
    for item in decisions["decisions"]:
        assert item["sourceCell"] in probe_cells, item["sourceCell"]
        assert item["groupIds"] and set(item["groupIds"]).issubset(EXPECTED_GROUPS), item["id"]
        assert item["dates"] and minutes(item["startTime"]) < minutes(item["endTime"]), item["id"]
    for item in decisions["assessmentMetadata"]:
        assert item["sourceCell"] in probe_cells, item["sourceCell"]
    for item in decisions["unresolved"]:
        assert item["sourceCell"] in probe_cells and item["weekGridCell"] in probe_cells, item["id"]

    strip_bad_cell_hash_metadata(decisions)
    allowed_dates = service_dates()
    events = []
    for item in decisions["decisions"]:
        for group_id in item["groupIds"]:
            for event_date in item["dates"]:
                assert event_date in allowed_dates, (item["id"], event_date)
                key = "|".join([group_id, event_date, item["startTime"], item["endTime"], item["discipline"], item["sourceLocator"]])
                event = {
                    "eventId": "kgmu-" + hashlib.sha256(key.encode()).hexdigest()[:24],
                    "universityId": "kirov-gmu", "academicPeriodId": "2026-2027-semester-1",
                    "groupId": group_id, "date": event_date, "startTime": item["startTime"], "endTime": item["endTime"],
                    "timeSemantics": "floating", "discipline": item["discipline"], "lessonType": item["lessonType"],
                    "location": item["location"], "teacher": None,
                    "sourceRef": {"sourceId": "dentistry", "locator": item["sourceLocator"]},
                }
                for field in ("facultativeId", "notes", "assessment"):
                    if field in item:
                        event[field] = item[field]
                events.append(event)
    events.sort(key=lambda x: (x["groupId"], x["date"], x["startTime"], x["endTime"], x["discipline"], x["sourceRef"]["locator"]))

    signatures = Counter((x["groupId"], x["date"], x["startTime"], x["endTime"], x["discipline"], x.get("facultativeId")) for x in events)
    duplicates = [sig for sig, count in signatures.items() if count > 1]
    assert not duplicates, duplicates[:5]
    by_id = {x["id"]: x for x in decisions["decisions"]}
    assert len(by_id) == len(decisions["decisions"])
    for check in decisions["crossChecks"]:
        validate_cross_check(check, by_id)

    overlaps, by_day = [], defaultdict(list)
    for event in events:
        by_day[(event["groupId"], event["date"])].append(event)
    for (group_id, event_date), day_events in sorted(by_day.items()):
        ordered = sorted(day_events, key=lambda x: (minutes(x["startTime"]), minutes(x["endTime"])))
        for i, left in enumerate(ordered):
            for right in ordered[i + 1:]:
                if minutes(right["startTime"]) >= minutes(left["endTime"]):
                    break
                overlaps.append({"groupId": group_id, "date": event_date, "left": left["sourceRef"]["locator"], "right": right["sourceRef"]["locator"]})

    counts = Counter(x["groupId"] for x in events)
    core = {
        "schema": "kgmu-normalized-draft-v1", "fixtureId": decisions["fixtureId"], "sourceFixtureId": source["fixtureId"],
        "sourceSha256": decisions["sourceSha256"], "parserRulesVersion": decisions["parserRulesVersion"],
        "status": "REVIEW_REQUIRED" if decisions["unresolved"] else "NORMALIZED",
        "assessmentMetadata": decisions["assessmentMetadata"], "events": events,
    }
    digest = "sha256:" + hashlib.sha256(stable_json(core).encode()).hexdigest()
    candidate = {**core, "candidateDigest": digest}
    review = {"schema": "kgmu-semantic-review-v1", "fixtureId": decisions["fixtureId"], "sourceSha256": decisions["sourceSha256"], "status": "REVIEW_REQUIRED" if decisions["unresolved"] else "RESOLVED", "items": decisions["unresolved"]}
    checks = [
        {"code":"source-identity-coherent","status":"pass","message":"source fixture, SourceArtifact, ParsingJob and mechanical probe resolve to the same official XLSX SHA-256"},
        {"code":"main-table-content-accounted-for","status":"pass","message":f"{len(decision_cells)}/{len(source_cells)} main-table cells normalized; {len(unresolved_cells)} represented explicitly in semantic review"},
        {"code":"source-cell-locator-coverage","status":"pass","message":f"all {len(decisions['decisions'])} decision segments point to cells present in the hash-pinned mechanical probe"},
        {"code":"groups-match-expected","status":"pass","message":"groups 191-194 only"},
        {"code":"dates-within-service-grid","status":"pass","message":f"all {len(events)} normalized base events fall inside B50 service-week intervals"},
        {"code":"hard-count-cross-checks","status":"pass","message":f"all {len(decisions['crossChecks'])} R07/R08/R83 cross-checks match explicit source events"},
        {"code":"assessment-metadata-lossless","status":"pass","message":f"{len(decisions['assessmentMetadata'])} source-explicit assessment metadata mappings preserved"},
        {"code":"duplicate-events-resolved","status":"pass","message":"0 duplicate normalized event signatures"},
        {"code":"source-backed-overlaps-preserved","status":"warning" if overlaps else "pass","message":f"{len(overlaps)} overlap pairs remain visible for G16/R69 audit; no time shifting/deletion"},
        {"code":"unresolved-ambiguities-zero-before-pass","status":"fail" if decisions["unresolved"] else "pass","message":f"{len(decisions['unresolved'])} unresolved item(s): R90 periodicity confirmation blocks B49 expansion/publication" if decisions["unresolved"] else "0 unresolved semantic ambiguities"},
        {"code":"publication-not-performed","status":"pass","message":"QA-only draft; no ScheduleVersion publish, production persistence, subscription or opaque ICS URL mutation"},
    ]
    qa_decision = "review-required" if decisions["unresolved"] else "pass"
    report = {"qaReportId":"qa-kgmu-2026-2027-s1-dentistry-191-194-719d8081-v2","parsingJobId":job["jobId"],"candidateDigest":digest,"decision":qa_decision,"checks":checks,"eventCount":len(events),"eventCountByGroup":dict(sorted(counts.items())),"overlapPairCount":len(overlaps),"unresolvedSemanticItemCount":len(decisions["unresolved"]),"readyForScheduleVersion":not decisions["unresolved"],"publicationPerformed":False}
    evidence = {"schema":"kgmu-dentistry-191-194-evidence-v1","fixtureId":decisions["fixtureId"],"sourceSha256":decisions["sourceSha256"],"sourceArtifactId":artifact["sourceArtifactId"],"parsingJobId":job["jobId"],"candidateDigest":digest,"logicalMainTableSourceCellCount":len(source_cells),"resolvedMainTableSourceCellCount":len(decision_cells),"normalizedBaseEventCount":len(events),"eventCountByGroup":dict(sorted(counts.items())),"duplicateSignatureCount":len(duplicates),"overlapPairs":overlaps,"assessmentMetadataCount":len(decisions["assessmentMetadata"]),"crossCheckCount":len(decisions["crossChecks"]),"unresolved":decisions["unresolved"]}

    NORMALIZED.parent.mkdir(parents=True, exist_ok=True); QA.mkdir(parents=True, exist_ok=True)
    for path, value in ((NORMALIZED,candidate),(EVIDENCE,evidence),(SEMANTIC_REVIEW,review),(QA_REPORT,report)):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"candidateDigest":digest,"eventCount":len(events),"eventCountByGroup":dict(sorted(counts.items())),"duplicateSignatureCount":len(duplicates),"overlapPairCount":len(overlaps),"resolvedMainTableSourceCellCount":len(decision_cells),"logicalMainTableSourceCellCount":len(source_cells),"unresolvedSemanticItemCount":len(decisions["unresolved"]),"qaDecision":qa_decision,"readyForScheduleVersion":not decisions["unresolved"]}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
