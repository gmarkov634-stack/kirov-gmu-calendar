#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

RUSSIAN_TITLE = "РАСПИСАНИЕ ЦИКЛОВЫХ ЗАНЯТИЙ"
CYCLE_RE = re.compile(r"(\d+)\s*цикл\s*:\s*(\d{2}\.\d{2})\s*[-–]\s*(\d{2}\.\d{2})(.*)", re.I)
GROUP_RE = re.compile(r"\d{3,4}")
HOLIDAY_LINE_RE = re.compile(r"Праздничные\s+дни\s*:\s*([^\n\r]+)", re.I)
DATE_TOKEN_RE = re.compile(r"(?<!\d)(\d{2}\.\d{2})(?!\d)")


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip()


def covered_groups(cell: tuple[float, float, float, float], groups: list[dict[str, Any]]) -> list[str]:
    x0, _y0, x1, _y1 = cell
    return [
        group["code"]
        for group in groups
        if group["x0"] >= x0 - 0.05 and group["x1"] <= x1 + 0.05
    ]


def extract_cycle_geometry(pdf_path: Path) -> dict[str, Any]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required; install tools/requirements-omgmu.txt") from error

    cycles: list[dict[str, Any]] = []
    source_calendar_exceptions: list[str] = []
    with pdfplumber.open(pdf_path) as document:
        russian_started = False
        for page_number, page in enumerate(document.pages, start=1):
            page_text = page.extract_text() or ""
            if RUSSIAN_TITLE in page_text:
                russian_started = True
            if not russian_started:
                continue

            for match in HOLIDAY_LINE_RE.finditer(page_text):
                for token in DATE_TOKEN_RE.findall(match.group(1)):
                    if token not in source_calendar_exceptions:
                        source_calendar_exceptions.append(token)

            tables = page.find_tables()
            if not tables:
                continue
            table = max(tables, key=lambda candidate: candidate.bbox[2] - candidate.bbox[0])
            extracted = table.extract()
            if not extracted:
                continue

            cycle_row_index = None
            cycle_match = None
            for index, values in enumerate(extracted):
                line = compact(values[0] if values else "")
                match = CYCLE_RE.search(line)
                if match:
                    cycle_row_index = index
                    cycle_match = match
                    break
            if cycle_match is None or cycle_row_index is None:
                continue

            header_index = None
            for index in range(cycle_row_index + 1, len(extracted)):
                row_text = [compact(value) for value in extracted[index]]
                if "Дисциплина" in row_text and "Время" in row_text and "К.дн." in row_text:
                    header_index = index
                    break
            if header_index is None:
                raise RuntimeError(f"OMG_CYCLE_HEADER_NOT_FOUND: page {page_number}")

            header_values = [compact(value) for value in extracted[header_index]]
            header_cells = table.rows[header_index].cells
            discipline_col = header_values.index("Дисциплина")
            time_col = header_values.index("Время")
            kdays_col = header_values.index("К.дн.")

            groups: list[dict[str, Any]] = []
            group_columns: dict[int, str] = {}
            for column_index, value in enumerate(header_values):
                if not GROUP_RE.fullmatch(value):
                    continue
                cell = header_cells[column_index]
                if cell is None:
                    continue
                x0, _y0, x1, _y1 = cell
                group_columns[column_index] = value
                groups.append({"code": value, "x0": round(x0, 3), "x1": round(x1, 3)})
            if len(groups) < 2:
                raise RuntimeError(f"OMG_CYCLE_GROUP_COLUMNS_NOT_FOUND: page {page_number}")

            rows: list[dict[str, Any]] = []
            inherited_discipline = ""
            for row_index in range(header_index + 1, len(extracted)):
                values = extracted[row_index]
                row = table.rows[row_index]
                discipline = compact(values[discipline_col] if discipline_col < len(values) else "")
                inherited = False
                if discipline:
                    inherited_discipline = discipline
                elif inherited_discipline:
                    discipline = inherited_discipline
                    inherited = True

                time_text = compact(values[time_col] if time_col < len(values) else "")
                kdays_text = compact(values[kdays_col] if kdays_col < len(values) else "")
                if not discipline or not time_text or not kdays_text.isdigit():
                    continue

                group_cells: list[dict[str, Any]] = []
                for column_index in group_columns:
                    if column_index >= len(row.cells):
                        continue
                    cell = row.cells[column_index]
                    if cell is None:
                        continue
                    text = str(values[column_index] or "").strip() if column_index < len(values) else ""
                    if not text:
                        continue
                    span = covered_groups(cell, groups)
                    if not span:
                        continue
                    x0, y0, x1, y1 = cell
                    group_cells.append({
                        "groups": span,
                        "text": text,
                        "bbox": [round(x0, 3), round(y0, 3), round(x1, 3), round(y1, 3)],
                    })

                if group_cells:
                    disc_cell = row.cells[discipline_col] if discipline_col < len(row.cells) else None
                    time_cell = row.cells[time_col] if time_col < len(row.cells) else None
                    kdays_cell = row.cells[kdays_col] if kdays_col < len(row.cells) else None
                    rows.append({
                        "rowIndex": row_index,
                        "discipline": discipline,
                        "disciplineInherited": inherited,
                        "disciplineBbox": [round(v, 3) for v in disc_cell] if disc_cell else None,
                        "timeText": time_text,
                        "timeBbox": [round(v, 3) for v in time_cell] if time_cell else None,
                        "declaredDays": int(kdays_text),
                        "kDaysBbox": [round(v, 3) for v in kdays_cell] if kdays_cell else None,
                        "groupCells": group_cells,
                    })

            cycles.append({
                "cycleNo": int(cycle_match.group(1)),
                "pageNumber": page_number,
                "envelope": {
                    "start": cycle_match.group(2),
                    "end": cycle_match.group(3),
                    "raw": compact(extracted[cycle_row_index][0]),
                    "withoutSaturday": "без суббот" in cycle_match.group(4).lower(),
                },
                "tableBbox": [round(value, 3) for value in table.bbox],
                "groups": groups,
                "rows": rows,
            })

    if not cycles:
        raise RuntimeError(f"OMG_CYCLE_RU_GEOMETRY_NOT_FOUND: {pdf_path}")

    return {
        "version": 1,
        "sourceProfile": "cycle_rotation_grid",
        "sourceLanguage": "ru",
        "sourceCalendarExceptions": source_calendar_exceptions,
        "cycles": cycles,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Russian cycle_rotation_grid geometry from ОмГМУ PDF")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    geometry = extract_cycle_geometry(Path(args.input))
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(geometry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        "cycle_rotation_grid geometry: "
        + ", ".join(
            f"cycle {cycle['cycleNo']} page={cycle['pageNumber']} rows={len(cycle['rows'])}"
            for cycle in geometry["cycles"]
        )
        + f" holidays={','.join(geometry['sourceCalendarExceptions']) or '-'}"
        + f" -> {output_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
