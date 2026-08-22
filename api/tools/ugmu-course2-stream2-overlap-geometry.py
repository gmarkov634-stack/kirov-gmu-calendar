#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any

EXPECTED_SHA256 = "07675a77bdb80080ea018a73750f00f458cc100fcd01a63ecaf142430bca94bd"
TARGET_PREFIX = "клиническ"
TARGET_FRAGMENT = "биохим"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_raw_module():
    module_path = Path(__file__).with_name("ugmu-course2-stream2-raw.py")
    spec = importlib.util.spec_from_file_location("ugmu_course2_stream2_raw", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load stream-II raw extractor")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rounded_bbox(cell: tuple[float, float, float, float]) -> list[float]:
    return [round(float(value), 3) for value in cell]


def build(path: Path) -> dict[str, Any]:
    actual_sha = sha256_file(path)
    if actual_sha != EXPECTED_SHA256:
        raise RuntimeError(f"Unexpected stream-II SHA-256: {actual_sha}")

    import pdfplumber  # type: ignore

    raw = load_raw_module()
    with pdfplumber.open(path) as document:
        page = document.pages[0]
        table, geometry = raw.find_weekly_table(page)
        group_centers = raw.header_group_centers(table, geometry)
        bounds = raw.weekday_bounds(page, geometry)
        all_cells: list[dict[str, Any]] = []
        target_rows: set[int] = set()
        seen: set[tuple[Any, ...]] = set()

        for row_index, row_values in enumerate(table[1:-1], start=1):
            row_geometry = geometry.rows[row_index]
            center_y = raw.smallest_cell_center(row_geometry)
            day = next((name for name, top, bottom in bounds if top <= center_y < bottom), None)
            for column_index in range(1, min(len(row_values), len(row_geometry.cells))):
                value = row_values[column_index]
                cell = row_geometry.cells[column_index]
                if value is None or cell is None or not raw.compact(value):
                    continue
                text = raw.compact(value)
                key = (row_index, *[round(float(v), 4) for v in cell], text)
                if key in seen:
                    continue
                seen.add(key)
                x0, top, x1, bottom = cell
                covered = [
                    group
                    for group, center in group_centers.items()
                    if x0 - 1e-6 <= center <= x1 + 1e-6
                ]
                item = {
                    "rowIndex": row_index,
                    "columnIndex": column_index,
                    "inferredWeekday": day,
                    "rowCenterY": round(float(center_y), 3),
                    "bbox": rounded_bbox(cell),
                    "text": text,
                    "coveredGroups": covered,
                    "coveredGroupCount": len(covered),
                }
                all_cells.append(item)
                lowered = text.lower()
                if day == "суббота" and (TARGET_PREFIX in lowered or TARGET_FRAGMENT in lowered):
                    target_rows.add(row_index)

        if not target_rows:
            raise RuntimeError("Saturday Clinical Biochemistry source rows were not found")

        sibling_cells = [item for item in all_cells if item["rowIndex"] in target_rows]
        sibling_cells.sort(key=lambda item: (item["rowCenterY"], item["bbox"][0], item["text"]))
        target_cells = [
            item
            for item in sibling_cells
            if TARGET_PREFIX in item["text"].lower() or TARGET_FRAGMENT in item["text"].lower()
        ]

    return {
        "mode": "stream2-overlap-geometry-read-only",
        "sourceSha256": actual_sha,
        "groupCenters": {group: round(float(center), 3) for group, center in group_centers.items()},
        "targetRowIndexes": sorted(target_rows),
        "targetCells": target_cells,
        "targetRowSiblingCells": sibling_cells,
        "summary": {
            "targetRowCount": len(target_rows),
            "targetCellCount": len(target_cells),
            "targetSiblingCellCount": len(sibling_cells),
            "productionMutationPerformed": False,
            "semanticRuleChanged": False,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only geometry audit for UGMU course-2 stream-II overlap")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = build(Path(args.input))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
