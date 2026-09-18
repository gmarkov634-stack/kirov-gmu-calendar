#!/usr/bin/env python3
"""Finalize the course-specific Dentistry 591-594 normalized draft and QA.

Runs the deterministic builder, then records fail-closed semantic evidence for
the unresolved common Practice period in the current official XLSX. No DB,
object-storage, ScheduleVersion or publication write is performed.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERIOD = "2026-2027-semester-1"
FIXTURE_DIR = ROOT / "fixtures" / PERIOD
QA_DIR = ROOT / "qa" / PERIOD
SOURCE_PATH = FIXTURE_DIR / "dentistry-591-594.source.json"
JOB_PATH = FIXTURE_DIR / "dentistry-591-594.parsing-job.json"
PROBE_PATH = FIXTURE_DIR / "dentistry-591-594.source-probe.json"
COMPACT_PATH = FIXTURE_DIR / "normalized" / "dentistry-591-594.normalized.compact.json"
BUILDER = ROOT / "fixtures" / "tools" / "build_dentistry_591_594_candidate.py"
EXPECTED_SHA = "0c8b13b7e4dc409eaec551f8d4720d77dee88d76e8e7e89e4efcfe2aeed42109"
EXPECTED_GROUPS = ["591", "592", "593", "594"]
EXPECTED_RULES = "kgmu-2026-08-27-v3"
PRACTICE_RANGE = "DC15:DN18"
EXAM_RANGE = "CW15:DB18"
HOLIDAY_RANGE = "DO15:DT18"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def col_number(name: str) -> int:
    value = 0
    for char in name:
        value = value * 26 + ord(char) - 64
    return value


def coord_parts(coord: str):
    match = re.fullmatch(r"([A-Z]+)(\d+)", coord)
    if not match:
        raise SystemExit(f"bad cell coordinate: {coord}")
    return col_number(match.group(1)), int(match.group(2))


def range_parts(value: str):
    start, end = value.split(":")
    sc, sr = coord_parts(start)
    ec, er = coord_parts(end)
    return sc, sr, ec, er


def dates_for_range(probe, range_text: str):
    source = probe["source"]
    sheet = source["sheets"][0]
    cells = {item["coord"]: str(item["value"]).strip() for item in sheet["nonEmptyCells"]}
    merged = {item for item in sheet["mergedRanges"]}
    if range_text not in merged:
        raise SystemExit(f"expected merged range missing: {range_text}")

    month_map = {"Сентябрь": (2026, 9), "Октябрь": (2026, 10), "Ноябрь": (2026, 11), "Декабрь": (2026, 12), "Январь": (2027, 1)}
    spans = []
    for rng in sheet["mergedRanges"]:
        sc, sr, ec, er = range_parts(rng)
        if sr != 12 or er != 12:
            continue
        start_coord = re.match(r"([A-Z]+)", rng).group(1) + "12"
        month_name = cells.get(start_coord)
        if month_name in month_map:
            year, month = month_map[month_name]
            spans.append((sc, ec, year, month))
    if len(spans) != 5:
        raise SystemExit(f"month geometry mismatch: {spans}")

    day_by_col = {}
    for coord, value in cells.items():
        col, row = coord_parts(coord)
        if row != 13 or not value.isdigit():
            continue
        span = next((item for item in spans if item[0] <= col <= item[1]), None)
        if span is None:
            continue
        day_by_col[col] = date(span[2], span[3], int(value)).isoformat()

    sc, _sr, ec, _er = range_parts(range_text)
    return [day_by_col[col] for col in range(sc, ec + 1) if col in day_by_col]


def overlap_pairs(events):
    def minutes(clock):
        h, m = map(int, clock.split(":"))
        return h * 60 + m
    by_day = defaultdict(list)
    for event in events:
        by_day[(event[1], event[2])].append(event)
    overlaps = []
    for (group, day), items in sorted(by_day.items()):
        ordered = sorted(items, key=lambda e: (e[3], e[4], e[5], e[9]))
        for index, first in enumerate(ordered):
            for second in ordered[index + 1:]:
                if minutes(first[3]) < minutes(second[4]) and minutes(second[3]) < minutes(first[4]):
                    overlaps.append({
                        "groupId": group,
                        "date": day,
                        "left": f"{first[3]}-{first[4]} {first[5]}",
                        "right": f"{second[3]}-{second[4]} {second[5]}",
                        "sourceBacked": True,
                    })
    return overlaps


def main():
    subprocess.run([sys.executable, str(BUILDER), "--write"], cwd=ROOT, check=True)

    source_cfg = read_json(SOURCE_PATH)
    job = read_json(JOB_PATH)
    probe = read_json(PROBE_PATH)
    compact = read_json(COMPACT_PATH)

    if source_cfg["source"]["sha256"] != EXPECTED_SHA or probe["source"]["sha256"] != EXPECTED_SHA:
        raise SystemExit("source hash mismatch")
    if source_cfg["parserProfile"] != "cyclic":
        raise SystemExit(f"course 5 must use cyclic/C profile, got {source_cfg['parserProfile']}")
    if source_cfg["parserRulesVersion"] != EXPECTED_RULES:
        raise SystemExit("parser rules mismatch")
    if source_cfg["expectedGroupIds"] != EXPECTED_GROUPS or job["expectedGroupIds"] != EXPECTED_GROUPS:
        raise SystemExit("group scope mismatch")
    if compact["eventCount"] != 492 or compact["groupEventCounts"] != {group: 123 for group in EXPECTED_GROUPS}:
        raise SystemExit("normalized event count changed")

    events = compact["events"]
    duplicates = len(events) - len({tuple(event[1:]) for event in events})
    if duplicates:
        raise SystemExit(f"duplicate normalized event signatures: {duplicates}")
    overlaps = overlap_pairs(events)
    if len(overlaps) != 3:
        raise SystemExit(f"source-backed overlap count changed: {len(overlaps)}")

    practice_dates = dates_for_range(probe, PRACTICE_RANGE)
    exam_dates = dates_for_range(probe, EXAM_RANGE)
    holiday_dates = dates_for_range(probe, HOLIDAY_RANGE)
    expected_practice_dates = [
        "2027-01-11", "2027-01-12", "2027-01-13", "2027-01-14", "2027-01-15", "2027-01-16",
        "2027-01-18", "2027-01-19", "2027-01-20", "2027-01-21", "2027-01-22", "2027-01-23",
    ]
    if practice_dates != expected_practice_dates:
        raise SystemExit(f"practice range dates changed: {practice_dates}")

    group_rows = {15: "591", 16: "592", 17: "593", 18: "594"}
    academic_last = col_number("CV")
    academic_blocks = []
    combined_blocks = []
    cells = {item["coord"]: str(item["value"]).strip() for item in probe["source"]["sheets"][0]["nonEmptyCells"]}
    for rng in probe["source"]["sheets"][0]["mergedRanges"]:
        sc, sr, ec, er = range_parts(rng)
        if sr in group_rows and er == sr and sc >= col_number("C") and ec <= academic_last:
            start_col = re.match(r"([A-Z]+)", rng).group(1)
            locator = f"{start_col}{sr}"
            raw = re.sub(r"\s+", " ", cells.get(locator, "")).strip()
            academic_blocks.append({"groupId": group_rows[sr], "range": rng, "label": raw})
            if "Медицина катастроф" in raw and "Физическая подготовка" in raw:
                combined_blocks.append(rng)
    by_group_blocks = dict(sorted(Counter(item["groupId"] for item in academic_blocks).items()))
    if len(academic_blocks) != 33 or by_group_blocks != {"591": 8, "592": 8, "593": 8, "594": 9}:
        raise SystemExit(f"academic block accounting changed: {len(academic_blocks)} {by_group_blocks}")
    if len(combined_blocks) != 4:
        raise SystemExit(f"combined block count changed: {combined_blocks}")

    elective_count = sum(event[5] == "Элективные дисциплины по физической культуре и спорту" for event in events)
    if elective_count != 64:
        raise SystemExit(f"elective event count changed: {elective_count}")
    assessment_count = sum(event[8] is not None for event in events)
    digest_check = "sha256:" + hashlib.sha256(json.dumps(events, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
    if digest_check != compact["candidateDigest"]:
        raise SystemExit("candidate digest mismatch")

    unresolved_occurrences = len(practice_dates) * len(EXPECTED_GROUPS)
    unresolved = [{
        "rule": "G04/G21",
        "kind": "practice-period",
        "locator": PRACTICE_RANGE,
        "groupIds": EXPECTED_GROUPS,
        "dates": practice_dates,
        "sourceLabel": "Практика",
        "c22Applicable": False,
        "c22Reason": "Canonical C22 is source-specific to a different historical 5-course XLSX and cannot supply title/time/location for 5_stomat-24-08-2026-14.xlsx.",
        "reason": "The current official XLSX provides the Practice period dates but not an exact practice title, daily time or location; these details are therefore withheld rather than inferred.",
    }]

    source_artifact = {
        "schema": "kgmu-source-artifact-evidence-v1",
        "sourceArtifactId": source_cfg["source"]["sourceArtifactId"],
        "universityId": "kirov-gmu",
        "academicPeriodId": PERIOD,
        "sourceId": "dentistry",
        "originUrl": source_cfg["source"]["url"],
        "sha256": EXPECTED_SHA,
        "byteLength": source_cfg["source"]["byteLength"],
        "mediaType": source_cfg["source"]["mimeType"],
        "sourceObjectKey": source_cfg["source"]["objectKey"],
        "expectedGroupIds": EXPECTED_GROUPS,
        "evidence": {"mechanicalProbeFile": str(PROBE_PATH.relative_to(ROOT))},
        "productionObjectStorageWritePerformed": False,
        "productionDatabaseWritePerformed": False,
        "publicationPerformed": False,
    }
    parsing_result = {
        "schema": "kgmu-parsing-result-v1",
        "jobId": job["jobId"],
        "sourceArtifactId": source_cfg["source"]["sourceArtifactId"],
        "sourceSha256": EXPECTED_SHA,
        "parserProfile": "cyclic",
        "profileLayer": "C",
        "parserRulesVersion": EXPECTED_RULES,
        "courseParserRulesVersion": source_cfg["courseParserRulesVersion"],
        "status": "REVIEW_REQUIRED",
        "expectedGroupIds": EXPECTED_GROUPS,
        "sheetName": probe["source"]["sheetNames"][0],
        "logicalSourceBlockCount": 37,
        "groupLocalCycleBlockCount": len(academic_blocks),
        "independentScheduleBlockCount": 1,
        "serviceBlockCount": 2,
        "unresolvedCommonBlockCount": 1,
        "resolvedOccurrenceCount": len(events),
        "unresolvedOccurrenceCount": unresolved_occurrences,
        "diagnostics": unresolved,
        "serviceBlocks": [
            {"rule": "C07/C14", "locator": EXAM_RANGE, "label": "Экзамены", "dates": exam_dates},
            {"rule": "G07", "locator": HOLIDAY_RANGE, "label": "Каникулы", "dates": holiday_dates},
        ],
    }
    normalized_index = {
        "schema": "kgmu-normalized-draft-index-v1",
        "draftId": f"normalized-draft-dentistry-591-594-{EXPECTED_SHA[:16]}-v1",
        "parsingJobId": job["jobId"],
        "sourceArtifactId": source_cfg["source"]["sourceArtifactId"],
        "sourceSha256": EXPECTED_SHA,
        "parserProfile": "cyclic",
        "profileLayer": "C",
        "parserRulesVersion": EXPECTED_RULES,
        "status": "REVIEW_REQUIRED",
        "coverage": "safe-resolved-subset",
        "candidatePath": str(COMPACT_PATH.relative_to(ROOT)),
        "candidateDigest": compact["candidateDigest"],
        "eventCount": len(events),
        "eventCountsByGroup": compact["groupEventCounts"],
        "assessmentBearingEventCount": assessment_count,
        "sourceBackedOverlapCount": len(overlaps),
        "unresolvedEventOccurrenceCount": unresolved_occurrences,
        "expectedGroupIds": EXPECTED_GROUPS,
    }
    semantic_review = {
        "schema": "kgmu-semantic-review-v1",
        "sourceSha256": EXPECTED_SHA,
        "status": "REVIEW_REQUIRED",
        "parserProfile": "C",
        "sourceScope": {"program": "dentistry", "course": 5, "groupIds": EXPECTED_GROUPS},
        "ruleApplications": [
            {"rule": "C01/C08", "result": "PASS", "detail": "33 group-local merged cycle blocks expanded across explicit calendar columns and normalized against the lower reference table."},
            {"rule": "G09", "result": "PASS", "detail": "Four source cells containing Medicine of Disasters and Physical Training are split into separate events using each discipline's explicit lower-table time and location."},
            {"rule": "C12", "result": "PASS", "detail": "The independent Friday physical-culture elective schedule expands to 16 Fridays per group (64 events)."},
            {"rule": "C07/C14", "result": "PASS", "detail": "The common Exam period is service metadata only; no synthetic exam events are created."},
            {"rule": "G07", "result": "PASS", "detail": "The common Holiday block is non-study metadata and creates no class events."},
            {"rule": "G04/G21", "result": "REVIEW_REQUIRED", "detail": "The current source Practice period has explicit dates but lacks an exact practice title, daily time and location."},
            {"rule": "C22", "result": "NOT_APPLICABLE", "detail": "C22 belongs to a different historical 5-course source and is not transplanted to the current 2026/27 XLSX."},
        ],
        "unresolved": unresolved,
        "publishEligible": False,
    }
    qa_report = {
        "schema": "kgmu-qa-report-v1",
        "sourceSha256": EXPECTED_SHA,
        "draftId": normalized_index["draftId"],
        "status": "REVIEW_REQUIRED",
        "publishEligible": False,
        "checks": [
            {"name": "official-source-hash", "status": "PASS", "detail": EXPECTED_SHA},
            {"name": "group-scope", "status": "PASS", "detail": EXPECTED_GROUPS},
            {"name": "parser-profile", "status": "PASS", "detail": f"cyclic/C @ {EXPECTED_RULES}"},
            {"name": "idempotent-identities", "status": "PASS", "detail": {"sourceArtifactId": source_cfg["source"]["sourceArtifactId"], "parsingJobId": job["jobId"]}},
            {"name": "logical-source-accounting", "status": "PASS", "detail": "37 logical blocks: 33 group-local cycles + 1 independent elective schedule + 2 service periods + 1 unresolved common Practice period."},
            {"name": "group-local-source-coverage", "status": "PASS", "detail": {"blocks": 33, "byGroup": by_group_blocks}},
            {"name": "safe-normalized-events", "status": "PASS", "detail": {"eventCount": len(events), "byGroup": compact["groupEventCounts"]}},
            {"name": "assessment-metadata", "status": "PASS", "detail": {"eventCount": assessment_count}},
            {"name": "combined-discipline-split", "status": "PASS", "detail": {"sourceBlocks": len(combined_blocks)}},
            {"name": "physical-culture-independent-schedule", "status": "PASS", "detail": {"events": elective_count, "perGroup": 16}},
            {"name": "duplicates", "status": "PASS", "detail": 0},
            {"name": "source-backed-overlaps", "status": "SOURCE_CONFLICT" if overlaps else "PASS", "detail": overlaps},
            {"name": "practice-period-resolution", "status": "REVIEW_REQUIRED", "detail": {"locator": PRACTICE_RANGE, "dates": practice_dates, "impactedGroups": EXPECTED_GROUPS, "unresolvedOccurrences": unresolved_occurrences}},
            {"name": "production-write-boundary", "status": "PASS", "detail": "No production object-storage write, DB write, ScheduleVersion creation or publication performed."},
        ],
        "blockers": [
            "Current XLSX block DC15:DN18 is labelled only 'Практика'. Exact practice title, daily time and location are not present and cannot be imported from historical C22 evidence."
        ],
        "scheduleVersionReady": False,
        "publicationPerformed": False,
    }

    write_json(FIXTURE_DIR / "dentistry-591-594.source-artifact.json", source_artifact)
    write_json(QA_DIR / "dentistry-591-594.parsing-result.json", parsing_result)
    write_json(QA_DIR / "dentistry-591-594.normalized-draft.json", normalized_index)
    write_json(QA_DIR / "dentistry-591-594.semantic-review.json", semantic_review)
    write_json(QA_DIR / "dentistry-591-594.qa-report.json", qa_report)

    print(json.dumps({
        "status": "REVIEW_REQUIRED",
        "sourceSha256": EXPECTED_SHA,
        "eventCount": len(events),
        "groupEventCounts": compact["groupEventCounts"],
        "candidateDigest": compact["candidateDigest"],
        "assessmentBearingEventCount": assessment_count,
        "sourceBackedOverlapCount": len(overlaps),
        "unresolvedPracticeDates": len(practice_dates),
        "unresolvedPracticeOccurrences": unresolved_occurrences,
        "scheduleVersionReady": False,
        "publicationPerformed": False,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
