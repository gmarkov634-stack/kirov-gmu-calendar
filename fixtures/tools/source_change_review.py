#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path


LOCATOR_RE = re.compile(r"^(?:[^!]+!)?([A-Z]+\d+)(?:#s\d+)?$")
COORD_RE = re.compile(r"^([A-Z]+)(\d+)$")


class SourceChangeReviewError(RuntimeError):
    pass


def column_number(letters: str) -> int:
    result = 0
    for char in letters:
        if char < "A" or char > "Z":
            raise SourceChangeReviewError(f"invalid column letters: {letters}")
        result = result * 26 + (ord(char) - ord("A") + 1)
    return result


def coordinate_key(coord: str):
    match = COORD_RE.fullmatch(coord)
    if not match:
        raise SourceChangeReviewError(f"invalid cell coordinate: {coord}")
    return (int(match.group(2)), column_number(match.group(1)))


def coordinate_in_bounds(coord: str, *, min_row: int, max_row: int, min_col: int, max_col: int) -> bool:
    row, col = coordinate_key(coord)
    return min_row <= row <= max_row and min_col <= col <= max_col


def decision_coordinate(locator: str) -> str:
    if not isinstance(locator, str):
        raise SourceChangeReviewError("decision locator must be a string")
    match = LOCATOR_RE.fullmatch(locator)
    if not match:
        raise SourceChangeReviewError(f"unsupported decision locator: {locator}")
    return match.group(1)


def build_source_change_review(
    *,
    workbook_dump,
    decisions,
    min_row: int,
    max_row: int,
    min_col: int,
    max_col: int,
):
    current_cells = {
        item["coord"]
        for item in workbook_dump.get("nonEmptyCells", [])
        if isinstance(item, dict)
        and isinstance(item.get("coord"), str)
        and coordinate_in_bounds(
            item["coord"],
            min_row=min_row,
            max_row=max_row,
            min_col=min_col,
            max_col=max_col,
        )
    }
    approved_cells = set()
    for decision in decisions.get("decisions", []):
        if not isinstance(decision, list) or not decision:
            raise SourceChangeReviewError("each semantic decision must be a non-empty array")
        coord = decision_coordinate(decision[0])
        if coordinate_in_bounds(
            coord,
            min_row=min_row,
            max_row=max_row,
            min_col=min_col,
            max_col=max_col,
        ):
            approved_cells.add(coord)

    missing = sorted(approved_cells - current_cells, key=coordinate_key)
    added = sorted(current_cells - approved_cells, key=coordinate_key)
    current_sha = workbook_dump.get("sourceSha256")
    approved_sha = decisions.get("sourceSha256")
    fingerprint_matches = (
        isinstance(current_sha, str)
        and isinstance(approved_sha, str)
        and current_sha == approved_sha
    )
    reasons = []
    if not fingerprint_matches:
        reasons.append("SOURCE_FINGERPRINT_CHANGED")
    if missing:
        reasons.append("APPROVED_SOURCE_CELL_REMOVED")
    if added:
        reasons.append("UNREVIEWED_SOURCE_CELL_ADDED")

    return {
        "status": "PASS" if not reasons else "REVIEW_REQUIRED",
        "currentSourceSha256": current_sha,
        "approvedSourceSha256": approved_sha,
        "currentLogicalSourceCellCount": len(current_cells),
        "approvedLogicalSourceCellCount": len(approved_cells),
        "missingApprovedSourceCells": missing,
        "newUnreviewedSourceCells": added,
        "reasonCodes": reasons,
        "semanticDecisionReuseAllowed": not reasons,
        "note": (
            "Structural comparison only. A changed source fingerprint always requires fresh semantic review; "
            "matching cell coordinates do not authorize reuse of prior semantic decisions."
        ),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump", required=True)
    parser.add_argument("--decisions", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--min-row", type=int, required=True)
    parser.add_argument("--max-row", type=int, required=True)
    parser.add_argument("--min-col", type=int, required=True)
    parser.add_argument("--max-col", type=int, required=True)
    args = parser.parse_args()

    workbook_dump = json.loads(Path(args.dump).read_text(encoding="utf-8"))
    decisions = json.loads(Path(args.decisions).read_text(encoding="utf-8"))
    review = build_source_change_review(
        workbook_dump=workbook_dump,
        decisions=decisions,
        min_row=args.min_row,
        max_row=args.max_row,
        min_col=args.min_col,
        max_col=args.max_col,
    )
    Path(args.output).write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(review, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
