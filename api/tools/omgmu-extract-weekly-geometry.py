#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

DAY_BY_NAME = {
    "понедельник": 1,
    "вторник": 2,
    "среда": 3,
    "четверг": 4,
    "пятница": 5,
    "суббота": 6,
}
GROUP_RE = re.compile(r"\d{3,4}")
RUSSIAN_MARKER = "РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ"
ALIASES_MARKER = "Обозначения и сокращения:"


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip()


def decode_day(value: Any) -> int | None:
    letters = re.sub(r"[^а-яё]", "", str(value or "").lower())
    for candidate in (letters, letters[::-1]):
        for name, weekday in DAY_BY_NAME.items():
            if candidate == name or candidate.startswith(name) or (len(candidate) >= 5 and name.startswith(candidate)):
                return weekday
    return None


def extract_source_aliases(page_text: str) -> list[dict[str, str]]:
    marker_index = page_text.find(ALIASES_MARKER)
    if marker_index < 0:
        return []

    aliases: list[dict[str, str]] = []
    lines = page_text[marker_index:].splitlines()
    for line_index, raw_line in enumerate(lines):
        line = compact(raw_line)
        if line_index == 0 and line.startswith(ALIASES_MARKER):
            line = compact(line[len(ALIASES_MARKER):])
        if not line:
            continue
        match = re.match(r"^(.+?)\s*-\s+(.+)$", line)
        if not match:
            continue
        alias = compact(match.group(1))
        expansion = compact(match.group(2))
        if alias and expansion:
            aliases.append({"alias": alias, "expansion": expansion})
    return aliases


def header_groups(table: Any, extracted: list[list[Any]]) -> list[dict[str, Any]]:
    if not extracted or not table.rows:
        return []
    header_cells = table.rows[0].cells
    result: list[dict[str, Any]] = []
    for column_index, value in enumerate(extracted[0][1:], start=1):
        code = compact(value)
        if not GROUP_RE.fullmatch(code):
            continue
        if column_index >= len(header_cells) or header_cells[column_index] is None:
            continue
        x0, _y0, x1, _y1 = header_cells[column_index]
        result.append({"code": code, "x0": round(x0, 3), "x1": round(x1, 3)})
    return result


def choose_russian_table(pdf_path: Path) -> tuple[int, Any, list[list[Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, str]]]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required; install tools/requirements-omgmu.txt") from error

    candidates: list[tuple[int, int, Any, Any, list[list[Any]], list[dict[str, Any]], str]] = []
    with pdfplumber.open(pdf_path) as document:
        for page_number, page in enumerate(document.pages, start=1):
            page_text = page.extract_text() or ""
            if RUSSIAN_MARKER not in page_text:
                continue
            cyrillic_score = len(re.findall(r"[А-Яа-яЁё]", page_text))
            for table in page.find_tables():
                extracted = table.extract()
                groups = header_groups(table, extracted)
                if len(groups) < 2:
                    continue
                candidates.append((len(groups) * 1000 + cyrillic_score, page_number, page, table, extracted, groups, page_text))

        if not candidates:
            raise RuntimeError(f"OMG_WEEKLY_RU_GEOMETRY_NOT_FOUND: {pdf_path}")

        _score, page_number, _page, table, extracted, groups, page_text = max(candidates, key=lambda item: item[0])
        rows: list[dict[str, Any]] = []
        weekday: int | None = None
        for row_index, (row, values) in enumerate(zip(table.rows[1:], extracted[1:]), start=1):
            day = decode_day(values[0] if values else None)
            if day is not None:
                weekday = day

            cells: list[dict[str, Any]] = []
            for column_index, cell in enumerate(row.cells[1:], start=1):
                if cell is None:
                    continue
                text = str(values[column_index] or "").strip() if column_index < len(values) else ""
                if not text:
                    continue
                x0, y0, x1, y1 = cell
                covered_groups = [
                    group["code"]
                    for group in groups
                    if group["x0"] >= x0 - 0.05 and group["x1"] <= x1 + 0.05
                ]
                if not covered_groups:
                    continue
                cells.append({
                    "bbox": [round(x0, 3), round(y0, 3), round(x1, 3), round(y1, 3)],
                    "groups": covered_groups,
                    "text": text,
                })

            if cells:
                rows.append({"rowIndex": row_index, "weekday": weekday, "cells": cells})

        return page_number, table, extracted, groups, rows, extract_source_aliases(page_text)


def extract_weekly_geometry(pdf_path: Path) -> dict[str, Any]:
    page_number, table, _extracted, groups, rows, source_aliases = choose_russian_table(pdf_path)
    return {
        "version": 1,
        "sourceProfile": "weekly_grid",
        "sourceLanguage": "ru",
        "pageNumber": page_number,
        "tableBbox": [round(value, 3) for value in table.bbox],
        "groups": groups,
        "sourceAliases": source_aliases,
        "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract authoritative weekly_grid cell geometry from an ОмГМУ PDF")
    parser.add_argument("--input", required=True, help="Input official PDF")
    parser.add_argument("--output", required=True, help="Output geometry JSON")
    args = parser.parse_args()

    pdf_path = Path(args.input)
    output_path = Path(args.output)
    geometry = extract_weekly_geometry(pdf_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(geometry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"weekly_grid geometry: page={geometry['pageNumber']} "
        f"groups={len(geometry['groups'])} rows={len(geometry['rows'])} aliases={len(geometry['sourceAliases'])} -> {output_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
