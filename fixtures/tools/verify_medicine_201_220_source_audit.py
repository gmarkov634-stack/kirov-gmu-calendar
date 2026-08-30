#!/usr/bin/env python3
"""Fail-closed mechanical audit for the approved medicine course-2 source fixtures.

No semantic parsing happens here. The script only checks that the currently
fetched official workbooks still match the approved fingerprints/geometry and
that every non-empty timetable cell is represented by an explicit decision
locator.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "medicine-201-220-source-probe.json"
STREAMS = {
    "201-210": {
        "rows": (7, 40),
        "source": ROOT / "fixtures/2026-2027-semester-1/medicine-201-210.source.json",
        "manifest": ROOT / "fixtures/2026-2027-semester-1/medicine-201-210.decisions.json",
    },
    "211-220": {
        "rows": (9, 43),
        "source": ROOT / "fixtures/2026-2027-semester-1/medicine-211-220.source.json",
        "manifest": ROOT / "fixtures/2026-2027-semester-1/medicine-211-220.decisions.json",
    },
}


def cell_column(coord: str) -> int:
    letters = re.match(r"([A-Z]+)", coord).group(1)
    value = 0
    for char in letters:
        value = value * 26 + ord(char) - 64
    return value


def cell_row(coord: str) -> int:
    return int(re.search(r"(\d+)$", coord).group(1))


def main() -> None:
    probe = json.loads(PROBE.read_text(encoding="utf-8"))
    if probe.get("semanticParsingPerformed") is not False:
        raise SystemExit("source probe must remain mechanical-only")
    sources = {entry["stream"]: entry for entry in probe.get("sources", [])}
    if set(sources) != set(STREAMS):
        raise SystemExit(f"unexpected probed streams: {sorted(sources)}")

    results = []
    for stream, config in STREAMS.items():
        actual = sources[stream]
        source = json.loads(config["source"].read_text(encoding="utf-8"))
        manifest = json.loads(config["manifest"].read_text(encoding="utf-8"))
        expected = source["source"]
        workbook = source["workbookExpectations"]

        for field in ["url", "sha256", "byteLength"]:
            if actual.get(field) != expected.get(field):
                raise SystemExit(f"{stream} source {field} changed: expected={expected.get(field)!r} actual={actual.get(field)!r}")
        if actual.get("sheetNames") != workbook["sheetNames"]:
            raise SystemExit(f"{stream} sheet names changed: {actual.get('sheetNames')}")
        if len(actual.get("sheets", [])) != 1:
            raise SystemExit(f"{stream} expected exactly one worksheet")
        sheet = actual["sheets"][0]
        checks = {
            "maxRow": sheet.get("maxRow"),
            "maxColumn": sheet.get("maxColumn"),
            "mergedRangeCount": len(sheet.get("mergedRanges", [])),
            "nonEmptyCellCount": sheet.get("nonEmptyCellCount"),
        }
        for key, value in checks.items():
            if value != workbook[key]:
                raise SystemExit(f"{stream} workbook {key} changed: expected={workbook[key]} actual={value}")

        start_row, end_row = config["rows"]
        logical = {
            cell["coord"]
            for cell in sheet.get("nonEmptyCells", [])
            if 2 <= cell_column(cell["coord"]) <= 11 and start_row <= cell_row(cell["coord"]) <= end_row
        }
        decision_cells = set()
        for decision in manifest.get("decisions", []):
            match = re.match(r"([A-Z]+\d+)#s\d+$", decision[0])
            if not match:
                raise SystemExit(f"{stream} unexpected decision locator: {decision[0]}")
            decision_cells.add(match.group(1))
        if logical != decision_cells:
            raise SystemExit(
                f"{stream} logical-cell coverage mismatch: missing={sorted(logical - decision_cells)} extra={sorted(decision_cells - logical)}"
            )
        if manifest.get("logicalSourceCellCount") != len(logical):
            raise SystemExit(f"{stream} manifest logicalSourceCellCount mismatch")
        classified = set(manifest.get("sourceClassifications", {}).get("coveredLogicalCells", []))
        if classified != logical:
            raise SystemExit(f"{stream} explicit coveredLogicalCells mismatch")

        cells = {cell["coord"]: cell for cell in sheet.get("nonEmptyCells", [])}
        if stream == "201-210":
            if "Анатомия 02.09-30.12 (1 занятие в чт.)" not in cells.get("G23", {}).get("value", ""):
                raise SystemExit("group 206 G23 Anatomy source text changed")
            if "Анатомия 30.12" not in cells.get("G28", {}).get("value", ""):
                raise SystemExit("group 206 G28 explicit Anatomy source text changed")
            if "12.09-онлайн" not in cells.get("B37", {}).get("value", ""):
                raise SystemExit("medicine/biophysics online lecture source text changed")
            if cells.get("B37", {}).get("hyperlinkTarget") not in (None, ""):
                raise SystemExit("B37 now contains a hyperlink target; semantic presentation evidence must be re-reviewed")

        results.append({
            "stream": stream,
            "sourceSha256": actual["sha256"],
            "logicalSourceCellCount": len(logical),
            "coveredSourceCellCount": len(decision_cells),
            "decision": "PASS_SOURCE_FINGERPRINT_AND_COVERAGE",
        })

    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
