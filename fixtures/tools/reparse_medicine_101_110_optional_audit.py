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
SHEET_NAME = "1 леч.1"
EXPECTED_LOGICAL_CELLS = 145
OPTIONAL_RE = re.compile(r"факульт|электив", re.IGNORECASE)


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

    logical = []
    optional = []
    for row in sheet.iter_rows(min_row=9, max_row=42, min_col=2, max_col=11):
        for cell in row:
            if cell.value is None:
                continue
            logical.append(cell.coordinate)
            text = str(cell.value).strip()
            if OPTIONAL_RE.search(text):
                lowered = text.lower()
                if "факульт" in lowered:
                    kind = "facultative-candidate"
                elif "элективные дисциплины (модули) по физической культуре и спорту" in lowered:
                    kind = "elective-umbrella"
                else:
                    kind = "elective-candidate"
                optional.append({"coord": cell.coordinate, "kind": kind, "text": text})

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

    facultatives = [item for item in optional if item["kind"] == "facultative-candidate"]
    elective_candidates = [item for item in optional if item["kind"] == "elective-candidate"]
    result = {
        "sourceSha256": actual_sha,
        "logicalSourceCellCount": len(logical),
        "coveredSourceCellCount": len(covered),
        "optionalCandidates": optional,
        "facultativeCandidateCount": len(facultatives),
        "electiveOptionCandidateCount": len(elective_candidates),
        "decision": "REVIEW_REQUIRED" if facultatives or elective_candidates else "PASS_NO_EXPLICIT_OPTION_VARIANTS",
        "note": "Generic elective physical-culture umbrella rows remain canonical schedule events unless the XLSX explicitly enumerates selectable options. No facultativeId/selectionOptionId is invented from an umbrella title."
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
