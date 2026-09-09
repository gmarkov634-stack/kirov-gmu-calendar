#!/usr/bin/env python3
"""Derive a compact, deterministic QA conclusion from the C20 style probe.

This review deliberately distinguishes Excel merged-cell storage artifacts from
source-visible date-level evidence. It never chooses exceptional dates.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERIOD = "2026-2027-semester-1"
IN = ROOT / "qa" / PERIOD / "dentistry-391-394.c20-style-probe.json"
OUT = ROOT / "qa" / PERIOD / "dentistry-391-394.c20-evidence-review.json"
EXPECTED_SHA = "82fcb873776634553f9dcc5bf3da581654d59f4ef10db5ad6a779aa6d53f950d"


def main() -> None:
    probe = json.loads(IN.read_text(encoding="utf-8"))
    if probe["sourceSha256"] != EXPECTED_SHA:
        raise SystemExit(f"source hash mismatch: {probe['sourceSha256']}")
    if probe["targetRangeCount"] != 12 or len(probe["targetRanges"]) != 12:
        raise SystemExit("expected exactly 12 C20 target ranges")
    if probe["conditionalFormatting"]:
        raise SystemExit("conditional formatting exists; manual source review required")

    diagnostics = []
    for item in probe["targetRanges"]:
        cells = item["cells"]
        if not cells:
            raise SystemExit(f"empty target range: {item['range']}")
        first, rest = cells[0], cells[1:]
        if first["semanticStyle"]["cellClass"] != "Cell":
            raise SystemExit(f"top-left is not a real Cell: {item['range']}")
        if any(cell["semanticStyle"]["cellClass"] != "MergedCell" for cell in rest):
            raise SystemExit(f"non-placeholder inner cell found: {item['range']}")
        if any(cell["value"] is not None for cell in rest):
            raise SystemExit(f"date-level inner value found: {item['range']}")
        if any(cell["semanticStyle"]["fill"]["fillType"] is not None for cell in rest):
            raise SystemExit(f"date-level inner fill found: {item['range']}")
        diagnostics.append({
            "range": item["range"],
            "groupId": item["groupId"],
            "kind": item["kind"],
            "dateLabels": [cell["dateLabelRow11"] for cell in cells],
            "topLeftCell": first["coordinate"],
            "innerCellsAreMergedPlaceholders": True,
            "innerCellsCarryDateLevelValues": False,
            "innerCellsCarryDateLevelFills": False,
        })

    review = {
        "schema": "kgmu-c20-source-evidence-review-v1",
        "sourceSha256": EXPECTED_SHA,
        "status": "NO_DATE_LEVEL_SOURCE_EVIDENCE",
        "c20Resolution": "REVIEW_REQUIRED",
        "semanticInferencePerformed": False,
        "targetRangeCount": 12,
        "conditionalFormattingCount": 0,
        "finding": (
            "All 12 ambiguous cycles are single merged Excel ranges. The apparent "
            "within-range style variation is the top-left real Cell versus inner "
            "MergedCell placeholders (plus merged-edge borders), not a per-date source "
            "encoding. No conditional formatting or inner date-level values/fills identify "
            "which calendar dates use the exceptional time."
        ),
        "ruleConclusion": (
            "Canonical C20 remains applicable. Exceptional dates must not be guessed. "
            "C21 remains inapplicable because it is source-specific to a different historical XLSX."
        ),
        "diagnostics": diagnostics,
        "publishEligible": False,
    }
    OUT.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": review["status"],
        "c20Resolution": review["c20Resolution"],
        "targetRangeCount": review["targetRangeCount"],
        "conditionalFormattingCount": review["conditionalFormattingCount"],
        "publishEligible": review["publishEligible"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
