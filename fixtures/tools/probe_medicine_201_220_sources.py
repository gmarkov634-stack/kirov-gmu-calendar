#!/usr/bin/env python3
"""Mechanical XLSX source probe for KGMU medicine groups 201-220.

This helper intentionally performs no semantic parsing. It only fetches the two
official workbooks and records checksums, workbook geometry, merged ranges and
non-empty cell values for operator/ChatGPT review under canonical G/R rules.
"""
import hashlib
import io
import json
import urllib.request
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "medicine-201-220-source-probe.json"

SOURCES = [
    {
        "stream": "201-210",
        "url": "https://kirovgma.ru/sites/default/files/files/2026/08/24/1078/2_lech._1_potok-24-08-2026-13.xlsx",
    },
    {
        "stream": "211-220",
        "url": "https://kirovgma.ru/sites/default/files/files/2026/08/24/1078/2_lech._2_potok-24-08-2026-13.xlsx",
    },
]


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "kgmu-calendar-source-probe/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read()
    if not data.startswith(b"PK"):
        raise SystemExit(f"source is not XLSX/ZIP: {url}")
    return data


def workbook_dump(source: dict) -> dict:
    data = fetch(source["url"])
    workbook = load_workbook(io.BytesIO(data), data_only=False)
    sheets = []
    for sheet in workbook.worksheets:
        non_empty = []
        for row in sheet.iter_rows(min_row=1, max_row=sheet.max_row, min_col=1, max_col=sheet.max_column):
            for cell in row:
                if cell.value is None:
                    continue
                non_empty.append({"coord": cell.coordinate, "value": str(cell.value).strip()})
        sheets.append(
            {
                "title": sheet.title,
                "maxRow": sheet.max_row,
                "maxColumn": sheet.max_column,
                "mergedRanges": [str(rng) for rng in sheet.merged_cells.ranges],
                "nonEmptyCellCount": len(non_empty),
                "nonEmptyCells": non_empty,
            }
        )
    return {
        **source,
        "sha256": hashlib.sha256(data).hexdigest(),
        "byteLength": len(data),
        "sheetNames": workbook.sheetnames,
        "sheets": sheets,
    }


def main() -> None:
    payload = {
        "schema": "kgmu-mechanical-source-probe-v1",
        "semanticParsingPerformed": False,
        "sources": [workbook_dump(source) for source in SOURCES],
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = [
        {
            "stream": source["stream"],
            "sha256": source["sha256"],
            "byteLength": source["byteLength"],
            "sheetNames": source["sheetNames"],
            "dimensions": [
                [sheet["title"], sheet["maxRow"], sheet["maxColumn"], len(sheet["mergedRanges"]), sheet["nonEmptyCellCount"]]
                for sheet in source["sheets"]
            ],
        }
        for source in payload["sources"]
    ]
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
