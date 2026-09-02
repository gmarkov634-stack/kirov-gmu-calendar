#!/usr/bin/env python3
"""Build a mechanical semantic-review inventory for KGMU Pediatrics course 3.

This intentionally does not normalize timetable events. It only partitions the
checked-in mechanical XLSX probe into source regions and extracts review cues.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "fixtures/2026-2027-semester-1/pediatrics-331-337.source-probe.json"
SOURCE = ROOT / "fixtures/2026-2027-semester-1/pediatrics-331-337.source.json"
OUT = ROOT / "qa/2026-2027-semester-1/pediatrics-331-337.source-inventory.json"

CELL_RE = re.compile(r"^([A-Z]+)(\d+)$")
CROSS_DAY_RE = re.compile(
    r"\((\d+)\s+(занят(?:ие|ия|ий)|лекци(?:я|и|й))\s+в\s+([^)]+)\)",
    re.IGNORECASE,
)
DATE_RE = re.compile(r"(?<!\d)(\d{1,2}\.\d{1,2})(?!\d)")
TIME_RE = re.compile(r"(?<!\d)(\d{1,2}\.\d{2})(?!\d)")


def column_number(name: str) -> int:
    value = 0
    for ch in name:
        value = value * 26 + ord(ch) - 64
    return value


def classify(coord: str) -> str:
    match = CELL_RE.match(coord)
    if not match:
        return "unclassified"
    col_name, row_text = match.groups()
    col = column_number(col_name)
    row = int(row_text)
    if 1 <= row <= 6:
        return "header"
    if row == 7 and 2 <= col <= 8:
        return "group-header"
    if 8 <= row <= 33 and 1 <= col <= 9:
        return "timetable"
    if row == 34:
        return "service-week-grid"
    if 35 <= row <= 42 and 1 <= col <= 9:
        return "reference-table"
    if 43 <= row <= 44:
        return "footer"
    return "unclassified"


def main() -> None:
    probe = json.loads(PROBE.read_text(encoding="utf-8"))
    source_manifest = json.loads(SOURCE.read_text(encoding="utf-8"))
    source = probe["source"]
    assert source["sha256"] == source_manifest["source"]["sha256"]
    assert source["groups"] == source_manifest["expectedGroupIds"]
    assert source["sheetNames"] == source_manifest["workbookExpectations"]["sheetNames"]

    cells = source["sheets"][0]["nonEmptyCells"]
    inventory = []
    region_counts = {}
    cross_day_cues = []
    suspicious_literals = []

    for cell in cells:
        coord = cell["coord"]
        value = cell["value"]
        region = classify(coord)
        region_counts[region] = region_counts.get(region, 0) + 1
        item = {"locator": f"3пед.!{coord}", "region": region, "raw": value}
        inventory.append(item)

        if region == "timetable":
            for count, kind, target_day in CROSS_DAY_RE.findall(value):
                cross_day_cues.append({
                    "sourceLocator": f"3пед.!{coord}",
                    "expectedCount": int(count),
                    "kind": kind.lower(),
                    "targetDayRaw": target_day.strip(),
                    "explicitDateTokens": DATE_RE.findall(value),
                    "timeTokens": TIME_RE.findall(value),
                    "raw": value,
                })
        if "Щорса, 640" in value:
            suspicious_literals.append({
                "sourceLocator": f"3пед.!{coord}",
                "literal": "ул. Щорса, 640",
                "reason": "address literal differs from another same-workbook reference entry; no correction applied",
            })

    unclassified = [item for item in inventory if item["region"] == "unclassified"]
    payload = {
        "schema": "kgmu-source-semantic-inventory-v1",
        "fixtureId": source_manifest["fixtureId"],
        "sourceSha256": source["sha256"],
        "sheetName": source["sheetNames"][0],
        "semanticNormalizationPerformed": False,
        "regionCounts": region_counts,
        "nonEmptyCellCount": len(cells),
        "allNonEmptyCellsMechanicallyPartitioned": len(unclassified) == 0,
        "unclassifiedCells": unclassified,
        "crossDayExpectationCues": cross_day_cues,
        "suspiciousSourceLiterals": suspicious_literals,
        "cells": inventory,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "sourceSha256": payload["sourceSha256"],
        "nonEmptyCellCount": payload["nonEmptyCellCount"],
        "regionCounts": payload["regionCounts"],
        "allNonEmptyCellsMechanicallyPartitioned": payload["allNonEmptyCellsMechanicallyPartitioned"],
        "crossDayExpectationCueCount": len(cross_day_cues),
        "suspiciousLiteralCount": len(suspicious_literals),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
