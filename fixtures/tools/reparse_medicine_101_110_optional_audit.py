#!/usr/bin/env python3
import hashlib
import io
import json
import re
import urllib.request
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[2]
SOURCE_META = ROOT / "fixtures/2026-2027-semester-1/medicine-101-110.source.json"
DECISIONS = ROOT / "fixtures/2026-2027-semester-1/medicine-101-110.decisions.json"
DUMP_PATH = ROOT / "medicine-101-110-workbook-dump.json"
SHEET_NAME = "1 леч.1"
EXPECTED_LOGICAL_CELLS = 145
OPTIONAL_RE = re.compile(r"факультатив|электив|по выбор", re.IGNORECASE)


def optional_kind(coord, text):
    lowered = text.lower()
    if "факультатив" in lowered:
        if coord == "A43":
            return "facultative-schedule-row"
        return "facultative-reference"
    if "элективные дисциплины (модули) по физической культуре и спорту" in lowered:
        return "elective-umbrella" if coord == "B16" else "elective-reference"
    return "elective-candidate"


def main():
    meta = json.loads(SOURCE_META.read_text(encoding="utf-8"))
    manifest = json.loads(DECISIONS.read_text(encoding="utf-8"))

    data = urllib.request.urlopen(meta["source"]["url"], timeout=30).read()
    actual_sha = hashlib.sha256(data).hexdigest()
    if actual_sha != meta["source"]["sha256"]:
        raise SystemExit(f"source SHA mismatch: {actual_sha}")
    if len(data) != meta["source"]["byteLength"]:
        raise SystemExit(f"source byteLength mismatch: {len(data)}")

    workbook = load_workbook(io.BytesIO(data), data_only=False)
    if workbook.sheetnames != meta["workbookExpectations"]["sheetNames"]:
        raise SystemExit(f"sheet set changed: {workbook.sheetnames}")
    sheet = workbook[SHEET_NAME]

    full_cells = []
    full_sheet_optional = []
    for row in sheet.iter_rows(min_row=1, max_row=sheet.max_row, min_col=1, max_col=sheet.max_column):
        for cell in row:
            if cell.value is None:
                continue
            text = str(cell.value).strip()
            entry = {"coord": cell.coordinate, "value": text}
            full_cells.append(entry)
            if OPTIONAL_RE.search(text):
                full_sheet_optional.append({**entry, "kind": optional_kind(cell.coordinate, text)})

    dump = {
        "sourceSha256": actual_sha,
        "byteLength": len(data),
        "sheet": SHEET_NAME,
        "maxRow": sheet.max_row,
        "maxColumn": sheet.max_column,
        "nonEmptyCells": full_cells,
        "mergedRanges": [str(rng) for rng in sheet.merged_cells.ranges],
        "optionalTermMatches": full_sheet_optional,
    }
    DUMP_PATH.write_text(json.dumps(dump, ensure_ascii=False, indent=2), encoding="utf-8")

    logical = []
    for row in sheet.iter_rows(min_row=9, max_row=42, min_col=2, max_col=11):
        for cell in row:
            if cell.value is not None:
                logical.append(cell.coordinate)

    if len(logical) != EXPECTED_LOGICAL_CELLS:
        raise SystemExit(f"logical source cell count changed: {len(logical)}")

    covered = set()
    for decision in manifest["decisions"]:
        locator = decision[0]
        match = re.match(r"([A-Z]+\d+)#s\d+$", locator)
        if not match:
            raise SystemExit(f"unexpected decision locator: {locator}")
        covered.add(match.group(1))

    missing = sorted(set(logical) - covered)
    extra = sorted(covered - set(logical))
    if missing or extra:
        raise SystemExit(f"source coverage mismatch: missing={missing} extra={extra}")

    schedule_facultatives = [item for item in full_sheet_optional if item["kind"] == "facultative-schedule-row"]
    elective_candidates = [item for item in full_sheet_optional if item["kind"] == "elective-candidate"]
    result = {
        "sourceSha256": actual_sha,
        "logicalSourceCellCount": len(logical),
        "coveredSourceCellCount": len(covered),
        "fullSheetOptionalCandidates": full_sheet_optional,
        "facultativeScheduleRows": schedule_facultatives,
        "facultativeCandidateCount": len(schedule_facultatives),
        "electiveOptionCandidateCount": len(elective_candidates),
        "decision": "REVIEW_REQUIRED" if schedule_facultatives or elective_candidates else "PASS_NO_EXPLICIT_OPTION_VARIANTS",
        "note": "A43:K43 is outside the historical B9:K42 decision range but is a merged all-groups facultative schedule row and must not be silently ignored under R39/R78."
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if result["decision"] == "REVIEW_REQUIRED":
        raise SystemExit("REVIEW_REQUIRED: optional schedule content requires semantic normalization")


if __name__ == "__main__":
    main()
